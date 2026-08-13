import { describe, it, expect } from "vitest";
import { ControlPlane } from "./index.js";
import { createPlatform } from "@pyai/core";

describe("ControlPlane (AI-native command routing)", () => {
  it("routes 'summarize last three meetings with Acme' to Brief", () => {
    const cp = ControlPlane.withDefaults(createPlatform({ includeMock: true }));
    const r = cp.parse("Summarize the last three meetings with Acme.");
    expect("error" in r).toBe(false);
    if (!("error" in r)) {
      expect(r.result.product).toBe("brief");
      expect(r.result.params).toMatchObject({ account: "acme", limit: 3 });
    }
  });

  it("routes 'run my agent against 20 angry customers' to Simulator", () => {
    const cp = ControlPlane.withDefaults(createPlatform({ includeMock: true }));
    const r = cp.parse("Run my agent against 20 angry customers.");
    expect("error" in r).toBe(false);
    if (!("error" in r)) {
      expect(r.result.product).toBe("simulator");
      expect(r.result.params).toMatchObject({ count: 20, persona: "angry_customer" });
    }
  });

  it("routes pricing search to CallIQ", () => {
    const cp = ControlPlane.withDefaults(createPlatform({ includeMock: true }));
    const r = cp.parse("Find the call where pricing was objected to.");
    expect("error" in r).toBe(false);
    if (!("error" in r)) expect(r.result.product).toBe("calliq");
  });

  it("returns an error for unresolvable commands", () => {
    const cp = ControlPlane.withDefaults(createPlatform({ includeMock: true }));
    const r = cp.parse("make me a sandwich");
    expect("error" in r).toBe(true);
  });
});
