import type {
  RealtimeAdapter,
  RealtimeSessionConfig,
  RealtimeSessionHandle,
} from "./adapter.js";
import {
  EventBus,
  OMNI_KIND,
  PCM_RATE,
  connectWebSocket,
  frameBytes,
  isWsSubprotocol,
  taggedFrame,
} from "./realtime-shared.js";

const CONNECT_MS = 8_000;

function mapVoice(voice?: string): string {
  const v = (voice ?? "ava").toLowerCase().replace(/[^a-z0-9_]/g, "");
  if (v.startsWith("stock_")) return v.slice(0, 64);
  if (v === "emma") return "stock_emma_en_gb";
  if (v === "dorit") return "stock_dorit_en_us";
  if (v === "alloy" || v === "shimmer" || v === "nova") return "stock_ava_en_us";
  return "stock_ava_en_us";
}

function clip(value: string | undefined, max: number): string {
  return (value ?? "").replace(/[\u0000-\u001f]/g, " ").trim().slice(0, max);
}

/**
 * PyAI Omni — native kind-byte WebSocket. Keys stay on this process.
 */
export function createPyAIRealtime(opts: { apiKey?: string; baseUrl?: string }): RealtimeAdapter {
  const key = opts.apiKey;
  const origin = (opts.baseUrl ?? "https://api.pyai.com").replace(/\/$/, "").replace(/\/v1$/, "");
  const wsOrigin = origin.replace(/^http/, "ws");

  return {
    async startSession(config: RealtimeSessionConfig): Promise<RealtimeSessionHandle> {
      if (!key) throw new Error("pyai omni: not configured");
      const rate = config.sampleRate ?? PCM_RATE;
      const label = clip(config.sessionLabel, 64).replace(/[^a-zA-Z0-9_-]/g, "") || undefined;
      const qs = new URLSearchParams({ format: "pcm16", rate: String(rate) });
      if (label) qs.set("session_label", label);
      const url = `${wsOrigin}/v1/omni?${qs.toString()}`;
      const bus = new EventBus();
      let closed = false;
      let agentSpeaking = false;
      let handshakeError: Error | undefined;
      let configured = false;
      let resolveConfigured: () => void = () => {};
      const configuredAt = new Promise<void>((resolve) => {
        resolveConfigured = () => {
          configured = true;
          resolve();
        };
      });

      const proto = `pyai-key.${key}`;
      const ws = await connectWebSocket(
        url,
        isWsSubprotocol(proto) ? [proto] : [],
        CONNECT_MS,
        { Authorization: `Bearer ${key}`, "x-api-key": key },
        (data) => {
          if (closed) return;
          const buf = frameBytes(data);
          if (!buf?.length) return;
          const kind = buf[0]!;
          const body = buf.subarray(1);
          if (kind === OMNI_KIND.CONTROL) {
            const peek = peekControl(body);
            if (peek.event === "error" && !configured) {
              handshakeError = new Error(peek.message || "pyai omni: error");
            }
            if (
              peek.event === "hello" ||
              peek.event === "session_started" ||
              peek.event === "configured"
            ) {
              resolveConfigured();
            }
          }
          handleInbound(kind, body, {
            bus,
            rate,
            get agentSpeaking() {
              return agentSpeaking;
            },
            setAgentSpeaking: (v) => {
              agentSpeaking = v;
            },
            get closed() {
              return closed;
            },
          });
        },
      );

      const persona = clip(config.systemPrompt, 8_000) || "You are a helpful voice agent. Be brief and natural.";
      const greeting = clip(config.greeting, 500);
      const configure: Record<string, string> = {
        type: "configure",
        voice_id: mapVoice(config.voice),
        persona,
      };
      if (greeting) configure.greeting = greeting;
      ws.send(taggedFrame(OMNI_KIND.CONTROL, JSON.stringify(configure)));

      await Promise.race([configuredAt, sleep(2_000)]);
      if (handshakeError) {
        try {
          ws.close();
        } catch {
          /* ignore */
        }
        throw handshakeError;
      }
      bus.push({ type: "session.started" });

      ws.addEventListener("close", () => {
        if (closed) return;
        closed = true;
        bus.push({ type: "ended" });
        bus.end();
      });
      ws.addEventListener("error", () => {
        if (closed) return;
        bus.push({ type: "error", error: "connection failed" });
      });

      return {
        sendAudio(chunk: Uint8Array) {
          if (closed || ws.readyState !== WebSocket.OPEN || !chunk.length) return;
          ws.send(taggedFrame(OMNI_KIND.AUDIO, chunk));
        },
        async interrupt() {
          if (closed || ws.readyState !== WebSocket.OPEN) return;
          ws.send(taggedFrame(OMNI_KIND.CONTROL, JSON.stringify({ type: "interrupt" })));
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

function peekControl(body: Uint8Array): { event: string; message: string } {
  try {
    const msg = JSON.parse(new TextDecoder().decode(body)) as Record<string, unknown>;
    return {
      event: String(msg.event ?? ""),
      message: clipText(msg.message ?? msg.error),
    };
  } catch {
    return { event: "", message: "" };
  }
}

function handleInbound(
  kind: number,
  body: Uint8Array,
  ctx: {
    bus: EventBus;
    rate: number;
    agentSpeaking: boolean;
    setAgentSpeaking: (v: boolean) => void;
    closed: boolean;
  },
): void {
  if (ctx.closed) return;
  if (kind === OMNI_KIND.AUDIO) {
    if (!ctx.agentSpeaking) {
      ctx.setAgentSpeaking(true);
      ctx.bus.push({ type: "agent.speech_started" });
    }
    ctx.bus.push({ type: "agent.audio", audio: body, format: "pcm16", sampleRate: ctx.rate });
    return;
  }
  if (kind === OMNI_KIND.TRANSCRIPT) {
    const text = new TextDecoder().decode(body).trim();
    if (text) ctx.bus.push({ type: "transcript", speaker: "user", text, isFinal: false });
    return;
  }
  if (kind !== OMNI_KIND.CONTROL) return;
  let msg: Record<string, unknown>;
  try {
    msg = JSON.parse(new TextDecoder().decode(body)) as Record<string, unknown>;
  } catch {
    return;
  }
  const event = String(msg.event ?? "");
  if (event === "flush") {
    ctx.setAgentSpeaking(false);
    ctx.bus.push({ type: "interrupted" });
    return;
  }
  if (event === "transcript" || event === "agent_transcript") {
    const text = clipText(msg.text ?? msg.delta);
    const speaker = event === "agent_transcript" || msg.role === "agent" ? "agent" : "user";
    if (text) ctx.bus.push({ type: "transcript", speaker, text, isFinal: Boolean(msg.final ?? msg.is_final) });
    return;
  }
  if (event === "session_end") {
    ctx.bus.push({ type: "ended" });
    ctx.bus.end();
    return;
  }
  if (event === "error") {
    ctx.bus.push({ type: "error", error: clipText(msg.message ?? msg.error) || "provider error" });
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function clipText(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.replace(/[\u0000-\u001f]/g, " ").trim().slice(0, 4_000);
}
