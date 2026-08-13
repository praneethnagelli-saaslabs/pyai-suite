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

  app.post<{ Body: Record<string, unknown> }>("/api/simulator/sims", async (req, reply) => {
    try {
      const sim = svc.simulator.recordSimulation(req.body ?? {});
      app.log.info(
        {
          simId: sim.id,
          agentId: sim.agentId,
          version: sim.version,
          passed: sim.evaluation.passed,
          score: sim.evaluation.scores.overall,
          provider: sim.provider,
          fallbackUsed: sim.fallbackUsed,
        },
        "simulator.eval.recorded",
      );
      return { simulation: sim };
    } catch (e) {
      return reply.code(400).send({ error: e instanceof Error ? e.message : "Could not record the simulation." });
    }
  });

  app.get("/api/simulator/sims", async () => ({ simulations: svc.simulator.listSimulations() }));

  app.get<{ Params: { id: string } }>("/api/simulator/sims/:id", async (req, reply) => {
    const sim = svc.simulator.getSimulation(clipId(req.params.id));
    if (!sim) return reply.code(404).send({ error: "Simulation not found." });
    return { simulation: sim };
  });

  app.get("/api/simulator/dashboard", async () => svc.simulator.dashboard());

  app.get<{ Querystring: { a?: string; b?: string } }>("/api/simulator/compare", async (req, reply) => {
    try {
      return svc.simulator.compareSimulations(clipId(req.query.a), clipId(req.query.b));
    } catch (e) {
      return reply.code(400).send({ error: e instanceof Error ? e.message : "Could not compare." });
    }
  });
}
