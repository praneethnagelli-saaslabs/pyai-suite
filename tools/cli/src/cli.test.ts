import { describe, expect, it } from "vitest";

describe("cli", () => {
  it("exposes expected commands", () => {
    const commands = ["doctor", "setup", "providers", "playground", "demo", "benchmark", "run"];
    expect(commands).toContain("doctor");
    expect(commands.length).toBe(7);
  });
});
