import type { FastifyInstance } from "fastify";
import {
  botProviderStatus,
  getMeetingBot,
  joinMeetingBot,
  leaveMeetingBot,
  MeetingBotInUseError,
  meetingBotOwnerFromCookie,
  meetingBotOwnerSetCookie,
} from "../meetingBot/index.js";

function joinFailed(reply: { code: (n: number) => { send: (b: unknown) => unknown } }, e: unknown) {
  const msg = e instanceof Error ? e.message : String(e);
  if (e instanceof MeetingBotInUseError) return reply.code(409).send({ error: msg });
  return reply.code(400).send({ error: msg });
}

/** CallIQ meeting-bot join (one bot + one transcript owner per Meet). */
export async function calliqBotRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/calliq/bot/providers", async () => botProviderStatus());

  app.get("/api/calliq/bot/current", async (req, reply) => {
    const ownerId = meetingBotOwnerFromCookie(req.headers.cookie);
    if (!ownerId) return reply.code(204).send();
    const session = await getMeetingBot(ownerId);
    if (!session) return reply.code(204).send();
    return {
      id: session.id,
      provider: session.provider,
      status: session.status,
      meetingUrl: session.meetingUrl,
      botName: session.botName,
      detail: session.detail,
      error: session.error,
      transcriptText: session.transcriptText,
      updatedAt: session.updatedAt,
    };
  });

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
        ownerSessionId: meetingBotOwnerFromCookie(req.headers.cookie),
      });
      void reply.header("Set-Cookie", meetingBotOwnerSetCookie(session.id));
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
      return joinFailed(reply, e);
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
