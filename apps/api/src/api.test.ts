import { describe, it, expect, beforeAll } from "vitest";
import { buildServer } from "./index.js";

let base: string;
let server: { app: import("fastify").FastifyInstance; svc: unknown };

describe("API integration", () => {
  beforeAll(async () => {
    server = await buildServer();
    await server.app.listen({ port: 0, host: "127.0.0.1" });
    base = `http://127.0.0.1:${(server.app.server.address() as { port: number }).port}`;
  });

  it("health + providers list includes mock", async () => {
    const h = await fetch(`${base}/health`);
    expect(h.status).toBe(200);
    const body = await h.json() as { providers: string[] };
    expect(body.providers).toContain("mock");
  });

  it("lists providers and capabilities", async () => {
    const r = await fetch(`${base}/api/providers`);
    const body = await r.json() as { providers: Array<{ id: string; configured: boolean }> };
    expect(body.providers.find((p) => p.id === "mock")?.configured).toBe(true);
    const c = await fetch(`${base}/api/capabilities`);
    expect((await c.json()).capabilities.length).toBeGreaterThan(5);
  });

  it("runs the universal playground LLM against mock", async () => {
    const r = await fetch(`${base}/api/playground/run`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ capability: "llm", provider: "mock", input: "Say hi" }),
    });
    const body = await r.json() as { provider: string; output: string; latencyMs: number };
    expect(body.provider).toBe("mock");
    expect(body.latencyMs).toBeGreaterThanOrEqual(0);
    expect(typeof body.output).toBe("string");
  });

  it("analyzes a sample sales call end-to-end (CallIQ)", async () => {
    const sample = await (await fetch(`${base}/api/sample/calliq`)).json() as { transcriptText: string };
    const r = await fetch(`${base}/api/calliq/analyze`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ transcriptText: sample.transcriptText }),
    });
    const body = await r.json() as { status: string; analysis: { objections: Array<{ evidence: { source: string } }>; dealHealthScore: number } };
    expect(body.status).toBe("SUCCEEDED");
    expect(body.analysis.objections.length).toBeGreaterThan(0);
    expect(body.analysis.objections[0]!.evidence.source).toBeTruthy();
    expect(body.analysis.dealHealthScore).toBeGreaterThan(0);
  });

  it("records the run in the explorer", async () => {
    const r = await fetch(`${base}/api/runs`);
    const body = await r.json() as {
      runs: Array<{ runId: string; product: string }>;
      storeBackend: string;
    };
    expect(body.runs.some((x) => x.product === "calliq")).toBe(true);
    expect(["memory", "postgres"]).toContain(body.storeBackend);
  });

  it("enqueues and drains an in-memory job", async () => {
    const r = await fetch(`${base}/api/jobs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind: "scrib.dictate", payload: { rawText: "hey uh team" } }),
    });
    expect(r.status).toBe(200);
    const body = await r.json() as { backend: string; results?: Array<{ status: string }> };
    expect(body.backend).toBe("memory");
    expect(body.results?.[0]?.status).toBeTruthy();
  });

  it("exposes the canonical /v1/calls/analyze and OpenAPI", async () => {
    const sample = await (await fetch(`${base}/api/sample/calliq`)).json() as { transcriptText: string };
    const r = await fetch(`${base}/v1/calls/analyze`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ transcriptText: sample.transcriptText }),
    });
    const body = await r.json() as { status: string; analysis: { dealHealthScore: number } };
    expect(body.status).toBe("SUCCEEDED");
    expect(body.analysis.dealHealthScore).toBeGreaterThan(0);

    const oa = await (await fetch(`${base}/openapi.json`)).json() as { openapi: string; paths: Record<string, unknown> };
    expect(oa.openapi).toBe("3.1.0");
    expect(oa.paths["/v1/calls/analyze"]).toBeTruthy();
  });
});
