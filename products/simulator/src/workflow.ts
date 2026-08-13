import { type Platform, type WorkflowDef, Capability, ZERO_USAGE } from "@pyai/core";
import { pickPersona, pickScenario, type Persona, type AdversarialScenario, PERSONAS } from "./personas.js";

export interface SimulatorRunInput {
  agentName?: string;
  agentPrompt?: string;
  personaId?: string;
  scenarioId?: string;
  count?: number;
  concurrency?: number;
  llmProvider?: string;
}

export interface CallResult {
  callId: string;
  persona: string;
  scenario: string;
  passed: boolean;
  score: number;
  failures: string[];
  warnings: string[];
  latencyMs: number;
  transcript: string;
  costUsd: number;
}

export interface BenchmarkCard {
  agent: string;
  tests: number;
  passed: number;
  failed: number;
  score: number;
  medianLatencyMs: number;
  worstFailure?: string;
  costUsd: number;
  calls: CallResult[];
}

/**
 * Voice agent stress test (spec #51–#54).
 * Runs N independent adversarial callers (safe parallelism), scores each call,
 * and produces a shareable benchmark card. Uses LLM when available; otherwise
 * a deterministic mock scorer so Demo Mode works offline.
 */
export function buildSimulatorWorkflow(
  platform: Platform,
  input: SimulatorRunInput,
): { def: WorkflowDef; getArtifact: () => BenchmarkCard } {
  const count = Math.min(Math.max(input.count ?? 10, 1), 100);
  const concurrency = Math.min(Math.max(input.concurrency ?? 5, 1), 20);
  const agent = input.agentName ?? "Acme Receptionist";
  const calls: CallResult[] = [];

  const def: WorkflowDef = {
    id: "simulator_stress_test",
    product: "simulator",
    version: "simulator.stress.v1",
    budget: {
      maxDurationMs: 300_000,
      maxTokens: 500_000,
      maxAudioMinutes: 60,
      maxCostUsd: 2,
      maxRetries: 1,
      maxParallelTasks: concurrency,
    },
    tasks: [
      {
        id: "batch",
        label: `Run ${count} adversarial callers`,
        estimate: { inputTokens: count * 500 },
        run: async () => {
          const batches: number[][] = [];
          for (let i = 0; i < count; i += concurrency) {
            batches.push(Array.from({ length: Math.min(concurrency, count - i) }, (_, j) => i + j));
          }
          for (const batch of batches) {
            const results = await Promise.all(
              batch.map((idx) =>
                runOneCall(platform, {
                  idx,
                  persona: pickPersona(input.personaId ?? PERSONAS[idx % PERSONAS.length]!.id),
                  scenario: pickScenario(input.scenarioId),
                  agentPrompt: input.agentPrompt ?? "You are a helpful voice agent. Be brief and accurate.",
                  agentName: agent,
                  llmProvider: input.llmProvider,
                }),
              ),
            );
            calls.push(...results);
          }
          return { count: calls.length, usage: { ...ZERO_USAGE, providerCalls: calls.length, costUsd: calls.reduce((s, c) => s + c.costUsd, 0) } };
        },
      },
    ],
  };

  return {
    def,
    getArtifact: () => buildCard(agent, calls),
  };
}

async function runOneCall(
  platform: Platform,
  opts: {
    idx: number;
    persona: Persona;
    scenario: AdversarialScenario;
    agentPrompt: string;
    agentName: string;
    llmProvider?: string;
  },
): Promise<CallResult> {
  const t0 = Date.now();
  const callId = `call_${opts.idx + 1}`;
  const adapter = platform.registry.getAdapterFor(Capability.LLM, opts.llmProvider);
  const llm = adapter?.asLLM;

  const userScript = [
    `Persona: ${opts.persona.label} (${opts.persona.emotionalState}, patience=${opts.persona.patience})`,
    `Goal: ${opts.persona.goal}`,
    `Scenario: ${opts.scenario.label} — ${opts.scenario.behaviors.join(", ")}`,
    `Caller opening: ${opts.persona.openingLine}`,
    `Agent system: ${opts.agentPrompt}`,
    `Respond as the AGENT in 2-4 short turns. Then score yourself.`,
  ].join("\n");

  let transcript = `Caller: ${opts.persona.openingLine}\n`;
  let costUsd = 0;
  let agentReply = "";

  if (llm) {
    try {
      const res = await llm().complete({
        messages: [
          { role: "system", content: opts.agentPrompt },
          { role: "user", content: userScript },
        ],
        temperature: 0.4,
        maxTokens: 400,
      });
      agentReply = res.text;
      costUsd = res.usage.costUsd;
      transcript += `Agent: ${agentReply}\n`;
    } catch (e) {
      return {
        callId,
        persona: opts.persona.id,
        scenario: opts.scenario.id,
        passed: false,
        score: 0,
        failures: [`provider_error: ${String(e)}`],
        warnings: [],
        latencyMs: Date.now() - t0,
        transcript,
        costUsd,
      };
    }
  } else {
    agentReply = mockAgentReply(opts.persona);
    transcript += `Agent: ${agentReply}\n`;
  }

  const scored = scoreCall(opts.persona, opts.scenario, agentReply);
  return {
    callId,
    persona: opts.persona.id,
    scenario: opts.scenario.id,
    ...scored,
    latencyMs: Date.now() - t0,
    transcript,
    costUsd,
  };
}

function mockAgentReply(persona: Persona): string {
  if (persona.id === "angry_customer") {
    return "I hear your frustration. I can start a refund review now and confirm within one business day.";
  }
  if (persona.id === "silent_customer") {
    return "Hi — I'm here to help. What can I assist you with today?";
  }
  return "Happy to help. Could you share a bit more detail so I can take the right next step?";
}

function scoreCall(
  persona: Persona,
  scenario: AdversarialScenario,
  reply: string,
): { passed: boolean; score: number; failures: string[]; warnings: string[] } {
  const failures: string[] = [];
  const warnings: string[] = [];
  let score = 100;
  const lower = reply.toLowerCase();

  if (reply.trim().length < 20) {
    failures.push("response_too_short");
    score -= 40;
  }
  if (persona.patience === "low" && /please hold|one moment while I transfer/i.test(reply)) {
    failures.push("triggered_low_patience_hold");
    score -= 30;
  }
  for (const trigger of persona.failureTriggers) {
    if (lower.includes(trigger.toLowerCase())) {
      failures.push(`failure_trigger:${trigger}`);
      score -= 20;
    }
  }
  if (scenario.id === "escalate" && !/supervisor|human|specialist|transfer/i.test(reply)) {
    warnings.push("missed_escalation_path");
    score -= 10;
  }
  if (/as an ai|language model/i.test(reply)) {
    warnings.push("broke_character");
    score -= 5;
  }
  score = Math.max(0, Math.min(100, score));
  return { passed: failures.length === 0 && score >= 70, score, failures, warnings };
}

function buildCard(agent: string, calls: CallResult[]): BenchmarkCard {
  const passed = calls.filter((c) => c.passed).length;
  const failed = calls.length - passed;
  const latencies = [...calls.map((c) => c.latencyMs)].sort((a, b) => a - b);
  const medianLatencyMs = latencies[Math.floor(latencies.length / 2)] ?? 0;
  const worst = calls.filter((c) => !c.passed).sort((a, b) => a.score - b.score)[0];
  const score = calls.length ? Math.round(calls.reduce((s, c) => s + c.score, 0) / calls.length) : 0;
  return {
    agent,
    tests: calls.length,
    passed,
    failed,
    score,
    medianLatencyMs,
    worstFailure: worst ? `${worst.callId}: ${worst.failures.join(", ") || "low_score"}` : undefined,
    costUsd: calls.reduce((s, c) => s + c.costUsd, 0),
    calls,
  };
}

export * from "./personas.js";
