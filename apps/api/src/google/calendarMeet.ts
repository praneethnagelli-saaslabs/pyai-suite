/**
 * Google OAuth + Calendar API — create an instant Google Meet (no extension).
 * Uses REST only; client secret stays server-side.
 */

import {
  getGoogleTokens,
  putGoogleTokens,
  type GoogleTokenSet,
} from "./oauthStore.js";

const AUTH = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN = "https://oauth2.googleapis.com/token";
const USERINFO = "https://www.googleapis.com/oauth2/v2/userinfo";
const CAL_EVENTS = "https://www.googleapis.com/calendar/v3/calendars/primary/events";

const SCOPES = [
  "openid",
  "email",
  "https://www.googleapis.com/auth/calendar.events",
].join(" ");

export function googleOAuthConfigured(): boolean {
  return Boolean(
    process.env.GOOGLE_OAUTH_CLIENT_ID?.trim() &&
      process.env.GOOGLE_OAUTH_CLIENT_SECRET?.trim() &&
      process.env.GOOGLE_OAUTH_REDIRECT_URI?.trim(),
  );
}

export function googleOAuthConfig() {
  return {
    clientId: process.env.GOOGLE_OAUTH_CLIENT_ID?.trim() ?? "",
    clientSecret: process.env.GOOGLE_OAUTH_CLIENT_SECRET?.trim() ?? "",
    redirectUri: process.env.GOOGLE_OAUTH_REDIRECT_URI?.trim() ?? "",
    webOrigin: (process.env.WEB_ORIGIN ?? "http://localhost:3000").replace(/\/$/, ""),
  };
}

export function buildGoogleAuthUrl(state: string): string {
  const { clientId, redirectUri } = googleOAuthConfig();
  const u = new URL(AUTH);
  u.searchParams.set("client_id", clientId);
  u.searchParams.set("redirect_uri", redirectUri);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("scope", SCOPES);
  u.searchParams.set("access_type", "offline");
  u.searchParams.set("prompt", "consent");
  u.searchParams.set("include_granted_scopes", "true");
  u.searchParams.set("state", state);
  return u.toString();
}

export async function exchangeCodeForTokens(code: string): Promise<GoogleTokenSet> {
  const { clientId, clientSecret, redirectUri } = googleOAuthConfig();
  const body = new URLSearchParams({
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri,
    grant_type: "authorization_code",
  });
  const res = await fetch(TOKEN, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const json = (await res.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    scope?: string;
    error?: string;
    error_description?: string;
  };
  if (!res.ok || !json.access_token) {
    throw new Error(json.error_description || json.error || `token exchange failed (${res.status})`);
  }
  const tokens: GoogleTokenSet = {
    accessToken: json.access_token,
    refreshToken: json.refresh_token,
    expiryMs: Date.now() + Math.max(30, (json.expires_in ?? 3600) - 60) * 1000,
    scope: json.scope,
  };
  try {
    const me = await fetch(USERINFO, {
      headers: { Authorization: `Bearer ${tokens.accessToken}` },
    });
    if (me.ok) {
      const info = (await me.json()) as { email?: string };
      tokens.email = info.email;
    }
  } catch {
    /* email optional */
  }
  return tokens;
}

async function refreshAccessToken(sessionId: string, tokens: GoogleTokenSet): Promise<GoogleTokenSet> {
  if (!tokens.refreshToken) throw new Error("Google session expired — reconnect Google");
  const { clientId, clientSecret } = googleOAuthConfig();
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: tokens.refreshToken,
    grant_type: "refresh_token",
  });
  const res = await fetch(TOKEN, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const json = (await res.json()) as {
    access_token?: string;
    expires_in?: number;
    error?: string;
    error_description?: string;
  };
  if (!res.ok || !json.access_token) {
    throw new Error(json.error_description || json.error || "Google token refresh failed");
  }
  const next: GoogleTokenSet = {
    ...tokens,
    accessToken: json.access_token,
    expiryMs: Date.now() + Math.max(30, (json.expires_in ?? 3600) - 60) * 1000,
  };
  putGoogleTokens(sessionId, next);
  return next;
}

export async function getValidAccessToken(sessionId: string): Promise<{ token: string; email?: string }> {
  let tokens = getGoogleTokens(sessionId);
  if (!tokens) throw new Error("Connect Google first");
  if (Date.now() >= tokens.expiryMs) {
    tokens = await refreshAccessToken(sessionId, tokens);
  }
  return { token: tokens.accessToken, email: tokens.email };
}

function extractMeetUrl(event: Record<string, unknown>): string | null {
  const hangout = typeof event.hangoutLink === "string" ? event.hangoutLink : null;
  if (hangout && /meet\.google\.com\//i.test(hangout)) return hangout;

  const conf = event.conferenceData as
    | {
        entryPoints?: Array<{ entryPointType?: string; uri?: string }>;
      }
    | undefined;
  const video = conf?.entryPoints?.find((e) => e.entryPointType === "video" && e.uri);
  if (video?.uri && /meet\.google\.com\//i.test(video.uri)) return video.uri;
  return hangout;
}

export async function createInstantGoogleMeet(sessionId: string): Promise<{
  meetingUrl: string;
  eventId: string;
  htmlLink?: string;
}> {
  const { token } = await getValidAccessToken(sessionId);
  const start = new Date();
  const end = new Date(start.getTime() + 60 * 60 * 1000);
  const requestId = `calliq-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

  const res = await fetch(`${CAL_EVENTS}?conferenceDataVersion=1&supportsAttachments=false`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      summary: "CallIQ call",
      description: "Created by CallIQ — CallIQ Bot joins this Meet automatically.",
      start: { dateTime: start.toISOString() },
      end: { dateTime: end.toISOString() },
      conferenceData: {
        createRequest: {
          requestId,
          conferenceSolutionKey: { type: "hangoutsMeet" },
        },
      },
    }),
  });

  const json = (await res.json()) as Record<string, unknown> & {
    error?: { message?: string };
    id?: string;
    htmlLink?: string;
  };
  if (!res.ok) {
    throw new Error(json.error?.message || `Calendar API failed (${res.status})`);
  }

  const meetingUrl = extractMeetUrl(json);
  if (!meetingUrl) {
    throw new Error("Google did not return a Meet link. Ensure Meet is enabled on this Google account.");
  }
  return {
    meetingUrl,
    eventId: String(json.id ?? ""),
    htmlLink: typeof json.htmlLink === "string" ? json.htmlLink : undefined,
  };
}
