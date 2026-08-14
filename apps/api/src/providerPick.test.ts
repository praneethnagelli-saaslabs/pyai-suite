import { beforeEach, describe, expect, it } from "vitest";
import { Capability, createPlatform } from "@pyai/core";
import {
  liveCandidates,
  pickProvider,
  resetSttCooldowns,
  sttFallbackMessage,
  transcribeWithFallback,
} from "./providerPick.js";

describe("providerPick", () => {
  beforeEach(() => resetSttCooldowns());

  it("orders live STT candidates pyai → openai → gemini", () => {
    expect(liveCandidates()).toEqual(["pyai", "openai", "gemini"]);
    expect(liveCandidates("openai")).toEqual(["openai", "pyai", "gemini"]);
    expect(liveCandidates("mock")).toEqual(["pyai", "openai", "gemini"]);
  });

  it("picks OpenAI for LLM when PyAI has no chat", () => {
    const platform = createPlatform({
      includeMock: true,
      pyai: { apiKey: "pyai-test" },
      openai: { apiKey: "openai-test" },
    });
    expect(pickProvider(platform, Capability.LLM, "pyai")).toBe("openai");
    expect(pickProvider(platform, Capability.BATCH_STT, "pyai")).toBe("pyai");
  });

  it("skips unconfigured PyAI/OpenAI and uses mock when allowed", async () => {
    const platform = createPlatform({
      includeMock: true,
      pyai: { apiKey: "" },
      openai: { apiKey: "" },
      gemini: { apiKey: "" },
    });
    const out = await transcribeWithFallback(
      platform,
      { audio: new TextEncoder().encode("dummy"), format: "wav" },
      "pyai",
      { includeMock: true },
    );
    expect(out.provider).toBe("mock");
    expect(out.text.length).toBeGreaterThan(0);
    expect(out.fallback).toBe(false);
  });

  it("does not use mock for live Scrib audio", async () => {
    const platform = createPlatform({
      includeMock: true,
      pyai: { apiKey: "" },
      openai: { apiKey: "" },
      gemini: { apiKey: "" },
    });
    await expect(
      transcribeWithFallback(
        platform,
        { audio: new TextEncoder().encode("dummy"), format: "wav" },
        "pyai",
        { includeMock: false },
      ),
    ).rejects.toThrow(/no STT provider available|transcription failed/);
  });

  it("lists every provider that failed", () => {
    expect(sttFallbackMessage(["pyai: empty transcript", "openai: 401"])).toContain("openai: 401");
  });

  it("formats a UI-facing fallback note", async () => {
    const { providerFallbackNote } = await import("./providerPick.js");
    expect(providerFallbackNote("openai", ["pyai: timeout"])).toMatch(/Fell back to openai/);
    expect(providerFallbackNote("openai", [])).toBeUndefined();
  });
});
