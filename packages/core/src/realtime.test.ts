import { describe, expect, it } from "vitest";
import { Capability, createPlatform } from "./index.js";
import { MockRealtimeAdapter } from "./providers/realtime-mock.js";
import { classifyRealtimeFailure, taggedFrame, OMNI_KIND, isWsSubprotocol } from "./providers/realtime-shared.js";

describe("realtime mock", () => {
  it("starts, greets, and closes without a network", async () => {
    const rt = new MockRealtimeAdapter();
    const session = await rt.startSession({
      systemPrompt: "You are a receptionist.",
      greeting: "Hello from mock.",
    });
    const events: string[] = [];
    const collect = (async () => {
      for await (const ev of session.events()) {
        events.push(ev.type);
        if (ev.type === "ended") break;
      }
    })();
    await new Promise((r) => setTimeout(r, 50));
    session.sendAudio(new Uint8Array(2400));
    await new Promise((r) => setTimeout(r, 800));
    await session.close();
    await collect;
    expect(events).toContain("session.started");
    expect(events).toContain("agent.speech_started");
    expect(events).toContain("transcript");
    expect(events).toContain("ended");
  });

  it("is registered on the mock provider", async () => {
    const platform = createPlatform({ includeMock: true });
    const adapter = platform.registry.getAdapterFor(Capability.REALTIME_VOICE, "mock");
    expect(adapter?.asRealtime).toBeTypeOf("function");
    const session = await adapter!.asRealtime()!.startSession({ greeting: "Hi" });
    await session.close();
  });
});

describe("omni framing", () => {
  it("prefixes kind bytes", () => {
    const frame = taggedFrame(OMNI_KIND.CONTROL, '{"type":"configure"}');
    expect(frame[0]).toBe(0x03);
    expect(new TextDecoder().decode(frame.subarray(1))).toContain('"type":"configure"');
  });

  it("classifies timeouts without leaking secrets", () => {
    const out = classifyRealtimeFailure(new Error("timeout pyai_live_abcdefghijklmnopqrstuvwxyz"));
    expect(out.reason).toBe("TIMEOUT");
    expect(out.message).not.toMatch(/pyai_live_abcdefghijklmnopqrstuvwxyz/);
  });

  it("treats retired Realtime Beta as unavailable so fallback can run", () => {
    const out = classifyRealtimeFailure(
      new Error("The Realtime Beta API is no longer supported. Please use /v1/realtime for the GA API."),
    );
    expect(out.reason).toBe("UNAVAILABLE");
  });

  it("rejects API keys that are not valid WebSocket subprotocols", () => {
    expect(isWsSubprotocol("realtime")).toBe(true);
    expect(isWsSubprotocol("pyai-key.abc_def-1")).toBe(true);
    expect(isWsSubprotocol("pyai-key.abc/def")).toBe(false);
    expect(isWsSubprotocol("openai-insecure-api-key.sk-proj=x")).toBe(false);
  });
});
