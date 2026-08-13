import type { FastifyInstance } from "fastify";
import type { AppServices } from "../services.js";

function clipId(value: unknown): string {
  return String(value ?? "").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 64);
}

/** Agent + scenario catalog. No secrets, no raw prompts in logs. */
export async function simulatorCatalogRoutes(app: FastifyInstance, svc: AppServices): Promise<void> {
  app.get("/api/simulator/agents", async () => ({ agents: svc.simulator.listAgents() }));

  app.post<{ Body: Record<string, unknown> }>("/api/simulator/agents", async (req, reply) => {
    try {
      return { agent: svc.simulator.createAgent(req.body ?? {}) };
    } catch (e) {
      return reply.code(400).send({ error: e instanceof Error ? e.message : "Could not create agent." });
    }
  });

  app.get<{ Params: { id: string } }>("/api/simulator/agents/:id", async (req, reply) => {
    const agent = svc.simulator.getAgent(clipId(req.params.id));
    if (!agent) return reply.code(404).send({ error: "Agent not found." });
    return { agent };
  });

  app.patch<{ Params: { id: string }; Body: Record<string, unknown> }>(
    "/api/simulator/agents/:id",
    async (req, reply) => {
      try {
        return { agent: svc.simulator.updateAgent(clipId(req.params.id), req.body ?? {}) };
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Could not update agent.";
        return reply.code(msg.includes("not found") ? 404 : 400).send({ error: msg });
      }
    },
  );

  app.post<{ Params: { id: string }; Body: { version?: number } }>(
    "/api/simulator/agents/:id/activate",
    async (req, reply) => {
      const version = Number(req.body?.version);
      if (!Number.isInteger(version) || version < 1) {
        return reply.code(400).send({ error: "version is required." });
      }
      try {
        return { agent: svc.simulator.activateVersion(clipId(req.params.id), version) };
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Could not activate version.";
        return reply.code(msg.includes("not found") ? 404 : 400).send({ error: msg });
      }
    },
  );

  app.get("/api/simulator/scenarios", async () => ({ scenarios: svc.simulator.listScenarios() }));

  app.post<{ Body: Record<string, unknown> }>("/api/simulator/scenarios", async (req, reply) => {
    try {
      return { scenario: svc.simulator.createScenario(req.body ?? {}) };
    } catch (e) {
      return reply.code(400).send({ error: e instanceof Error ? e.message : "Could not create scenario." });
    }
  });

  app.patch<{ Params: { id: string }; Body: Record<string, unknown> }>(
    "/api/simulator/scenarios/:id",
    async (req, reply) => {
      try {
        return { scenario: svc.simulator.updateScenario(clipId(req.params.id), req.body ?? {}) };
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Could not update scenario.";
        return reply.code(msg.includes("not found") ? 404 : 400).send({ error: msg });
      }
    },
  );
}
