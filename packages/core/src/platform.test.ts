import { describe, it, expect } from "vitest";
import { createHmac } from "node:crypto";
import { PromptRegistry, makePrompt } from "./prompts.js";
import { WebhookBus } from "./webhooks.js";
import { FeatureFlags } from "./flags.js";
import { createPlatform } from "./index.js";

describe("PromptRegistry (spec #83)", () => {
  it("registers, resolves latest, and renders templates", () => {
    const r = new PromptRegistry();
    r.register(makePrompt({ id: "sales", version: "v1", description: "draft", template: "Hello {{name}}" }));
    r.register(makePrompt({ id: "sales", version: "v2", description: "draft", template: "Hi {{name}}, let's talk" }));
    expect(r.get("sales")?.version).toBe("v2");
    const rendered = r.render("sales", { name: "Dana" });
    expect(rendered.text).toContain("Dana");
    expect(rendered.version).toBe("v2");
  });
  it("rejects malformed prompt defs at registration", () => {
    const r = new PromptRegistry();
    expect(() => r.register(makePrompt({ id: "x", version: "", description: "", template: 5 as unknown as string }))).toThrow();
  });
});

describe("WebhookBus (spec #80)", () => {
  it("emits only to subscribers of the matching event", async () => {
    const bus = new WebhookBus();
    const received: string[] = [];
    // Intercept fetch via global override for the test.
    const orig = globalThis.fetch;
    globalThis.fetch = (async (url: string | URL | Request) => {
      received.push(String(url));
      return new Response("ok", { status: 200 });
    }) as typeof fetch;
    bus.subscribe("http://hook-a", ["workflow.completed"], "secret");
    bus.subscribe("http://hook-b", ["provider.failed"]);
    await bus.emit("workflow.completed", "calliq", { x: 1 }, "run_1");
    globalThis.fetch = orig;
    expect(received).toEqual(["http://hook-a"]);
  });
  it("signs payloads with HMAC and verifies", async () => {
    const body = '{"a":1}';
    const sig = `sha256=${createHmac("sha256", "secret").update(body).digest("hex")}`;
    expect(WebhookBus.verify("secret", body, sig)).toBe(true);
  });
});

describe("FeatureFlags (spec #82)", () => {
  it("defaults then env overrides", () => {
    const f = new FeatureFlags({ FLAG_BETA_UI: "true" });
    expect(f.isOn("beta_ui")).toBe(true);
    expect(f.isOn("automatic_routing")).toBe(true); // default
    f.set("experimental_providers", true);
    expect(f.isOn("experimental_providers")).toBe(true);
  });
});

describe("Reproducibility (spec #84, #85)", () => {
  it("captures provenance on the run record", async () => {
    const platform = createPlatform({ includeMock: true });
    const def = {
      id: "repro_test",
      product: "test",
      version: "repro_test.v1",
      tasks: [{ id: "t", run: async () => ({ ok: true, usage: { inputTokens: 1, outputTokens: 1, audioSeconds: 0, costUsd: 0, providerCalls: 1, cacheHits: 0 } }) }],
      provenance: {
        provider: "mock", model: "mock-flash", promptVersion: "sales.v2", workflowVersion: "repro_test.v1",
        configurationHash: "abc", inputHash: "def", settings: { temperature: 0.2 }, tools: ["t"],
      },
    };
    const out = await platform.engine.execute(def);
    const run = platform.tracer.getRun(out.runId);
    expect(run?.provenance?.workflowVersion).toBe("repro_test.v1");
    expect(run?.provenance?.promptVersion).toBe("sales.v2");
  });
});
