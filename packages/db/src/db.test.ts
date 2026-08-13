import { describe, expect, it } from "vitest";
import { createRunStore, MemoryMeetingStore, MemoryRunStore } from "./index.js";

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

describe("MeetingStore", () => {
  it("persists meetings and replaces chunks", async () => {
    const store = new MemoryMeetingStore();
    await store.saveMeeting({
      id: "m1",
      date: "2026-06-17T00:00:00.000Z",
      title: "Launch planning",
      mode: "Planning",
      notes: { title: "Launch planning" },
      transcript: "Them: launch moves to August.",
    });
    await store.replaceChunks("m1", [
      {
        id: "m1:decision:0",
        meetingId: "m1",
        date: "2026-06-17T00:00:00.000Z",
        title: "Launch planning",
        kind: "decision",
        text: "Move launch to August.",
        evidence: "launch moves to August",
        embedding: [0.1, 0.2],
      },
    ]);
    await store.replaceChunks("m1", [
      {
        id: "m1:decision:0",
        meetingId: "m1",
        date: "2026-06-17T00:00:00.000Z",
        title: "Launch planning",
        kind: "decision",
        text: "Move launch to August.",
        evidence: "launch moves to August",
        embedding: [0.3],
      },
    ]);
    const listed = await store.listMeetings();
    expect(listed[0]?.id).toBe("m1");
    const chunks = await store.loadChunks();
    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.embedding).toEqual([0.3]);
  });
});
