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
  /** Set once we ask Attendee to leave, or observe the bot leave Meet. */
  leaveRequested?: boolean;
  hearAttempted?: boolean;
};

type HearRecordingFn = (audio: Uint8Array, format: string) => Promise<string | undefined>;
let hearRecordingFn: HearRecordingFn | undefined;

/** Wire PyAI Hear (or another STT) so empty Attendee captions can fall back to the recording. */
export function setMeetingBotHear(fn: HearRecordingFn): void {
  hearRecordingFn = fn;
}

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

function attendeeHeaders(): Record<string, string> {
  const key = env("ATTENDEE_API_KEY");
  if (!key) throw new Error("ATTENDEE_API_KEY not set");
  return { Authorization: `Token ${key}`, "Content-Type": "application/json" };
}

/** Stable key so a second Send Bot on the same Meet reuses the live bot instead of spawning another guest. */
export function meetingDedupKey(meetingUrl: string): string {
  const lower = meetingUrl.trim().toLowerCase();
  const meet = lower.match(/meet\.google\.com\/([a-z0-9]{3}-[a-z0-9]{4}-[a-z0-9]{3})/);
  if (meet) return `calliq-meet-${meet[1]}`;
  const zoom = lower.match(/zoom\.us\/j\/(\d+)/);
  if (zoom) return `calliq-zoom-${zoom[1]}`;
  const teams = lower.match(/meetup-join\/([^/?#]+)/)?.[1];
  if (teams) return `calliq-teams-${teams.slice(0, 48)}`;
  return `calliq-${lower.replace(/https?:\/\//, "").replace(/[^a-z0-9]+/g, "-").slice(0, 64)}`;
}

export function sameMeetingUrl(a: string, b: string): boolean {
  return meetingDedupKey(a) === meetingDedupKey(b);
}

type AttendeeBotRow = {
  id: string;
  meeting_url?: string;
  state?: string;
  deduplication_key?: string | null;
};

const ATTENDEE_ACTIVE_JOIN_STATES = new Set([
  "joining",
  "waiting_room",
  "staged",
  "ready",
  "scheduled",
  "joined_recording",
  "joined_not_recording",
  "joined_recording_paused",
  "joined_recording_permission_denied",
  "connected",
  "joining_breakout_room",
  "leaving_breakout_room",
]);

function isActiveJoinState(state: string | undefined): boolean {
  return ATTENDEE_ACTIVE_JOIN_STATES.has(normalizeAttendeeState(state ?? ""));
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

function meetingClosedCaptionSettings(meetingUrl: string): Record<string, unknown> {
  // Do not set google_meet_language — Attendee then clicks Meet Settings to
  // change caption language and fatals with ui_element_not_found when the
  // menu is missing (non-English UI, waiting room, or Meet layout change).
  if (/zoom\.us/i.test(meetingUrl)) {
    return { meeting_closed_captions: { zoom_language: "English", merge_consecutive_captions: true } };
  }
  if (/teams\.microsoft\.com|teams\.live\.com/i.test(meetingUrl)) {
    return { meeting_closed_captions: { teams_language: "en-us", merge_consecutive_captions: true } };
  }
  return { meeting_closed_captions: { merge_consecutive_captions: true } };
}

export function attendeeCreatePayload(meetingUrl: string, botName: string): Record<string, unknown> {
  const aloneAfter = Number(env("ATTENDEE_ALONE_TIMEOUT_SECONDS") || "20");
  const payload: Record<string, unknown> = {
    meeting_url: meetingUrl,
    bot_name: botName,
    transcription_settings: meetingClosedCaptionSettings(meetingUrl),
    recording_settings: { format: "mp3" },
    automatic_leave_settings: {
      only_participant_in_meeting_timeout_seconds: Number.isFinite(aloneAfter) ? aloneAfter : 20,
      waiting_room_timeout_seconds: 180,
      silence_timeout_seconds: 300,
      silence_activate_after_seconds: 120,
    },
  };
  if (/meet\.google\.com/i.test(meetingUrl)) {
    payload.google_meet_settings = {
      use_login: false,
      ui_interaction_mode: "robotic",
    };
  }
  payload.deduplication_key = meetingDedupKey(meetingUrl);
  return payload;
}

async function attendeeListBots(query: Record<string, string> = {}): Promise<AttendeeBotRow[]> {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v) qs.set(k, v);
  }
  const suffix = qs.size ? `?${qs.toString()}` : "";
  const r = await fetch(`${attendeeBase()}/api/v1/bots${suffix}`, { headers: attendeeHeaders() });
  const text = await r.text();
  if (!r.ok) return [];
  try {
    const raw = JSON.parse(text) as unknown;
    if (Array.isArray(raw)) return raw as AttendeeBotRow[];
    if (raw && typeof raw === "object" && Array.isArray((raw as { results?: unknown }).results)) {
      return (raw as { results: AttendeeBotRow[] }).results;
    }
  } catch {
    /* ignore */
  }
  return [];
}

async function findActiveAttendeeBots(meetingUrl: string): Promise<AttendeeBotRow[]> {
  const key = meetingDedupKey(meetingUrl);
  const [byKey, byUrl, recent] = await Promise.all([
    attendeeListBots({ deduplication_key: key }),
    attendeeListBots({ meeting_url: meetingUrl }),
    attendeeListBots({}),
  ]);
  const seen = new Map<string, AttendeeBotRow>();
  for (const row of [...byKey, ...byUrl, ...recent]) {
    if (!row?.id) continue;
    const url = typeof row.meeting_url === "string" ? row.meeting_url : "";
    const matches =
      row.deduplication_key === key || (url ? sameMeetingUrl(url, meetingUrl) : false);
    if (!matches) continue;
    if (!isActiveJoinState(row.state)) continue;
    seen.set(row.id, row);
  }
  return [...seen.values()];
}

/** Keep one live bot for this Meet; tell extras to leave so Admit does not let two guests in. */
async function keepOneActiveAttendeeBot(meetingUrl: string): Promise<AttendeeBotRow | undefined> {
  const active = await findActiveAttendeeBots(meetingUrl);
  if (!active.length) return undefined;
  const [keep, ...extras] = active;
  await Promise.all(extras.map((row) => attendeeLeave(row.id).catch(() => undefined)));
  return keep;
}

function findLocalActiveSession(meetingUrl: string): BotSession | undefined {
  for (const session of sessions.values()) {
    if (session.provider !== "attendee") continue;
    if (!sameMeetingUrl(session.meetingUrl, meetingUrl)) continue;
    if (session.status === "joining" || session.status === "in_call") return session;
  }
  return undefined;
}

async function attendeeCreate(meetingUrl: string, botName: string): Promise<{ id: string; raw: unknown }> {
  const r = await fetch(`${attendeeBase()}/api/v1/bots`, {
    method: "POST",
    headers: attendeeHeaders(),
    body: JSON.stringify(attendeeCreatePayload(meetingUrl, botName)),
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

export function normalizeAttendeeState(raw: string): string {
  return raw.toLowerCase().replace(/[\s-]+/g, "_").trim();
}

function eventBlob(event: Record<string, unknown>): string {
  return [event.type, event.sub_type, event.event_type, event.code, event.new_state]
    .filter(Boolean)
    .map(String)
    .join(" ")
    .toLowerCase();
}

export function eventsIndicateBotLeft(events: Array<Record<string, unknown>>): boolean {
  return events.some((event) =>
    /left_meeting|bot_left|meeting_ended|call_ended/.test(eventBlob(event)),
  );
}

const ATTENDEE_LEFT_STATES = new Set([
  "leaving",
  "post_processing",
  "ended",
  "data_deleted",
  "disconnecting",
]);

const ATTENDEE_IN_CALL_STATES = new Set([
  "joined_recording",
  "joined_not_recording",
  "joined_recording_paused",
  "joined_recording_permission_denied",
  "connected",
  "joining_breakout_room",
  "leaving_breakout_room",
]);

export function mapAttendeeBotStatus(input: {
  state: string;
  transcriptionState?: string;
  recordingState?: string;
  events?: Array<Record<string, unknown>>;
  transcriptText?: string;
}): {
  status: BotSessionStatus;
  transcriptText?: string;
  detail?: string;
  error?: string;
  leftMeet: boolean;
} {
  const state = normalizeAttendeeState(input.state);
  const transcriptionState = normalizeAttendeeState(input.transcriptionState ?? "");
  const events = input.events ?? [];
  const lastEvent = events.length ? events[events.length - 1] : undefined;
  const lastEventLabel = lastEvent
    ? [lastEvent.type, lastEvent.sub_type].filter(Boolean).map(String).join(":")
    : undefined;
  const transcriptText = input.transcriptText?.trim() || undefined;
  const lineNote = transcriptText ? ` · ${transcriptText.split("\n").length} lines` : "";
  const label = lastEventLabel || state || "unknown";

  if (state === "fatal_error" || state.includes("fatal")) {
    const error = /ui_element_not_found/i.test(label)
      ? "Google Meet UI element not found (join, name, or captions). Use a live meet.google.com/xxx-xxxx-xxx link, admit CallIQ Bot immediately, keep Meet in English, then try again."
      : label;
    return { status: "failed", error, detail: label, leftMeet: true };
  }

  const leftMeet = ATTENDEE_LEFT_STATES.has(state) || eventsIndicateBotLeft(events);

  if (leftMeet) {
    if (transcriptText) {
      return {
        status: "done",
        transcriptText,
        detail: `Bot left Meet · ${label}${lineNote}`,
        leftMeet: true,
      };
    }
    return {
      status: "waiting_transcript",
      detail: `Bot left Meet · finalizing transcript${transcriptionState ? ` (${transcriptionState})` : ""}`,
      leftMeet: true,
    };
  }

  if (state.startsWith("joined") || ATTENDEE_IN_CALL_STATES.has(state)) {
    return {
      status: "in_call",
      transcriptText,
      detail: transcriptText ? `${label}${lineNote}` : label,
      leftMeet: false,
    };
  }

  return {
    status: "joining",
    transcriptText,
    detail:
      label && label !== "joining" && label !== "join_requested"
        ? label
        : "joining — admit CallIQ Bot. If Meet says “You can’t join this video call”, Google blocked the guest: start a new Meet, allow anyone with the link, send the bot once.",
    leftMeet: false,
  };
}

async function attendeeRecordingAudio(botId: string): Promise<{ audio: Uint8Array; format: string } | undefined> {
  const key = env("ATTENDEE_API_KEY");
  if (!key) return undefined;
  const r = await fetch(`${attendeeBase()}/api/v1/bots/${botId}/recording`, {
    headers: { Authorization: `Token ${key}` },
  });
  if (!r.ok) return undefined;
  const raw = (await r.json()) as { url?: string };
  const url = typeof raw.url === "string" ? rewriteRecordingUrl(raw.url) : "";
  if (!url) return undefined;
  const file = await fetch(url);
  if (!file.ok) return undefined;
  const buf = new Uint8Array(await file.arrayBuffer());
  if (buf.byteLength < 256 || buf.byteLength > 18_000_000) return undefined;
  const format = url.toLowerCase().includes(".mp3") ? "mp3" : url.toLowerCase().includes(".wav") ? "wav" : "m4a";
  return { audio: buf, format };
}

function rewriteRecordingUrl(url: string): string {
  const endpoint = env("AWS_ENDPOINT_URL") || env("MINIO_ENDPOINT");
  if (!endpoint) return url;
  try {
    const u = new URL(url);
    if (u.hostname === "localhost" || u.hostname === "127.0.0.1" || u.hostname === "minio") {
      const raw = endpoint.replace(/^https?:\/\//, "");
      const [host, port] = raw.split(":");
      if (host) u.hostname = host;
      if (port) u.port = port;
      u.protocol = endpoint.startsWith("https") ? "https:" : "http:";
    }
    return u.toString();
  } catch {
    return url;
  }
}

async function attendeeGet(botId: string): Promise<{
  status: BotSessionStatus;
  transcriptText?: string;
  detail?: string;
  error?: string;
  leftMeet: boolean;
  recordingReady?: boolean;
}> {
  const key = env("ATTENDEE_API_KEY");
  if (!key) throw new Error("ATTENDEE_API_KEY not set");
  const r = await fetch(`${attendeeBase()}/api/v1/bots/${botId}`, {
    headers: { Authorization: `Token ${key}` },
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`attendee get ${r.status}: ${text.slice(0, 240)}`);
  const raw = JSON.parse(text) as Record<string, unknown>;

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

  const recordingState = normalizeAttendeeState(String(raw.recording_state ?? ""));
  return {
    ...mapAttendeeBotStatus({
      state: String(raw.state ?? ""),
      transcriptionState: String(raw.transcription_state ?? ""),
      recordingState,
      events: Array.isArray(raw.events) ? (raw.events as Array<Record<string, unknown>>) : [],
      transcriptText,
    }),
    recordingReady: recordingState === "complete" || recordingState === "completed",
  };
}

function utteranceText(o: Record<string, unknown>): string {
  if (typeof o.text === "string" && o.text.trim()) return o.text.trim();
  if (typeof o.content === "string" && o.content.trim()) return o.content.trim();
  if (typeof o.caption === "string" && o.caption.trim()) return o.caption.trim();
  if (typeof o.transcription === "string" && o.transcription.trim()) return o.transcription.trim();
  // Attendee: { transcription: { transcript: "..." } } or a plain string
  if (o.transcription && typeof o.transcription === "object") {
    const nested = o.transcription as Record<string, unknown>;
    for (const key of ["transcript", "text", "content", "caption"]) {
      const t = nested[key];
      if (typeof t === "string" && t.trim()) return t.trim();
    }
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
      const local = findLocalActiveSession(meetingUrl);
      if (local) return local;
      const existing = await keepOneActiveAttendeeBot(meetingUrl);
      if (existing) {
        const session: BotSession = {
          id,
          provider: "attendee",
          externalId: existing.id,
          meetingUrl,
          botName,
          status: (() => {
            const st = normalizeAttendeeState(existing.state ?? "");
            return st.startsWith("joined") || st === "connected" ? "in_call" : "joining";
          })(),
          createdAt: now,
          updatedAt: now,
          detail: "Reusing the bot already in this Meet — admit CallIQ Bot once (deny extras)",
        };
        sessions.set(id, session);
        return session;
      }
      let created: { id: string; raw: unknown };
      try {
        created = await attendeeCreate(meetingUrl, botName);
      } catch (createErr) {
        const msg = createErr instanceof Error ? createErr.message : String(createErr);
        const raced = await keepOneActiveAttendeeBot(meetingUrl);
        if (raced && /dedup|already exists|non-terminal/i.test(msg)) {
          const session: BotSession = {
            id,
            provider: "attendee",
            externalId: raced.id,
            meetingUrl,
            botName,
            status: "joining",
            createdAt: now,
            updatedAt: now,
            detail: "Reusing the bot already in this Meet — admit CallIQ Bot once",
          };
          sessions.set(id, session);
          return session;
        }
        throw createErr;
      }
      const session: BotSession = {
        id,
        provider: "attendee",
        externalId: created.id,
        meetingUrl,
        botName,
        status: "joining",
        createdAt: now,
        updatedAt: now,
        detail: "Attendee bot created — admit “CallIQ Bot” once (deny any extra guests)",
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
  session.leaveRequested = true;
  if (session.provider === "attendee" && session.externalId) {
    try {
      await attendeeLeave(session.externalId);
      session.detail = "Leave requested — waiting for Attendee to finalize transcript";
      session.status = session.transcriptText?.trim() ? "done" : "waiting_transcript";
      session.updatedAt = Date.now();
    } catch (e) {
      session.detail = e instanceof Error ? e.message.slice(0, 160) : "leave failed";
      session.updatedAt = Date.now();
    }
  } else if (session.transcriptText?.trim()) {
    session.status = "done";
    session.detail = "Leave requested · transcript ready";
    session.updatedAt = Date.now();
  } else {
    session.status = "waiting_transcript";
    session.detail = "Leave requested — finalizing transcript";
    session.updatedAt = Date.now();
  }
  return getMeetingBot(id);
}

function applyLiveBotStatus(
  session: BotSession,
  live: {
    status: BotSessionStatus;
    transcriptText?: string;
    detail?: string;
    error?: string;
    leftMeet?: boolean;
  },
): void {
  session.transcriptText = live.transcriptText ?? session.transcriptText;
  session.error = live.error;
  session.updatedAt = Date.now();
  if (live.leftMeet) session.leaveRequested = true;

  const stickyLeave =
    session.leaveRequested ||
    session.status === "waiting_transcript" ||
    session.status === "done" ||
    live.leftMeet === true;

  if (live.status === "failed") {
    session.status = "failed";
    session.detail = live.detail;
    return;
  }

  if (live.status === "done") {
    session.status = "done";
    session.detail = live.detail;
    return;
  }

  if (stickyLeave && (live.status === "in_call" || live.status === "joining")) {
    session.status = session.transcriptText?.trim() ? "done" : "waiting_transcript";
    session.detail = live.detail
      ? `${live.detail} · finalizing after leave`
      : "Bot left Meet · finalizing transcript";
    return;
  }

  session.status = live.status;
  session.detail = live.detail;
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
    applyLiveBotStatus(session, live);
    const leftMeet = "leftMeet" in live && Boolean(live.leftMeet);
    const recordingReady = "recordingReady" in live && Boolean(live.recordingReady);
    if (
      session.provider === "attendee" &&
      !session.transcriptText?.trim() &&
      leftMeet &&
      recordingReady &&
      !session.hearAttempted &&
      hearRecordingFn
    ) {
      session.hearAttempted = true;
      session.detail = "Bot left Meet · Hear transcribing recording…";
      const rec = await attendeeRecordingAudio(session.externalId);
      if (rec) {
        const heard = await hearRecordingFn(rec.audio, rec.format);
        if (heard?.trim()) {
          session.transcriptText = heard.trim();
          session.status = "done";
          session.detail = "Hear from meeting recording";
        }
      }
    }
  } catch (e) {
    session.detail = e instanceof Error ? e.message.slice(0, 160) : "poll failed";
    session.updatedAt = Date.now();
  }
  return session;
}
