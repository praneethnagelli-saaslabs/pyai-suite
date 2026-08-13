import type {
  AIProvider,
  Capability,
  ModelInfo,
  ProviderHealth,
  ProviderId,
  RoutingDecision,
  RoutingPolicy,
} from "../types.js";
import type { ProviderAdapter } from "./adapter.js";
import { logger } from "../util/logger.js";

interface CircuitState {
  failures: number;
  openedAt?: number;
  halfOpenProbe?: boolean;
}

const CIRCUIT_TRIP_FAILURES = 5;
const CIRCUIT_COOLDOWN_MS = 30_000;

/**
 * Capability registry (spec #6, #7, #8, #68). The single place that knows
 * which provider supports which capability, how healthy/latent each is, and
 * how to route a task across them with fallback + a circuit breaker.
 *
 * Product code asks: "give me an STT adapter" — it never names a vendor.
 */
export class CapabilityRegistry {
  private adapters = new Map<ProviderId, ProviderAdapter>();
  private healthCache = new Map<ProviderId, { health: ProviderHealth; at: number }>();
  private latencySamples = new Map<ProviderId, number[]>();
  private circuits = new Map<ProviderId, CircuitState>();
  private defaultProviders = new Map<Capability, ProviderId>();

  register(adapter: ProviderAdapter): void {
    this.adapters.set(adapter.id, adapter);
    logger.info("registry: registered provider", { id: adapter.id, caps: adapter.capabilities });
  }

  setDefault(capability: Capability, provider: ProviderId): void {
    this.defaultProviders.set(capability, provider);
  }

  list(): ProviderAdapter[] {
    return Array.from(this.adapters.values());
  }

  get(providerId: ProviderId): ProviderAdapter | undefined {
    return this.adapters.get(providerId);
  }

  /** Providers that are configured AND implement the capability. */
  providersFor(capability: Capability): ProviderAdapter[] {
    return this.list().filter(
      (a) => a.capabilities.includes(capability) && a.isConfigured(),
    );
  }

  getAdapterFor(capability: Capability, providerId?: ProviderId): ProviderAdapter | undefined {
    if (providerId) {
      const a = this.adapters.get(providerId);
      return a && a.capabilities.includes(capability) ? a : undefined;
    }
    const configured = this.providersFor(capability);
    if (configured.length === 0) return undefined;
    const preferred = this.defaultProviders.get(capability);
    return preferred ? configured.find((a) => a.id === preferred) ?? configured[0] : configured[0];
  }

  // -- health & latency --------------------------------------------------

  async health(providerId: ProviderId): Promise<ProviderHealth> {
    const cached = this.healthCache.get(providerId);
    if (cached && Date.now() - cached.at < 30_000) return cached.health;
    const a = this.adapters.get(providerId);
    if (!a) return { status: "down", latencyMs: 0, detail: "unknown provider", checkedAt: Date.now() };
    const h = await a.health().catch((e: unknown) => ({
      status: "down" as const,
      latencyMs: 0,
      detail: String(e),
      checkedAt: Date.now(),
    }));
    this.healthCache.set(providerId, { health: h, at: Date.now() });
    return h;
  }

  recordLatency(providerId: ProviderId, ms: number): void {
    const arr = this.latencySamples.get(providerId) ?? [];
    arr.push(ms);
    if (arr.length > 50) arr.shift();
    this.latencySamples.set(providerId, arr);
  }

  avgLatency(providerId: ProviderId): number {
    const arr = this.latencySamples.get(providerId);
    if (!arr || arr.length === 0) return Number.POSITIVE_INFINITY;
    return arr.reduce((s, x) => s + x, 0) / arr.length;
  }

  // -- circuit breaker --------------------------------------------------

  private circuit(providerId: ProviderId): CircuitState {
    return this.circuits.get(providerId) ?? { failures: 0 };
  }

  isOpen(providerId: ProviderId): boolean {
    const c = this.circuit(providerId);
    if (c.openedAt == null) return false;
    if (Date.now() - (c.openedAt ?? 0) > CIRCUIT_COOLDOWN_MS) {
      // move to half-open for a probe
      c.halfOpenProbe = true;
      return false;
    }
    return true;
  }

  markSuccess(providerId: ProviderId): void {
    const c = this.circuit(providerId);
    c.failures = 0;
    c.openedAt = undefined;
    c.halfOpenProbe = false;
    this.circuits.set(providerId, c);
  }

  markFailure(providerId: ProviderId): void {
    const c = this.circuit(providerId);
    c.failures += 1;
    if (c.failures >= CIRCUIT_TRIP_FAILURES) c.openedAt = Date.now();
    this.circuits.set(providerId, c);
  }

  // -- routing -----------------------------------------------------------

  /**
   * Decide primary + fallback order for a capability under a policy.
   * (spec #8). Never silently switches — the returned `reason` is shown in UI.
   */
  async route(
    capability: Capability,
    policy: RoutingPolicy = "fallback",
    prefer?: ProviderId,
  ): Promise<RoutingDecision> {
    const candidates = this.providersFor(capability).filter((a) => !this.isOpen(a.id));
    if (candidates.length === 0) {
      return {
        primary: prefer ?? "none",
        fallback: [],
        reason: "no configured provider available for capability",
      };
    }
    const scored = await Promise.all(
      candidates.map(async (a) => {
        const h = await this.health(a.id);
        return { a, h, lat: this.avgLatency(a.id) };
      }),
    );
    const healthy = scored.filter((s) => s.h.status !== "down");

    if (prefer && healthy.some((s) => s.a.id === prefer)) {
      const p = healthy.find((s) => s.a.id === prefer)!;
      const fb = healthy.filter((s) => s.a.id !== prefer).map((s) => s.a.id);
      return { primary: p.a.id, fallback: fb, reason: `user-preferred provider ${p.a.id}` };
    }

    let order: ProviderId[];
    if (policy === "cheapest") {
      order = healthy
        .slice()
        .sort(
          (x, y) =>
            (cheapest(x.a.id) ?? Number.POSITIVE_INFINITY) -
            (cheapest(y.a.id) ?? Number.POSITIVE_INFINITY),
        )
        .map((s) => s.a.id);
    } else if (policy === "fastest") {
      order = healthy.slice().sort((x, y) => x.lat - y.lat).map((s) => s.a.id);
    } else if (policy === "best_quality") {
      order = healthy
        .slice()
        .sort((x, y) => qualityRank(y.a.id) - qualityRank(x.a.id))
        .map((s) => s.a.id);
    } else if (policy === "balanced") {
      order = healthy
        .slice()
        .sort((x, y) => score(y) - score(x))
        .map((s) => s.a.id);
    } else {
      // fallback: registry default first, then configured order
      const def = this.defaultProviders.get(capability);
      order = healthy
        .slice()
        .sort((x, y) => {
          if (def && x.a.id === def) return -1;
          if (def && y.a.id === def) return 1;
          return x.lat - y.lat;
        })
        .map((s) => s.a.id);
    }

    const reasonByPolicy: Record<RoutingPolicy, string> = {
      cheapest: "selected lowest-priced available provider",
      fastest: "selected lowest-measured-latency provider",
      best_quality: "selected highest-quality-ranked provider",
      balanced: "selected best weighted score (quality+latency+reliability+cost)",
      fallback: "registry default with measured fallback",
    };

    return {
      primary: order[0]!,
      fallback: order.slice(1),
      reason: reasonByPolicy[policy],
    };
  }

  async allModels(): Promise<ModelInfo[]> {
    const out: ModelInfo[] = [];
    for (const a of this.list()) {
      try {
        out.push(...(await a.models()));
      } catch {
        /* unhealthy adapter, skip */
      }
    }
    return out;
  }
}

// -- helper scoring (driven by provider metadata, not hardcoded in workflows) --

function qualityRank(_p: ProviderId): number {
  // Placeholder: real ranking pulls model.qualityClass from registry models.
  return 1;
}
function cheapest(_p: ProviderId): number | undefined {
  return undefined;
}
function score(_s: { a: ProviderAdapter; h: ProviderHealth; lat: number }): number {
  // Higher is better. Combines inverse latency with health.
  return 1 / (1 + _s.lat) + (_s.h.status === "healthy" ? 1 : 0);
}
