import { DEFAULT_AGENT, LIVE_VOICES, type AgentConfig } from "./agent.js";
import { compareEvaluations, evaluateCall, formatTranscript, type Evaluation } from "./eval.js";
import { BUILTIN_SCENARIOS, sanitizeScenario, type Scenario } from "./scenarios.js";

const MAX_AGENTS = 50;
const MAX_VERSIONS = 40;
const MAX_SCENARIOS = 50;
const MAX_SIMS = 80;

export const PERSONALITIES = [
  "professional",
  "friendly",
  "concise",
  "empathetic",
  "confident",
  "persuasive",
  "casual",
] as const;

export type Personality = (typeof PERSONALITIES)[number];

export interface AgentVersion {
  version: number;
  name: string;
  prompt: string;
  voice: string;
  greeting: string;
  personality: Personality;
  personalityNotes: string;
  role: string;
  createdAt: number;
  note: string;
}

export interface StoredAgent {
  id: string;
  name: string;
  description: string;
  role: string;
  industry: string;
  language: string;
  personality: Personality;
  personalityNotes: string;
  voice: string;
  greeting: string;
  prompt: string;
  activeVersion: number;
  versions: AgentVersion[];
  createdAt: number;
  updatedAt: number;
}

export interface SimulationRecord {
  id: string;
  createdAt: number;
  mode: "manual" | "persona";
  agentId?: string;
  agentName: string;
  version: number;
  scenarioId?: string;
  scenarioName?: string;
  provider: string;
  fallbackUsed: boolean;
  fallbackReason?: string;
  durationMs: number;
  turnCount: number;
  interruptions: number;
  transcript: string;
  evaluation: Evaluation;
}

export interface SimulationSummary {
  id: string;
  createdAt: number;
  mode: "manual" | "persona";
  agentName: string;
  version: number;
  scenarioName?: string;
  provider: string;
  fallbackUsed: boolean;
  durationMs: number;
  score: number;
  passed: boolean;
}

export interface SimDraft {
  mode?: string;
  agentId?: string;
  agentName?: string;
  version?: number;
  scenarioId?: string;
  provider?: string;
  fallbackUsed?: boolean;
  fallbackReason?: string;
  durationMs?: number;
  interruptions?: number;
  turns?: Array<{ speaker?: string; text?: string }>;
  transcript?: string;
}

export interface AgentDraft {
  name?: string;
  description?: string;
  role?: string;
  industry?: string;
  language?: string;
  personality?: string;
  personalityNotes?: string;
  voice?: string;
  greeting?: string;
  prompt?: string;
  note?: string;
}

function clip(value: unknown, max: number, fallback = ""): string {
  return String(value ?? fallback).replace(/[\u0000-\u001f]/g, " ").trim().slice(0, max);
}

function id(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function personalityOf(value: unknown): Personality {
  const v = clip(value, 32).toLowerCase();
  return (PERSONALITIES as readonly string[]).includes(v) ? (v as Personality) : "professional";
}

function voiceOf(value: unknown): string {
  const v = clip(value, 64, "ava");
  return LIVE_VOICES.some((x) => x.id === v) ? v : "ava";
}

function snapshot(agent: StoredAgent, note: string): AgentVersion {
  return {
    version: agent.activeVersion,
    name: agent.name,
    prompt: agent.prompt,
    voice: agent.voice,
    greeting: agent.greeting,
    personality: agent.personality,
    personalityNotes: agent.personalityNotes,
    role: agent.role,
    createdAt: Date.now(),
    note: clip(note, 120) || `Snapshot v${agent.activeVersion}`,
  };
}

function seedAgent(): StoredAgent {
  const now = Date.now();
  const agent: StoredAgent = {
    id: "agt_acme",
    name: DEFAULT_AGENT.name,
    description: "Front-desk voice agent for inbound support and routing.",
    role: "Receptionist",
    industry: "SaaS",
    language: "en",
    personality: "professional",
    personalityNotes: "Warm, brief, never invent account details.",
    voice: DEFAULT_AGENT.voice,
    greeting: DEFAULT_AGENT.greeting ?? "",
    prompt: DEFAULT_AGENT.prompt,
    activeVersion: 1,
    versions: [],
    createdAt: now,
    updatedAt: now,
  };
  agent.versions = [snapshot(agent, "Initial version")];
  return agent;
}

export function agentToLiveConfig(agent: StoredAgent, version?: number): AgentConfig {
  const snap = version
    ? agent.versions.find((v) => v.version === version)
    : agent.versions.find((v) => v.version === agent.activeVersion);
  const src = snap ?? agent;
  return {
    name: src.name,
    prompt: composePrompt(src),
    voice: src.voice,
    greeting: "greeting" in src ? src.greeting : agent.greeting,
    version: snap?.version ?? agent.activeVersion,
    agentId: agent.id,
  };
}

function composePrompt(src: {
  prompt: string;
  personality: string;
  personalityNotes?: string;
  role?: string;
}): string {
  const bits = [
    src.prompt,
    src.role ? `Role: ${src.role}.` : "",
    `Personality: ${src.personality}.`,
    src.personalityNotes ? `Voice notes: ${src.personalityNotes}` : "",
  ].filter(Boolean);
  return bits.join(" ").slice(0, 8_000);
}

function toSummary(sim: SimulationRecord): SimulationSummary {
  return {
    id: sim.id,
    createdAt: sim.createdAt,
    mode: sim.mode,
    agentName: sim.agentName,
    version: sim.version,
    scenarioName: sim.scenarioName,
    provider: sim.provider,
    fallbackUsed: sim.fallbackUsed,
    durationMs: sim.durationMs,
    score: sim.evaluation.scores.overall,
    passed: sim.evaluation.passed,
  };
}

export function createSimulatorCatalog() {
  const agents = new Map<string, StoredAgent>();
  const scenarios = new Map<string, Scenario>();
  const sims = new Map<string, SimulationRecord>();

  const seeded = seedAgent();
  agents.set(seeded.id, seeded);
  for (const scn of BUILTIN_SCENARIOS) scenarios.set(scn.id, scn);

  return {
    listAgents(): StoredAgent[] {
      return [...agents.values()].sort((a, b) => b.updatedAt - a.updatedAt);
    },
    getAgent(agentId: string): StoredAgent | undefined {
      return agents.get(clip(agentId, 64));
    },
    createAgent(draft: AgentDraft): StoredAgent {
      if (agents.size >= MAX_AGENTS) throw new Error("Agent limit reached.");
      const now = Date.now();
      const agent: StoredAgent = {
        id: id("agt"),
        name: clip(draft.name, 80) || "Untitled agent",
        description: clip(draft.description, 240),
        role: clip(draft.role, 80) || "Voice agent",
        industry: clip(draft.industry, 80),
        language: clip(draft.language, 16, "en") || "en",
        personality: personalityOf(draft.personality),
        personalityNotes: clip(draft.personalityNotes, 500),
        voice: voiceOf(draft.voice),
        greeting: clip(draft.greeting, 500) || "Hi, how can I help you today?",
        prompt: clip(draft.prompt, 8_000) || DEFAULT_AGENT.prompt,
        activeVersion: 1,
        versions: [],
        createdAt: now,
        updatedAt: now,
      };
      agent.versions = [snapshot(agent, clip(draft.note, 120) || "v1")];
      agents.set(agent.id, agent);
      return agent;
    },
    updateAgent(agentId: string, draft: AgentDraft): StoredAgent {
      const agent = agents.get(clip(agentId, 64));
      if (!agent) throw new Error("Agent not found.");
      const nextName = clip(draft.name, 80) || agent.name;
      const nextPrompt = clip(draft.prompt, 8_000) || agent.prompt;
      const nextVoice = voiceOf(draft.voice ?? agent.voice);
      const nextGreeting = draft.greeting !== undefined ? clip(draft.greeting, 500) : agent.greeting;
      const nextPersonality = personalityOf(draft.personality ?? agent.personality);
      const nextNotes = draft.personalityNotes !== undefined ? clip(draft.personalityNotes, 500) : agent.personalityNotes;
      const nextRole = draft.role !== undefined ? clip(draft.role, 80) || agent.role : agent.role;
      const changed =
        nextName !== agent.name ||
        nextPrompt !== agent.prompt ||
        nextVoice !== agent.voice ||
        nextGreeting !== agent.greeting ||
        nextPersonality !== agent.personality ||
        nextNotes !== agent.personalityNotes ||
        nextRole !== agent.role;
      if (changed) {
        if (agent.versions.length >= MAX_VERSIONS) agent.versions.shift();
        agent.activeVersion += 1;
        agent.name = nextName;
        agent.prompt = nextPrompt;
        agent.voice = nextVoice;
        agent.greeting = nextGreeting;
        agent.personality = nextPersonality;
        agent.personalityNotes = nextNotes;
        agent.role = nextRole;
        agent.versions.push(snapshot(agent, clip(draft.note, 120) || `v${agent.activeVersion}`));
      }
      if (draft.description !== undefined) agent.description = clip(draft.description, 240);
      if (draft.industry !== undefined) agent.industry = clip(draft.industry, 80);
      if (draft.language !== undefined) agent.language = clip(draft.language, 16, "en") || "en";
      agent.updatedAt = Date.now();
      return agent;
    },
    activateVersion(agentId: string, version: number): StoredAgent {
      const agent = agents.get(clip(agentId, 64));
      if (!agent) throw new Error("Agent not found.");
      const snap = agent.versions.find((v) => v.version === version);
      if (!snap) throw new Error("Version not found.");
      agent.name = snap.name;
      agent.prompt = snap.prompt;
      agent.voice = snap.voice;
      agent.greeting = snap.greeting;
      agent.personality = snap.personality;
      agent.personalityNotes = snap.personalityNotes;
      agent.role = snap.role;
      agent.activeVersion = snap.version;
      agent.updatedAt = Date.now();
      return agent;
    },
    listScenarios(): Scenario[] {
      return [...scenarios.values()];
    },
    getScenario(scenarioId: string): Scenario | undefined {
      return scenarios.get(clip(scenarioId, 64));
    },
    createScenario(input: unknown): Scenario {
      if (scenarios.size >= MAX_SCENARIOS) throw new Error("Scenario limit reached.");
      const scn = sanitizeScenario({ ...(input as object), id: id("scn"), builtIn: false });
      scenarios.set(scn.id, scn);
      return scn;
    },
    updateScenario(scenarioId: string, input: unknown): Scenario {
      const current = scenarios.get(clip(scenarioId, 64));
      if (!current) throw new Error("Scenario not found.");
      if (current.builtIn) throw new Error("Built-in scenarios cannot be edited. Duplicate them instead.");
      const scn = sanitizeScenario({ ...(input as object), id: current.id, builtIn: false });
      scenarios.set(scn.id, scn);
      return scn;
    },
    recordSimulation(draft: SimDraft): SimulationRecord {
      const mode = draft.mode === "persona" ? "persona" : "manual";
      const agent = agents.get(clip(draft.agentId, 64));
      const scenario = scenarios.get(clip(draft.scenarioId, 64));
      const turns = Array.isArray(draft.turns) ? draft.turns : [];
      const rawTranscript = String(draft.transcript ?? "").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, " ");
      const transcript =
        rawTranscript.trim().slice(0, 8_000) ||
        formatTranscript(
          turns.map((t) => ({
            speaker: t.speaker === "agent" ? "agent" : "user",
            text: String(t.text ?? ""),
          })),
        );
      const durationMs = Math.max(0, Math.min(15 * 60 * 1000, Number(draft.durationMs) || 0));
      const interruptions = Math.max(0, Math.min(100, Math.floor(Number(draft.interruptions) || 0)));
      const turnCount = Math.max(turns.filter((t) => String(t.text ?? "").trim()).length, transcript ? 1 : 0);
      const evaluation = evaluateCall({
        transcript,
        scenario,
        durationMs,
        turnCount,
        interruptions,
        fallbackUsed: Boolean(draft.fallbackUsed),
      });
      const sim: SimulationRecord = {
        id: id("sim"),
        createdAt: Date.now(),
        mode,
        agentId: agent?.id,
        agentName: clip(draft.agentName, 80) || agent?.name || "Agent",
        version: Number.isInteger(draft.version) && Number(draft.version) > 0 ? Number(draft.version) : agent?.activeVersion ?? 1,
        scenarioId: scenario?.id,
        scenarioName: scenario?.name,
        provider: clip(draft.provider, 32, "mock") || "mock",
        fallbackUsed: Boolean(draft.fallbackUsed),
        fallbackReason: clip(draft.fallbackReason, 40) || undefined,
        durationMs,
        turnCount,
        interruptions,
        transcript,
        evaluation,
      };
      if (sims.size >= MAX_SIMS) {
        const oldest = [...sims.values()].sort((a, b) => a.createdAt - b.createdAt)[0];
        if (oldest) sims.delete(oldest.id);
      }
      sims.set(sim.id, sim);
      return sim;
    },
    listSimulations(): SimulationSummary[] {
      return [...sims.values()].reverse().map(toSummary);
    },
    getSimulation(simId: string): SimulationRecord | undefined {
      return sims.get(clip(simId, 64));
    },
    dashboard() {
      const all = [...sims.values()];
      const n = all.length;
      const passed = all.filter((s) => s.evaluation.passed).length;
      const fallbacks = all.filter((s) => s.fallbackUsed).length;
      const avg = (pick: (s: SimulationRecord) => number) =>
        n ? Math.round(all.reduce((sum, s) => sum + pick(s), 0) / n) : 0;
      return {
        total: n,
        passed,
        failed: n - passed,
        successRate: n ? Math.round((passed / n) * 1000) / 10 : 0,
        avgScore: avg((s) => s.evaluation.scores.overall),
        avgLatencyMs: avg((s) => s.durationMs / Math.max(1, s.turnCount)),
        fallbackRate: n ? Math.round((fallbacks / n) * 1000) / 10 : 0,
        recent: [...all].reverse().slice(0, 12).map(toSummary),
      };
    },
    compareSimulations(aId: string, bId: string) {
      const a = sims.get(clip(aId, 64));
      const b = sims.get(clip(bId, 64));
      if (!a || !b) throw new Error("Pick two saved simulations.");
      return {
        a: toSummary(a),
        b: toSummary(b),
        evalA: a.evaluation,
        evalB: b.evaluation,
        deltas: compareEvaluations(a.evaluation, b.evaluation),
      };
    },
  };
}

export type SimulatorCatalog = ReturnType<typeof createSimulatorCatalog>;
