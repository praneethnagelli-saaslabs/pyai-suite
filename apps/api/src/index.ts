import Fastify from "fastify";
import cors from "@fastify/cors";
import websocket from "@fastify/websocket";
import { createServices } from "./services.js";
import { providersRoutes } from "./routes/providers.js";
import { runsRoutes } from "./routes/runs.js";
import { playgroundRoutes } from "./routes/playground.js";
import { v1Routes } from "./routes/v1.js";
import { productsRoutes } from "./routes/products.js";
import { jobsRoutes } from "./routes/jobs.js";
import { realtimeRoutes } from "./routes/realtime.js";
import { sttRoutes } from "./routes/stt.js";
import { calliqBotRoutes } from "./routes/calliqBot.js";
import { googleMeetRoutes } from "./routes/googleMeet.js";
import { Capability } from "@pyai/core";
import { pickProvider } from "./providerPick.js";
import { setMeetingBotHear } from "./meetingBot/index.js";

export async function buildServer() {
  const svc = await createServices();
  setMeetingBotHear(async (audio, format) => {
    const id = pickProvider(svc.platform, Capability.BATCH_STT);
    if (id === "mock") return undefined;
    const adapter = svc.platform.registry.getAdapterFor(Capability.BATCH_STT, id);
    const stt = adapter?.asSTT?.();
    if (!stt) return undefined;
    const res = await stt.transcribe({ audio, format, diarize: true });
    const lines = (res.segments ?? [])
      .map((s) => {
        const text = s.text?.trim();
        if (!text) return "";
        return `${s.speaker?.trim() || "Speaker"}: ${text}`;
      })
      .filter(Boolean);
    return (lines.length ? lines.join("\n") : res.text?.trim()) || undefined;
  });
  const app = Fastify({ logger: false, bodyLimit: 25 * 1024 * 1024 });

  await app.register(cors, { origin: true, credentials: true });
  await app.register(websocket);
  await app.register(async (a) => providersRoutes(a, svc));
  await app.register(async (a) => runsRoutes(a, svc));
  await app.register(async (a) => playgroundRoutes(a, svc));
  await app.register(async (a) => v1Routes(a, svc));
  await app.register(async (a) => productsRoutes(a, svc));
  await app.register(async (a) => jobsRoutes(a, svc));
  await app.register(async (a) => realtimeRoutes(a, svc));
  await app.register(async (a) => sttRoutes(a, svc));
  await app.register(async (a) => calliqBotRoutes(a));
  await app.register(async (a) => googleMeetRoutes(a));

  app.get("/health", async () => ({
    status: "ok",
    providers: svc.platform.registry.list().map((p: { id: string }) => p.id),
    store: svc.runStore.backend,
    jobs: svc.jobs.backend,
    meetingBots: (await import("./meetingBot/index.js")).botProviderStatus(),
  }));

  app.get("/api/config", async () => ({
    providers: svc.platform.registry.list().map((p: { id: string; isConfigured(): boolean }) => ({
      id: p.id,
      configured: p.isConfigured(),
    })),
    defaultProvider: "pyai",
    store: svc.runStore.backend,
    jobs: svc.jobs.backend,
  }));

  return { app, svc };
}

export async function startServer() {
  const { app } = await buildServer();
  const port = Number(process.env.API_PORT ?? 4000);
  const host = process.env.API_HOST ?? "0.0.0.0";
  await app.listen({ port, host });
  // eslint-disable-next-line no-console
  console.log(`PyAI Suite API listening on http://${host}:${port}`);
}

const isMain = process.argv[1]?.endsWith("index.ts") || process.argv[1]?.endsWith("src/index.ts");
if (isMain) {
  startServer().catch((e) => {
    // eslint-disable-next-line no-console
    console.error(e);
    process.exit(1);
  });
}
