import {
  type Platform,
  type WorkflowDef,
  Capability,
  ZERO_USAGE,
} from "@pyai/core";
import {
  type CleanupMode,
  type TabContext,
  cleanupSystemPrompt,
  cleanupUserMessage,
  isCodeField,
  localCleanup,
  looksLikeAssistantReply,
  sanitizeTabContext,
} from "./modes.js";
import { PersonalDictionary, type DictionaryEntry } from "./dictionary.js";

export interface ScribInput {
  /** Raw speech text, or omit and pass audio for STT. */
  rawText?: string;
  audio?: Uint8Array;
  mode?: CleanupMode;
  appName?: string;
  /** Focused tab + field. Cleaner uses this instead of a host→mode map. */
  tabContext?: TabContext;
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
  const appName = input.appName?.replace(/[\u0000-\u001f]/g, " ").trim().slice(0, 200) || undefined;
  const tabContext = sanitizeTabContext(input.tabContext) ?? sanitizeTabContext({ title: appName });
  const mode: CleanupMode = input.mode ?? "light";
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
          const order = [input.sttProvider, "pyai", "openai", "gemini", "mock"].filter(
            (id, i, arr): id is string => Boolean(id) && arr.indexOf(id) === i,
          );
          let lastErr = "no STT provider";
          for (const id of order) {
            const adapter = platform.registry.getAdapterFor(Capability.BATCH_STT, id);
            const stt = adapter?.asSTT;
            if (!stt || (typeof adapter.isConfigured === "function" && !adapter.isConfigured())) continue;
            try {
              const res = await stt().transcribe({ audio: input.audio ?? new Uint8Array(1) });
              const text = res.text?.trim() ?? "";
              if (!text) {
                lastErr = `${id}: empty transcript`;
                continue;
              }
              raw = text;
              sttProvider = adapter.id;
              latency.sttMs = Date.now() - t;
              return { text: raw, provider: adapter.id, usage: res.usage };
            } catch (e) {
              lastErr = `${id}: ${e instanceof Error ? e.message : "failed"}`;
            }
          }
          throw new Error(lastErr);
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
          const dictated = dict.apply(raw);
          const fallbackMode: CleanupMode = isCodeField(tabContext?.field) ? "raw" : mode;
          const order = [input.cleanupProvider, "openai", "gemini"].filter(
            (id, i, arr): id is string =>
              Boolean(id) && id !== "mock" && id !== "local" && id !== "none" && arr.indexOf(id) === i,
          );
          for (const id of order) {
            const adapter = platform.registry.getAdapterFor(Capability.LLM, id);
            const llm = adapter?.asLLM;
            if (!llm || adapter.id === "mock") continue;
            if (typeof adapter.isConfigured === "function" && !adapter.isConfigured()) continue;
            try {
              const res = await llm().complete({
                messages: [
                  { role: "system", content: cleanupSystemPrompt(mode, input.customHint, tabContext, appName) },
                  { role: "user", content: cleanupUserMessage(dictated, tabContext, appName) },
                ],
                temperature: 0.1,
                maxTokens: 1024,
              });
              const candidate = res.text.trim();
              cleaned = looksLikeAssistantReply(dictated, candidate)
                ? localCleanup(dictated, fallbackMode)
                : candidate;
              cleanupProvider = looksLikeAssistantReply(dictated, candidate) ? "local" : adapter.id;
              latency.cleanupMs = Date.now() - t;
              return { text: cleaned, provider: cleanupProvider, usage: res.usage };
            } catch {
              /* try next LLM, then local cleanup */
            }
          }
          cleaned = localCleanup(dictated, fallbackMode);
          cleanupProvider = "local";
          latency.cleanupMs = Date.now() - t;
          return { text: cleaned, provider: "local", usage: { ...ZERO_USAGE } };
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
        appRuleId: appName,
        latency: { ...latency },
        sttProvider,
        cleanupProvider,
      };
    },
  };
}

export { localCleanup };
