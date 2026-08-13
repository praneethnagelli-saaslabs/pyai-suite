import { describe, expect, it } from "vitest";
import { createSimulatorCatalog } from "./catalog.js";
import { mockCustomerTurn, parseCustomerTurn } from "./customer.js";
import { sanitizeScenario } from "./scenarios.js";

describe("simulator catalog", () => {
  it("seeds Acme and built-in scenarios", () => {
    const cat = createSimulatorCatalog();
    expect(cat.listAgents()[0]?.id).toBe("agt_acme");
    expect(cat.listScenarios().length).toBeGreaterThanOrEqual(5);
  });

  it("snapshots a new version on prompt change and can roll back", () => {
    const cat = createSimulatorCatalog();
    const created = cat.createAgent({ name: "Sales", prompt: "Be helpful." });
    const v2 = cat.updateAgent(created.id, { prompt: "Be terse." });
    expect(v2.activeVersion).toBe(2);
    expect(v2.versions).toHaveLength(2);
    const rolled = cat.activateVersion(created.id, 1);
    expect(rolled.activeVersion).toBe(1);
    expect(rolled.prompt).toBe("Be helpful.");
  });

  it("rejects editing built-in scenarios", () => {
    const cat = createSimulatorCatalog();
    expect(() => cat.updateScenario("angry_customer", { name: "nope" })).toThrow(/Built-in/);
  });
});

describe("customer turns", () => {
  it("parses JSON without leaking control chars", () => {
    const turn = parseCustomerTurn('{"say":"I want a refund\\u0000 now","end":true,"reason":"done"}');
    expect(turn.say).toContain("refund");
    expect(turn.say).not.toMatch(/\u0000/);
    expect(turn.end).toBe(true);
  });

  it("uses opening line then ends the mock script", () => {
    const scn = sanitizeScenario({
      name: "Angry",
      openingLine: "Refund now.",
      patience: "low",
    });
    expect(mockCustomerTurn(scn, 0, "").say).toBe("Refund now.");
    expect(mockCustomerTurn(scn, 4, "I can help").end).toBe(true);
  });
});
