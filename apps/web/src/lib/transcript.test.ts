import { describe, expect, it } from "vitest";
import { parseTranscript, formatClock, normalizeDiarizedTranscript } from "./transcript";
import { liveSignals, conversationMap, speakerLanes } from "./conversationIntel";

describe("parseTranscript", () => {
  it("splits speaker lines and estimates clocks", () => {
    const u = parseTranscript(
      "Rep: Let's talk pricing.\nCustomer: The enterprise plan seems expensive.\nRep: We can send the security pack.",
    );
    expect(u).toHaveLength(3);
    expect(u[0]?.speaker).toBe("Rep");
    expect(u[1]?.speaker).toBe("Customer");
    expect(u[1]?.text).toMatch(/expensive/);
    expect(formatClock(u[0]!.t)).toBe("0:00");
  });

  it("reads Hear [speaker_n] labels and normalizes them", () => {
    const raw = [
      "[speaker_2] take care",
      "[speaker_3] any question for from from my end",
      "[speaker_1] no the",
      "[speaker_1] thank you",
      "[speaker_1] okay",
      "[speaker_1] bye bye",
    ].join("\n");
    const u = parseTranscript(raw);
    expect(u[0]?.speaker).toBe("Speaker 2");
    expect(u[1]?.speaker).toBe("Speaker 3");
    expect(u[2]?.speaker).toBe("Speaker 1");
    const n = normalizeDiarizedTranscript(raw);
    expect(n).toContain("Speaker 2: take care");
    expect(n).toMatch(/Speaker 1: no the thank you okay bye bye/);
  });
});

describe("conversationIntel", () => {
  it("surfaces pricing and next-step signals from real text", () => {
    const u = parseTranscript(
      "Customer: The cost is holding us back.\nRep: I'll send the security pack next week.",
    );
    const sig = liveSignals(u);
    expect(sig.some((s) => s.label.toLowerCase().includes("pricing"))).toBe(true);
    expect(sig.some((s) => s.kind === "action")).toBe(true);
    const map = conversationMap(u, {
      objections: [{ type: "Price", detail: "cost is holding us back" }],
      nextSteps: [{ task: "Send security pack" }],
    });
    expect(map[0]?.kind).toBe("open");
    expect(map.some((n) => n.kind === "risk")).toBe(true);
    expect(map.some((n) => n.kind === "resolve")).toBe(true);
  });

  it("puts Rep and Customer on opposite lanes with different fills", () => {
    const lanes = speakerLanes(["Rep", "Customer", "Rep"]);
    expect(lanes.get("Rep")?.lane).toBe("up");
    expect(lanes.get("Customer")?.lane).toBe("down");
    expect(lanes.get("Rep")?.fill).not.toBe(lanes.get("Customer")?.fill);
  });
});
