import { describe, expect, it } from "vitest";
import { PyAIProvider, PYAI_DEFAULT_BASE_URL } from "./providers/pyai.js";

describe("PyAIProvider (docs alignment)", () => {
  it("defaults to api.pyai.com (not .dev)", () => {
    const p = new PyAIProvider({ apiKey: "pyai_test_dummy" });
    expect(p.apiOrigin).toBe(PYAI_DEFAULT_BASE_URL);
    expect(PYAI_DEFAULT_BASE_URL).toBe("https://api.pyai.com");
  });

  it("strips trailing /v1 from configured base URL", () => {
    const p = new PyAIProvider({ apiKey: "x", baseUrl: "https://api.pyai.com/v1" });
    expect(p.apiOrigin).toBe("https://api.pyai.com");
  });

  it("isConfigured only when a key is present", () => {
    expect(new PyAIProvider({}).isConfigured()).toBe(false);
    expect(new PyAIProvider({ apiKey: "pyai_test_x" }).isConfigured()).toBe(true);
  });

  it("advertises Hear / Speak / Omni models", async () => {
    const models = await new PyAIProvider({ apiKey: "x" }).models();
    const ids = models.map((m) => m.id);
    expect(ids).toContain("pyai-hear");
    expect(ids).toContain("pyai-voice");
    expect(ids).toContain("pyai-omni");
  });
});
