import type { Capability, ModelInfo, ProviderHealth } from "../types.js";
import {
  type ProviderAdapter,
  type STTAdapter,
  type STTRequest,
  type TranscriptResult,
  type TranscriptSegment,
  type LLMAdapter,
  type LLMRequest,
  type LLMResult,
  type TTSAdapter,
  type TTSResult,
  type EmbeddingsAdapter,
} from "./adapter.js";

/**
 * MockProvider — a fully-functional, deterministic provider used for local
 * development, demos and tests WITHOUT any API key (spec #28, #69). It emits
 * believable, evidence-linked transcripts and structured extractions so the
 * entire platform — gates, budgets, runs, playground — works offline.
 *
 * It is also the reference implementation: real adapters (PyAI/OpenAI/Gemini)
 * return the same shapes and the same `{ usage }` contract.
 */
export class MockProvider implements ProviderAdapter {
  readonly id = "mock";
  readonly name = "Mock (local, no network)";
  readonly capabilities: Capability[] = [
    "streaming_stt",
    "batch_stt",
    "speaker_diarization",
    "llm",
    "reasoning_llm",
    "structured_output",
    "tool_calling",
    "tts",
    "streaming_tts",
    "embeddings",
  ];

  isConfigured(): boolean {
    return true; // always available
  }

  async models(): Promise<ModelInfo[]> {
    return [
      { id: "mock-hear", provider: "mock", label: "Mock Hear (STT)", capabilities: ["streaming_stt", "batch_stt", "speaker_diarization"], supportsStreaming: true, audioFormats: ["wav", "mp3", "webm"], maxInputSeconds: 3600, latencyClass: "low", pricing: { audioCostPerMinute: 0, currency: "USD" } },
      { id: "mock-flash", provider: "mock", label: "Mock Flash (LLM)", capabilities: ["llm", "structured_output", "tool_calling"], contextWindow: 128_000, latencyClass: "low", qualityClass: "medium", pricing: { inputCostPerUnit: 0, outputCostPerUnit: 0, currency: "USD" } },
      { id: "mock-opus", provider: "mock", label: "Mock Opus (reasoning)", capabilities: ["llm", "reasoning_llm", "structured_output"], contextWindow: 200_000, latencyClass: "medium", qualityClass: "high", pricing: { inputCostPerUnit: 0, outputCostPerUnit: 0, currency: "USD" } },
      { id: "mock-speak", provider: "mock", label: "Mock Speak (TTS)", capabilities: ["tts", "streaming_tts"], latencyClass: "low", pricing: { audioCostPerMinute: 0, currency: "USD" } },
      { id: "mock-embed", provider: "mock", label: "Mock Embeddings", capabilities: ["embeddings"], latencyClass: "low", pricing: { inputCostPerUnit: 0, currency: "USD" } },
    ];
  }

  async health(): Promise<ProviderHealth> {
    return { status: "healthy", latencyMs: 0, detail: "deterministic local provider", checkedAt: Date.now() };
  }

  asSTT(): STTAdapter {
    return {
      transcribe: async (req: STTRequest): Promise<TranscriptResult> => {
        const audioSeconds = req.audio instanceof Buffer ? req.audio.length / 16_000 / 2 / 60 : 1;
        const segs = mockTranscript(req.prompt);
        return {
          segments: segs,
          text: segs.map((s) => `${s.speaker ? `${s.speaker}: ` : ""}${s.text}`).join("\n"),
          language: "en",
          usage: {
            inputTokens: 0,
            outputTokens: 0,
            audioSeconds: Math.max(1, audioSeconds),
            costUsd: 0,
            providerCalls: 1,
            cacheHits: 0,
          },
        };
      },
    };
  }

  asLLM(): LLMAdapter {
    return {
      complete: async (req: LLMRequest): Promise<LLMResult> => {
        const text = mockCompletion(req);
        const parsed = maybeParse(req, text);
        return {
          text,
          model: req.model ?? "mock-flash",
          parsed,
          usage: {
            inputTokens: estimateTokens(req),
            outputTokens: estimateTokens({ messages: [{ role: "assistant", content: text }] }),
            audioSeconds: 0,
            costUsd: 0,
            providerCalls: 1,
            cacheHits: 0,
          },
        };
      },
    };
  }

  asTTS(): TTSAdapter {
    return {
      synthesize: async (req) => {
        const audio = new TextEncoder().encode(`[mock-tts] ${req.text.slice(0, 32)}`).buffer;
        return {
          audio: new Uint8Array(audio),
          format: req.format ?? "wav",
          usage: { inputTokens: 0, outputTokens: 0, audioSeconds: req.text.length / 15, costUsd: 0, providerCalls: 1, cacheHits: 0 },
        };
      },
    };
  }

  asEmbeddings(): EmbeddingsAdapter {
    return {
      embed: async (req) => {
        const inputs = Array.isArray(req.input) ? req.input : [req.input];
        return {
          embeddings: inputs.map((t) => hashEmbed(t)),
          usage: { inputTokens: inputs.reduce((s, t) => s + Math.ceil(t.length / 4), 0), outputTokens: 0, audioSeconds: 0, costUsd: 0, providerCalls: 1, cacheHits: 0 },
        };
      },
    };
  }
}

// -- deterministic mock content --------------------------------------------

function mockTranscript(_prompt?: string): TranscriptSegment[] {
  return [
    { id: "s1", speaker: "Sales Rep", start: 0, end: 14.2, text: "Thanks for hopping on, Dana. I wanted to walk you through the enterprise plan and how rollout would work for your team." },
    { id: "s2", speaker: "Customer", start: 14.5, end: 33.0, text: "Sure. Honestly the main thing holding us back is the implementation cost. We got burned last year with a six month onboarding." },
    { id: "s3", speaker: "Sales Rep", start: 33.4, end: 48.9, text: "Totally hear that. We do white-glove onboarding in under four weeks, and a dedicated engineer for the first 90 days." },
    { id: "s4", speaker: "Customer", start: 49.2, end: 67.0, text: "That helps. But we also need to know if your security review passes our procurement. We use a competitor for the EU region today." },
    { id: "s5", speaker: "Sales Rep", start: 67.3, end: 84.1, text: "We are SOC 2 Type II and have a EU data residency option. I can loop in our solutions architect next week." },
    { id: "s6", speaker: "Customer", start: 84.5, end: 99.8, text: "Okay. If you send the security pack and a timeline, I think we can get a decision maker in the loop by end of month." },
  ];
}

function mockCompletion(req: LLMRequest): string {
  const last = [...req.messages].reverse().find((m) => m.role === "user")?.content ?? "";
  if (req.jsonSchema) {
    return JSON.stringify(buildMockJson(req.jsonSchema, last));
  }
  const dictated = extractDictationTranscript(last);
  if (dictated !== undefined) {
    return mockCleanDictation(dictated);
  }
  return `Mock analysis for: ${last.slice(0, 120).replace(/\n/g, " ")}`;
}

/** Scrib cleanup prompt — return the transcript, not "Mock analysis for: <instructions>". */
function extractDictationTranscript(userMessage: string): string | undefined {
  const marker = "Return only the cleaned transcript:";
  const idx = userMessage.indexOf(marker);
  if (idx === -1) return undefined;
  return userMessage.slice(idx + marker.length).trim();
}

function mockCleanDictation(text: string): string {
  let t = text.replace(/\b(uh+|um+|er+|like)\b/gi, "").replace(/\s{2,}/g, " ").trim();
  if (!t) return text.trim();
  t = t.charAt(0).toUpperCase() + t.slice(1);
  if (!/[.!?]$/.test(t)) t += ".";
  return t;
}

function mockBriefNotes(source: string): Record<string, unknown> {
  const lines = source.split(/\n+/).map((l) => l.trim()).filter(Boolean);
  const speakers = Array.from(
    new Set(
      lines
        .map((l) => l.match(/^([^:]+):/)?.[1]?.trim())
        .filter((x): x is string => Boolean(x))
        .map((s) => (/^me$/i.test(s) ? "You" : /^them$/i.test(s) ? "Jordan" : s)),
    ),
  );
  const lower = source.toLowerCase();
  const launch = /launch/.test(lower) && /august/.test(lower);
  const ev = (excerpt: string, speaker?: string) => ({
    source: "meeting",
    start: 12,
    end: 20,
    speaker: speaker ?? "Jordan",
    excerpt,
  });
  if (launch) {
    return {
      title: "Launch planning",
      mode: "Planning",
      summary:
        "The group decided to move the July launch to August while the security review stays open. Jordan will own the security pack by Friday. EU data residency is still an open question.",
      decisions: [
        {
          decision: "Move the product launch from July to August.",
          evidence: ev("Agreed — decision: launch moves to August.", "You"),
        },
      ],
      actionItems: [
        {
          owner: "Jordan",
          task: "Own the security pack",
          deadline: "Friday",
          evidence: ev("I'll own the security pack by Friday.", "Jordan"),
        },
      ],
      questions: [
        {
          question: "Can we keep EU data residency in scope?",
          evidence: ev("Can we keep EU data residency in scope?", "You"),
        },
      ],
      importantMoments: [
        { moment: "Launch date slips to August", start: 8, end: 16 },
        { moment: "Jordan takes the security pack", start: 16, end: 24 },
      ],
      participants: speakers.length ? speakers : ["You", "Jordan"],
    };
  }
  const first = lines[0]?.replace(/^[^:]+:\s*/, "") ?? "the discussion";
  return {
    title: "Meeting notes",
    mode: "Custom",
    summary: `The group reviewed ${first.slice(0, 100)}. Follow-ups and open questions are captured below.`,
    decisions: [
      {
        decision: "Continue with the plan discussed on the call.",
        evidence: ev(lines[0] ?? first, speakers[0]),
      },
    ],
    actionItems: [],
    questions: lines
      .filter((l) => l.includes("?"))
      .slice(0, 3)
      .map((q) => ({ question: q.replace(/^[^:]+:\s*/, ""), evidence: ev(q) })),
    importantMoments: [{ moment: first.slice(0, 100), start: 0, end: 10 }],
    participants: speakers.length ? speakers : ["You"],
  };
}

function extractLabeledTranscript(source: string): string {
  const labeled = source.match(/Labeled transcript:\s*([\s\S]*?)(?:\n\nReturn ONLY valid JSON|$)/i);
  if (labeled?.[1]?.trim()) return labeled[1].trim();
  return source.trim();
}

function mockCallIQNotes(source: string): Record<string, unknown> {
  const labeled = extractLabeledTranscript(source);
  const parsed = labeled
    .split(/\n+/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const m = l.match(/^\[([^\]]+)\]\s*(.*)$/) ?? l.match(/^([^:]+):\s*(.*)$/);
      return { speaker: m?.[1]?.trim() || "Unknown", text: (m?.[2] ?? l).trim() };
    })
    .filter((l) => l.text);
  const speakers = Array.from(new Set(parsed.map((p) => p.speaker)));
  const first = parsed[0]?.text ?? labeled.slice(0, 160);
  const who = speakers.join(" and ") || "The caller";
  const ev = (excerpt: string, speaker?: string) => ({
    source: "transcript",
    start: 0,
    end: 0,
    speaker: speaker ?? speakers[0] ?? "Unknown",
    excerpt,
  });
  const oneSided = speakers.length <= 1;
  return {
    summary: `${who} said: ${first.slice(0, 180)}${oneSided ? " No other speaker appears in the transcript." : ""}`,
    participants: speakers.length
      ? speakers.map((name, i) => ({
          name,
          role: i === 0 ? "Sales Rep" : "Customer",
          talkSeconds: 10,
        }))
      : [{ name: "Unknown", role: "Other", talkSeconds: 0 }],
    dealStage: "Discovery",
    dealHealthScore: oneSided ? 28 : 55,
    dealHealthRationale: oneSided
      ? "One-sided transcript; notes stay limited to what was spoken."
      : "Notes stay limited to the recorded speakers and quotes.",
    objections: [],
    buyingSignals: [],
    risks: oneSided
      ? [
          {
            type: "weak_buying_signal",
            detail: "Only one speaker was captured.",
            severity: "high",
            evidence: ev(first, speakers[0]),
          },
        ]
      : [],
    competitorMentions: [],
    pricingObjections: [],
    nextSteps: [],
    followUpEmail: `Hi there, thanks for the time. Following up on: ${first.slice(0, 100)}`,
    followUpSlack: `Follow-up: ${first.slice(0, 80)}`,
    crmJson: { stage: "Discovery", owner: speakers[0] ?? null, next_step: null },
  };
}

function buildMockJson(schema: Record<string, unknown>, source: string): Record<string, unknown> {
  const props = (schema.properties ?? {}) as Record<string, { type?: string; items?: { type?: string } }>;
  const isBrief = "decisions" in props && "actionItems" in props && "importantMoments" in props;
  if (isBrief) return mockBriefNotes(source);
  const isCallIQ = "dealHealthScore" in props && "objections" in props && "followUpEmail" in props;
  if (isCallIQ) return mockCallIQNotes(source);
  const out: Record<string, unknown> = {};
  const ev = (excerpt: string) => ({ source: "mock-call", start: 14.5, end: 33.0, speaker: "Customer", excerpt });
  for (const [k, v] of Object.entries(props)) {
    if (k === "summary") out[k] = `Mock summary of the call. ${source.slice(0, 80)}`;
    else if (k === "participants") {
      out[k] =
        v.items?.type === "string"
          ? ["Sales Rep", "Dana"]
          : [
              { name: "Sales Rep", role: "Sales Rep", talkSeconds: 120 },
              { name: "Dana", role: "Customer", talkSeconds: 95 },
            ];
    }
    else if (k === "dealStage") out[k] = "Evaluation";
    else if (k === "dealHealthScore") out[k] = 72;
    else if (k === "dealHealthRationale") out[k] = "Strong buying signal but unresolved pricing objection and no confirmed decision maker.";
    else if (k === "objections") out[k] = [{ type: "Pricing", detail: "Implementation cost cited as blocker from a prior bad onboarding", severity: "high", evidence: ev("honestly the main thing holding us back is the implementation cost") }];
    else if (k === "buyingSignals") out[k] = [{ type: "intent", detail: "Customer open to looping in decision maker", evidence: ev("get a decision maker in the loop by end of month") }];
    else if (k === "risks") out[k] = [{ type: "unresolved_objection", detail: "Pricing objection not yet resolved", severity: "high", evidence: ev("implementation cost") }];
    else if (k === "competitorMentions") out[k] = ["EU competitor"];
    else if (k === "pricingObjections") out[k] = ["Implementation cost too high"];
    else if (k === "nextSteps") out[k] = [{ owner: "Sales Rep", task: "Send security pack and timeline", deadline: "2026-08-20", evidence: ev("send the security pack and a timeline") }];
    else if (k === "followUpEmail") out[k] = "Hi Dana, thanks for the call. Sending the security pack and a rollout timeline today.";
    else if (k === "followUpSlack") out[k] = "Dana: sending security pack + 4-week onboarding timeline. Decision-maker sync by EOM?";
    else if (k === "crmJson") out[k] = { stage: "Evaluation", owner: "Sales Rep", next_step: "Send security pack", amount: null };
    else if (v.type === "string") out[k] = `mock ${k}`;
    else if (v.type === "number") out[k] = 1;
    else if (v.type === "array") out[k] = [];
    else if (v.type === "object") out[k] = {};
    else out[k] = null;
  }
  return out;
}

function maybeParse(req: LLMRequest, text: string): unknown {
  if (!req.jsonSchema) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function estimateTokens(req: LLMRequest): number {
  return req.messages.reduce((s, m) => s + Math.ceil(m.content.length / 4), 0);
}

function hashEmbed(text: string): number[] {
  const vec = new Array(32).fill(0);
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    vec[code % 32] += 1;
  }
  const norm = Math.sqrt(vec.reduce((s, x) => s + x * x, 0)) || 1;
  return vec.map((x) => x / norm);
}
