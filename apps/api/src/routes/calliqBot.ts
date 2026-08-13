import type { FastifyInstance } from "fastify";
import {
  botProviderStatus,
  getMeetingBot,
  joinMeetingBot,
  leaveMeetingBot,
} from "../meetingBot/index.js";

/** CallIQ meeting-bot join (Recall production, Attendee demo/fallback). */
export async function calliqBotRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/calliq/bot/providers", async () => botProviderStatus());

  app.post<{
    Body: {
      meetingUrl?: string;
      botName?: string;
      prefer?: "auto" | "recall" | "attendee" | "simulated";
      demo?: boolean;
    };
  }>("/api/calliq/bot/join", async (req, reply) => {
    try {
      const session = await joinMeetingBot({
        meetingUrl: req.body.meetingUrl ?? "",
        botName: req.body.botName,
        prefer: req.body.prefer ?? "auto",
        demo: Boolean(req.body.demo),
      });
      return {
        id: session.id,
        provider: session.provider,
        status: session.status,
        meetingUrl: session.meetingUrl,
        botName: session.botName,
        detail: session.detail,
        externalId: session.externalId,
      };
    } catch (e) {
      return reply.code(400).send({ error: e instanceof Error ? e.message : String(e) });
    }
  });

  app.post<{ Params: { id: string } }>("/api/calliq/bot/:id/leave", async (req, reply) => {
    const session = await leaveMeetingBot(req.params.id);
    if (!session) return reply.code(404).send({ error: "bot session not found" });
    return {
      id: session.id,
      provider: session.provider,
      status: session.status,
      meetingUrl: session.meetingUrl,
      botName: session.botName,
      detail: session.detail,
      error: session.error,
      transcriptText: session.transcriptText,
      externalId: session.externalId,
      updatedAt: session.updatedAt,
    };
  });

  app.get<{ Params: { id: string } }>("/api/calliq/bot/:id", async (req, reply) => {
    const session = await getMeetingBot(req.params.id);
    if (!session) return reply.code(404).send({ error: "bot session not found" });
    return {
      id: session.id,
      provider: session.provider,
      status: session.status,
      meetingUrl: session.meetingUrl,
      botName: session.botName,
      detail: session.detail,
      error: session.error,
      transcriptText: session.transcriptText,
      externalId: session.externalId,
      updatedAt: session.updatedAt,
    };
  });
}
