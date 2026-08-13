import type { FastifyInstance } from "fastify";
import type { AppServices } from "../services.js";
import { Capability, mintPyAISandboxKey, PyAIProvider, PYAI_DEFAULT_BASE_URL } from "@pyai/core";

/** Providers + models + health + routing — the registry surface (spec #6, #67, #68). */
export async function providersRoutes(app: FastifyInstance, svc: AppServices): Promise<void> {
  app.get("/api/providers", async () => {
    const providers = svc.platform.registry.list().map((p: { id: string; name: string; capabilities: readonly string[]; isConfigured(): boolean }) => ({
      id: p.id,
      name: p.name,
      capabilities: p.capabilities,
      configured: p.isConfigured(),
    }));
    return { providers };
  });

  app.get("/api/providers/models", async () => {
    const models = await svc.platform.registry.allModels();
    return { models };
  });

  app.get("/api/providers/health", async () => {
    const ids = svc.platform.registry.list().map((p: { id: string }) => p.id);
    const health = await Promise.all(ids.map(async (id) => ({ id, ...(await svc.platform.registry.health(id)) })));
    return { health };
  });

  app.get("/api/capabilities", async () => {
    return { capabilities: Object.values(Capability) };
  });

  /**
   * Mint a PyAI sandbox key server-side and hot-register the adapter.
   * The raw key NEVER leaves the API process (no secrets to frontend).
   * Docs: https://docs.pyai.com/quickstart
   */
  app.post("/api/providers/pyai/sandbox", async (_req, reply) => {
    const existing = svc.platform.registry.get("pyai");
    if (existing?.isConfigured()) {
      return {
        status: "already_configured",
        docs: "https://docs.pyai.com/quickstart",
        keyPrefix: "pyai_…",
      };
    }
    try {
      const { apiKey, keyPrefix } = await mintPyAISandboxKey(process.env.PYAI_BASE_URL ?? PYAI_DEFAULT_BASE_URL);
      const adapter = new PyAIProvider({
        apiKey,
        baseUrl: process.env.PYAI_BASE_URL ?? PYAI_DEFAULT_BASE_URL,
      });
      svc.platform.registry.register(adapter);
      for (const cap of ["streaming_stt", "batch_stt", "speaker_diarization", "tts", "streaming_tts", "realtime_voice"] as Capability[]) {
        svc.platform.registry.setDefault(cap, "pyai");
      }
      process.env.PYAI_API_KEY = apiKey;
      return {
        status: "connected",
        keyPrefix,
        docs: "https://docs.pyai.com/quickstart",
        note: "Sandbox key held in API memory for this process. Persist with: ai-suite setup --sandbox",
      };
    } catch (e: unknown) {
      return reply.code(502).send({
        error: "sandbox_mint_failed",
        reason: String(e),
        docs: "https://docs.pyai.com/quickstart",
      });
    }
  });

  app.post<{ Body: { capability: string; policy?: string; prefer?: string } }>(
    "/api/route",
    async (req) => {
      const decision = await svc.platform.registry.route(
        req.body.capability as Capability,
        (req.body.policy as never) ?? "fallback",
        req.body.prefer,
      );
      return decision;
    },
  );
}
