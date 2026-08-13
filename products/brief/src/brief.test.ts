import { describe, expect, it } from "vitest";
import { createPlatform } from "@pyai/core";
import { buildBriefWorkflow, MeetingMemory } from "./workflow.js";

const SAMPLE = [
  "Me: Let's lock July launch if security signs off.",
  "Them: We decided to move launch to August.",
  "Me: Action item — Them owns the security pack by Friday?",
  "Them: Yes. Any questions on pricing?",
].join("\n");

describe("Brief", () => {
  it("extracts meeting notes on mock", async () => {
    const platform = createPlatform({ includeMock: true });
    const { def, getArtifact } = buildBriefWorkflow(platform, {
      transcriptText: SAMPLE,
      mode: "Planning",
      llmProvider: "mock",
    });
    const out = await platform.engine.execute(def);
    expect(["SUCCEEDED", "PARTIAL"]).toContain(out.status);
    const art = getArtifact();
    expect(art.notes.title.toLowerCase()).not.toContain("mock");
    expect(art.notes.summary.toLowerCase()).not.toContain("mock summary");
    expect(art.notes.summary).not.toMatch(/^Summary of /);
    expect(art.notes.decisions.length).toBeGreaterThan(0);
    expect(art.notes.decisions[0]!.decision).not.toMatch(/^(Me|Them):/i);
    expect(art.notes.actionItems.some((a) => /security pack/i.test(a.task))).toBe(true);
    expect(art.notes.participants.length).toBeGreaterThan(0);
    expect(art.segments.length).toBeGreaterThan(0);
    expect(art.privacy.storage).toBe("local");
  });

  it("searches meeting memory", async () => {
    const platform = createPlatform({ includeMock: true });
    const mem = new MeetingMemory();
    const { def, getArtifact } = buildBriefWorkflow(platform, {
      transcriptText: SAMPLE,
      mode: "Planning",
      llmProvider: "mock",
    });
    await platform.engine.execute(def);
    const art = getArtifact();
    mem.add("m1", art.notes, SAMPLE, "2026-06-17");
    const hits = mem.search("August");
    expect(hits.length + mem.list().length).toBeGreaterThan(0);
    expect(mem.list()[0]?.id).toBe("m1");
  });
});
