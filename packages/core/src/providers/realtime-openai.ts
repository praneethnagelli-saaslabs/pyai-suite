import type {
  RealtimeAdapter,
  RealtimeSessionConfig,
  RealtimeSessionHandle,
} from "./adapter.js";
import { EventBus, PCM_RATE, connectWebSocket } from "./realtime-shared.js";

const CONNECT_MS = 8_000;
/** GA speech-to-speech model. Beta `gpt-4o-realtime-preview` is retired. */
const MODEL = "gpt-realtime";

function mapVoice(voice?: string): string {
  const v = (voice ?? "alloy").toLowerCase();
  if (["alloy", "ash", "ballad", "coral", "echo", "sage", "shimmer", "verse"].includes(v)) return v;
  if (v === "emma" || v === "ava") return "shimmer";
  return "alloy";
}

function clip(value: string | undefined, max: number): string {
  return (value ?? "").replace(/[\u0000-\u001f]/g, " ").trim().slice(0, max);
}

function bytesToB64(chunk: Uint8Array): string {
  if (typeof Buffer !== "undefined") return Buffer.from(chunk).toString("base64");
  let bin = "";
  for (const b of chunk) bin += String.fromCharCode(b);
  return btoa(bin);
}

function b64ToBytes(b64: string): Uint8Array {
  if (typeof Buffer !== "undefined") return Uint8Array.from(Buffer.from(b64, "base64"));
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function errorMessage(msg: Record<string, unknown>): string {
  const err = msg.error as { message?: string; code?: string } | undefined;
  return clip(err?.message ?? err?.code ?? String(msg.message ?? "openai error"), 160);
}

/**
 * OpenAI Realtime GA (`/v1/realtime`). No beta header/subprotocol.
 * Key stays on this process; used as Omni fallback only.
 */
export function createOpenAIRealtime(opts: { apiKey?: string; baseUrl?: string }): RealtimeAdapter {
  const key = opts.apiKey;
  const origin = (opts.baseUrl ?? "https://api.openai.com").replace(/\/$/, "");
  const wsOrigin = origin.replace(/^http/, "ws");

  return {
    async startSession(config: RealtimeSessionConfig): Promise<RealtimeSessionHandle> {
      if (!key) throw new Error("openai realtime: not configured");
      const rate = config.sampleRate ?? PCM_RATE;
      const model =
        (config.model ?? process.env.OPENAI_REALTIME_MODEL ?? MODEL).replace(/[^a-zA-Z0-9._-]/g, "") ||
        MODEL;
      const bus = new EventBus();
      let closed = false;
      let agentSpeaking = false;
      let ready = false;
      let resolveReady: () => void = () => {};
      let rejectReady: (err: Error) => void = () => {};
      const handshake = new Promise<void>((resolve, reject) => {
        resolveReady = () => {
          if (ready) return;
          ready = true;
          resolve();
        };
        rejectReady = (err) => {
          if (ready) return;
          reject(err);
        };
      });
      const url = `${wsOrigin}/v1/realtime?model=${encodeURIComponent(model)}`;
      const instructions =
        clip(config.systemPrompt, 8_000) || "You are a helpful voice agent. Be brief and natural.";
      const greeting = clip(config.greeting, 500);

      const ws = await connectWebSocket(
        url,
        ["realtime"],
        CONNECT_MS,
        { Authorization: `Bearer ${key}` },
        (data) => {
          const raw = textFromWsData(data);
          if (!raw) return;
          let msg: Record<string, unknown>;
          try {
            msg = JSON.parse(raw) as Record<string, unknown>;
          } catch {
            return;
          }
          const type = String(msg.type ?? "");
          if (!ready && type === "error") {
            rejectReady(new Error(errorMessage(msg) || "openai realtime: error"));
            return;
          }
          if (type === "session.created" || type === "session.updated") {
            resolveReady();
          }
          handleServerEvent(msg, {
            bus,
            get closed() {
              return closed;
            },
            get agentSpeaking() {
              return agentSpeaking;
            },
            setAgentSpeaking: (v) => {
              agentSpeaking = v;
            },
            rate,
            ready: () => ready,
          });
        },
      );

      try {
        if (!ready) {
          await Promise.race([
            handshake,
            new Promise<never>((_, reject) =>
              setTimeout(() => reject(new Error("openai realtime: timeout")), CONNECT_MS),
            ),
          ]);
        }
      } catch (err) {
        try {
          ws.close();
        } catch {
          /* ignore */
        }
        throw err;
      }

      sendJson(ws, {
        type: "session.update",
        session: {
          type: "realtime",
          model,
          instructions: greeting ? `${instructions}\nGreet the caller with: ${greeting}` : instructions,
          output_modalities: ["audio"],
          audio: {
            input: {
              format: { type: "audio/pcm", rate },
              turn_detection: { type: "server_vad", create_response: true },
            },
            output: {
              format: { type: "audio/pcm", rate },
              voice: mapVoice(config.voice),
            },
          },
        },
      });
      bus.push({ type: "session.started" });
      if (greeting) {
        sendJson(ws, {
          type: "response.create",
          response: {
            output_modalities: ["audio"],
            instructions: `Say exactly: ${greeting}`,
          },
        });
      }

      ws.addEventListener("close", () => {
        if (closed) return;
        closed = true;
        bus.push({ type: "ended" });
        bus.end();
      });
      ws.addEventListener("error", () => {
        if (closed || !ready) return;
        bus.push({ type: "error", error: "connection failed" });
      });

      return {
        sendAudio(chunk: Uint8Array) {
          if (closed || ws.readyState !== WebSocket.OPEN || !chunk.length) return;
          sendJson(ws, { type: "input_audio_buffer.append", audio: bytesToB64(chunk) });
        },
        commitInput() {
          if (closed || ws.readyState !== WebSocket.OPEN) return;
          sendJson(ws, { type: "input_audio_buffer.commit" });
          sendJson(ws, {
            type: "response.create",
            response: { output_modalities: ["audio"] },
          });
        },
        async interrupt() {
          if (closed || ws.readyState !== WebSocket.OPEN) return;
          sendJson(ws, { type: "response.cancel" });
          agentSpeaking = false;
          bus.push({ type: "interrupted" });
        },
        events: () => bus.events(),
        async close() {
          if (closed) return;
          closed = true;
          try {
            ws.close();
          } catch {
            /* ignore */
          }
          bus.push({ type: "ended" });
          bus.end();
        },
      };
    },
  };
}

function handleServerEvent(
  msg: Record<string, unknown>,
  ctx: {
    bus: EventBus;
    closed: boolean;
    agentSpeaking: boolean;
    setAgentSpeaking: (v: boolean) => void;
    rate: number;
    ready: () => boolean;
  },
): void {
  if (ctx.closed) return;
  const type = String(msg.type ?? "");
  if (type === "input_audio_buffer.speech_started") {
    ctx.bus.push({ type: "user.speech_started" });
    if (ctx.agentSpeaking) ctx.bus.push({ type: "interrupted" });
    return;
  }
  if (type === "input_audio_buffer.speech_stopped") {
    ctx.bus.push({ type: "user.speech_ended" });
    return;
  }
  if (type === "conversation.item.input_audio_transcription.completed") {
    const text = clip(String(msg.transcript ?? ""), 4_000);
    if (text) ctx.bus.push({ type: "transcript", speaker: "user", text, isFinal: true });
    return;
  }
  if (type === "response.output_audio_transcript.delta" || type === "response.audio_transcript.delta") {
    const text = clip(String(msg.delta ?? ""), 4_000);
    if (text) ctx.bus.push({ type: "transcript", speaker: "agent", text, isFinal: false });
    return;
  }
  if (type === "response.output_audio_transcript.done" || type === "response.audio_transcript.done") {
    const text = clip(String(msg.transcript ?? ""), 4_000);
    if (text) ctx.bus.push({ type: "transcript", speaker: "agent", text, isFinal: true });
    return;
  }
  if (type === "response.output_audio.delta" || type === "response.audio.delta") {
    const b64 = typeof msg.delta === "string" ? msg.delta : "";
    if (!b64) return;
    if (!ctx.agentSpeaking) {
      ctx.setAgentSpeaking(true);
      ctx.bus.push({ type: "agent.speech_started" });
    }
    try {
      ctx.bus.push({
        type: "agent.audio",
        audio: b64ToBytes(b64),
        format: "pcm16",
        sampleRate: ctx.rate,
      });
    } catch {
      /* ignore bad chunk */
    }
    return;
  }
  if (
    type === "response.output_audio.done" ||
    type === "response.audio.done" ||
    type === "response.done"
  ) {
    if (ctx.agentSpeaking) {
      ctx.setAgentSpeaking(false);
      ctx.bus.push({ type: "agent.speech_ended" });
    }
    return;
  }
  if (type === "error" && ctx.ready()) {
    ctx.bus.push({ type: "error", error: errorMessage(msg) });
  }
}

function textFromWsData(data: unknown): string | null {
  if (typeof data === "string") return data.startsWith("{") || data.startsWith("[") ? data : null;
  if (typeof Buffer !== "undefined" && Buffer.isBuffer(data)) {
    const s = data.toString("utf8");
    return s.startsWith("{") || s.startsWith("[") ? s : null;
  }
  if (data instanceof ArrayBuffer || ArrayBuffer.isView(data)) {
    const bytes = data instanceof ArrayBuffer ? new Uint8Array(data) : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    if (bytes.length === 0 || (bytes[0] !== 0x7b && bytes[0] !== 0x5b)) return null;
    return new TextDecoder().decode(bytes);
  }
  return null;
}

function sendJson(ws: WebSocket, body: Record<string, unknown>): void {
  ws.send(JSON.stringify(body));
}
