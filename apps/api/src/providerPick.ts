import { Capability, type Platform, type TranscriptResult } from "@pyai/core";

/** PyAI first everywhere; others only when PyAI lacks the capability or key. */
export const PREFERRED_PROVIDERS = ["pyai", "openai", "gemini", "mock"] as const;

/** Live fallback chain for TTS/STT retries (no mock). */
export function liveCandidates(preferred?: string): string[] {
  return [...(preferred ? [preferred] : []), "pyai", "openai", "gemini"].filter(
    (id, i, arr) => id !== "mock" && arr.indexOf(id) === i,
  );
}

/** Prefer live providers when configured; always fall back to mock for demos. */
export function pickProvider(
  platform: Platform,
  capability: Capability,
  preferred?: string,
  order: string[] = [],
): string {
  const tryId = (id: string): string | undefined => {
    const adapter = platform.registry.getAdapterFor(capability, id);
    if (!adapter) return undefined;
    if (typeof adapter.isConfigured === "function" && !adapter.isConfigured()) return undefined;
    return adapter.id;
  };

  if (preferred === "local" || preferred === "none") return preferred;

  if (preferred) {
    const hit = tryId(preferred);
    if (hit) return hit;
  }

  const defaults = order.length > 0 ? order : [...PREFERRED_PROVIDERS];

  for (const id of defaults) {
    const hit = tryId(id);
    if (hit) return hit;
  }
  return "mock";
}

export class SttFallbackError extends Error {
  readonly errors: string[];
  constructor(errors: string[]) {
    super(errors[0] ?? "no STT provider available");
    this.name = "SttFallbackError";
    this.errors = errors;
  }
}

export interface TranscribeFallbackInput {
  audio: Uint8Array;
  format?: string;
  prompt?: string;
  diarize?: boolean;
}

export interface TranscribeFallbackResult {
  text: string;
  provider: string;
  result: TranscriptResult;
  errors: string[];
  fallback: boolean;
  /** Human-readable note when a later provider won after earlier tries failed. */
  fallbackNote?: string;
  /** True when PyAI Hear was skipped because of an active cooldown (not a hard failure). */
  hearCooldown?: boolean;
}

export type SttMode = "live" | "batch";

export interface TranscribeFallbackOpts {
  includeMock?: boolean;
  /**
   * `live` — Meet/mic chunks: short Hear budget.
   * `batch` — uploads/demos: long Hear budget.
   * Cooldown after a Hear miss applies to both.
   */
  mode?: SttMode;
}

/** Shared copy for UI banners when a later provider was used. */
export function providerFallbackNote(used: string, errors: string[]): string | undefined {
  if (!errors.length) return undefined;
  const first = errors[0] ?? "earlier provider failed";
  const more = errors.length > 1 ? ` (+${errors.length - 1} more)` : "";
  return `Fell back to ${used} — ${first}${more}`;
}

/** Live Meet chunks cannot wait minutes for Hear. */
const PYAI_LIVE_BUDGET_MS = 8_000;
/** Uploads / demos get a full Hear attempt. */
const PYAI_BATCH_BUDGET_MS = 90_000;
const OTHER_STT_BUDGET_MS = 90_000;
const PYAI_COOLDOWN_MS = 3 * 60_000;

let pyaiSkipUntil = 0;
let pyaiSkipReason = "";

/** Test helper — do not call from product code. */
export function resetSttCooldowns(): void {
  pyaiSkipUntil = 0;
  pyaiSkipReason = "";
}

/** Exposed for Providers UI — healthy key can still be skipped for live Hear. */
export function getPyaiHearCooldown(): {
  active: boolean;
  skipUntil: number;
  remainingMs: number;
  reason?: string;
  liveBudgetMs: number;
  batchBudgetMs: number;
  cooldownMs: number;
} {
  const now = Date.now();
  const remainingMs = Math.max(0, pyaiSkipUntil - now);
  return {
    active: remainingMs > 0,
    skipUntil: pyaiSkipUntil,
    remainingMs,
    reason: remainingMs > 0 ? pyaiSkipReason || "recent Hear miss" : undefined,
    liveBudgetMs: PYAI_LIVE_BUDGET_MS,
    batchBudgetMs: PYAI_BATCH_BUDGET_MS,
    cooldownMs: PYAI_COOLDOWN_MS,
  };
}

async function withBudget<T>(work: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label}: timeout`)), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function isRawWebm(audio: Uint8Array): boolean {
  // EBML header — MediaRecorder webm/mkv. Hear rejects; Whisper accepts.
  return (
    audio.length >= 4 &&
    audio[0] === 0x1a &&
    audio[1] === 0x45 &&
    audio[2] === 0xdf &&
    audio[3] === 0xa3
  );
}

/**
 * Try preferred → pyai → openai → gemini (→ mock). Empty transcripts count as
 * failure so a silent Hear miss still falls through to OpenAI.
 *
 * Live = short Hear budget; batch = long budget for uploads. After any Hear
 * timeout/error, skip Hear for a few minutes on *all* subsequent STT calls.
 * Raw webm is skipped for PyAI (clients should convert; OpenAI still tried).
 */
export async function transcribeWithFallback(
  platform: Platform,
  req: TranscribeFallbackInput,
  preferred?: string,
  opts?: TranscribeFallbackOpts,
): Promise<TranscribeFallbackResult> {
  const mode: SttMode = opts?.mode === "batch" ? "batch" : "live";
  const candidates = (
    opts?.includeMock === false ? liveCandidates(preferred) : [...liveCandidates(preferred), "mock"]
  ).filter((id, i, arr) => arr.indexOf(id) === i);

  const errors: string[] = [];
  let hearOnCooldown = false;
  const now = Date.now();
  const rawWebm = isRawWebm(req.audio);
  for (const id of candidates) {
    if (id === "pyai" && now < pyaiSkipUntil) {
      // Expected while cooling down — do not treat as a failed attempt / UI "fallback".
      hearOnCooldown = true;
      continue;
    }
    if (id === "pyai" && rawWebm) {
      // Avoid hard reject + error noise; OpenAI Whisper handles webm.
      continue;
    }
    const adapter = platform.registry.getAdapterFor(Capability.BATCH_STT, id);
    if (!adapter?.isConfigured?.() || !adapter.asSTT) continue;
    const budget =
      id === "pyai"
        ? mode === "batch"
          ? PYAI_BATCH_BUDGET_MS
          : PYAI_LIVE_BUDGET_MS
        : OTHER_STT_BUDGET_MS;
    try {
      const result = await withBudget(
        adapter.asSTT().transcribe({
          audio: req.audio,
          format: req.format ?? (rawWebm ? "webm" : "wav"),
          prompt: req.prompt,
          diarize: Boolean(req.diarize) && (id === "openai" || id === "pyai"),
        }),
        budget,
        id,
      );
      const text = result.text?.trim() ?? "";
      if (!text) {
        errors.push(`${id}: empty transcript`);
        continue;
      }
      const fallback = errors.length > 0;
      return {
        text,
        provider: id,
        result,
        errors,
        fallback,
        fallbackNote: fallback ? providerFallbackNote(id, errors) : undefined,
        hearCooldown: hearOnCooldown || undefined,
      };
    } catch (e) {
      const msg = e instanceof Error ? e.message.slice(0, 160) : "failed";
      errors.push(`${id}: ${msg}`);
      if (id === "pyai") {
        // Format / config mistakes are client issues — don't lock Hear out for 3 minutes.
        const clientMistake =
          /does not accept raw webm|empty audio|missing API key/i.test(msg);
        if (!clientMistake) {
          pyaiSkipUntil = Date.now() + PYAI_COOLDOWN_MS;
          pyaiSkipReason = msg;
        }
        hearOnCooldown = !clientMistake;
      }
    }
  }

  throw new SttFallbackError(errors);
}

export function sttFallbackMessage(errors: string[]): string {
  if (!errors.length) return "no STT provider available";
  const rest = errors.length > 1 ? ` (also tried ${errors.slice(1).join("; ")})` : "";
  return `transcription failed — ${errors[0]}${rest}`;
}
