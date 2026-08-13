import { describe, expect, it } from "vitest";
import { StubDesktopBridge } from "./bridge.js";

describe("desktop bridge stub", () => {
  it("reports unavailable outside Tauri", () => {
    const b = new StubDesktopBridge();
    expect(b.isAvailable()).toBe(false);
    expect(b.capabilities()).toEqual([]);
  });
});
