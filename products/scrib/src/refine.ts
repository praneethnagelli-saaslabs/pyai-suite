/**
 * Second-hold refine: speech is either an edit of the last insert, or new dictation.
 * Never logs the transcript.
 */

import { type Platform, Capability } from "@pyai/core";
import {
  clipSpeech,
  localRefine,
  looksLikeRefineInstruction,
  MAX_LAST_TEXT,
  MAX_SPEECH,
  type SpeechAction,
} from "./refine-detect.js";

export type { SpeechAction };
export { clipSpeech, localRefine, looksLikeRefineInstruction, MAX_LAST_TEXT, MAX_SPEECH };

export interface RefineDecision {
  action: SpeechAction;
  text: string;
  provider: string;
}

function parseDecision(raw: string): RefineDecision | null {
  const trimmed = raw.trim();
  const jsonStart = trimmed.indexOf("{");
  const jsonEnd = trimmed.lastIndexOf("}");
  if (jsonStart < 0 || jsonEnd <= jsonStart) return null;
  try {
    const obj = JSON.parse(trimmed.slice(jsonStart, jsonEnd + 1)) as {
      action?: unknown;
      text?: unknown;
    };
    const action = obj.action === "refine" || obj.action === "dictate" ? obj.action : null;
    const text = clipSpeech(obj.text, MAX_LAST_TEXT);
    if (!action || !text) return null;
    if (action === "refine" && /clean this dictation transcript/i.test(text)) return null;
    return { action, text, provider: "llm" };
  } catch {
    return null;
  }
}

function refinePrompt(lastText: string, speech: string, appName: string): { system: string; user: string } {
  const app = clipSpeech(appName, 200) || "unknown app";
  return {
    system: [
      "You decide if new speech is an edit of the previous insert, or brand-new dictation.",
      "Output ONLY JSON: {\"action\":\"refine\"|\"dictate\",\"text\":\"...\"}",
      "refine: speech is an instruction about the previous insert. text = the revised insert only.",
      "dictate: speech is new content to insert. text = cleaned speech only, not the previous insert.",
      "Never answer questions. Never add greetings or sign-offs unless spoken or asked.",
      "Preserve facts and names. Do not invent content.",
      `The previous insert went into ${app}. Match that app's tone when refining.`,
    ].join(" "),
    user: [`app: ${app}`, "previous insert:", lastText, "", "new speech:", speech].join("\n"),
  };
}

/**
 * If `lastText` is set and speech looks like an edit, rewrite it.
 * Otherwise treat speech as new dictation (caller still runs cleanup).
 */
export async function decideDictateOrRefine(
  platform: Platform,
  input: {
    lastText: string;
    speech: string;
    appName?: string;
    cleanupProvider?: string;
  },
): Promise<RefineDecision> {
  const lastText = clipSpeech(input.lastText, MAX_LAST_TEXT);
  const speech = clipSpeech(input.speech, MAX_SPEECH);
  if (!lastText || !speech) {
    return { action: "dictate", text: speech, provider: "none" };
  }
  if (!looksLikeRefineInstruction(speech)) {
    return { action: "dictate", text: speech, provider: "none" };
  }

  const { system, user } = refinePrompt(lastText, speech, input.appName ?? "");
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
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        temperature: 0.1,
        maxTokens: 1024,
      });
      const parsed = parseDecision(res.text);
      if (parsed) return { ...parsed, provider: adapter.id };
    } catch {
      /* try next */
    }
  }

  return { action: "refine", text: localRefine(lastText, speech), provider: "local" };
}
