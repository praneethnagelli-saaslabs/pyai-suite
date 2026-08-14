import { describe, expect, it } from "vitest";
import {
  MemoryRecordingStore,
  normalizeContentType,
  sanitizeEntityId,
} from "./recordingStore.js";

describe("recordingStore", () => {
  it("sanitizes entity ids and content types", () => {
    expect(sanitizeEntityId("run_abc-1")).toBe("run_abc-1");
    expect(sanitizeEntityId("../etc/passwd")).toBeNull();
    expect(normalizeContentType("audio/mpeg")).toBe("audio/mpeg");
    expect(normalizeContentType(undefined, "wav")).toBe("audio/wav");
    expect(normalizeContentType("text/plain")).toBeNull();
  });

  it("stores and retrieves audio in memory", async () => {
    const store = new MemoryRecordingStore();
    const bytes = new TextEncoder().encode("fake-wav");
    const meta = await store.put({
      product: "brief",
      entityId: "m1",
      bytes,
      contentType: "audio/wav",
    });
    expect(meta.byteLength).toBe(bytes.byteLength);
    expect(await store.has("brief", "m1")).toBe(true);
    const got = await store.get("brief", "m1");
    expect(got?.contentType).toBe("audio/wav");
    expect(Buffer.from(got!.bytes).toString()).toBe("fake-wav");
    const flags = await store.hasMany("brief", ["m1", "m2"]);
    expect(flags.m1).toBe(true);
    expect(flags.m2).toBe(false);
  });
});
