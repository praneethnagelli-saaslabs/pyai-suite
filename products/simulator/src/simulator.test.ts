import { describe, expect, it } from "vitest";
import { createPlatform } from "@pyai/core";
import { buildSimulatorWorkflow, PERSONAS } from "./index.js";

describe("Voice Agent Simulator", () => {
  it("ships personas", () => {
    expect(PERSONAS.length).toBeGreaterThanOrEqual(5);
  });

  it("runs a small stress batch offline", async () => {
    const platform = createPlatform({ includeMock: true });
    const { def, getArtifact } = buildSimulatorWorkflow(platform, {
      count: 5,
      concurrency: 5,
      llmProvider: "mock",
      agentName: "Demo Agent",
    });
    const out = await platform.engine.execute(def);
    expect(["SUCCEEDED", "PARTIAL"]).toContain(out.status);
    const card = getArtifact();
    expect(card.tests).toBe(5);
    expect(card.agent).toBe("Demo Agent");
    expect(card.calls.length).toBe(5);
  });
});
