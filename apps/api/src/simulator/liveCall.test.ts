import { describe, expect, it } from "vitest";
import { createPlatform } from "@pyai/core";
import { listRealtimeProviders, openLiveCall } from "./liveCall.js";

describe("simulator live call", () => {
  it("lists mock as a demo provider without secrets", () => {
    const platform = createPlatform({ includeMock: true });
    const providers = listRealtimeProviders(platform);
    expect(providers.some((p) => p.id === "mock" && p.configured)).toBe(true);
    expect(JSON.stringify(providers)).not.toMatch(/sk-|pyai_live_|pyai_test_/i);
  });

  it("opens a mock session and closes it", async () => {
    const platform = createPlatform({ includeMock: true });
    const session = await openLiveCall(
      platform,
      {
        name: "Test Agent",
        prompt: "You are a test receptionist.",
        voice: "ava",
        greeting: "Hello.",
        version: "v1",
      },
      { forceProvider: "mock" },
    );
    expect(session.provider).toBe("mock");
    expect(session.fallbackUsed).toBe(false);
    expect(session.sessionId.startsWith("sim_")).toBe(true);
    await session.handle.close();
  });
});
