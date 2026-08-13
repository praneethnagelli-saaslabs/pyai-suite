import { describe, expect, it } from "vitest";
import { applyTranscriptDelta, growCaption, upsertTurn } from "./liveCaption";

describe("growCaption", () => {
  it("never shrinks a longer caption", () => {
    expect(growCaption("Hello there", "Hello")).toBe("Hello there");
  });

  it("grows when the model sends a prefix snapshot", () => {
    expect(growCaption("Hello", "Hello there")).toBe("Hello there");
  });

  it("inserts a space between word tokens", () => {
    expect(growCaption("Hello", "there")).toBe("Hello there");
    expect(growCaption("Hi", ",")).toBe("Hi,");
    expect(growCaption("Hi,", "you've")).toBe("Hi, you've");
  });

  it("keeps the spaced sentence instead of jammed plus spaced", () => {
    const jammed = "Hi,you'vereachedAcme.HowcanIhelpyoutoday?";
    const spaced = "Hi, you've reached Acme. How can I help you today?";
    expect(growCaption(jammed, spaced)).toBe(spaced);
    expect(growCaption(spaced, jammed)).toBe(spaced);
    expect(growCaption(jammed + spaced, spaced)).toBe(spaced);
  });

  it("does not append a leftover token after a duplicate final", () => {
    const jammed = "I'msorryyou'reupset.can'tprocessrefundsdirectly,butcanconnectyouwithsomeonewhocanassist.Wouldyoulikemetotransferyoutoanagent?";
    const spaced =
      "I'm sorry you're upset. I can't process refunds directly, but I can connect you with someone who can assist. Would you like me to transfer you to an agent?";
    expect(growCaption(jammed + spaced, spaced)).toBe(spaced);
  });
});

describe("applyTranscriptDelta", () => {
  it("ignores a shorter final that would rewind", () => {
    expect(applyTranscriptDelta("How can I help you today?", "How can", true)).toBe(
      "How can I help you today?",
    );
  });

  it("uses the spaced final over jammed deltas", () => {
    const jammed = "Understood.I'llconnectyoutoasupervisorrightaway.Pleaseholdforamoment.";
    const spaced = "Understood. I'll connect you to a supervisor right away. Please hold for a moment.";
    expect(applyTranscriptDelta(jammed, spaced, true)).toBe(spaced);
  });

  it("builds a readable line from unspaced tokens", () => {
    let text = "";
    for (const part of ["Hi", ",", "you've", "reached", "Acme", "."]) {
      text = applyTranscriptDelta(text, part, false);
    }
    expect(text).toBe("Hi, you've reached Acme.");
  });

  it("keeps a lead-in and replaces the jammed tail with the spaced final", () => {
    const jammed = "I understand.Understood.I'llconnectyoutoasupervisorrightaway.Pleaseholdforamoment.";
    const spaced = "Understood. I'll connect you to a supervisor right away. Please hold for a moment.";
    expect(applyTranscriptDelta(jammed, spaced, true)).toBe(
      "I understand. Understood. I'll connect you to a supervisor right away. Please hold for a moment.",
    );
  });
});

describe("upsertTurn", () => {
  it("updates a live row in place instead of moving it", () => {
    const a = { id: "agent-live", speaker: "agent" as const, text: "Hi", ts: 1, final: false };
    const u = { id: "user-live", speaker: "user" as const, text: "Hey", ts: 2, final: false };
    const next = upsertTurn([a, u], { ...a, text: "Hi there" });
    expect(next.map((t) => t.id)).toEqual(["agent-live", "user-live"]);
    expect(next[0]?.text).toBe("Hi there");
  });

  it("finalizes the live row in place", () => {
    const live = { id: "agent-live", speaker: "agent" as const, text: "Hi", ts: 1, final: false };
    const done = { id: "a-9", speaker: "agent" as const, text: "Hi", ts: 1, final: true };
    const next = upsertTurn([live], done);
    expect(next).toEqual([done]);
  });
});
