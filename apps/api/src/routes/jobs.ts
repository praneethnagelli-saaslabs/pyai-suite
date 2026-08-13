import type { FastifyInstance } from "fastify";
import type { AppServices } from "../services.js";
import type { JobKind } from "@pyai/worker";

const KINDS: JobKind[] = [
  "calliq.analyze",
  "brief.analyze",
  "scrib.dictate",
  "simulator.run",
  "eval.run",
];

/** Async job enqueue / status (pairs with apps/worker). */
export async function jobsRoutes(app: FastifyInstance, svc: AppServices): Promise<void> {
  app.get("/api/jobs", async () => ({
    backend: svc.jobs.backend,
    results: svc.jobs.listResults?.() ?? [],
  }));

  app.post<{ Body: { kind: string; payload?: Record<string, unknown> } }>("/api/jobs", async (req, reply) => {
    const kind = req.body.kind as JobKind;
    if (!KINDS.includes(kind)) {
      return reply.code(400).send({ error: `invalid kind; allowed: ${KINDS.join(", ")}` });
    }
    const payload = req.body.payload ?? {};
    // Basic size guard — no huge blobs on the queue.
    if (JSON.stringify(payload).length > 200_000) {
      return reply.code(413).send({ error: "payload too large" });
    }
    const job = await svc.jobs.enqueue(kind, payload);
    // Memory backend: process immediately so demos without Redis still finish.
    if (svc.jobs.backend === "memory") {
      const results = await svc.jobs.drain?.(svc.platform);
      return { job, results: results ?? [], backend: svc.jobs.backend };
    }
    return { job, backend: svc.jobs.backend, queued: true };
  });
}
