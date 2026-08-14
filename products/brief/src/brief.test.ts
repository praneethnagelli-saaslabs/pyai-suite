import { describe, expect, it } from "vitest";
import { createPlatform, Capability } from "@pyai/core";
import { MemoryMeetingStore } from "@pyai/db";
import { buildBriefWorkflow, MeetingMemory } from "./workflow.js";

const SAMPLE = [
  "Me: Let's lock July launch if security signs off.",
  "Them: We decided to move launch to August.",
  "Me: Action item — Them owns the security pack by Friday?",
  "Them: Yes. Any questions on pricing?",
].join("\n");

function memoryFromPlatform() {
  const platform = createPlatform({ includeMock: true });
  const embed = platform.registry.getAdapterFor(Capability.EMBEDDINGS, "mock")?.asEmbeddings?.();
  const llm = platform.registry.getAdapterFor(Capability.LLM, "mock")?.asLLM?.();
  if (!embed || !llm) throw new Error("mock adapters missing");
  return { platform, mem: new MeetingMemory(new MemoryMeetingStore(), embed, llm) };
}

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
    expect(art.notes.actionItems.every((a) => !/jordan/i.test(a.owner))).toBe(true);
    expect(art.notes.participants.every((p) => !/jordan/i.test(p))).toBe(true);
    expect(art.segments.length).toBeGreaterThan(0);
    expect(art.privacy.storage).toBe("local");
  });

  it("answers meeting memory from retrieved notes, not a keyword dump", async () => {
    const { platform, mem } = memoryFromPlatform();
    const { def, getArtifact } = buildBriefWorkflow(platform, {
      transcriptText: SAMPLE,
      mode: "Planning",
      llmProvider: "mock",
    });
    await platform.engine.execute(def);
    const art = getArtifact();
    await mem.add("m1", art.notes, SAMPLE, "2026-06-17T00:00:00.000Z");

    const byMonth = await mem.search("August");
    expect(byMonth.answer).toMatch(/august|launch/i);
    expect(byMonth.grounded).toBe(true);
    expect(byMonth.results.length).toBeGreaterThan(0);
    expect(byMonth.results.some((h) => h.kind === "decision" || h.kind === "transcript")).toBe(true);

    const nl = await mem.search("What did we decide about launch?");
    expect(nl.grounded).toBe(true);
    expect(nl.answer).toMatch(/august|launch/i);
    expect(nl.answer).not.toMatch(/^Them:/i);

    const empty = await mem.search("");
    expect(empty.results).toHaveLength(0);
    expect(empty.answer).toBeNull();

    const miss = await mem.search("xyzzy-no-such-topic");
    expect(miss.grounded).toBe(false);
    expect(miss.results).toHaveLength(0);

    expect((await mem.list())[0]?.id).toBe("m1");
    const got = await mem.get("m1");
    expect(got?.title).toBe(art.notes.title);
    expect(got?.transcript).toContain("August");
  });
});
