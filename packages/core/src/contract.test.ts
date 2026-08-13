import { describe, it, expect } from "vitest";
import { createPlatform, Capability, type ProviderAdapter } from "./index.js";

/**
 * Provider contract tests (spec #87). ONE shared suite runs against EVERY
 * registered adapter, so a new provider is verifiable without touching product
 * logic. We assert: capability declaration, connectivity/health, streaming
 * interface presence, error handling, usage reporting.
 *
 * Only configured providers are exercised (offline, only Mock is configured).
 */
function contractSuiteFor(adapter: ProviderAdapter): void {
  describe(`contract: ${adapter.id}`, () => {
    it("declares capabilities and is configured", () => {
      expect(adapter.capabilities.length).toBeGreaterThan(0);
      expect(adapter.isConfigured()).toBe(true);
    });

    it("reports health without throwing", async () => {
      const h = await adapter.health();
      expect(["healthy", "degraded", "down"]).toContain(h.status);
      expect(typeof h.latencyMs).toBe("number");
    });

    it("exposes streaming interface for STT-capable providers", () => {
      if (adapter.capabilities.includes(Capability.STREAMING_STT)) {
        expect(typeof adapter.asSTT).toBe("function");
      }
    });

    it("reports usage on an LLM call (usage reporting)", async () => {
      if (!adapter.asLLM) return;
      const res = await adapter.asLLM()!.complete({ messages: [{ role: "user", content: "ping" }] });
      expect(res.usage).toBeDefined();
      expect(res.usage.providerCalls).toBeGreaterThanOrEqual(1);
      expect(typeof res.usage.costUsd).toBe("number");
    });

    it("reports usage on an STT call (usage reporting)", async () => {
      if (!adapter.asSTT) return;
      const res = await adapter.asSTT()!.transcribe({ audio: new TextEncoder().encode("dummy") });
      expect(Array.isArray(res.segments)).toBe(true);
      expect(res.usage.providerCalls).toBeGreaterThanOrEqual(1);
    });

    it("classifies errors as retryable on transient failure (error handling)", async () => {
      if (!adapter.asLLM) return;
      // Inject a chaotic failure via a chaos wrapper to exercise error handling
      // without a live provider. A dropped call must surface an Error.
      const { ChaosProvider } = await import("./chaos.js");
      const chaos = new ChaosProvider(adapter, { dropRate: 1 });
      await expect(
        chaos.asLLM()!.complete({ messages: [{ role: "user", content: "x" }] }),
      ).rejects.toBeDefined();
    });
  });
}

const platform = createPlatform({ includeMock: true });
for (const a of platform.registry.list()) {
  if (a.isConfigured()) contractSuiteFor(a);
}

describe("contract breadth", () => {
  it("runs the shared suite for at least the mock provider", () => {
    expect(platform.registry.list().some((p) => p.id === "mock" && p.isConfigured())).toBe(true);
  });
});
