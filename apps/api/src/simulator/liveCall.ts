import {
  Capability,
  classifyRealtimeFailure,
  type Platform,
  type RealtimeEvent,
  type RealtimeFallbackReason,
  type RealtimeSessionHandle,
} from "@pyai/core";
import { sanitizeAgentConfig, type AgentConfig } from "@pyai/simulator";

export interface LiveCallAttempt {
  provider: string;
  ok: boolean;
  reason?: RealtimeFallbackReason;
  detail?: string;
}

export interface LiveCallSession {
  sessionId: string;
  agent: AgentConfig;
  handle: RealtimeSessionHandle;
  provider: string;
  fallbackUsed: boolean;
  fallbackReason?: RealtimeFallbackReason;
  fallbackProvider?: string;
  attempts: LiveCallAttempt[];
  startedAt: number;
  events: Array<{ t: number; type: string; provider?: string; speaker?: string }>;
}

const ORDER = ["pyai", "openai", "mock"] as const;

export function listRealtimeProviders(platform: Platform): Array<{
  id: string;
  name: string;
  configured: boolean;
  role: "primary" | "fallback" | "demo";
}> {
  return ORDER.map((id) => {
    const adapter = platform.registry.list().find((a) => a.id === id);
    const configured = Boolean(adapter?.isConfigured() && adapter.asRealtime);
    return {
      id,
      name: adapter?.name ?? id,
      configured: id === "mock" ? true : configured,
      role: id === "pyai" ? "primary" : id === "openai" ? "fallback" : "demo",
    };
  });
}

export async function openLiveCall(
  platform: Platform,
  rawAgent: unknown,
  opts?: { forceProvider?: string },
): Promise<LiveCallSession> {
  const agent = sanitizeAgentConfig(rawAgent);
  const sessionId = `sim_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const attempts: LiveCallAttempt[] = [];
  const force = opts?.forceProvider?.replace(/[^a-z0-9]/g, "");
  const order = force ? [force, ...ORDER.filter((id) => id !== force)] : [...ORDER];

  let lastError: string | undefined;
  for (const id of order) {
    const adapter = platform.registry.getAdapterFor(Capability.REALTIME_VOICE, id);
    if (!adapter?.asRealtime || !adapter.isConfigured()) {
      attempts.push({ provider: id, ok: false, reason: "UNAVAILABLE", detail: "not configured" });
      continue;
    }
    try {
      const handle = await withTimeout(
        adapter.asRealtime().startSession({
          systemPrompt: agent.prompt,
          voice: agent.voice,
          greeting: agent.greeting,
          sessionLabel: sessionId,
        }),
        8_000,
        `${id} realtime: timeout`,
      );
      const fallbackUsed = attempts.some((a) => !a.ok);
      const failed = attempts.filter((a) => !a.ok);
      attempts.push({ provider: id, ok: true });
      return {
        sessionId,
        agent,
        handle,
        provider: id,
        fallbackUsed,
        fallbackReason: fallbackUsed ? failed[0]?.reason : undefined,
        fallbackProvider: fallbackUsed ? id : undefined,
        attempts,
        startedAt: Date.now(),
        events: [{ t: 0, type: "SESSION_STARTED", provider: id }],
      };
    } catch (err) {
      const classified = classifyRealtimeFailure(err);
      lastError = classified.message;
      attempts.push({ provider: id, ok: false, reason: classified.reason, detail: classified.message });
    }
  }

  throw new Error(friendlyStartError(lastError, attempts));
}

export function recordCallEvent(session: LiveCallSession, ev: RealtimeEvent): void {
  if (session.events.length > 400) session.events.shift();
  session.events.push({
    t: Date.now() - session.startedAt,
    type: ev.type,
    provider: session.provider,
    speaker: ev.speaker,
  });
}

export function friendlyProviderError(reason?: RealtimeFallbackReason): string {
  switch (reason) {
    case "TIMEOUT":
      return "The primary voice provider timed out.";
    case "RATE_LIMIT":
      return "The primary voice provider is rate limited.";
    case "UNAVAILABLE":
      return "The primary voice provider is unavailable.";
    case "CONNECTION":
      return "We couldn't connect to the primary voice provider.";
    case "MALFORMED":
      return "The primary voice provider returned a bad response.";
    case "STREAM":
      return "The live audio stream failed.";
    default:
      return "The primary voice provider hit an error.";
  }
}

function friendlyStartError(last: string | undefined, attempts: LiveCallAttempt[]): string {
  const liveFailed = attempts.filter((a) => a.provider !== "mock" && !a.ok);
  if (liveFailed.length && attempts.every((a) => !a.ok)) {
    return "We couldn't start a live voice session. Check provider keys, or run Demo Mode (mock).";
  }
  return last ? `Could not start a voice session.` : "No realtime provider available.";
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(label)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}
