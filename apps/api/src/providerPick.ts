import { type Capability, type Platform } from "@pyai/core";

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
