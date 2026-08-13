import { describe, it, expect } from "vitest";
import { IntegrationRegistry } from "./integration.js";
import { WebhookIntegration, SlackIntegration, NotionIntegration } from "./adapters.js";

describe("IntegrationRegistry", () => {
  it("lists adapters and refuses unknown sends", async () => {
    const reg = new IntegrationRegistry();
    reg.register(new WebhookIntegration("http://example.com/hook"));
    expect(reg.list().map((x) => x.id)).toContain("webhook");
    const r = await reg.send("does-not-exist", { title: "t", body: "b" });
    expect(r.ok).toBe(false);
  });

  it("webhook integration posts and reports status", async () => {
    const orig = globalThis.fetch;
    let captured: { url: string; body: string } | null = null;
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      captured = { url: String(url), body: String(init?.body) };
      return new Response("ok", { status: 200 });
    }) as typeof fetch;
    const reg = new IntegrationRegistry();
    reg.register(new WebhookIntegration("http://example.com/hook", "secret"));
    const r = await reg.send("webhook", { title: "Deal notes", body: "Acme — pricing objection", url: "http://localhost:3000/share/abc" });
    globalThis.fetch = orig;
    expect(r.ok).toBe(true);
    expect(captured?.url).toBe("http://example.com/hook");
    expect(captured?.body).toContain("Acme");
  });

  it("slack/notion are unconfigured without env and report gracefully", async () => {
    const reg = new IntegrationRegistry();
    reg.register(new SlackIntegration());
    reg.register(new NotionIntegration());
    const s = await reg.send("slack", { title: "t", body: "b" });
    const n = await reg.send("notion", { title: "t", body: "b" });
    expect(s.ok).toBe(false);
    expect(n.ok).toBe(false);
  });
});
