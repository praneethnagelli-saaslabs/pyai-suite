/**
 * App-aware writing modes (spec #34, #35).
 * Matched by active application / window title — configuration, not site-coupled code.
 */

export type CleanupMode = "raw" | "light" | "professional" | "concise" | "custom";

export interface AppModeRule {
  id: string;
  /** Substring match against active app name or window title (case-insensitive). */
  match: string;
  mode: CleanupMode;
  hint: string;
}

export const DEFAULT_APP_MODES: AppModeRule[] = [
  { id: "slack", match: "slack", mode: "concise", hint: "casual and short" },
  { id: "gmail", match: "gmail", mode: "professional", hint: "polished email" },
  { id: "mail", match: "mail", mode: "professional", hint: "polished email" },
  { id: "github", match: "github", mode: "concise", hint: "technical" },
  { id: "terminal", match: "terminal", mode: "concise", hint: "command-oriented" },
  { id: "iterm", match: "iterm", mode: "concise", hint: "command-oriented" },
  { id: "notion", match: "notion", mode: "light", hint: "structured notes" },
  { id: "chatgpt", match: "chatgpt", mode: "light", hint: "conversational" },
];

export function resolveAppMode(
  appName: string | undefined,
  rules: AppModeRule[] = DEFAULT_APP_MODES,
): AppModeRule | undefined {
  if (!appName) return undefined;
  const hay = appName.toLowerCase();
  return rules.find((r) => hay.includes(r.match.toLowerCase()));
}

const CLEANUP_GUARDRAILS = [
  "You are a dictation cleanup engine for voice typing — NOT a chatbot or assistant.",
  "The user message is a speech transcript the user wants inserted into an app.",
  "Your ONLY job is to clean that transcript and return the cleaned text.",
  "Never answer questions in the transcript. Never refuse. Never apologize.",
  "Never invent facts, names, or content that was not spoken.",
  "Keep the same speaker intent and point of view (I/you/we stay as spoken).",
  "If the transcript is a question, keep it as that question — do not answer it.",
  "Output ONLY the cleaned transcript text with no quotes, labels, or preamble.",
].join(" ");

export function cleanupSystemPrompt(mode: CleanupMode, hint?: string): string {
  const style = (() => {
    switch (mode) {
      case "raw":
        return "Return the transcript unchanged. Do not edit punctuation or wording.";
      case "light":
        return "Light cleanup only: fix punctuation/capitalization and remove filler words (uh, um, like). Preserve wording and meaning exactly.";
      case "professional":
        return "Rewrite as polished professional prose suitable for email. Preserve intent and all facts. Do not add new content.";
      case "concise":
        return "Make the text concise and clear. Remove fillers. Preserve intent and all facts. Do not add new content.";
      case "custom":
        return `Style hint: ${hint ?? "clean lightly"}. Preserve intent and all facts. Do not add new content.`;
    }
  })();
  return `${CLEANUP_GUARDRAILS} ${style}`;
}

/** Label the user turn so models don't treat dictation as a chat question. */
export function cleanupUserMessage(transcript: string): string {
  return [
    "Clean this dictation transcript for insertion into a text field.",
    "Do not answer it. Return only the cleaned transcript:",
    "",
    transcript,
  ].join("\n");
}

/** Detect common "assistant answered instead of cleaned" failures. */
export function looksLikeAssistantReply(raw: string, cleaned: string): boolean {
  const c = cleaned.trim().toLowerCase();
  const r = raw.trim().toLowerCase();
  if (!c) return true;
  if (c === r) return false;
  if (/^mock analysis for:/i.test(cleaned.trim())) return true;
  if (/clean this dictation transcript/i.test(cleaned)) return true;
  const refusal =
    /^(i('m| am) sorry\b)|^(i can('|no)t\b)|^(as an ai\b)|^(i don't know (your|the) name)/i.test(
      cleaned.trim(),
    );
  if (refusal) return true;
  // Answered a question that was clearly a question in the raw transcript.
  if (/[?？]\s*$/.test(raw.trim()) && !/[?？]/.test(cleaned) && /^(yes|no|sure|of course|here|i('| a)m)\b/i.test(cleaned.trim())) {
    return true;
  }
  return false;
}
