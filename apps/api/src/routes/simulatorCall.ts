import type { FastifyInstance } from "fastify";
import { Capability } from "@pyai/core";
import { agentToLiveConfig } from "@pyai/simulator";
import type { AppServices } from "../services.js";
import {
  friendlyProviderError,
  listRealtimeProviders,
  openLiveCall,
  recordCallEvent,
  type LiveCallSession,
} from "../simulator/liveCall.js";
import { runPersonaLoop } from "../simulator/personaCall.js";

type WsSocket = {
  readyState: number;
  send: (data: string | Buffer, opts?: { binary?: boolean }) => void;
  on: (event: string, handler: (...args: unknown[]) => void) => void;
};

const MAX_CHUNK = 64 * 1024;
const MAX_MS = 15 * 60 * 1000;
const PCM_AGENT = 0x01;
const PCM_USER = 0x02;

function sendJson(socket: WsSocket, body: Record<string, unknown>): void {
  if (socket.readyState !== 1) return;
  socket.send(JSON.stringify(body));
}

function sendTaggedPcm(socket: WsSocket, kind: number, pcm: Uint8Array | Buffer): void {
  if (socket.readyState !== 1 || !pcm.length) return;
  const out = Buffer.allocUnsafe(pcm.length + 1);
  out[0] = kind;
  Buffer.from(pcm).copy(out, 1);
  socket.send(out, { binary: true });
}

/** `ws` delivers text frames as Buffer; do not treat JSON start/end as PCM. */
function parseCallFrame(
  raw: unknown,
  isBinary: boolean,
): { kind: "audio"; bytes: Buffer } | { kind: "text"; text: string } {
  if (typeof raw === "string") return { kind: "text", text: raw };
  const bytes = Buffer.isBuffer(raw)
    ? raw
    : raw instanceof ArrayBuffer
      ? Buffer.from(raw)
      : Buffer.from(String(raw));
  if (isBinary) return { kind: "audio", bytes };
  const lead = bytes[0];
  if (lead === 0x7b || lead === 0x5b) return { kind: "text", text: bytes.toString("utf8") };
  return { kind: "audio", bytes };
}

/** Live Simulator call. Browser never receives provider keys. */
export async function simulatorCallRoutes(app: FastifyInstance, svc: AppServices): Promise<void> {
  app.get("/api/simulator/live", async () => ({
    voices: [
      { id: "ava", label: "Ava" },
      { id: "emma", label: "Emma" },
      { id: "dorit", label: "Dorit" },
    ],
    providers: listRealtimeProviders(svc.platform),
    primary: svc.platform.registry.getAdapterFor(Capability.REALTIME_VOICE)?.id ?? "mock",
  }));

  app.get("/ws/simulator/call", { websocket: true }, (socket: WsSocket) => {
    let call: LiveCallSession | undefined;
    let pump: Promise<void> | undefined;
    let personaMode = false;
    let lastAgentText = "";
    let idleGen = 0;
    let speechGen = 0;
    const idleWaiters: Array<() => void> = [];
    const timer = setTimeout(() => {
      void hangup("duration_limit");
    }, MAX_MS);

    const flushWaiters = () => {
      const pending = idleWaiters.splice(0);
      for (const fn of pending) fn();
    };

    const hangup = async (reason: string) => {
      clearTimeout(timer);
      if (call) {
        sendJson(socket, {
          type: "ended",
          reason,
          sessionId: call.sessionId,
          provider: call.provider,
          fallbackUsed: call.fallbackUsed,
          fallbackReason: call.fallbackReason,
          fallbackProvider: call.fallbackProvider,
          durationMs: Date.now() - call.startedAt,
          trace: call.events,
        });
        try {
          await call.handle.close();
        } catch {
          /* ignore */
        }
        call = undefined;
      }
    };

    socket.on("message", (...args: unknown[]) => {
      const raw = args[0];
      const isBinary = args[1] === true;
      void (async () => {
        try {
          const parsed = parseCallFrame(raw, isBinary);
          if (parsed.kind === "audio") {
            if (personaMode) return;
            if (parsed.bytes.length > MAX_CHUNK) return;
            call?.handle.sendAudio(new Uint8Array(parsed.bytes));
            return;
          }
          const text = parsed.text;
          if (text.length > 20_000) {
            sendJson(socket, { type: "error", message: "Message too large." });
            return;
          }
          const msg = JSON.parse(text) as {
            type?: string;
            mode?: string;
            name?: string;
            prompt?: string;
            voice?: string;
            greeting?: string;
            forceProvider?: string;
            agentId?: string;
            version?: number;
            scenarioId?: string;
          };
          if (msg.type === "start") {
            if (call) return;
            personaMode = msg.mode === "persona";
            const stored = msg.agentId ? svc.simulator.getAgent(String(msg.agentId).slice(0, 64)) : undefined;
            const version = Number(msg.version);
            const liveAgent =
              personaMode && stored
                ? agentToLiveConfig(stored, Number.isInteger(version) && version > 0 ? version : undefined)
                : {
                    name: msg.name,
                    prompt: msg.prompt,
                    voice: msg.voice,
                    greeting: msg.greeting,
                    version: stored?.activeVersion ?? 1,
                    agentId: stored?.id,
                  };
            try {
              call = await openLiveCall(svc.platform, liveAgent, { forceProvider: msg.forceProvider });
            } catch (e) {
              sendJson(socket, {
                type: "error",
                message: e instanceof Error ? e.message : "Could not start the call.",
              });
              return;
            }
            app.log.info(
              {
                sessionId: call.sessionId,
                provider: call.provider,
                fallbackUsed: call.fallbackUsed,
                mode: personaMode ? "persona" : "manual",
                agentId: stored?.id,
                attempts: call.attempts.map((a) => ({
                  provider: a.provider,
                  ok: a.ok,
                  reason: a.reason,
                  detail: a.detail,
                })),
              },
              "simulator.live.start",
            );
            sendJson(socket, {
              type: "session",
              sessionId: call.sessionId,
              agentName: call.agent.name,
              version: call.agent.version,
              mode: personaMode ? "persona" : "manual",
              provider: call.provider,
              fallbackUsed: call.fallbackUsed,
              fallbackReason: call.fallbackReason,
              fallbackProvider: call.fallbackProvider,
              attempts: call.attempts.map((a) => ({
                provider: a.provider,
                ok: a.ok,
                reason: a.reason,
              })),
              message: call.fallbackUsed
                ? `${friendlyProviderError(call.fallbackReason)} Switched to ${call.provider}.`
                : undefined,
            });
            const current = call;
            lastAgentText = "";
            idleGen = 0;
            speechGen = 0;
            pump = (async () => {
              for await (const ev of current.handle.events()) {
                if (!call || call.sessionId !== current.sessionId) break;
                recordCallEvent(current, ev);
                if (ev.type === "agent.speech_started") {
                  speechGen += 1;
                  flushWaiters();
                }
                if (ev.type === "agent.speech_ended" || ev.type === "ended") {
                  idleGen += 1;
                  flushWaiters();
                }
                if (ev.type === "transcript" && ev.speaker === "agent" && ev.text) {
                  lastAgentText = ev.isFinal ? ev.text : `${lastAgentText}${ev.text}`.slice(-2_000);
                }
                if (ev.type === "agent.audio" && ev.audio?.length) {
                  sendTaggedPcm(socket, PCM_AGENT, ev.audio);
                  continue;
                }
                sendJson(socket, {
                  type: ev.type,
                  text: ev.text,
                  speaker: ev.speaker,
                  isFinal: ev.isFinal,
                  sampleRate: ev.sampleRate ?? 24_000,
                  error: ev.error,
                });
                if (ev.type === "ended") break;
              }
            })().catch(() => {
              sendJson(socket, { type: "error", message: "The live audio stream failed." });
            });
            if (personaMode) {
              const scenario =
                svc.simulator.getScenario(String(msg.scenarioId ?? "").slice(0, 64)) ??
                svc.simulator.listScenarios()[0];
              if (!scenario) {
                sendJson(socket, { type: "error", message: "No scenario available." });
                return;
              }
              const session = current;
              void runPersonaLoop(svc.platform, session.handle, scenario, {
                stopped: () => !call || call.sessionId !== session.sessionId,
                lastAgentText: () => lastAgentText,
                speechGen: () => speechGen,
                idleGen: () => idleGen,
                waitUntil: (pred, ms) => {
                  if (pred()) return Promise.resolve(true);
                  return new Promise((resolve) => {
                    let done = false;
                    const finish = (ok: boolean) => {
                      if (done) return;
                      done = true;
                      clearTimeout(t);
                      resolve(ok);
                    };
                    const t = setTimeout(() => finish(pred()), ms);
                    const tick = () => {
                      if (done) return;
                      if (pred()) {
                        finish(true);
                        return;
                      }
                      idleWaiters.push(tick);
                    };
                    idleWaiters.push(tick);
                  });
                },
                sendJson: (body) => sendJson(socket, body),
                sendPcm: (pcm) => sendTaggedPcm(socket, PCM_USER, pcm),
              })
                .then(() => hangup("persona_complete"))
                .catch(() => {
                  sendJson(socket, { type: "error", message: "The AI customer stopped unexpectedly." });
                  void hangup("persona_error");
                });
            }
            return;
          }
          if (msg.type === "interrupt") {
            await call?.handle.interrupt();
            return;
          }
          if (msg.type === "end") {
            await hangup("user");
            return;
          }
        } catch {
          sendJson(socket, { type: "error", message: "Invalid call message." });
        }
      })();
    });

    socket.on("close", () => {
      void hangup("disconnect");
      void pump;
    });
  });
}
