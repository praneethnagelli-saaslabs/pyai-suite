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
}

/** Hear batch can sit for minutes; live Meet chunks cannot wait that long. */
const PYAI_STT_BUDGET_MS = 8_000;
const OTHER_STT_BUDGET_MS = 90_000;
const PYAI_COOLDOWN_MS = 3 * 60_000;

let pyaiSkipUntil = 0;

/** Test helper — do not call from product code. */
export function resetSttCooldowns(): void {
  pyaiSkipUntil = 0;
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

/**
 * Try preferred → pyai → openai → gemini (→ mock). Empty transcripts count as
 * failure so a silent Hear miss still falls through to OpenAI.
 * Hear gets a short budget; after a timeout/error it is skipped for a few minutes
 * so OpenAI is not blocked behind a dead Hear job on every chunk.
 */
export async function transcribeWithFallback(
  platform: Platform,
  req: TranscribeFallbackInput,
  preferred?: string,
  opts?: { includeMock?: boolean },
): Promise<TranscribeFallbackResult> {
  const candidates = (
    opts?.includeMock === false ? liveCandidates(preferred) : [...liveCandidates(preferred), "mock"]
  ).filter((id, i, arr) => arr.indexOf(id) === i);

  const errors: string[] = [];
  const now = Date.now();
  for (const id of candidates) {
    if (id === "pyai" && now < pyaiSkipUntil) {
      errors.push("pyai: skipped (recent Hear miss)");
      continue;
    }
    const adapter = platform.registry.getAdapterFor(Capability.BATCH_STT, id);
    if (!adapter?.isConfigured?.() || !adapter.asSTT) continue;
    const budget = id === "pyai" ? PYAI_STT_BUDGET_MS : OTHER_STT_BUDGET_MS;
    try {
      const result = await withBudget(
        adapter.asSTT().transcribe({
          audio: req.audio,
          format: req.format ?? "wav",
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
      return {
        text,
        provider: id,
        result,
        errors,
        fallback: errors.length > 0,
      };
    } catch (e) {
      const msg = e instanceof Error ? e.message.slice(0, 160) : "failed";
      errors.push(`${id}: ${msg}`);
      if (id === "pyai") pyaiSkipUntil = Date.now() + PYAI_COOLDOWN_MS;
    }
  }

  throw new SttFallbackError(errors);
}

export function sttFallbackMessage(errors: string[]): string {
  if (!errors.length) return "no STT provider available";
  const rest = errors.length > 1 ? ` (also tried ${errors.slice(1).join("; ")})` : "";
  return `transcription failed — ${errors[0]}${rest}`;
}
