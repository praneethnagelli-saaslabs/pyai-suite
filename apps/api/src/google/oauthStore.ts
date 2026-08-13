/**
 * Server-side Google OAuth token store.
 * Tokens never returned to the browser — only a session cookie id.
 */

import { createHash, randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";

export interface GoogleTokenSet {
  accessToken: string;
  refreshToken?: string;
  expiryMs: number;
  email?: string;
  scope?: string;
}

interface StoredFile {
  sessions: Record<string, GoogleTokenSet>;
}

const COOKIE = "pyai_google_sid";
const DATA_PATH = join(process.cwd(), ".data", "google-oauth.json");

const sessions = new Map<string, GoogleTokenSet>();

function load() {
  try {
    if (!existsSync(DATA_PATH)) return;
    const raw = JSON.parse(readFileSync(DATA_PATH, "utf8")) as StoredFile;
    for (const [id, tok] of Object.entries(raw.sessions ?? {})) {
      if (tok?.accessToken) sessions.set(id, tok);
    }
  } catch {
    /* ignore corrupt store */
  }
}

function save() {
  try {
    mkdirSync(dirname(DATA_PATH), { recursive: true });
    const out: StoredFile = { sessions: {} };
    for (const [id, tok] of sessions) out.sessions[id] = tok;
    writeFileSync(DATA_PATH, JSON.stringify(out, null, 2), { mode: 0o600 });
  } catch {
    /* best-effort persistence */
  }
}

load();

export function googleCookieName(): string {
  return COOKIE;
}

export function newSessionId(): string {
  return randomBytes(24).toString("hex");
}

export function putGoogleTokens(sessionId: string, tokens: GoogleTokenSet): void {
  sessions.set(sessionId, tokens);
  save();
}

export function getGoogleTokens(sessionId: string | undefined): GoogleTokenSet | null {
  if (!sessionId) return null;
  return sessions.get(sessionId) ?? null;
}

export function clearGoogleTokens(sessionId: string | undefined): void {
  if (!sessionId) return;
  sessions.delete(sessionId);
  save();
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  }
  return out;
}

export function sessionIdFromRequest(cookieHeader: string | undefined): string | undefined {
  return parseCookies(cookieHeader)[COOKIE];
}

export function oauthStateToken(): string {
  return randomBytes(16).toString("hex");
}

export function hashState(state: string): string {
  return createHash("sha256").update(state).digest("hex");
}

/** Short-lived OAuth CSRF states */
const oauthStates = new Map<string, number>();

export function rememberOAuthState(state: string): void {
  oauthStates.set(hashState(state), Date.now() + 10 * 60 * 1000);
}

export function consumeOAuthState(state: string | undefined): boolean {
  if (!state) return false;
  const key = hashState(state);
  const exp = oauthStates.get(key);
  oauthStates.delete(key);
  return Boolean(exp && exp > Date.now());
}
