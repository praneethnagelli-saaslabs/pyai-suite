/**
 * Cleanup modes + insert-target context (spec #34, #35).
 * The cleaner is app-aware: we pass the frontmost app (and optional tab/field) into the prompt.
 */

export type CleanupMode = "raw" | "light" | "professional" | "concise" | "custom";

/** Focused control kind — what the user is typing in, not a site name. */
export type ScribFieldKind =
  | "ace"
  | "monaco"
  | "codemirror"
  | "docs"
  | "textarea"
  | "input"
  | "contenteditable"
  | "unknown";

export interface TabContext {
  host?: string;
  path?: string;
  title?: string;
  field?: ScribFieldKind | string;
  bundleId?: string;
}

export interface AppModeRule {
  id: string;
  match: string;
  mode: CleanupMode;
  hint: string;
}

/** @deprecated App name is sent to the cleaner instead of a host map. */
export const DEFAULT_APP_MODES: AppModeRule[] = [];

/** @deprecated The cleaner receives `appName` directly. */
export function resolveAppMode(
  _appName: string | undefined,
  _rules: AppModeRule[] = DEFAULT_APP_MODES,
): AppModeRule | undefined {
  return undefined;
}

const FIELD_KINDS = new Set<string>([
  "ace",
  "monaco",
  "codemirror",
  "docs",
  "textarea",
  "input",
  "contenteditable",
  "unknown",
]);

function clip(value: unknown, max: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const t = value.replace(/[\u0000-\u001f]/g, " ").trim().slice(0, max);
  return t || undefined;
}

export function sanitizeTabContext(raw: unknown): TabContext | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const o = raw as Record<string, unknown>;
  const fieldRaw = clip(o.field, 32)?.toLowerCase();
  const field = fieldRaw && FIELD_KINDS.has(fieldRaw) ? fieldRaw : fieldRaw ? "unknown" : undefined;
  const host = clip(o.host, 200);
  const path = clip(o.path, 200);
  const title = clip(o.title, 200);
  const bundleId = clip(o.bundleId ?? o.bundle_id, 200);
  if (!host && !path && !title && !field && !bundleId) return undefined;
  return { host, path, title, field, bundleId };
}

export function isCodeField(field?: string): boolean {
  return field === "ace" || field === "monaco" || field === "codemirror";
}

export function formatTabContext(ctx?: TabContext, appName?: string): string {
  const parts: string[] = [];
  if (appName) parts.push(`app: ${clip(appName, 200)}`);
  if (ctx?.host) parts.push(`host: ${ctx.host}`);
  if (ctx?.path) parts.push(`path: ${ctx.path}`);
  if (ctx?.title && ctx.title !== appName) parts.push(`title: ${ctx.title}`);
  if (ctx?.field && ctx.field !== "unknown") parts.push(`field: ${ctx.field}`);
  return parts.join("\n") || "unknown page";
}

const CLEANUP_GUARDRAILS = [
  "You are a dictation cleanup engine for voice typing — NOT a chatbot or assistant.",
  "The user message is a speech transcript the user wants inserted at the caret.",
  "Your ONLY job is to clean that transcript and return the cleaned text.",
  "Never answer questions in the transcript. Never refuse. Never apologize.",
  "Never invent facts, names, or content that was not spoken.",
  "Keep the same speaker intent and point of view (I/you/we stay as spoken).",
  "If the transcript is a question, keep it as that question — do not answer it.",
  "Output ONLY the cleaned transcript text with no quotes, labels, or preamble.",
].join(" ");

const APP_AWARE_STYLE = [
  "Clean for the insert app named below. Infer the surface from that app name.",
  "Chat (Slack, Messages, Discord, Teams, WhatsApp): light cleanup, keep casual tone and @mentions. Do not make it an email.",
  "Email (Mail, Outlook, Spark, Gmail): light professional polish. Same facts. No greeting or sign-off unless spoken.",
  "Code / terminal (VS Code, Cursor, Xcode, Terminal, iTerm, Warp): keep tokens, flags, paths, quotes, and commands. Do not rewrite into prose.",
  "Notes / docs (Notes, TextEdit, Word, Pages, Notion, Obsidian): light cleanup only. Preserve wording.",
  "Unknown app: light cleanup only (punctuation, capitalization, drop uh/um/like). Preserve wording.",
].join(" ");

export function cleanupSystemPrompt(
  mode: CleanupMode,
  hint?: string,
  ctx?: TabContext,
  appName?: string,
): string {
  const style = (() => {
    switch (mode) {
      case "raw":
        return "Return the transcript unchanged. Do not edit punctuation or wording.";
      case "professional":
        return "Rewrite as polished professional prose suitable for email. Preserve intent and all facts. Do not add new content.";
      case "concise":
        return "Make the text concise and clear. Remove fillers. Preserve intent and all facts. Do not add new content.";
      case "custom":
        return `Style hint: ${hint ?? "clean lightly"}. Preserve intent and all facts. Do not add new content.`;
      case "light":
      default:
        return APP_AWARE_STYLE;
    }
  })();
  const target = formatTabContext(ctx, appName);
  return `${CLEANUP_GUARDRAILS} Insert target:\n${target}\n${style}`;
}

/** Label the user turn so models don't treat dictation as a chat question. */
export function cleanupUserMessage(transcript: string, ctx?: TabContext, appName?: string): string {
  return [
    "Clean this dictation transcript for insertion into the target below.",
    formatTabContext(ctx, appName),
    "Do not answer it. Return only the cleaned transcript:",
    "",
    transcript,
  ].join("\n");
}

/** Offline deterministic cleanup for Mock/Demo paths. */
export function localCleanup(text: string, mode: CleanupMode): string {
  if (mode === "raw") return text.trim();
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
  if (/[?？]\s*$/.test(raw.trim()) && !/[?？]/.test(cleaned) && /^(yes|no|sure|of course|here|i('| a)m)\b/i.test(cleaned.trim())) {
    return true;
  }
  return false;
}
