import type {
  RealtimeAdapter,
  RealtimeSessionConfig,
  RealtimeSessionHandle,
} from "./adapter.js";
import { EventBus, PCM_RATE, tonePcm } from "./realtime-shared.js";

const REPLIES = [
  "I hear you. In demo mode I reply with a short tone instead of a live model.",
  "Got it. Demo mode is working — connect PyAI Omni for a real voice.",
  "Understood. Ask me another question whenever you are ready.",
];

/**
 * Deterministic realtime session for Demo Mode. Speaks the Omni event
 * contract (PCM16 + transcripts + barge-in) without a network.
 */
export class MockRealtimeAdapter implements RealtimeAdapter {
  async startSession(opts: RealtimeSessionConfig): Promise<RealtimeSessionHandle> {
    const bus = new EventBus();
    const sampleRate = opts.sampleRate ?? PCM_RATE;
    let closed = false;
    let speaking = false;
    let pending = 0;
    let replyIdx = 0;
    let utterance = false;
    let gapTimer: ReturnType<typeof setTimeout> | undefined;

    const greeting =
      (opts.greeting ?? "").trim().slice(0, 500) ||
      `Hi, this is ${"the mock agent"}. How can I help you today?`;

    const speak = (text: string, speaker: "agent") => {
      if (closed) return;
      speaking = true;
      bus.push({ type: "agent.thinking" });
      bus.push({ type: "agent.speech_started" });
      bus.push({ type: "transcript", speaker, text, isFinal: true });
      bus.push({
        type: "agent.audio",
        audio: tonePcm(520 + replyIdx * 40, Math.min(1.2, 0.25 + text.length / 80), sampleRate),
        format: "pcm16",
        sampleRate,
      });
      bus.push({ type: "agent.speech_ended" });
      speaking = false;
    };

    queueMicrotask(() => {
      bus.push({ type: "session.started" });
      speak(greeting, "agent");
    });

    const maybeCommit = () => {
      if (closed || pending < sampleRate / 4) return;
      pending = 0;
      utterance = false;
      bus.push({ type: "user.speech_ended" });
      bus.push({
        type: "transcript",
        speaker: "user",
        text: "Hello — (demo transcript)",
        isFinal: true,
      });
      const reply = REPLIES[replyIdx % REPLIES.length]!;
      replyIdx += 1;
      speak(reply, "agent");
    };

    return {
      sendAudio(chunk: Uint8Array) {
        if (closed || !chunk.length) return;
        pending += chunk.byteLength / 2;
        if (!utterance) {
          utterance = true;
          bus.push({ type: "user.speech_started" });
          if (speaking) bus.push({ type: "interrupted" });
        }
        if (gapTimer) clearTimeout(gapTimer);
        gapTimer = setTimeout(maybeCommit, 700);
      },
      commitInput() {
        if (gapTimer) clearTimeout(gapTimer);
        maybeCommit();
      },
      async interrupt() {
        if (closed) return;
        if (gapTimer) clearTimeout(gapTimer);
        bus.push({ type: "interrupted" });
        speaking = false;
        pending = 0;
        utterance = false;
      },
      events: () => bus.events(),
      async close() {
        if (closed) return;
        closed = true;
        if (gapTimer) clearTimeout(gapTimer);
        bus.push({ type: "ended" });
        bus.end();
      },
    };
  }
}
