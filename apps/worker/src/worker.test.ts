import { describe, expect, it } from "vitest";
import { InMemoryQueue, processJob } from "./index.js";
import { createPlatform } from "@pyai/core";

describe("worker queue", () => {
  it("drains scrib jobs", async () => {
    const q = new InMemoryQueue();
    await q.enqueue("scrib.dictate", { rawText: "hey uh send this" });
    const results = await q.drain();
    expect(results).toHaveLength(1);
    expect(["SUCCEEDED", "PARTIAL", "FAILED"]).toContain(results[0]!.status);
  });

  it("processJob handles unknown kind", async () => {
    const platform = createPlatform({ includeMock: true });
    const r = await processJob(platform, { id: "x", kind: "eval.run", payload: {} });
    expect(r.status).toBe("FAILED");
    expect(r.error).toBe("unknown_kind");
  });
});
