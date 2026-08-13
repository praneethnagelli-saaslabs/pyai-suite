import type { FastifyInstance } from "fastify";
import type { AppServices } from "../services.js";

/** Run explorer — every AI operation appears here (spec #56). */
export async function runsRoutes(app: FastifyInstance, svc: AppServices): Promise<void> {
  app.get("/api/runs", async (req) => {
    const limit = Number((req.query as { limit?: string }).limit ?? 50);
    const tracerRuns = svc.platform.tracer.listRuns(limit);
    for (const r of tracerRuns.slice(0, 20)) {
      await svc.runStore.upsert({
        runId: r.runId,
        product: r.product,
        status: r.status,
        startedAt: r.startedAt,
        finishedAt: r.completedAt,
        durationMs: r.durationMs,
        usage: r.usage as unknown as Record<string, unknown>,
      });
    }
    const stored = await svc.runStore.list(limit);
    return {
      runs: tracerRuns,
      stored,
      storeBackend: svc.runStore.backend,
    };
  });

  app.get<{ Params: { id: string } }>("/api/runs/:id", async (req, reply) => {
    const run = svc.platform.tracer.getRun(req.params.id);
    if (!run) {
      const stored = await svc.runStore.get(req.params.id);
      if (!stored) return reply.code(404).send({ error: "run not found" });
      return { run: stored, calls: [], from: "store" };
    }
    const calls = svc.platform.tracer.getRunCalls(req.params.id);
    return { run, calls, from: "tracer" };
  });
}
