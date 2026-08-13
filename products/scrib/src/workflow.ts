import {
  type Platform,
  type WorkflowDef,
  Capability,
  ZERO_USAGE,
} from "@pyai/core";
import { type CleanupMode, cleanupSystemPrompt, cleanupUserMessage, looksLikeAssistantReply, resolveAppMode } from "./modes.js";
import { PersonalDictionary, type DictionaryEntry } from "./dictionary.js";

export interface ScribInput {
  /** Raw speech text, or omit and pass audio for STT. */
  rawText?: string;
  audio?: Uint8Array;
  mode?: CleanupMode;
  appName?: string;
  sttProvider?: string;
  cleanupProvider?: string;
  dictionary?: DictionaryEntry[];
  customHint?: string;
  /** Wall time of Hear/STT when transcription ran before this workflow. */
  sttMs?: number;
}

export interface ScribArtifact {
  raw: string;
  cleaned: string;
  mode: CleanupMode;
  appRuleId?: string;
  latency: {
    sttMs: number;
    cleanupMs: number;
    dictionaryMs: number;
    totalMs: number;
  };
  sttProvider: string;
  cleanupProvider: string;
}

/**
 * Dictation cleanup workflow (spec #35, #37, #40).
 * STT (optional) → dictionary → cleanup LLM → output. Never silently changes meaning.
 */
export function buildScribWorkflow(
  platform: Platform,
  input: ScribInput,
): { def: WorkflowDef; getArtifact: () => ScribArtifact } {
  const rule = resolveAppMode(input.appName);
  const mode: CleanupMode = input.mode ?? rule?.mode ?? "light";
  const dict = new PersonalDictionary();
  for (const e of input.dictionary ?? []) dict.add(e);

  let raw = input.rawText ?? "";
  let cleaned = "";
  let sttProvider = input.sttProvider ?? "inline";
  let cleanupProvider = input.cleanupProvider ?? "none";
  const latency = { sttMs: input.sttMs ?? 0, cleanupMs: 0, dictionaryMs: 0, totalMs: 0 };

  const def: WorkflowDef = {
    id: "scrib_dictation",
    product: "scrib",
    version: "scrib.dictation.v1",
    budget: {
      maxDurationMs: 30_000,
      maxTokens: 8_000,
      maxAudioMinutes: 5,
      maxCostUsd: 0.05,
      maxRetries: 2,
      maxParallelTasks: 2,
    },
    optional: mode === "raw" ? ["cleanup"] : [],
    tasks: [
      {
        id: "stt",
        label: "Speech-to-text",
        estimate: { audioSeconds: 2 },
        run: async () => {
          const t = Date.now();
          if (input.rawText) {
            raw = input.rawText;
            latency.sttMs = input.sttMs ?? 0;
            if (input.sttProvider) sttProvider = input.sttProvider;
            return { text: raw, provider: sttProvider, usage: { ...ZERO_USAGE } };
          }
          const adapter = platform.registry.getAdapterFor(Capability.BATCH_STT, input.sttProvider);
          const stt = adapter?.asSTT;
          if (!stt) throw new Error("no STT provider");
          sttProvider = adapter.id;
          const res = await stt().transcribe({ audio: input.audio ?? new Uint8Array(1) });
          raw = res.text;
          latency.sttMs = Date.now() - t;
          return { text: raw, provider: adapter.id, usage: res.usage };
        },
      },
      {
        id: "dictionary",
        label: "Personal dictionary",
        dependsOn: ["stt"],
        run: async () => {
          const t = Date.now();
          cleaned = dict.apply(raw);
          latency.dictionaryMs = Date.now() - t;
          return { text: cleaned, usage: { ...ZERO_USAGE } };
        },
      },
      {
        id: "cleanup",
        label: "Cleanup LLM",
        dependsOn: ["dictionary"],
        run: async () => {
          if (mode === "raw") {
            cleaned = dict.apply(raw);
            return { text: cleaned, provider: "none", usage: { ...ZERO_USAGE } };
          }
          const t = Date.now();
          const adapter = platform.registry.getAdapterFor(Capability.LLM, input.cleanupProvider);
          const llm = adapter?.asLLM;
          // PyAI is Hear/Speak only (no chat). Mock LLM used to echo
          // "Mock analysis for: <cleanup prompt>" into the text field.
          if (!llm || adapter.id === "mock") {
            cleaned = localCleanup(dict.apply(raw), mode);
            cleanupProvider = "local";
            latency.cleanupMs = Date.now() - t;
            return { text: cleaned, provider: "local", usage: { ...ZERO_USAGE } };
          }
          cleanupProvider = adapter.id;
          const dictated = dict.apply(raw);
          const res = await llm().complete({
            messages: [
              { role: "system", content: cleanupSystemPrompt(mode, input.customHint ?? rule?.hint) },
              { role: "user", content: cleanupUserMessage(dictated) },
            ],
            temperature: 0.1,
            maxTokens: 1024,
          });
          const candidate = res.text.trim();
          // If the model answered like a chatbot, fall back to deterministic cleanup.
          cleaned = looksLikeAssistantReply(dictated, candidate) ? localCleanup(dictated, mode) : candidate;
          latency.cleanupMs = Date.now() - t;
          return { text: cleaned, provider: adapter.id, usage: res.usage };
        },
      },
    ],
  };

  return {
    def,
    getArtifact: () => {
      latency.totalMs = latency.sttMs + latency.dictionaryMs + latency.cleanupMs;
      return {
        raw,
        cleaned: cleaned || dict.apply(raw),
        mode,
        appRuleId: rule?.id,
        latency: { ...latency },
        sttProvider,
        cleanupProvider,
      };
    },
  };
}

/** Offline deterministic cleanup for Mock/Demo paths. */
export function localCleanup(text: string, mode: CleanupMode): string {
  let t = text.replace(/\b(uh+|um+|er+|like)\b/gi, "").replace(/\s{2,}/g, " ").trim();
  if (!t) return text.trim();
  t = t.charAt(0).toUpperCase() + t.slice(1);
  if (!/[.!?]$/.test(t)) t += mode === "concise" ? "" : ".";
  if (mode === "professional") {
    t = t.replace(/\bgotta\b/gi, "have to").replace(/\bwanna\b/gi, "want to");
  }
  if (mode === "concise") {
    t = t.replace(/\b(just|really|very|actually)\b/gi, "").replace(/\s{2,}/g, " ").trim();
  }
  return t;
}
