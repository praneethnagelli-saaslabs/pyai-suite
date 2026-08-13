import { randomUUID } from "node:crypto";
import type { Capability, ModelInfo, ProviderHealth } from "../types.js";
import {
  type ProviderAdapter,
  type STTAdapter,
  type STTRequest,
  type TranscriptResult,
  type TranscriptSegment,
  type TTSAdapter,
  type TTSResult,
} from "./adapter.js";
import { logger } from "../util/logger.js";

/**
 * PyAI adapter — PRIMARY provider (spec #4).
 *
 * Aligns with https://docs.pyai.com/quickstart:
 *   - OpenAI-compatible API at https://api.pyai.com/v1
 *   - Hear  → POST /v1/audio/transcriptions (model: pyai-hear)
 *   - Hear batch → POST /v1/transcription/jobs (diarize / Recap loop)
 *   - Speak → POST /v1/audio/speech         (model: pyai-voice)
 *   - Health→ GET  /v1/me
 *   - Auth  → Authorization: Bearer <key>  (or x-api-key)
 *
 * Instant sandbox keys (no signup/card): POST /v1/sandbox/keys
 * See mintPyAISandboxKey(). Product code never calls these URLs directly.
 */
export const PYAI_DEFAULT_BASE_URL = "https://api.pyai.com";

export class PyAIProvider implements ProviderAdapter {
  readonly id = "pyai";
  readonly name = "PyAI";
  readonly capabilities: Capability[] = [
    "streaming_stt",
    "batch_stt",
    "speaker_diarization",
    // PyAI is telephony-native voice AI (Hear / Speak / Omni). There is no
    // public /v1/chat/completions — use OpenAI/Gemini/mock for text LLM.
    "tts",
    "streaming_tts",
    "realtime_voice",
    "moderation",
  ];
  private baseUrl: string;
  private key: string | undefined;

  constructor(opts?: { apiKey?: string; baseUrl?: string }) {
    this.key = opts?.apiKey ?? process.env.PYAI_API_KEY;
    // Accept either https://api.pyai.com or https://api.pyai.com/v1
    const raw = (opts?.baseUrl ?? process.env.PYAI_BASE_URL ?? PYAI_DEFAULT_BASE_URL).replace(/\/$/, "");
    this.baseUrl = raw.replace(/\/v1$/, "");
  }

  /** Origin without trailing /v1 — used to build OpenAI-compatible paths. */
  get apiOrigin(): string {
    return this.baseUrl;
  }

  isConfigured(): boolean {
    return Boolean(this.key);
  }

  private authHeaders(json = true): Record<string, string> {
    const h: Record<string, string> = { Authorization: `Bearer ${this.key}` };
    if (json) h["Content-Type"] = "application/json";
    return h;
  }

  async models(): Promise<ModelInfo[]> {
    return [
      {
        id: "pyai-hear",
        provider: "pyai",
        label: "PyAI Hear (STT)",
        capabilities: ["streaming_stt", "batch_stt", "speaker_diarization"],
        supportsStreaming: true,
        audioFormats: ["wav", "mp3", "webm", "opus", "pcm"],
        maxInputSeconds: 3600,
        latencyClass: "low",
        pricing: { audioCostPerMinute: 0.006, currency: "USD" },
      },
      {
        id: "pyai-voice",
        provider: "pyai",
        label: "PyAI Speak (TTS)",
        capabilities: ["tts", "streaming_tts"],
        latencyClass: "low",
        pricing: { audioCostPerMinute: 0.015, currency: "USD" },
      },
      {
        id: "pyai-omni",
        provider: "pyai",
        label: "PyAI Omni (realtime voice agent)",
        capabilities: ["realtime_voice", "tool_calling"],
        supportsStreaming: true,
        latencyClass: "low",
        qualityClass: "high",
      },
    ];
  }

  async health(): Promise<ProviderHealth> {
    if (!this.isConfigured()) return { status: "down", latencyMs: 0, detail: "not configured", checkedAt: Date.now() };
    const t = Date.now();
    try {
      // Docs: GET /v1/me echoes org, scopes, credit posture for the key.
      const r = await fetch(`${this.baseUrl}/v1/me`, { headers: this.authHeaders(false) });
      if (r.ok) return { status: "healthy", latencyMs: Date.now() - t, checkedAt: Date.now() };
      return {
        status: r.status === 401 || r.status === 403 ? "down" : "degraded",
        latencyMs: Date.now() - t,
        detail: `GET /v1/me → ${r.status}`,
        checkedAt: Date.now(),
      };
    } catch (e: unknown) {
      return { status: "down", latencyMs: Date.now() - t, detail: String(e), checkedAt: Date.now() };
    }
  }

  asSTT = (): STTAdapter => {
    const baseUrl = this.baseUrl;
    const key = this.key;
    return {
      transcribe: async (req: STTRequest): Promise<TranscriptResult> => {
        const t = Date.now();
        if (!req.audio?.length) throw new Error("pyai hear: empty audio");
        if (!key) throw new Error("pyai hear: missing API key");

        const sniffed = sniffAudioFormat(req.audio, req.format);
        // Hear accepts wav/mp3/m4a/flac/ogg — not browser MediaRecorder webm.
        if (sniffed.format === "webm") {
          throw new Error(
            "pyai hear does not accept raw webm. The playground converts mic to wav automatically — hard-refresh if you still see this, or upload wav/mp3.",
          );
        }

        if (req.diarize) {
          try {
            const batch = await hearBatchJob(baseUrl, key, req, sniffed);
            logger.debug("pyai: hear batch ok", {
              ms: Date.now() - t,
              format: sniffed.format,
              speakers: batch.segments.filter((s) => s.speaker).length,
            });
            return batch;
          } catch (e) {
            logger.warn("pyai: hear batch failed; falling back to sync", {
              err: String(e).slice(0, 160),
            });
          }
        }

        return hearSync(baseUrl, key, req, sniffed, t);
      },
    };
  };

  asTTS = (): TTSAdapter => {
    const baseUrl = this.baseUrl;
    const key = this.key;
    return {
      synthesize: async (req): Promise<TTSResult> => {
        // Official drop-in example uses mp3 + OpenAI voice aliases (alloy, etc.).
        const format = (req.format ?? "mp3").toLowerCase() === "wav" ? "wav" : "mp3";
        const r = await fetch(`${baseUrl}/v1/audio/speech`, {
          method: "POST",
          headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            model: "pyai-voice",
            input: req.text,
            voice: req.voice ?? "alloy",
            response_format: format,
          }),
        });
        if (!r.ok) throw new Error(`pyai speak ${r.status}: ${await r.text().catch(() => "")}`);
        const buf = new Uint8Array(await r.arrayBuffer());
        if (!buf.length) throw new Error("pyai speak returned empty audio");
        const sniffed = sniffAudioFormat(buf, format);
        return {
          audio: buf,
          format: sniffed.format,
          usage: {
            inputTokens: 0,
            outputTokens: 0,
            audioSeconds: req.text.length / 15,
            costUsd: 0,
            providerCalls: 1,
            cacheHits: 0,
          },
        };
      },
    };
  };
}

/**
 * Mint an instant sandbox key — no signup, email, or card.
 * https://docs.pyai.com/quickstart
 *
 * Never log or return the raw key to a browser UI without an explicit
 * local-dev / onboarding flow; prefer writing it to .env server-side.
 */
export async function mintPyAISandboxKey(
  baseUrl: string = PYAI_DEFAULT_BASE_URL,
): Promise<{ apiKey: string; keyPrefix: string }> {
  const origin = baseUrl.replace(/\/$/, "").replace(/\/v1$/, "");
  const r = await fetch(`${origin}/v1/sandbox/keys`, { method: "POST" });
  if (!r.ok) throw new Error(`pyai sandbox key mint failed: ${r.status}`);
  const data = (await r.json()) as { api_key: string };
  if (!data.api_key) throw new Error("pyai sandbox key response missing api_key");
  const apiKey = data.api_key;
  const keyPrefix = `${apiKey.slice(0, 12)}…`;
  return { apiKey, keyPrefix };
}

const HEAR_BATCH_TIMEOUT_MS = 90_000;

interface HearAudioMeta {
  format: string;
  mime: string;
}

interface HearJobResult {
  text?: string;
  language?: string;
  speakers?: number;
  audio_seconds?: number;
  segments?: Array<{
    id?: string;
    speaker?: string;
    channel?: number;
    start?: number;
    end?: number;
    text?: string;
  }>;
}

interface HearJob {
  job_id?: string;
  status?: string;
  error?: string;
  result?: HearJobResult;
  result_url?: string;
}

async function hearSync(
  baseUrl: string,
  key: string,
  req: STTRequest,
  sniffed: HearAudioMeta,
  startedAt: number,
): Promise<TranscriptResult> {
  const form = new FormData();
  form.append(
    "file",
    new Blob([toArrayBuffer(req.audio)], { type: sniffed.mime }),
    `audio.${sniffed.format}`,
  );
  form.append("model", "pyai-hear");
  if (req.prompt) form.append("prompt", req.prompt);
  const r = await fetch(`${baseUrl}/v1/audio/transcriptions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}` },
    body: form,
  });
  if (!r.ok) {
    const body = await r.text().catch(() => "");
    throw new Error(`pyai hear ${r.status}: ${body.slice(0, 300)}`);
  }
  const data = (await r.json()) as { text: string; segments?: TranscriptResult["segments"]; language?: string };
  const segments =
    data.segments?.length
      ? data.segments
      : [{ id: "s1", start: 0, end: 0, text: data.text }];
  logger.debug("pyai: hear sync ok", { ms: Date.now() - startedAt, format: sniffed.format });
  return {
    segments,
    text: data.text,
    language: data.language,
    usage: { inputTokens: 0, outputTokens: 0, audioSeconds: 0, costUsd: 0, providerCalls: 1, cacheHits: 0 },
  };
}

/** Recap path: async Hear job with speaker diarization (docs: /v1/transcription/jobs). */
async function hearBatchJob(
  baseUrl: string,
  key: string,
  req: STTRequest,
  sniffed: HearAudioMeta,
): Promise<TranscriptResult> {
  const form = new FormData();
  form.append("model", "pyai-hear");
  form.append("audio", new Blob([toArrayBuffer(req.audio)], { type: sniffed.mime }), `call.${sniffed.format}`);
  if (req.channels === 2) form.append("channel", "true");
  else form.append("diarize", "true");
  if (req.prompt) form.append("prompt", req.prompt);

  const submit = await fetch(`${baseUrl}/v1/transcription/jobs`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Idempotency-Key": randomUUID(),
    },
    body: form,
  });
  if (!submit.ok) {
    const body = await submit.text().catch(() => "");
    throw new Error(`pyai hear job ${submit.status}: ${body.slice(0, 300)}`);
  }
  const submitted = (await submit.json()) as HearJob;
  const jobId = submitted.job_id;
  if (!jobId) throw new Error("pyai hear job: missing job_id");

  const job = await waitHearJob(baseUrl, key, jobId, HEAR_BATCH_TIMEOUT_MS);
  const result = await resolveHearResult(job);
  const segments = mapHearSegments(result.segments);
  const text =
    result.text?.trim() ||
    segments.map((s) => (s.speaker ? `${s.speaker}: ${s.text}` : s.text)).join("\n");
  if (!text) throw new Error("pyai hear job returned empty transcript");
  return {
    segments: segments.length ? segments : [{ id: "s1", start: 0, end: 0, text }],
    text,
    language: result.language,
    usage: {
      inputTokens: 0,
      outputTokens: 0,
      audioSeconds: Number(result.audio_seconds ?? 0),
      costUsd: 0,
      providerCalls: 1,
      cacheHits: 0,
    },
  };
}

async function waitHearJob(baseUrl: string, key: string, jobId: string, timeoutMs: number): Promise<HearJob> {
  const started = Date.now();
  let delay = 1000;
  while (Date.now() - started < timeoutMs) {
    const r = await fetch(`${baseUrl}/v1/transcription/jobs/${encodeURIComponent(jobId)}`, {
      headers: { Authorization: `Bearer ${key}` },
    });
    if (!r.ok) {
      const body = await r.text().catch(() => "");
      throw new Error(`pyai hear job poll ${r.status}: ${body.slice(0, 200)}`);
    }
    const job = (await r.json()) as HearJob;
    if (job.status === "completed") return job;
    if (job.status === "failed" || job.status === "cancelled") {
      throw new Error(`pyai hear job ${job.status}: ${String(job.error ?? "no detail").slice(0, 200)}`);
    }
    await new Promise((resolve) => setTimeout(resolve, delay));
    delay = Math.min(delay * 1.5, 5000);
  }
  throw new Error(`pyai hear job ${jobId} timed out`);
}

async function resolveHearResult(job: HearJob): Promise<HearJobResult> {
  if (job.result && (job.result.text || job.result.segments?.length)) return job.result;
  if (job.result_url) {
    const r = await fetch(job.result_url);
    if (!r.ok) throw new Error(`pyai hear result_url ${r.status}`);
    return (await r.json()) as HearJobResult;
  }
  throw new Error("pyai hear job completed without result");
}

function mapHearSegments(raw: HearJobResult["segments"]): TranscriptSegment[] {
  if (!raw?.length) return [];
  return raw.map((s, i) => ({
    id: s.id || `s${i + 1}`,
    speaker: s.speaker || (s.channel != null ? `ch${s.channel}` : undefined),
    start: Number(s.start ?? 0),
    end: Number(s.end ?? 0),
    text: String(s.text ?? "").trim(),
  })).filter((s) => s.text);
}

function mimeForFormat(format?: string): string {
  switch ((format ?? "wav").toLowerCase()) {
    case "mp3":
    case "mpeg":
      return "audio/mpeg";
    case "webm":
      return "audio/webm";
    case "opus":
      return "audio/opus";
    case "ogg":
      return "audio/ogg";
    case "m4a":
    case "mp4":
      return "audio/mp4";
    case "flac":
      return "audio/flac";
    case "pcm":
      return "audio/pcm";
    default:
      return "audio/wav";
  }
}

/** Prefer magic-byte detection over client-claimed format (mic often lies as wav). */
function sniffAudioFormat(audio: Uint8Array, claimed?: string): { format: string; mime: string } {
  if (audio.length >= 4) {
    // RIFF....WAVE
    if (audio[0] === 0x52 && audio[1] === 0x49 && audio[2] === 0x46 && audio[3] === 0x46) {
      return { format: "wav", mime: "audio/wav" };
    }
    // OggS
    if (audio[0] === 0x4f && audio[1] === 0x67 && audio[2] === 0x67 && audio[3] === 0x53) {
      return { format: "ogg", mime: "audio/ogg" };
    }
    // EBML (webm/mkv)
    if (audio[0] === 0x1a && audio[1] === 0x45 && audio[2] === 0xdf && audio[3] === 0xa3) {
      return { format: "webm", mime: "audio/webm" };
    }
    // ID3 tag or MPEG frame sync
    if (
      (audio[0] === 0x49 && audio[1] === 0x44 && audio[2] === 0x33) ||
      (audio[0] === 0xff && (audio[1]! & 0xe0) === 0xe0)
    ) {
      return { format: "mp3", mime: "audio/mpeg" };
    }
    // fLaC
    if (audio[0] === 0x66 && audio[1] === 0x4c && audio[2] === 0x61 && audio[3] === 0x43) {
      return { format: "flac", mime: "audio/flac" };
    }
    // ftyp (m4a/mp4)
    if (audio.length >= 8 && audio[4] === 0x66 && audio[5] === 0x74 && audio[6] === 0x79 && audio[7] === 0x70) {
      return { format: "m4a", mime: "audio/mp4" };
    }
  }
  const format = (claimed ?? "wav").toLowerCase();
  return { format, mime: mimeForFormat(format) };
}

function safeParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    try {
      return JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1));
    } catch {
      return undefined;
    }
  }
}

function toArrayBuffer(audio: Uint8Array | Buffer): ArrayBuffer {
  return audio.buffer.slice(audio.byteOffset, audio.byteOffset + audio.byteLength) as ArrayBuffer;
}
