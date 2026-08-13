import { describe, expect, it } from "vitest";
import { createPlatform } from "@pyai/core";
import { buildScribWorkflow, localCleanup } from "./workflow.js";
import { PersonalDictionary } from "./dictionary.js";
import { resolveAppMode } from "./modes.js";

describe("Scrib", () => {
  it("resolves app-aware modes", () => {
    expect(resolveAppMode("Slack")?.mode).toBe("concise");
    expect(resolveAppMode("Gmail - Inbox")?.mode).toBe("professional");
  });

  it("applies personal dictionary", () => {
    const d = new PersonalDictionary();
    d.add({ term: "nestjs", replacement: "NestJS" });
    expect(d.apply("we use nestjs daily")).toBe("we use NestJS daily");
  });

  it("local cleanup removes fillers", () => {
    const out = localCleanup("hey can you like uh send this tomorrow", "light");
    expect(out.toLowerCase()).not.toContain("uh");
    expect(out.toLowerCase()).not.toContain(" like ");
  });

  it("flags chatbot-style cleanup failures", async () => {
    const { looksLikeAssistantReply } = await import("./modes.js");
    expect(
      looksLikeAssistantReply(
        "Can you tell me my name?",
        "I'm sorry, but I can't tell you your name.",
      ),
    ).toBe(true);
    expect(looksLikeAssistantReply("Can you tell me my name?", "Can you tell me my name?")).toBe(false);
    expect(
      looksLikeAssistantReply(
        "send this tomorrow",
        "Mock analysis for: Clean this dictation transcript for insertion into a text field.",
      ),
    ).toBe(true);
  });

  it("runs dictation workflow on mock", async () => {
    const platform = createPlatform({ includeMock: true });
    const { def, getArtifact } = buildScribWorkflow(platform, {
      rawText: "hey can you like uh send this to the team tomorrow",
      mode: "professional",
      cleanupProvider: "mock",
      dictionary: [{ term: "team", replacement: "Team" }],
    });
    const out = await platform.engine.execute(def);
    expect(["SUCCEEDED", "PARTIAL"]).toContain(out.status);
    const art = getArtifact();
    expect(art.raw.length).toBeGreaterThan(0);
    expect(art.cleaned.length).toBeGreaterThan(0);
    expect(art.cleaned.toLowerCase()).not.toContain("mock analysis");
    expect(art.cleaned.toLowerCase()).not.toContain("clean this dictation");
    expect(art.cleaned.toLowerCase()).toContain("send this");
    expect(art.cleanupProvider).toBe("local");
  });

  it("preserves Hear latency when STT ran before cleanup", async () => {
    const platform = createPlatform({ includeMock: true });
    const { def, getArtifact } = buildScribWorkflow(platform, {
      rawText: "hey team send this tomorrow",
      mode: "light",
      sttProvider: "pyai",
      sttMs: 842,
      cleanupProvider: "local",
    });
    await platform.engine.execute(def);
    const art = getArtifact();
    expect(art.sttProvider).toBe("pyai");
    expect(art.latency.sttMs).toBe(842);
    expect(art.latency.totalMs).toBe(art.latency.sttMs + art.latency.dictionaryMs + art.latency.cleanupMs);
  });
});
