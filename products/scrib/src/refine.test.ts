import { describe, expect, it } from "vitest";
import { localRefine, looksLikeRefineInstruction } from "./refine-detect.js";

describe("Scrib refine-in-place", () => {
  it("detects edit instructions, not new messages", () => {
    expect(looksLikeRefineInstruction("make it shorter")).toBe(true);
    expect(looksLikeRefineInstruction("more formal")).toBe(true);
    expect(looksLikeRefineInstruction("as an email")).toBe(true);
    expect(looksLikeRefineInstruction("add the date")).toBe(true);
    expect(looksLikeRefineInstruction("rewrite that")).toBe(true);
    expect(looksLikeRefineInstruction("hey uh can we push the launch tomorrow")).toBe(false);
    expect(looksLikeRefineInstruction("sounds good thanks")).toBe(false);
    expect(looksLikeRefineInstruction("make it to the office by five")).toBe(false);
  });

  it("local refine shortens or polishes without inventing", () => {
    const last = "Hey can you like uh send this to the team tomorrow.";
    const short = localRefine(last, "make it shorter");
    expect(short.toLowerCase()).not.toContain("uh");
    expect(short.toLowerCase()).toContain("send this");
    const pro = localRefine(last, "more professional");
    expect(pro.toLowerCase()).toContain("send this");
  });
});
