import { describe, expect, it } from "vitest";
import { recapFromSegments, talkRatio, trackKeywords } from "./recap.js";

const segs = [
  { id: "s1", speaker: "Sales Rep", start: 0, end: 40, text: "Let me walk you through pricing and onboarding." },
  { id: "s2", speaker: "Customer", start: 40, end: 70, text: "Implementation cost is the blocker. Security review too." },
  { id: "s3", speaker: "Sales Rep", start: 70, end: 90, text: "We can send the security pack this week." },
];

describe("Recap metrics", () => {
  it("computes talk-ratio from segment durations", () => {
    const ratio = talkRatio(segs);
    expect(ratio[0]?.speaker).toBe("Sales Rep");
    expect(ratio.find((r) => r.speaker === "Sales Rep")?.pct).toBe(67);
    expect(ratio.find((r) => r.speaker === "Customer")?.pct).toBe(33);
  });

  it("tracks sales keywords with speaker + timestamp", () => {
    const hits = trackKeywords(segs);
    expect(hits.find((h) => h.term === "pricing")?.count).toBe(1);
    expect(hits.find((h) => h.term === "security")?.speakers).toContain("Customer");
    expect(hits.find((h) => h.term === "implementation")?.at[0]).toBe(40);
  });

  it("rolls metrics into a Recap payload", () => {
    const recap = recapFromSegments(segs);
    expect(recap.speakers).toBe(2);
    expect(recap.durationSecs).toBe(90);
    expect(recap.keywords.length).toBeGreaterThan(0);
  });
});
