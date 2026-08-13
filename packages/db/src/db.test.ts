import { describe, expect, it } from "vitest";
import { createRunStore, MemoryRunStore } from "./index.js";

describe("RunStore", () => {
  it("memory upsert + list + get", async () => {
    const store = new MemoryRunStore();
    await store.upsert({
      runId: "r1",
      product: "calliq",
      status: "SUCCEEDED",
      startedAt: 100,
      finishedAt: 200,
      durationMs: 100,
    });
    await store.upsert({
      runId: "r2",
      product: "scrib",
      status: "FAILED",
      startedAt: 300,
    });
    const list = await store.list(10);
    expect(list[0]?.runId).toBe("r2");
    expect((await store.get("r1"))?.product).toBe("calliq");
    expect(await store.get("missing")).toBeNull();
  });

  it("createRunStore falls back to memory without DATABASE_URL", async () => {
    const prev = process.env.DATABASE_URL;
    delete process.env.DATABASE_URL;
    const store = await createRunStore();
    expect(store.backend).toBe("memory");
    if (prev !== undefined) process.env.DATABASE_URL = prev;
  });
});
