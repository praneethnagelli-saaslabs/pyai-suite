import type { FastifyInstance } from "fastify";
import type { AppServices } from "../services.js";
import { Capability } from "@pyai/core";
import { openApiJson } from "../openapi.js";

/**
 * Canonical /v1 API surface (spec #77). These map onto the same platform
 * services the rest of the app uses — there is no second implementation.
 * OpenAPI is served at /openapi.json (see openapi.yaml).
 */
export async function v1Routes(app: FastifyInstance, svc: AppServices): Promise<void> {
  app.get("/v1/providers", async () =>
    svc.platform.registry.list().map((p) => ({ id: p.id, name: p.name, capabilities: p.capabilities, configured: p.isConfigured() })),
  );

  app.get("/v1/models", async () => svc.platform.registry.allModels());

  app.get("/v1/capabilities", async () => Object.values(Capability));

  app.post<{ Body: { capability: string; provider?: string; input: string; model?: string } }>(
    "/v1/playground/runs",
    async (req, reply) => {
      const { capability, provider, input, model } = req.body;
      const adapter = svc.platform.registry.getAdapterFor(capability as Capability, provider);
      if (!adapter) return reply.code(400).send({ error: "no_provider", reason: `capability ${capability}` });
      const stt = adapter.asSTT;
      const llm = adapter.asLLM;
      const tts = adapter.asTTS;
      const emb = adapter.asEmbeddings;
      const t0 = Date.now();
      const trace = svc.platform.tracer.startRun(`v1_${capability}`, "playground");
      try {
        let output = "";
        let usage = { inputTokens: 0, outputTokens: 0, audioSeconds: 0, costUsd: 0, providerCalls: 1, cacheHits: 0 };
        if (capability === "batch_stt" || capability === "streaming_stt") {
          if (!stt) return reply.code(400).send({ error: "no_stt", reason: adapter.id });
          const r = await stt().transcribe({ audio: new TextEncoder().encode(input), diarize: true });
          output = r.text; usage = r.usage;
        } else if (["llm", "structured_output", "reasoning_llm"].includes(capability)) {
          if (!llm) return reply.code(400).send({ error: "no_llm", reason: adapter.id });
          const r = await llm().complete({ model, messages: [{ role: "user", content: input }] });
          output = r.text; usage = r.usage;
        } else if (capability === "tts" || capability === "streaming_tts") {
          if (!tts) return reply.code(400).send({ error: "no_tts", reason: adapter.id });
          const r = await tts().synthesize({ text: input });
          output = `audio bytes: ${r.audio.length}`; usage = r.usage;
        } else if (capability === "embeddings") {
          if (!emb) return reply.code(400).send({ error: "no_embeddings", reason: adapter.id });
          const r = await emb().embed({ input });
          output = `dim=${r.embeddings[0]?.length ?? 0}`; usage = r.usage;
        } else {
          return reply.code(400).send({ error: "unsupported_capability", reason: capability });
        }
        svc.platform.tracer.completeRun(trace, "SUCCEEDED");
        return { provider: adapter.id, output, usage, latencyMs: Date.now() - t0, runId: trace };
      } catch (e: unknown) {
        svc.platform.tracer.completeRun(trace, "FAILED", String(e));
        return reply.code(502).send({ error: "provider_error", reason: String(e) });
      }
    },
  );

  app.post<{
    Body: {
      transcriptText?: string;
      audio?: string;
      sttProvider?: string;
      llmProvider?: string;
      verifyProvider?: string;
    };
  }>("/v1/calls/analyze", async (req, reply) => {
      const { buildCallIQWorkflow } = await import("@pyai/calliq");
      const rawAudio = req.body.audio?.trim();
      let audio: Uint8Array | undefined;
      if (rawAudio) {
        if (rawAudio.length > 20_000_000) {
          return reply.code(413).send({ error: "audio too large (max ~15MB)" });
        }
        try {
          audio = Uint8Array.from(Buffer.from(rawAudio, "base64"));
        } catch {
          return reply.code(400).send({ error: "invalid audio" });
        }
      }
      const { def, getArtifact } = buildCallIQWorkflow(svc.platform, {
        transcriptText: audio ? undefined : req.body.transcriptText,
        audio,
        sttProvider: req.body.sttProvider,
        llmProvider: req.body.llmProvider,
        verifyProvider: req.body.verifyProvider,
      });
      const out = await svc.platform.engine.execute(def);
      const art = getArtifact();
      return reply.code(out.status === "SUCCEEDED" || out.status === "PARTIAL" ? 200 : 422).send({
        status: out.status,
        runId: out.runId,
        usage: out.usage,
        gates: out.gates,
        transcript: art.transcript,
        recap: art.recap,
        analysis: art.analysis,
        verification: art.verification,
      });
    },
  );

  app.get<{ Params: { id: string } }>("/v1/runs/:id", async (req, reply) => {
    const run = svc.platform.tracer.getRun(req.params.id);
    if (!run) return reply.code(404).send({ error: "not_found" });
    return { run, calls: svc.platform.tracer.getRunCalls(req.params.id) };
  });

  app.get("/openapi.json", async () => openApiJson());
}
