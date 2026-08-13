import type { ProviderInfo } from "@/lib/api";

/** PyAI first everywhere; others only when PyAI lacks the capability or key. */
export const PREFERRED_PROVIDERS = ["pyai", "openai", "gemini", "mock"] as const;

export function sortProviders<T extends { id: string }>(list: T[]): T[] {
  const rank = (id: string) => {
    const i = (PREFERRED_PROVIDERS as readonly string[]).indexOf(id);
    return i === -1 ? PREFERRED_PROVIDERS.length : i;
  };
  return [...list].sort((a, b) => rank(a.id) - rank(b.id));
}

/** Prefer configured live providers; fall back to mock for demos. */
export function pickPreferred(
  providers: ProviderInfo[] | undefined,
  capability: string,
  order: readonly string[] = PREFERRED_PROVIDERS,
): string {
  const list = providers ?? [];
  for (const id of order) {
    const p = list.find((x) => x.id === id && x.configured && x.capabilities.includes(capability));
    if (p) return p.id;
  }
  const any = list.find((x) => x.configured && x.capabilities.includes(capability) && x.id !== "mock");
  if (any) return any.id;
  const mock = list.find((x) => x.id === "mock" && x.capabilities.includes(capability));
  return mock?.id ?? order[order.length - 1] ?? "mock";
}
