import type { FastifyInstance } from "fastify";
import { joinMeetingBot } from "../meetingBot/index.js";
import {
  buildGoogleAuthUrl,
  createInstantGoogleMeet,
  exchangeCodeForTokens,
  googleOAuthConfig,
  googleOAuthConfigured,
  getValidAccessToken,
} from "../google/calendarMeet.js";
import {
  clearGoogleTokens,
  consumeOAuthState,
  getGoogleTokens,
  googleCookieName,
  newSessionId,
  oauthStateToken,
  putGoogleTokens,
  rememberOAuthState,
  sessionIdFromRequest,
} from "../google/oauthStore.js";

function setSessionCookie(reply: { header: (k: string, v: string) => unknown }, sessionId: string) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  reply.header(
    "Set-Cookie",
    `${googleCookieName()}=${encodeURIComponent(sessionId)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${60 * 60 * 24 * 30}${secure}`,
  );
}

function clearSessionCookie(reply: { header: (k: string, v: string) => unknown }) {
  reply.header("Set-Cookie", `${googleCookieName()}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}

export async function googleMeetRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/google/status", async (req) => {
    const configured = googleOAuthConfigured();
    const sid = sessionIdFromRequest(req.headers.cookie);
    const tokens = getGoogleTokens(sid);
    return {
      configured,
      connected: Boolean(tokens?.accessToken),
      email: tokens?.email ?? null,
      redirectUri: configured ? googleOAuthConfig().redirectUri : null,
    };
  });

  app.get("/api/google/oauth/start", async (req, reply) => {
    if (!googleOAuthConfigured()) {
      return reply.code(503).send({
        error:
          "Google OAuth not configured. Set GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET, GOOGLE_OAUTH_REDIRECT_URI in .env",
      });
    }
    const state = oauthStateToken();
    rememberOAuthState(state);
    return reply.redirect(buildGoogleAuthUrl(state));
  });

  app.get<{ Querystring: { code?: string; state?: string; error?: string } }>(
    "/api/google/oauth/callback",
    async (req, reply) => {
      const web = googleOAuthConfig().webOrigin;
      if (req.query.error) {
        return reply.redirect(`${web}/calliq?google=error`);
      }
      if (!consumeOAuthState(req.query.state)) {
        return reply.redirect(`${web}/calliq?google=state`);
      }
      if (!req.query.code) {
        return reply.redirect(`${web}/calliq?google=error`);
      }
      try {
        const tokens = await exchangeCodeForTokens(req.query.code);
        const existing = sessionIdFromRequest(req.headers.cookie);
        const sid = existing && getGoogleTokens(existing) ? existing : newSessionId();
        // Keep prior refresh token if Google omits a new one
        const prev = getGoogleTokens(sid);
        if (!tokens.refreshToken && prev?.refreshToken) {
          tokens.refreshToken = prev.refreshToken;
        }
        putGoogleTokens(sid, tokens);
        setSessionCookie(reply, sid);
        return reply.redirect(`${web}/calliq?google=connected`);
      } catch {
        return reply.redirect(`${web}/calliq?google=error`);
      }
    },
  );

  app.post("/api/google/disconnect", async (req, reply) => {
    const sid = sessionIdFromRequest(req.headers.cookie);
    clearGoogleTokens(sid);
    clearSessionCookie(reply);
    return { ok: true };
  });

  /** Create a Meet + send CallIQ Bot into the same room (no extension). */
  app.post("/api/calliq/start-call", async (req, reply) => {
    if (!googleOAuthConfigured()) {
      return reply.code(503).send({
        error: "Google OAuth not configured",
        hint: "Add GOOGLE_OAUTH_* to .env — see docs/google-meet.md",
      });
    }
    const sid = sessionIdFromRequest(req.headers.cookie);
    if (!sid || !getGoogleTokens(sid)) {
      return reply.code(401).send({
        error: "Connect Google first",
        authUrl: "/api/google/oauth/start",
      });
    }

    try {
      await getValidAccessToken(sid);
      const meet = await createInstantGoogleMeet(sid);
      const bot = await joinMeetingBot({
        meetingUrl: meet.meetingUrl,
        botName: "CallIQ Bot",
        prefer: "auto",
        demo: false,
      });
      return {
        meetingUrl: meet.meetingUrl,
        eventId: meet.eventId,
        htmlLink: meet.htmlLink,
        bot: {
          id: bot.id,
          provider: bot.provider,
          status: bot.status,
          meetingUrl: bot.meetingUrl,
          botName: bot.botName,
          detail: bot.detail,
          externalId: bot.externalId,
        },
      };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return reply.code(400).send({ error: msg });
    }
  });
}
