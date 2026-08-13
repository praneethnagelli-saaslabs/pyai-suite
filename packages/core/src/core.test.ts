import { describe, it, expect } from "vitest";
import {
  createPlatform,
  Capability,
  WorkflowEngine,
  BudgetGovernor,
  withRetry,
  RetryError,
  runGates,
  schemaGate,
  evidenceGate,
  confidenceGate,
  worstVerdict,
  anyBlock,
  type WorkflowDef,
} from "./index.js";

const platform = createPlatform({ includeMock: true });

describe("platform wiring", () => {
  it("registers mock + default providers and exposes capabilities", () => {
    expect(platform.registry.list().some((p) => p.id === "mock")).toBe(true);
    const stt = platform.registry.providersFor(Capability.BATCH_STT);
    expect(stt.length).toBeGreaterThan(0);
  });

  it("routes to a configured provider; returns fallback order", async () => {
    const decision = await platform.registry.route(Capability.BATCH_STT, "fallback");
    expect(decision.primary).toBe("mock");
    expect(decision.reason).toBeTruthy();
  });
});

describe("workflow engine", () => {
  it("runs a parallel DAG and merges artifacts", async () => {
    const def: WorkflowDef = {
      id: "test-parallel",
      product: "test",
      tasks: [
        { id: "a", run: async () => ({ value: 1, usage: { inputTokens: 10, outputTokens: 5, audioSeconds: 0, costUsd: 0, providerCalls: 1, cacheHits: 0 } }) },
        { id: "b", run: async () => ({ value: 2, usage: { inputTokens: 10, outputTokens: 5, audioSeconds: 0, costUsd: 0, providerCalls: 1, cacheHits: 0 } }) },
        { id: "merge", dependsOn: ["a", "b"], run: async (ctx) => ({ sum: (ctx.artifacts.a as { value: number }).value + (ctx.artifacts.b as { value: number }).value }) },
      ],
    };
    const out = await platform.engine.execute(def);
    expect(out.status).toBe("SUCCEEDED");
    expect((out.artifacts.merge as { sum: number }).sum).toBe(3);
    expect(out.usage.inputTokens).toBe(20);
  });

  it("aborts and sets FAILED when a required task throws", async () => {
    const def: WorkflowDef = {
      id: "test-fail",
      product: "test",
      tasks: [{ id: "bad", run: async () => { throw new Error("boom"); } }],
    };
    const out = await platform.engine.execute(def);
    expect(out.status).toBe("FAILED");
    expect(out.errors.bad).toContain("boom");
    expect(platform.tracer.getRun(out.runId)?.status).toBe("FAILED");
  });

  it("still SUCCEEDED-equivalent as PARTIAL when only optional task fails", async () => {
    const def: WorkflowDef = {
      id: "test-opt",
      product: "test",
      optional: ["maybe"],
      tasks: [
        { id: "core", run: async () => 1 },
        { id: "maybe", run: async () => { throw new Error("skip me"); } },
      ],
    };
    const out = await platform.engine.execute(def);
    expect(out.status).toBe("PARTIAL");
  });

  it("blocks the workflow on a BLOCK gate", async () => {
    const def: WorkflowDef = {
      id: "test-gate",
      product: "test",
      tasks: [
        {
          id: "extract",
          run: async () => ({ data: { x: 1 }, claims: [{ claim: "unproven" }] }),
          gates: [evidenceGate],
        },
      ],
    };
    const out = await platform.engine.execute(def);
    expect(out.status).toBe("FAILED");
    expect(anyBlock(out.gates)).toBe(true);
  });

  it("completes when evidence is present", async () => {
    const def: WorkflowDef = {
      id: "test-gate-ok",
      product: "test",
      tasks: [
        {
          id: "extract",
          run: async () => ({ data: { x: 1 }, claims: [{ claim: "proven", evidence: { source: "call-1", start: 1, end: 2 } }] }),
          gates: [evidenceGate, schemaGate],
        },
      ],
    };
    const out = await platform.engine.execute(def);
    expect(out.status).toBe("SUCCEEDED");
    expect(worstVerdict(out.gates)).toBe("PASS");
  });
});

describe("budget governor", () => {
  it("blocks when projected cost exceeds max", () => {
    const g = new BudgetGovernor({ maxCostUsd: 0.01, maxTokens: 1_000_000, maxAudioMinutes: 999, maxDurationMs: 999_999, maxRetries: 4, maxParallelTasks: 8 });
    const v = g.checkBefore({ inputTokens: 0, outputTokens: 0, audioSeconds: 0, costUsd: 0, providerCalls: 0, cacheHits: 0 }, { costUsd: 0.02 });
    expect(v).toBe("max_cost");
  });
  it("allows within budget", () => {
    const g = new BudgetGovernor();
    expect(g.checkBefore({ inputTokens: 0, outputTokens: 0, audioSeconds: 0, costUsd: 0, providerCalls: 0, cacheHits: 0 }, { costUsd: 0.001 })).toBeNull();
  });
});

describe("retry", () => {
  it("retries bounded and records reasons", async () => {
    let n = 0;
    const { retries } = await withRetry(
      { maxRetries: 3, label: "t" },
      async () => {
        n++;
        if (n < 3) throw new Error(`fail-${n}`);
        return "ok";
      },
    );
    expect(retries.length).toBe(2);
    expect(retries[0]?.reason).toBe("fail-1");
  });
  it("gives up after maxRetries", async () => {
    await expect(
      withRetry({ maxRetries: 2, label: "t" }, async () => { throw new Error("always"); }),
    ).rejects.toBeInstanceOf(RetryError);
  });
});

describe("gates", () => {
  it("schema gate blocks missing fields", async () => {
    const r = await schemaGate.evaluate({ data: {}, schema: { properties: { a: { type: "string" } } } });
    expect(r.verdict).toBe("BLOCK");
  });
  it("confidence gate warns below floor", async () => {
    const r = await runGates([confidenceGate], {
      minConfidence: 0.9,
      claims: [{ claim: "c", evidence: { source: "s", confidence: 0.3 } }],
    });
    expect(r[0]?.verdict).toBe("WARN");
  });
});
