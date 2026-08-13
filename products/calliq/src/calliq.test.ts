import { describe, it, expect } from "vitest";
import { createPlatform } from "@pyai/core";
import { buildCallIQWorkflow } from "./workflow.js";

const platform = createPlatform({ includeMock: true });

describe("CallIQ analysis workflow", () => {
  it("transcribes (inline), extracts with evidence, and verifies offline via mock", async () => {
    const transcript = [
      "Sales Rep: Thanks for hopping on, Dana. I wanted to walk you through the enterprise plan.",
      "Customer: Honestly the main thing holding us back is the implementation cost. We got burned last year.",
      "Sales Rep: We do white-glove onboarding in under four weeks.",
      "Customer: If you send the security pack and a timeline, I think we can get a decision maker in the loop by end of month.",
    ].join("\n");

    const { def, getArtifact } = buildCallIQWorkflow(platform, { transcriptText: transcript });
    const out = await platform.engine.execute(def);
    expect(out.status).toBe("SUCCEEDED");
    const art = getArtifact();
    expect(art.transcript.segments.length).toBeGreaterThan(0);
    expect(art.analysis.dealStage).toBeTruthy();
    expect(art.analysis.objections.length).toBeGreaterThan(0);
    // Evidence must be present on every objection (evidence gate enforces this).
    for (const o of art.analysis.objections) {
      expect(o.evidence.source).toBeTruthy();
      expect(o.evidence.excerpt).toBeTruthy();
    }
    expect(out.gates.some((g) => g.gateId === "evidence" && g.verdict === "PASS")).toBe(true);
    expect(art.recap.talkRatio.length).toBeGreaterThan(0);
    expect(art.recap.keywords.some((k) => k.term === "implementation" || k.term === "security")).toBe(true);
    expect(art.analysis.summary.toLowerCase()).toMatch(/implementation|security|dana|enterprise/);
    expect(art.analysis.summary).not.toMatch(/Mock summary/i);
    const run = platform.tracer.getRun(out.runId);
    expect(run?.status).toBe("SUCCEEDED");
  });

  it("does not invent Dana/pricing notes for an unrelated transcript", async () => {
    const transcript = [
      "Nagelli Praneeth: I am willing to sell you just call products.",
      "Nagelli Praneeth: Are you interested in it?",
      "Nagelli Praneeth: Okay, thanks.",
    ].join("\n");
    const { def, getArtifact } = buildCallIQWorkflow(platform, { transcriptText: transcript, llmProvider: "mock" });
    const out = await platform.engine.execute(def);
    expect(out.status).toBe("SUCCEEDED");
    const art = getArtifact();
    expect(art.analysis.summary.toLowerCase()).toMatch(/just call|interested/);
    expect(art.analysis.summary).not.toMatch(/Dana|security pack|Mock summary/i);
    expect(art.analysis.followUpEmail).not.toMatch(/Dana/i);
    expect(art.analysis.objections).toHaveLength(0);
    expect(art.analysis.participants.some((p) => /nagelli/i.test(p.name))).toBe(true);
  });

  it("normalizes sparse LLM objections into typed details + summary", async () => {
    const { normalizeAnalysis } = await import("./workflow.js");
    const normalized = normalizeAnalysis({
      objections: [
        {
          evidence: {
            source: "transcript",
            excerpt: "the implementation cost. We got burned last year.",
          },
        },
        {
          evidence: {
            source: "transcript",
            excerpt: "if your security review passes our procurement",
          },
        },
      ],
    });
    expect(String(normalized.summary)).not.toMatch(/unavailable/i);
    const objections = normalized.objections as Array<{ type: string; detail: string }>;
    expect(objections[0]?.type).toBe("Implementation");
    expect(objections[0]?.detail.toLowerCase()).toContain("implementation");
    expect(objections[1]?.type).toBe("Security");
    expect(objections[1]?.detail.toLowerCase()).toMatch(/secur|procurement/);
  });
});
