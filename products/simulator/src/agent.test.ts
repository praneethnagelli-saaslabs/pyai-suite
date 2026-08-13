import { describe, expect, it } from "vitest";
import { DEFAULT_AGENT, sanitizeAgentConfig } from "./agent.js";

describe("simulator agent config", () => {
  it("accepts the default agent", () => {
    const agent = sanitizeAgentConfig(DEFAULT_AGENT);
    expect(agent.version).toBe(1);
    expect(agent.voice).toBe("ava");
  });

  it("rejects oversized prompts", () => {
    expect(() => sanitizeAgentConfig({ ...DEFAULT_AGENT, prompt: "x".repeat(9_000) })).toThrow();
  });

  it("falls back to ava for unknown voices", () => {
    expect(sanitizeAgentConfig({ ...DEFAULT_AGENT, voice: "unknown-voice" }).voice).toBe("ava");
  });

  it("accepts legacy version strings", () => {
    expect(sanitizeAgentConfig({ ...DEFAULT_AGENT, version: "v3" }).version).toBe(3);
  });
});
