import { applyTranscriptDelta, growCaption } from "./liveCaption";

export type CallState =
  | "idle"
  | "connecting"
  | "listening"
  | "user_speaking"
  | "processing"
  | "agent_speaking"
  | "overlapping"
  | "interrupted"
  | "error"
  | "ended";

export interface CallTurn {
  id: string;
  speaker: "user" | "agent";
  text: string;
  ts: number;
  final: boolean;
}

export interface CallSessionInfo {
  sessionId: string;
  provider: string;
  fallbackUsed: boolean;
  fallbackReason?: string;
  fallbackProvider?: string;
  message?: string;
}

export interface CallTraceEvent {
  t: number;
  type: string;
  provider?: string;
  speaker?: string;
}

export interface LiveCallHandlers {
  onState: (state: CallState) => void;
  onSession: (info: CallSessionInfo) => void;
  onTurn: (turn: CallTurn) => void;
  onLevel: (rms: number) => void;
  onError: (message: string) => void;
  onEnded: (info: {
    durationMs: number;
    provider: string;
    fallbackUsed: boolean;
    fallbackReason?: string;
    trace: CallTraceEvent[];
  }) => void;
}

const PCM_RATE = 24_000;
const PREROLL_SEC = 0.18;
const STASH_SEC = 0.08;
const IDLE_GRACE_MS = 160;

const CAPTURE_WORKLET = `
const TARGET = 24000;
const FRAME = 480;
class CaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._buf = new Int16Array(FRAME);
    this._n = 0;
    this._frac = 0;
  }
  process(inputs) {
    const ch = inputs[0]?.[0];
    if (!ch) return true;
    const step = TARGET / sampleRate;
    let frac = this._frac;
    for (let i = 0; i < ch.length; i++) {
      frac += step;
      if (frac < 1) continue;
      frac -= 1;
      const s = Math.max(-1, Math.min(1, ch[i]));
      this._buf[this._n++] = s < 0 ? s * 0x8000 : s * 0x7fff;
      if (this._n === FRAME) {
        const out = this._buf.slice();
        this.port.postMessage(out.buffer, [out.buffer]);
        this._n = 0;
      }
    }
    this._frac = frac;
    return true;
  }
}
registerProcessor("capture-processor", CaptureProcessor);
`;

function wsUrl(): string {
  const base = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/$/, "") ?? "";
  if (base) return `${base.replace(/^http/, "ws")}/ws/simulator/call`;
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${location.host}/ws/simulator/call`;
}

type MixTrack = {
  gain: GainNode;
  chunks: AudioBuffer[];
  queued: number;
  next: number;
  primed: boolean;
  nodes: Set<AudioBufferSourceNode>;
  startTimer: number;
  idleTimer: number;
  onStart: () => void;
  onIdle: () => void;
};

function pcm16ToBuffer(ctx: AudioContext, bytes: ArrayBuffer): AudioBuffer | null {
  const even = bytes.byteLength & ~1;
  if (even < 2) return null;
  const pcm = new Int16Array(bytes, 0, even / 2);
  const srcRate = PCM_RATE;
  const dstRate = ctx.sampleRate;
  if (srcRate === dstRate) {
    const buf = ctx.createBuffer(1, pcm.length, dstRate);
    const ch = buf.getChannelData(0);
    for (let i = 0; i < pcm.length; i++) ch[i] = pcm[i]! / 0x8000;
    return buf;
  }
  const outLen = Math.max(1, Math.round((pcm.length * dstRate) / srcRate));
  const buf = ctx.createBuffer(1, outLen, dstRate);
  const ch = buf.getChannelData(0);
  const step = srcRate / dstRate;
  let pos = 0;
  for (let i = 0; i < outLen; i++) {
    const i0 = Math.min(pcm.length - 1, Math.floor(pos));
    const i1 = Math.min(pcm.length - 1, i0 + 1);
    const t = pos - i0;
    ch[i] = pcm[i0]! / 0x8000 + (pcm[i1]! / 0x8000 - pcm[i0]! / 0x8000) * t;
    pos += step;
  }
  return buf;
}

function concatBytes(parts: Uint8Array[]): ArrayBuffer {
  const total = parts.reduce((n, p) => n + p.byteLength, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.byteLength;
  }
  return out.buffer;
}

function makeTrack(ctx: AudioContext, onStart: () => void, onIdle: () => void): MixTrack {
  const gain = ctx.createGain();
  gain.connect(ctx.destination);
  return {
    gain,
    chunks: [],
    queued: 0,
    next: 0,
    primed: false,
    nodes: new Set(),
    startTimer: 0,
    idleTimer: 0,
    onStart,
    onIdle,
  };
}

function stopTrack(track: MixTrack): void {
  window.clearTimeout(track.startTimer);
  window.clearTimeout(track.idleTimer);
  for (const node of track.nodes) {
    try {
      node.stop();
    } catch {
      /* already stopped */
    }
  }
  track.nodes.clear();
  track.chunks = [];
  track.queued = 0;
  track.primed = false;
  track.next = 0;
}

function pumpTrack(ctx: AudioContext, track: MixTrack): void {
  if (!track.chunks.length) return;
  const now = ctx.currentTime;
  if (!track.primed) {
    if (track.queued < PREROLL_SEC) {
      window.clearTimeout(track.startTimer);
      track.startTimer = window.setTimeout(() => {
        if (!track.primed && track.queued > 0) {
          track.primed = true;
          track.next = ctx.currentTime + 0.02;
          track.onStart();
          pumpTrack(ctx, track);
        }
      }, 90);
      return;
    }
    track.primed = true;
    track.next = now + 0.02;
    track.onStart();
  }
  window.clearTimeout(track.idleTimer);
  while (track.chunks.length) {
    const buf = track.chunks.shift();
    if (!buf) break;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(track.gain);
    const startAt = Math.max(ctx.currentTime + 0.006, track.next);
    src.start(startAt);
    track.next = startAt + buf.duration;
    track.queued = Math.max(0, track.queued - buf.duration);
    track.nodes.add(src);
    src.onended = () => {
      track.nodes.delete(src);
      if (track.nodes.size || track.chunks.length) return;
      window.clearTimeout(track.idleTimer);
      track.idleTimer = window.setTimeout(() => {
        if (track.nodes.size || track.chunks.length) return;
        track.primed = false;
        track.next = 0;
        track.onIdle();
      }, IDLE_GRACE_MS);
    };
  }
}

function enqueuePcm(ctx: AudioContext, track: MixTrack, pcm: ArrayBuffer): void {
  const buf = pcm16ToBuffer(ctx, pcm);
  if (!buf) return;
  track.chunks.push(buf);
  track.queued += buf.duration;
  pumpTrack(ctx, track);
}

function makeRevealer(speaker: "agent" | "user") {
  let full = "";
  let shown = "";
  let wantFinal = false;
  let audible = false;
  let everPlayed = false;
  let ts = Date.now();
  let lastKey = "";
  return {
    pushText(text: string, final: boolean) {
      if (wantFinal && !final) return;
      full = applyTranscriptDelta(full, text, final);
      if (final) wantFinal = true;
    },
    markPlaying() {
      audible = true;
      everPlayed = true;
    },
    markIdle() {
      audible = false;
    },
    snapshot(forceFinal = false): CallTurn | null {
      if (!full) return null;
      if (!everPlayed && !forceFinal) return null;
      shown = growCaption(shown, full);
      const done = forceFinal || (wantFinal && !audible && everPlayed);
      const turn: CallTurn = done
        ? { id: `${speaker[0]}-${Date.now()}`, speaker, text: shown || full, ts, final: true }
        : { id: `${speaker}-live`, speaker, text: shown, ts, final: false };
      const key = `${turn.id}:${turn.text}:${turn.final}`;
      if (key === lastKey) return null;
      lastKey = key;
      if (done) {
        full = "";
        shown = "";
        wantFinal = false;
        audible = false;
        everPlayed = false;
        ts = Date.now();
        lastKey = "";
      }
      return turn;
    },
  };
}

function rmsOfPcm(buf: ArrayBuffer): number {
  const pcm = new Int16Array(buf);
  if (!pcm.length) return 0;
  let sum = 0;
  for (let i = 0; i < pcm.length; i++) sum += (pcm[i]! / 0x8000) ** 2;
  return Math.sqrt(sum / pcm.length);
}

export async function startLiveCall(
  agent: { name: string; prompt: string; voice: string; greeting?: string },
  handlers: LiveCallHandlers,
  opts?: {
    forceProvider?: string;
    mode?: "manual" | "persona";
    agentId?: string;
    version?: number;
    scenarioId?: string;
  },
): Promise<{ interrupt: () => void; mute: (on: boolean) => void; end: () => void }> {
  handlers.onState("connecting");
  const listenOnly = opts?.mode === "persona";
  const ctx = new AudioContext();
  await ctx.resume();
  const capUrl = URL.createObjectURL(new Blob([CAPTURE_WORKLET], { type: "application/javascript" }));
  await ctx.audioWorklet.addModule(capUrl);

  const stream = listenOnly
    ? null
    : await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
      });
  const capture = new AudioWorkletNode(ctx, "capture-processor");
  if (stream) {
    const src = ctx.createMediaStreamSource(stream);
    src.connect(capture);
  }

  const ws = new WebSocket(wsUrl());
  ws.binaryType = "arraybuffer";
  const connectWatch = window.setTimeout(() => {
    if (ws.readyState !== WebSocket.OPEN) {
      handlers.onError("Could not reach the live call service.");
      handlers.onState("error");
      cleanup();
    }
  }, 8_000);

  let muted = false;
  let agentSpeaking = false;
  let agentSince = 0;
  let bargeFrames = 0;
  let closed = false;
  const agentRev = makeRevealer("agent");
  const userRev = makeRevealer("user");
  const stash: Array<{ parts: Uint8Array[]; bytes: number; timer: number }> = [
    { parts: [], bytes: 0, timer: 0 },
    { parts: [], bytes: 0, timer: 0 },
  ];

  const emitReveal = (rev: ReturnType<typeof makeRevealer>, forceFinal = false) => {
    const snap = rev.snapshot(forceFinal);
    if (!snap) return;
    handlers.onTurn(snap);
  };

  const syncDuck = () => {
    if (closed) return;
    const both = agentTrack.primed && userTrack.primed;
    agentTrack.gain.gain.setTargetAtTime(both ? 0.7 : 1, ctx.currentTime, 0.05);
    userTrack.gain.gain.setTargetAtTime(both ? 0.78 : 1, ctx.currentTime, 0.05);
    if (both) handlers.onState("overlapping");
  };

  const agentTrack = makeTrack(
    ctx,
    () => {
      agentRev.markPlaying();
      emitReveal(agentRev);
      syncDuck();
    },
    () => {
      agentRev.markIdle();
      emitReveal(agentRev);
      syncDuck();
    },
  );
  const userTrack = makeTrack(
    ctx,
    () => {
      userRev.markPlaying();
      emitReveal(userRev);
      syncDuck();
    },
    () => {
      userRev.markIdle();
      emitReveal(userRev);
      syncDuck();
    },
  );
  const tracks = [agentTrack, userTrack];

  const flushStash = (ch: 0 | 1) => {
    const s = stash[ch];
    const track = tracks[ch];
    if (!s || !track) return;
    window.clearTimeout(s.timer);
    if (!s.bytes) return;
    const pcm = concatBytes(s.parts);
    s.parts = [];
    s.bytes = 0;
    enqueuePcm(ctx, track, pcm);
  };

  const takePcm = (ch: 0 | 1, pcm: ArrayBuffer) => {
    const s = stash[ch];
    if (!s) return;
    const copy = new Uint8Array(pcm.byteLength);
    copy.set(new Uint8Array(pcm));
    s.parts.push(copy);
    s.bytes += copy.byteLength;
    if (s.bytes / 2 >= STASH_SEC * PCM_RATE) flushStash(ch);
    else {
      window.clearTimeout(s.timer);
      s.timer = window.setTimeout(() => flushStash(ch), 40);
    }
  };

  const cleanup = () => {
    if (closed) return;
    closed = true;
    window.clearTimeout(connectWatch);
    window.clearTimeout(stash[0]?.timer);
    window.clearTimeout(stash[1]?.timer);
    stopTrack(agentTrack);
    stopTrack(userTrack);
    try {
      ws.close();
    } catch {
      /* ignore */
    }
    stream?.getTracks().forEach((t) => t.stop());
    void ctx.close();
    URL.revokeObjectURL(capUrl);
  };

  const interrupt = () => {
    window.clearTimeout(stash[0]?.timer);
    if (stash[0]) {
      stash[0].parts = [];
      stash[0].bytes = 0;
    }
    stopTrack(agentTrack);
    emitReveal(agentRev, true);
    agentSpeaking = false;
    syncDuck();
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "interrupt" }));
  };

  ws.onopen = () => {
    window.clearTimeout(connectWatch);
    ws.send(
      JSON.stringify({
        type: "start",
        name: agent.name,
        prompt: agent.prompt,
        voice: agent.voice,
        greeting: agent.greeting,
        forceProvider: opts?.forceProvider,
        mode: opts?.mode ?? "manual",
        agentId: opts?.agentId,
        version: opts?.version,
        scenarioId: opts?.scenarioId,
      }),
    );
  };

  capture.port.onmessage = (e: MessageEvent<ArrayBuffer>) => {
    if (listenOnly || closed || ws.readyState !== WebSocket.OPEN || muted) return;
    const rms = rmsOfPcm(e.data);
    handlers.onLevel(rms);
    // Echo from the speaker used to trip barge-in and flush remaining audio
    // while transcript deltas had already arrived.
    if (agentSpeaking && Date.now() - agentSince > 1_200) {
      bargeFrames = rms > 0.12 ? bargeFrames + 1 : 0;
      if (bargeFrames >= 12) {
        bargeFrames = 0;
        interrupt();
      }
    } else {
      bargeFrames = 0;
    }
    ws.send(e.data);
  };

  ws.onmessage = (e) => {
    if (closed) return;
    if (typeof e.data !== "string") {
      const buf = e.data as ArrayBuffer;
      if (buf.byteLength < 3) return;
      const bytes = new Uint8Array(buf);
      const tagged = bytes[0] === 1 || bytes[0] === 2;
      const ch: 0 | 1 = tagged && bytes[0] === 2 ? 1 : 0;
      takePcm(ch, tagged ? buf.slice(1) : buf);
      return;
    }
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(e.data) as Record<string, unknown>;
    } catch {
      return;
    }
    const type = String(msg.type ?? "");
    if (type === "session") {
      handlers.onSession({
        sessionId: String(msg.sessionId ?? ""),
        provider: String(msg.provider ?? "mock"),
        fallbackUsed: Boolean(msg.fallbackUsed),
        fallbackReason: typeof msg.fallbackReason === "string" ? msg.fallbackReason : undefined,
        fallbackProvider: typeof msg.fallbackProvider === "string" ? msg.fallbackProvider : undefined,
        message: typeof msg.message === "string" ? msg.message : undefined,
      });
      handlers.onState("listening");
      return;
    }
    if (type === "user.speech_started") {
      handlers.onState("user_speaking");
      return;
    }
    if (type === "user.speech_ended") {
      handlers.onState("processing");
      return;
    }
    if (type === "agent.thinking") {
      handlers.onState("processing");
      return;
    }
    if (type === "agent.speech_started") {
      agentSpeaking = true;
      agentSince = Date.now();
      bargeFrames = 0;
      handlers.onState("agent_speaking");
      return;
    }
    if (type === "agent.speech_ended") {
      agentSpeaking = false;
      handlers.onState("listening");
      return;
    }
    if (type === "interrupted") {
      window.clearTimeout(stash[0]?.timer);
      if (stash[0]) {
        stash[0].parts = [];
        stash[0].bytes = 0;
      }
      stopTrack(agentTrack);
      emitReveal(agentRev, true);
      agentSpeaking = false;
      syncDuck();
      handlers.onState("interrupted");
      return;
    }
    if (type === "transcript") {
      const speaker = msg.speaker === "agent" ? "agent" : "user";
      const rev = speaker === "agent" ? agentRev : userRev;
      rev.pushText(String(msg.text ?? ""), Boolean(msg.isFinal));
      emitReveal(rev);
      return;
    }
    if (type === "error") {
      handlers.onError(String(msg.message ?? msg.error ?? "Call error"));
      handlers.onState("error");
      return;
    }
    if (type === "ended") {
      if (closed) return;
      handlers.onState("ended");
      handlers.onEnded({
        durationMs: Number(msg.durationMs ?? 0),
        provider: String(msg.provider ?? ""),
        fallbackUsed: Boolean(msg.fallbackUsed),
        fallbackReason: typeof msg.fallbackReason === "string" ? msg.fallbackReason : undefined,
        trace: Array.isArray(msg.trace) ? (msg.trace as CallTraceEvent[]) : [],
      });
      cleanup();
    }
  };

  ws.onerror = () => {
    if (closed) return;
    handlers.onError("Could not reach the live call service.");
    handlers.onState("error");
  };
  ws.onclose = () => {
    if (closed) return;
    handlers.onState("ended");
    cleanup();
  };

  return {
    interrupt,
    mute: (on: boolean) => {
      muted = on;
    },
    end: () => {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "end" }));
      cleanup();
      handlers.onState("ended");
    },
  };
}
