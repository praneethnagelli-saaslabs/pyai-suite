import { Capability, type Platform, type RealtimeSessionHandle } from "@pyai/core";
import {
  buildCustomerSystem,
  mockCustomerTurn,
  parseCustomerTurn,
  speakCustomerPcm,
  type Scenario,
} from "@pyai/simulator";

const MAX_TURNS = 8;
const GREETING_MS = 5_000;
const REPLY_MS = 12_000;
const FRAME = 960; // 20 ms at 24 kHz int16
const SILENCE_FRAMES = 25; // 500 ms so VAD / mock can close the turn

export interface PersonaLoopCtl {
  stopped: () => boolean;
  lastAgentText: () => string;
  speechGen: () => number;
  idleGen: () => number;
  waitUntil: (pred: () => boolean, ms: number) => Promise<boolean>;
  sendJson: (body: Record<string, unknown>) => void;
  sendPcm: (pcm: Uint8Array) => void;
}

export async function runPersonaLoop(
  platform: Platform,
  handle: RealtimeSessionHandle,
  scenario: Scenario,
  ctl: PersonaLoopCtl,
): Promise<void> {
  // Let the agent finish its greeting before the customer barges in.
  await ctl.waitUntil(() => ctl.stopped() || ctl.idleGen() > 0, GREETING_MS);
  if (ctl.stopped()) return;

  let agentLast = ctl.lastAgentText();
  for (let turn = 0; turn < MAX_TURNS; turn++) {
    if (ctl.stopped()) return;
    const next =
      turn === 0
        ? { say: scenario.openingLine, end: false, reason: "opening" }
        : await nextCustomerTurn(platform, scenario, turn, agentLast);
    const say = next.say.slice(0, 400);
    if (!say) break;

    const speechSeen = ctl.speechGen();
    const idleSeen = ctl.idleGen();

    ctl.sendJson({ type: "user.speech_started" });

    const spoken = await speakCustomerPcm(platform, say, "emma");
    if (ctl.stopped()) return;
    ctl.sendPcm(spoken.audio);
    const audioMs = Math.max(400, Math.round((spoken.audio.byteLength / 2 / 24_000) * 1000));
    ctl.sendJson({
      type: "transcript",
      speaker: "user",
      text: say,
      isFinal: true,
      source: "ai_customer",
      audioMs,
    });
    await pushPcm(handle, spoken.audio);
    await pushSilence(handle);
    ctl.sendJson({ type: "user.speech_ended" });

    if (next.end) return;
    const started = await ctl.waitUntil(
      () => ctl.stopped() || ctl.speechGen() > speechSeen,
      1_500,
    );
    if (!started && !ctl.stopped()) handle.commitInput?.();
    await ctl.waitUntil(
      () => ctl.stopped() || (ctl.speechGen() > speechSeen && ctl.idleGen() > idleSeen),
      REPLY_MS,
    );
    agentLast = ctl.lastAgentText() || agentLast;
  }
}

async function nextCustomerTurn(
  platform: Platform,
  scenario: Scenario,
  turn: number,
  agentLast: string,
) {
  const scripted = mockCustomerTurn(scenario, turn, agentLast);
  const adapter =
    platform.registry.getAdapterFor(Capability.LLM, "openai") ??
    platform.registry.getAdapterFor(Capability.LLM, "gemini") ??
    platform.registry.getAdapterFor(Capability.LLM);
  if (!adapter?.asLLM || adapter.id === "mock" || !adapter.isConfigured()) return scripted;

  try {
    const res = await adapter.asLLM().complete({
      messages: [
        { role: "system", content: buildCustomerSystem(scenario) },
        {
          role: "user",
          content: `Turn ${turn}. Agent just said: ${agentLast.slice(0, 800) || "(silence)"}\nReply JSON.`,
        },
      ],
      temperature: 0.6,
      maxTokens: 180,
    });
    return parseCustomerTurn(res.text);
  } catch {
    return scripted;
  }
}

async function pushPcm(handle: RealtimeSessionHandle, pcm: Uint8Array): Promise<void> {
  for (let i = 0; i < pcm.length; i += FRAME) {
    handle.sendAudio(pcm.subarray(i, Math.min(pcm.length, i + FRAME)));
    await sleep(20);
  }
}

async function pushSilence(handle: RealtimeSessionHandle): Promise<void> {
  const quiet = new Uint8Array(FRAME);
  for (let i = 0; i < SILENCE_FRAMES; i++) {
    handle.sendAudio(quiet);
    await sleep(20);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
