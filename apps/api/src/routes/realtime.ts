import type { FastifyInstance } from "fastify";
import type { AppServices } from "../services.js";

type WsSocket = {
  readyState: number;
  send: (data: string) => void;
  on: (event: string, handler: (...args: unknown[]) => void) => void;
};

/**
 * Lightweight realtime channel for run explorer / Omni stubs.
 * Clients subscribe; API broadcasts run snapshots periodically and on demand.
 * Not a full PyAI Omni WebSocket — that lives behind the provider adapter.
 */
export async function realtimeRoutes(app: FastifyInstance, svc: AppServices): Promise<void> {
  app.get("/ws/runs", { websocket: true }, (socket: WsSocket) => {
    socket.send(JSON.stringify({ type: "hello", backend: svc.runStore.backend, ts: Date.now() }));

    const tick = setInterval(() => {
      if (socket.readyState !== 1) return;
      const runs = svc.platform.tracer.listRuns(20);
      socket.send(JSON.stringify({ type: "runs", runs, ts: Date.now() }));
    }, 5000);

    socket.on("message", (...args: unknown[]) => {
      const raw = args[0];
      try {
        const msg = JSON.parse(String(raw)) as { type?: string };
        if (msg.type === "ping") {
          socket.send(JSON.stringify({ type: "pong", ts: Date.now() }));
        }
        if (msg.type === "list") {
          const runs = svc.platform.tracer.listRuns(50);
          socket.send(JSON.stringify({ type: "runs", runs, ts: Date.now() }));
        }
      } catch {
        socket.send(JSON.stringify({ type: "error", error: "invalid_json" }));
      }
    });

    socket.on("close", () => {
      clearInterval(tick);
    });
  });

  app.get("/api/realtime/info", async () => ({
    websocket: "/ws/runs",
    note: "Subscribe for run explorer updates. Provider Omni realtime is separate (PyAI adapter).",
  }));
}
