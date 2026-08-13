/** CallIQ call library — persisted locally until a server library exists. */

export type CallSource = "demo" | "meet" | "paste" | "upload";

export type CallStatus = "draft" | "recording" | "analyzing" | "ready" | "failed";

export interface CallAnalysis {
  summary?: string;
  dealHealthScore?: number;
  dealHealthRationale?: string;
  objections?: Array<{
    type: string;
    detail: string;
    evidence?: { start?: number; end?: number; speaker?: string };
  }>;
  nextSteps?: Array<{ task: string; owner?: string }>;
  risks?: Array<{ type: string; detail: string }>;
  followUpEmail?: string;
  talkRatio?: Array<{ speaker: string; secs: number; pct: number }>;
  keywords?: Array<{ term: string; count: number }>;
  [key: string]: unknown;
}

export interface CalliqCall {
  id: string;
  title: string;
  source: CallSource;
  meetingUrl?: string;
  transcript: string;
  createdAt: number;
  updatedAt: number;
  status: CallStatus;
  runId?: string;
  analysis?: CallAnalysis;
  error?: string;
}

export const CALLIQ_CALLS_KEY = "calliq.calls.v1";
export const CALLIQ_SELECTED_KEY = "calliq.selected.v1";
export const CALLIQ_LIVE_KEY = "calliq.live.v1";

const KEY = CALLIQ_CALLS_KEY;
const SELECTED_KEY = CALLIQ_SELECTED_KEY;

export type LiveBotSession = {
  botId: string;
  callId: string;
  meetingUrl: string;
  startedAt: number;
};

function safeParse(raw: string | null): CalliqCall[] {
  if (!raw) return [];
  try {
    const data = JSON.parse(raw) as unknown;
    if (!Array.isArray(data)) return [];
    return data.filter(
      (c): c is CalliqCall =>
        c != null &&
        typeof c === "object" &&
        typeof (c as CalliqCall).id === "string" &&
        typeof (c as CalliqCall).title === "string",
    );
  } catch {
    return [];
  }
}

export function loadCalls(): CalliqCall[] {
  if (typeof localStorage === "undefined") return [];
  return safeParse(localStorage.getItem(KEY)).sort((a, b) => b.updatedAt - a.updatedAt);
}

export function saveCalls(calls: CalliqCall[]): void {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(KEY, JSON.stringify(calls.slice(0, 100)));
}

export function loadSelectedCallId(): string | null {
  if (typeof localStorage === "undefined") return null;
  return localStorage.getItem(SELECTED_KEY);
}

export function saveSelectedCallId(id: string | null): void {
  if (typeof localStorage === "undefined") return;
  if (!id) localStorage.removeItem(SELECTED_KEY);
  else localStorage.setItem(SELECTED_KEY, id);
}

export function upsertCall(calls: CalliqCall[], next: CalliqCall): CalliqCall[] {
  const i = calls.findIndex((c) => c.id === next.id);
  if (i < 0) return [next, ...calls];
  const copy = calls.slice();
  copy[i] = next;
  return copy.sort((a, b) => b.updatedAt - a.updatedAt);
}

export function deleteCall(calls: CalliqCall[], id: string): CalliqCall[] {
  return calls.filter((c) => c.id !== id);
}

export function loadLiveBot(): LiveBotSession | null {
  if (typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem(CALLIQ_LIVE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw) as Partial<LiveBotSession>;
    if (!data.botId || !data.callId || !data.meetingUrl) return null;
    return {
      botId: String(data.botId),
      callId: String(data.callId),
      meetingUrl: String(data.meetingUrl),
      startedAt: typeof data.startedAt === "number" ? data.startedAt : Date.now(),
    };
  } catch {
    return null;
  }
}

export function saveLiveBot(live: LiveBotSession | null): void {
  if (typeof localStorage === "undefined") return;
  if (!live) localStorage.removeItem(CALLIQ_LIVE_KEY);
  else localStorage.setItem(CALLIQ_LIVE_KEY, JSON.stringify(live));
}

export function findLiveCall(calls: CalliqCall[], meetingUrl: string): CalliqCall | undefined {
  const needle = meetingUrl.trim();
  return calls.find(
    (c) =>
      (c.status === "recording" || c.status === "analyzing") &&
      Boolean(c.meetingUrl) &&
      c.meetingUrl === needle,
  );
}

export function newCallId(): string {
  return `call_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function titleFromTranscript(text: string, source: CallSource): string {
  const first = text
    .split("\n")
    .map((l) => l.replace(/^(Rep|Customer|Sales Rep|Me|Them):\s*/i, "").trim())
    .find((l) => l.length > 8);
  if (first) {
    const clipped = first.length > 56 ? `${first.slice(0, 53)}…` : first;
    return clipped;
  }
  if (source === "demo") return "Demo sales call";
  if (source === "meet") return "Meet call";
  if (source === "upload") return "Uploaded recording";
  return "Pasted transcript";
}

export function sourceLabel(source: CallSource): string {
  if (source === "demo") return "Demo";
  if (source === "meet") return "Meet bot";
  if (source === "upload") return "Recording";
  return "Paste";
}
