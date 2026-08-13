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

/**
 * Try preferred → pyai → openai → gemini (→ mock). Empty transcripts count as
 * failure so a silent Hear miss still falls through to OpenAI.
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
  for (const id of candidates) {
    const adapter = platform.registry.getAdapterFor(Capability.BATCH_STT, id);
    if (!adapter?.isConfigured?.() || !adapter.asSTT) continue;
    try {
      const result = await adapter.asSTT().transcribe({
        audio: req.audio,
        format: req.format ?? "wav",
        prompt: req.prompt,
        diarize: Boolean(req.diarize) && (id === "openai" || id === "pyai"),
      });
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
      errors.push(`${id}: ${e instanceof Error ? e.message.slice(0, 160) : "failed"}`);
    }
  }

  throw new SttFallbackError(errors);
}

export function sttFallbackMessage(errors: string[]): string {
  if (!errors.length) return "no STT provider available";
  const rest = errors.length > 1 ? ` (also tried ${errors.slice(1).join("; ")})` : "";
  return `transcription failed — ${errors[0]}${rest}`;
}
