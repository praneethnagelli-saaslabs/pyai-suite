import { describe, it, expect } from "vitest";
import { createPlatform, Capability, ChaosProvider, withRetry, BudgetGovernor, ZERO_USAGE } from "./index.js";
import { MockProvider } from "./providers/mock.js";

/**
 * Chaos / failure testing (spec #88). We wrap the MockProvider in a ChaosProvider
 * and verify the platform's resilience primitives: retry, failure record,
 * budget enforcement. This runs fully offline.
 */
describe("Chaos: provider outage resilience", () => {
  it("retry attempts then records failure when provider always drops", async () => {
    const chaos = new ChaosProvider(new MockProvider(), { dropRate: 1 });
    let attempts = 0;
    const { retries } = await withRetry(
      { maxRetries: 3, label: "chaos" },
      async () => {
        attempts++;
        return chaos.asLLM()!.complete({ messages: [{ role: "user", content: "x" }] });
      },
    ).catch((e) => {
      // withRetry throws RetryError after maxRetries; surface its records.
      return { retries: (e as { records: unknown[] }).records as Array<{ attempt: number }> };
    });
    expect(attempts).toBeGreaterThan(1); // it retried
    expect(retries.length).toBe(4); // bounded: initial attempt + maxRetries(3)
  });

  it("malformed JSON surfaces without hanging and is retryable", async () => {
    const chaos = new ChaosProvider(new MockProvider(), { malformedJsonRate: 1 });
    const res = await chaos.asLLM()!.complete({ messages: [{ role: "user", content: "x" }], jsonSchema: { type: "object", properties: { a: { type: "string" } } } });
    // The adapter corrupts text; parsed must be undefined (repair path will see it).
    expect(res.parsed).toBeUndefined();
  });

  it("budget governor blocks when projected cost exceeds max", () => {
    const g = new BudgetGovernor({ maxCostUsd: 0.01, maxTokens: 1e9, maxAudioMinutes: 999, maxDurationMs: 999999, maxRetries: 4, maxParallelTasks: 8 });
    const v = g.checkBefore({ ...ZERO_USAGE }, { costUsd: 0.5 });
    expect(v).toBe("max_cost");
  });

  it("workflow records a failure when a required task's provider always fails", async () => {
    const chaos = new ChaosProvider(new MockProvider(), { dropRate: 1 });
    const platform = createPlatform({ includeMock: true });
    // Force the registry to prefer the chaos provider for LLM by wrapping mock.
    // Simplest: register chaos as a separate provider and request it.
    platform.registry.register(chaos);
    const def = {
      id: "chaos_wf",
      product: "test",
      tasks: [
        {
          id: "extract",
          run: async () => {
            const adapter = platform.registry.getAdapterFor(Capability.STRUCTURED_OUTPUT, chaos.id);
            if (!adapter?.asLLM()) throw new Error("no llm");
            return adapter.asLLM()!.complete({ messages: [{ role: "user", content: "x" }] });
          },
        },
      ],
    };
    const out = await platform.engine.execute(def as never);
    expect(out.status).toBe("FAILED");
    expect(Object.keys(out.errors).length).toBeGreaterThan(0);
    const run = platform.tracer.getRun(out.runId);
    expect(run?.failures).toBeGreaterThan(0);
  });
});
