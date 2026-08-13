import { describe, expect, it } from "vitest";
import { TOOLS } from "./index.js";

describe("mcp tools", () => {
  it("exposes suite tools", () => {
    const names = TOOLS.map((t) => t.name);
    expect(names).toContain("search_meetings");
    expect(names).toContain("run_benchmark");
    expect(names).toContain("get_provider_status");
  });
});
