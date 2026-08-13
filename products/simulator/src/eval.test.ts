import { describe, expect, it } from "vitest";
import { createSimulatorCatalog } from "./catalog.js";
import { evaluateCall, formatTranscript } from "./eval.js";
import { sanitizeScenario } from "./scenarios.js";

const angry = sanitizeScenario({
  name: "Angry refund",
  emotionalState: "frustrated",
  expected: ["Acknowledge frustration", "Offer a next step"],
  failures: ["Argues with customer", "Makes unsupported promises"],
});

describe("evaluateCall", () => {
  it("passes a professional refund handling turn", () => {
    const ev = evaluateCall({
      transcript: [
        "Customer: This is ridiculous. I want a refund right now.",
        "Agent: I'm sorry you're upset. I can't process refunds directly, but I can connect you with someone who can assist.",
      ].join("\n"),
      scenario: angry,
      durationMs: 8_000,
      turnCount: 2,
      interruptions: 0,
      fallbackUsed: false,
    });
    expect(ev.passed).toBe(true);
    expect(ev.scores.overall).toBeGreaterThanOrEqual(70);
    expect(ev.checks.some((c) => c.status === "fail")).toBe(false);
  });

  it("fails an unsupported refund promise and strips control chars", () => {
    const ev = evaluateCall({
      transcript: "Agent: I'll give you a full refund right now\u0000.",
      scenario: angry,
      durationMs: 2_000,
      turnCount: 1,
      interruptions: 0,
      fallbackUsed: false,
    });
    expect(ev.passed).toBe(false);
    expect(ev.checks.some((c) => c.id === "unsupported_promise")).toBe(true);
    expect(ev.summary).not.toMatch(/\u0000/);
  });
});

describe("formatTranscript", () => {
  it("labels speakers and caps length", () => {
    const text = formatTranscript([
      { speaker: "agent", text: "Hi" },
      { speaker: "user", text: "Refund" },
    ]);
    expect(text).toContain("Agent: Hi");
    expect(text).toContain("Customer: Refund");
  });
});

describe("simulation store", () => {
  it("records an eval and builds dashboard + compare", () => {
    const cat = createSimulatorCatalog();
    const a = cat.recordSimulation({
      mode: "persona",
      agentId: "agt_acme",
      scenarioId: "angry_customer",
      provider: "mock",
      durationMs: 9_000,
      turns: [
        { speaker: "user", text: "I want a refund." },
        { speaker: "agent", text: "I'm sorry. I can transfer you to someone who can help." },
      ],
    });
    const b = cat.recordSimulation({
      mode: "persona",
      agentId: "agt_acme",
      scenarioId: "angry_customer",
      provider: "openai",
      fallbackUsed: true,
      durationMs: 12_000,
      turns: [{ speaker: "agent", text: "As an AI language model I will refund you immediately." }],
    });
    expect(a.evaluation.passed).toBe(true);
    expect(b.evaluation.passed).toBe(false);
    const dash = cat.dashboard();
    expect(dash.total).toBe(2);
    expect(dash.failed).toBe(1);
    const cmp = cat.compareSimulations(b.id, a.id);
    expect(cmp.deltas.overall).toBeGreaterThan(0);
    expect(cat.listSimulations()[0]?.id).toBe(b.id);
    expect(cat.listSimulations()[0]).not.toHaveProperty("transcript");
  });
});
