/**
 * Detect whether speech is an edit of the last insert. No provider imports.
 */

import { type CleanupMode, localCleanup } from "./modes.js";

export type SpeechAction = "refine" | "dictate";

export const MAX_LAST_TEXT = 8_000;
export const MAX_SPEECH = 4_000;

export function clipSpeech(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  return value.replace(/[\u0000-\u001f]/g, " ").trim().slice(0, max);
}

/** Cheap gate so we don't run a second LLM on obvious new dictation. */
export function looksLikeRefineInstruction(speech: string): boolean {
  const s = clipSpeech(speech, MAX_SPEECH).toLowerCase();
  if (!s) return false;
  const words = s.split(/\s+/).filter(Boolean);
  if (words.length > 18) return false;
  if (
    /^(please\s+)?(make\s+(it|this|that)\s+)?(shorter|longer|concise|punchy|formal|casual|professional|friendlier|kinder|nicer)\b/.test(
      s,
    )
  ) {
    return true;
  }
  if (/^(please\s+)?(rewrite|rephrase|fix(\s+(the|that|this))?(\s+(grammar|typos|it))?)\b/.test(s)) {
    return true;
  }
  if (/\b(more formal|more casual|as an email|as a slack|too (long|wordy|stiff|casual)|tone it down)\b/.test(s)) {
    return true;
  }
  if (/^(undo|try again|do that again|once more|again)\b/.test(s)) return true;
  if (/^(add|remove|delete|drop|take out)\b/.test(s) && words.length <= 16) return true;
  return false;
}

export function localRefine(lastText: string, speech: string): string {
  const last = clipSpeech(lastText, MAX_LAST_TEXT);
  const s = clipSpeech(speech, MAX_SPEECH).toLowerCase();
  if (!last) return "";
  let mode: CleanupMode = "light";
  if (/\b(shorter|concise|too (long|wordy)|punchy)\b/.test(s)) mode = "concise";
  else if (/\b(formal|professional|email)\b/.test(s)) mode = "professional";
  else if (/\b(casual|slack|friendlier|kinder|nicer)\b/.test(s)) mode = "light";
  return localCleanup(last, mode);
}
