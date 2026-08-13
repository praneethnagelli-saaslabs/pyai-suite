/**
 * Meeting-bot adapters for CallIQ.
 * - Attendee: primary (ATTENDEE_BASE_URL + ATTENDEE_API_KEY)
 * - Simulated: demo fallback when Attendee is unreachable
 * - Recall: optional only when prefer: "recall" (not used in auto)
 */

export type BotProviderId = "recall" | "attendee" | "simulated";

export type BotSessionStatus =
  | "joining"
  | "in_call"
  | "done"
  | "failed"
  | "waiting_transcript";

export type BotSession = {
  id: string;
  provider: BotProviderId;
  externalId?: string;
  meetingUrl: string;
  botName: string;
  status: BotSessionStatus;
  transcriptText?: string;
  error?: string;
  createdAt: number;
  updatedAt: number;
  detail?: string;
};

export type JoinBotInput = {
  meetingUrl: string;
  botName?: string;
  /** auto = attendee if configured, else simulated */
  prefer?: "auto" | "recall" | "attendee" | "simulated";
  /** Demo path (same providers; allows empty meetingUrl for simulated) */
  demo?: boolean;
};

function env(name: string): string | undefined {
  const v = process.env[name]?.trim();
  return v || undefined;
}

export function recallConfigured(): boolean {
  return Boolean(env("RECALL_API_KEY"));
}

export function attendeeConfigured(): boolean {
  return Boolean(env("ATTENDEE_API_KEY") && env("ATTENDEE_BASE_URL"));
}

export function botProviderStatus() {
  return {
    attendee: {
      configured: attendeeConfigured(),
      baseUrl: env("ATTENDEE_BASE_URL") ?? null,
      role: "primary" as const,
    },
    recall: {
      configured: recallConfigured(),
      region: env("RECALL_REGION") ?? "us-west-2",
      role: "optional" as const,
    },
    simulated: {
      configured: true,
      role: "product_demo" as const,
    },
  };
}

function pickProvider(prefer: JoinBotInput["prefer"], demo?: boolean): BotProviderId {
  if (prefer === "recall" || prefer === "attendee" || prefer === "simulated") return prefer;
  // Primary: Attendee (self-host or cloud). Simulated when Attendee isn't configured.
  // Recall is opt-in via prefer: "recall" only (not used in auto for now).
  void demo;
  if (attendeeConfigured()) return "attendee";
  return "simulated";
}

function recallBase(): string {
  const region = env("RECALL_REGION") ?? "us-west-2";
  return env("RECALL_BASE_URL") ?? `https://${region}.recall.ai`;
}

function attendeeBase(): string {
  return (env("ATTENDEE_BASE_URL") ?? "http://localhost:8000").replace(/\/$/, "");
}

async function recallCreate(meetingUrl: string, botName: string): Promise<{ id: string; raw: unknown }> {
  const key = env("RECALL_API_KEY");
  if (!key) throw new Error("RECALL_API_KEY not set");
  const r = await fetch(`${recallBase()}/api/v1/bot/`, {
    method: "POST",
    headers: {
      Authorization: `Token ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      meeting_url: meetingUrl,
      bot_name: botName,
      recording_config: {
        transcript: { provider: { recallai_streaming: {} } },
      },
    }),
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`recall create ${r.status}: ${text.slice(0, 240)}`);
  const raw = JSON.parse(text) as { id: string };
  return { id: raw.id, raw };
}

async function recallGet(botId: string): Promise<{
  status: BotSessionStatus;
  transcriptText?: string;
  detail?: string;
  error?: string;
}> {
  const key = env("RECALL_API_KEY");
  if (!key) throw new Error("RECALL_API_KEY not set");
  const r = await fetch(`${recallBase()}/api/v1/bot/${botId}/`, {
    headers: { Authorization: `Token ${key}` },
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`recall get ${r.status}: ${text.slice(0, 240)}`);
  const raw = JSON.parse(text) as Record<string, unknown>;

  let transcriptText = extractTranscriptFromUnknown(raw);
  if (!transcriptText) {
    try {
      const tr = await fetch(`${recallBase()}/api/v1/bot/${botId}/transcript/`, {
        headers: { Authorization: `Token ${key}` },
      });
      if (tr.ok) {
        transcriptText = extractTranscriptFromUnknown(await tr.json());
      }
    } catch {
      /* ignore */
    }
  }

  const statusList = Array.isArray(raw.status_changes)
    ? (raw.status_changes as Array<{ code?: string }>).map((s) => String(s.code ?? "").toLowerCase())
    : [];
  const statusCode = String(raw.status ?? raw.state ?? "").toLowerCase();
  const last = statusList[statusList.length - 1] ?? statusCode;

  if (transcriptText?.trim()) {
    return { status: "done", transcriptText, detail: `recall · ${last || "done"}` };
  }
  if (last.includes("fatal") || last.includes("failed") || last.includes("error")) {
    return { status: "failed", error: last || "recall bot failed", detail: last };
  }
  if (last.includes("done") || last.includes("ended") || last.includes("call_ended")) {
    return { status: "waiting_transcript", detail: last };
  }
  if (last.includes("in_call") || last.includes("recording")) {
    return { status: "in_call", detail: last };
  }
  return { status: "joining", detail: last || "joining" };
}

function summarizeHttpError(status: number, text: string): string {
  const trimmed = text.trim();
  if (trimmed.startsWith("{")) {
    try {
      const j = JSON.parse(trimmed) as Record<string, unknown>;
      const detail = j.detail ?? j.error ?? j.message ?? j.non_field_errors;
      if (typeof detail === "string") return `${status}: ${detail}`;
      if (detail != null) return `${status}: ${JSON.stringify(detail).slice(0, 200)}`;
    } catch {
      /* fall through */
    }
  }
  const title = trimmed.match(/<title>([^<]+)<\/title>/i)?.[1]?.replace(/\s+/g, " ").trim();
  if (title) return `${status}: ${title}`;
  return `${status}: ${trimmed.slice(0, 180).replace(/\s+/g, " ")}`;
}

async function attendeeCreate(meetingUrl: string, botName: string): Promise<{ id: string; raw: unknown }> {
  const key = env("ATTENDEE_API_KEY");
  if (!key) throw new Error("ATTENDEE_API_KEY not set");
  const aloneAfter = Number(env("ATTENDEE_ALONE_TIMEOUT_SECONDS") || "20");
  const r = await fetch(`${attendeeBase()}/api/v1/bots`, {
    method: "POST",
    headers: {
      Authorization: `Token ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      meeting_url: meetingUrl,
      bot_name: botName,
      // Defaults are 60s alone / 600s silence — shorten so demos finalize promptly
      automatic_leave_settings: {
        only_participant_in_meeting_timeout_seconds: Number.isFinite(aloneAfter) ? aloneAfter : 20,
        waiting_room_timeout_seconds: 180,
        silence_timeout_seconds: 300,
        silence_activate_after_seconds: 120,
      },
    }),
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`attendee create ${summarizeHttpError(r.status, text)}`);
  const raw = JSON.parse(text) as { id: string };
  return { id: raw.id, raw };
}

async function attendeeLeave(botId: string): Promise<void> {
  const key = env("ATTENDEE_API_KEY");
  if (!key) throw new Error("ATTENDEE_API_KEY not set");
  const r = await fetch(`${attendeeBase()}/api/v1/bots/${botId}/leave`, {
    method: "POST",
    headers: {
      Authorization: `Token ${key}`,
      "Content-Type": "application/json",
    },
    body: "{}",
  });
  if (r.ok || r.status === 400) return; // 400 = already leaving/ended
  const text = await r.text();
  throw new Error(`attendee leave ${summarizeHttpError(r.status, text)}`);
}

async function attendeeGet(botId: string): Promise<{
  status: BotSessionStatus;
  transcriptText?: string;
  detail?: string;
  error?: string;
}> {
  const key = env("ATTENDEE_API_KEY");
  if (!key) throw new Error("ATTENDEE_API_KEY not set");
  const r = await fetch(`${attendeeBase()}/api/v1/bots/${botId}`, {
    headers: { Authorization: `Token ${key}` },
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`attendee get ${r.status}: ${text.slice(0, 240)}`);
  const raw = JSON.parse(text) as Record<string, unknown>;
  const state = String(raw.state ?? "").toLowerCase();
  const transcriptionState = String(raw.transcription_state ?? "").toLowerCase();
  const events = Array.isArray(raw.events) ? (raw.events as Array<Record<string, unknown>>) : [];
  const lastEvent = events.length ? events[events.length - 1] : undefined;
  const lastEventLabel = lastEvent
    ? [lastEvent.type, lastEvent.sub_type].filter(Boolean).map(String).join(":")
    : undefined;

  let transcriptText: string | undefined;
  try {
    const tr = await fetch(`${attendeeBase()}/api/v1/bots/${botId}/transcript`, {
      headers: { Authorization: `Token ${key}` },
    });
    if (tr.ok) {
      transcriptText = extractTranscriptFromUnknown(await tr.json());
    }
  } catch {
    /* ignore */
  }

  if (state === "fatal_error" || state.includes("fatal")) {
    const err = lastEventLabel || state;
    return { status: "failed", error: err, detail: err };
  }

  // Only terminal Attendee states finalize the CallIQ pipeline
  const meetingOver = state === "ended" || state === "data_deleted";

  if (!meetingOver) {
    const inCall =
      state.startsWith("joined") ||
      state === "leaving" ||
      state === "post_processing" ||
      state === "connected" ||
      state === "disconnecting";
    if (inCall) {
      return {
        status: state === "leaving" || state === "post_processing" ? "waiting_transcript" : "in_call",
        transcriptText,
        detail: transcriptText?.trim()
          ? `${lastEventLabel || state} · ${transcriptText.trim().split("\n").length} lines so far`
          : lastEventLabel || state,
      };
    }
    return {
      status: "joining",
      transcriptText,
      detail: lastEventLabel || state || "joining",
    };
  }

  if (transcriptText?.trim()) {
    return { status: "done", transcriptText, detail: `attendee · ${state}` };
  }

  return {
    status: "failed",
    error:
      "Bot finished without a usable transcript. Stay in the Meet and speak; after you leave, the bot auto-leaves in ~20s (or click Finish & analyze).",
    detail: `${state}/${transcriptionState}${lastEventLabel ? ` · ${lastEventLabel}` : ""}`,
  };
}

function utteranceText(o: Record<string, unknown>): string {
  if (typeof o.text === "string" && o.text.trim()) return o.text.trim();
  if (typeof o.content === "string" && o.content.trim()) return o.content.trim();
  if (typeof o.transcription === "string" && o.transcription.trim()) return o.transcription.trim();
  // Attendee: { transcription: { transcript: "..." } }
  if (o.transcription && typeof o.transcription === "object") {
    const t = (o.transcription as Record<string, unknown>).transcript;
    if (typeof t === "string" && t.trim()) return t.trim();
  }
  const words = o.words as Array<{ text?: string; word?: string }> | undefined;
  if (Array.isArray(words)) {
    const joined = words.map((w) => w.text || w.word || "").filter(Boolean).join(" ").trim();
    if (joined) return joined;
  }
  return "";
}

/** Normalize provider transcript JSON into "Speaker: text" lines. */
export function extractTranscriptFromUnknown(data: unknown): string | undefined {
  if (!data) return undefined;
  if (typeof data === "string") return data.trim() || undefined;
  if (Array.isArray(data)) {
    const lines = data
      .map((item) => {
        if (!item || typeof item !== "object") return "";
        const o = item as Record<string, unknown>;
        const text = utteranceText(o);
        const speaker =
          (o.speaker as string | undefined) ||
          (o.speaker_name as string | undefined) ||
          ((o.participant as { name?: string } | undefined)?.name) ||
          "Speaker";
        return text ? `${speaker}: ${text}` : "";
      })
      .filter(Boolean);
    return lines.length ? lines.join("\n") : undefined;
  }
  if (typeof data === "object") {
    const o = data as Record<string, unknown>;
    if (typeof o.transcript === "string") return o.transcript.trim() || undefined;
    if (Array.isArray(o.transcript)) return extractTranscriptFromUnknown(o.transcript);
    if (Array.isArray(o.segments)) return extractTranscriptFromUnknown(o.segments);
    if (Array.isArray(o.results)) return extractTranscriptFromUnknown(o.results);
    if (Array.isArray(o.utterances)) return extractTranscriptFromUnknown(o.utterances);
    if (typeof o.text === "string") return o.text.trim() || undefined;
  }
  return undefined;
}

const DEMO_SALES_LINES = [
  "Rep: Thanks for hopping on, Dana. I wanted to walk you through the enterprise plan.",
  "Customer: Honestly the main thing holding us back is the implementation cost. We got burned last year.",
  "Rep: We do white-glove onboarding in under four weeks, and a dedicated engineer for the first 90 days.",
  "Customer: That helps. But we also need to know if your security review passes our procurement.",
  "Rep: We are SOC 2 Type II and have EU data residency. I can loop in our solutions architect next week.",
  "Customer: If you send the security pack and a timeline, we can get a decision maker in by end of month.",
];

const DEMO_SALES_TRANSCRIPT = DEMO_SALES_LINES.join("\n");

const sessions = new Map<string, BotSession>();

function newId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/** Simulate: join Meet → speak line-by-line → leave → finalize transcript. */
function scheduleSimulatedProgress(id: string) {
  const patches: Array<{ at: number; patch: Partial<BotSession> }> = [
    {
      at: 700,
      patch: {
        status: "joining",
        detail: "Simulated Meet · waiting room → admitted",
      },
    },
    {
      at: 1600,
      patch: {
        status: "in_call",
        detail: "Simulated Meet · recording + captions",
      },
    },
  ];

  let built = "";
  DEMO_SALES_LINES.forEach((line, i) => {
    const at = 2400 + i * 900;
    built = built ? `${built}\n${line}` : line;
    const snapshot = built;
    patches.push({
      at,
      patch: {
        status: "in_call",
        transcriptText: snapshot,
        detail: `Simulated Meet · live captions (${i + 1}/${DEMO_SALES_LINES.length})`,
      },
    });
  });

  const afterLines = 2400 + DEMO_SALES_LINES.length * 900;
  patches.push({
    at: afterLines + 600,
    patch: {
      status: "waiting_transcript",
      transcriptText: DEMO_SALES_TRANSCRIPT,
      detail: "Simulated Meet · call ended · finalizing transcript",
    },
  });
  patches.push({
    at: afterLines + 1400,
    patch: {
      status: "done",
      transcriptText: DEMO_SALES_TRANSCRIPT,
      detail: "Simulated Meet · transcript ready",
    },
  });

  for (const step of patches) {
    setTimeout(() => {
      const s = sessions.get(id);
      if (!s || s.status === "failed") return;
      Object.assign(s, step.patch, { updatedAt: Date.now() });
    }, step.at);
  }
}

export async function joinMeetingBot(input: JoinBotInput): Promise<BotSession> {
  const meetingUrl = input.meetingUrl.trim();
  if (!meetingUrl && !input.demo) {
    throw new Error("meetingUrl required");
  }
  const botName = input.botName?.trim() || "CallIQ Bot";
  const provider = pickProvider(input.prefer, input.demo);
  const id = newId("ogbot");
  const now = Date.now();

  if (provider === "simulated") {
    const session: BotSession = {
      id,
      provider: "simulated",
      meetingUrl: meetingUrl || "https://meet.google.com/demo-calliq",
      botName,
      status: "joining",
      createdAt: now,
      updatedAt: now,
      detail: "Simulated Meet · bot joining…",
    };
    sessions.set(id, session);
    scheduleSimulatedProgress(id);
    return session;
  }

  if (provider === "recall") {
    try {
      const created = await recallCreate(meetingUrl, botName);
      const session: BotSession = {
        id,
        provider: "recall",
        externalId: created.id,
        meetingUrl,
        botName,
        status: "joining",
        createdAt: now,
        updatedAt: now,
        detail: "Recall bot created (explicit prefer)",
      };
      sessions.set(id, session);
      return session;
    } catch {
      if (attendeeConfigured()) {
        return joinMeetingBot({ ...input, prefer: "attendee" });
      }
      return joinMeetingBot({ ...input, prefer: "simulated", demo: true });
    }
  }

  if (provider === "attendee") {
    try {
      if (!meetingUrl || /meet\.google\.com\/new\/?$/i.test(meetingUrl)) {
        throw new Error(
          "Paste a real Meet/Zoom link (e.g. https://meet.google.com/abc-defg-hij). Attendee joins an existing meeting — it does not create Google Meet rooms.",
        );
      }
      const created = await attendeeCreate(meetingUrl, botName);
      const session: BotSession = {
        id,
        provider: "attendee",
        externalId: created.id,
        meetingUrl,
        botName,
        status: "joining",
        createdAt: now,
        updatedAt: now,
        detail: "Attendee bot created — admit “CallIQ Bot” in Meet if asked",
      };
      sessions.set(id, session);
      return session;
    } catch (e) {
      const err = e instanceof Error ? e.message : String(e);
      // Real joins must not silently fall back to a fake transcript
      if (!input.demo) throw new Error(err);
      const session: BotSession = {
        id,
        provider: "simulated",
        meetingUrl: meetingUrl || "https://meet.google.com/demo-calliq",
        botName,
        status: "joining",
        createdAt: now,
        updatedAt: now,
        detail: `Attendee failed (${err.slice(0, 120)}); using simulated demo bot`,
      };
      sessions.set(id, session);
      scheduleSimulatedProgress(id);
      return session;
    }
  }

  throw new Error(`unknown bot provider ${provider}`);
}

/** Ask Attendee to leave now (faster than waiting for alone-timeout). */
export async function leaveMeetingBot(id: string): Promise<BotSession | null> {
  const session = sessions.get(id);
  if (!session) return null;
  if (session.provider === "attendee" && session.externalId) {
    try {
      await attendeeLeave(session.externalId);
      session.detail = "Leave requested — waiting for Attendee to finalize transcript";
      session.status = "waiting_transcript";
      session.updatedAt = Date.now();
    } catch (e) {
      session.detail = e instanceof Error ? e.message.slice(0, 160) : "leave failed";
      session.updatedAt = Date.now();
    }
  }
  return getMeetingBot(id);
}

export async function getMeetingBot(id: string): Promise<BotSession | null> {
  const session = sessions.get(id);
  if (!session) return null;

  if (session.provider === "simulated") return session;
  if (!session.externalId) return session;

  try {
    const live =
      session.provider === "recall"
        ? await recallGet(session.externalId)
        : await attendeeGet(session.externalId);
    session.status = live.status;
    session.transcriptText = live.transcriptText ?? session.transcriptText;
    session.error = live.error;
    session.detail = live.detail;
    session.updatedAt = Date.now();
  } catch (e) {
    session.detail = e instanceof Error ? e.message.slice(0, 160) : "poll failed";
    session.updatedAt = Date.now();
  }
  return session;
}
