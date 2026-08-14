import type { Capability, ModelInfo, ProviderHealth } from "../types.js";
import {
  type ProviderAdapter,
  type STTAdapter,
  type STTRequest,
  type TranscriptResult,
  type LLMAdapter,
  type LLMRequest,
  type LLMResult,
  type TTSAdapter,
  type TTSResult,
  type EmbeddingsAdapter,
  type RealtimeAdapter,
} from "./adapter.js";
import { createOpenAIRealtime } from "./realtime-openai.js";
import { logger } from "../util/logger.js";

/**
 * OpenAI adapter — alternative provider (spec #5). Activates on OPENAI_API_KEY.
 * Implements the same capability interfaces so routing/fallback can use it.
 */
export class OpenAIProvider implements ProviderAdapter {
  readonly id = "openai";
  readonly name = "OpenAI";
  readonly capabilities: Capability[] = [
    "streaming_stt",
    "batch_stt",
    "llm",
    "reasoning_llm",
    "structured_output",
    "tool_calling",
    "tts",
    "streaming_tts",
    "realtime_voice",
    "embeddings",
  ];
  private key: string | undefined;
  private baseUrl: string;

  constructor(opts?: { apiKey?: string; baseUrl?: string }) {
    this.key = opts?.apiKey ?? process.env.OPENAI_API_KEY;
    this.baseUrl = opts?.baseUrl ?? "https://api.openai.com";
  }

  isConfigured(): boolean {
    return Boolean(this.key);
  }

  async models(): Promise<ModelInfo[]> {
    return [
      { id: "whisper-1", provider: "openai", label: "Whisper (STT)", capabilities: ["streaming_stt", "batch_stt"], supportsStreaming: true, audioFormats: ["wav", "mp3", "webm"], latencyClass: "medium", pricing: { audioCostPerMinute: 0.006, currency: "USD" } },
      { id: "gpt-4o-transcribe-diarize", provider: "openai", label: "GPT-4o Transcribe Diarize", capabilities: ["batch_stt"], supportsStreaming: false, audioFormats: ["wav", "mp3", "webm"], latencyClass: "medium", pricing: { audioCostPerMinute: 0.006, currency: "USD" } },
      { id: "gpt-4o-mini", provider: "openai", label: "GPT-4o mini (LLM)", capabilities: ["llm", "structured_output", "tool_calling"], contextWindow: 128_000, latencyClass: "low", qualityClass: "medium", pricing: { inputCostPerUnit: 0.00000015, outputCostPerUnit: 0.0000006, currency: "USD" } },
      { id: "gpt-4o", provider: "openai", label: "GPT-4o (reasoning)", capabilities: ["llm", "reasoning_llm", "structured_output"], contextWindow: 128_000, latencyClass: "medium", qualityClass: "high", pricing: { inputCostPerUnit: 0.000005, outputCostPerUnit: 0.000015, currency: "USD" } },
      { id: "tts-1", provider: "openai", label: "TTS-1 (TTS)", capabilities: ["tts", "streaming_tts"], latencyClass: "low", pricing: { audioCostPerMinute: 0.015, currency: "USD" } },
      { id: "text-embedding-3-small", provider: "openai", label: "Embeddings 3-small", capabilities: ["embeddings"], latencyClass: "low", pricing: { inputCostPerUnit: 0.00000002, currency: "USD" } },
    ];
  }

  async health(): Promise<ProviderHealth> {
    if (!this.isConfigured()) return { status: "down", latencyMs: 0, detail: "not configured", checkedAt: Date.now() };
    const t = Date.now();
    try {
      const r = await fetch(`${this.baseUrl}/v1/models`, { headers: { Authorization: `Bearer ${this.key}` } });
      return { status: r.ok ? "healthy" : "degraded", latencyMs: Date.now() - t, checkedAt: Date.now() };
    } catch (e: unknown) {
      return { status: "down", latencyMs: Date.now() - t, detail: String(e), checkedAt: Date.now() };
    }
  }

  asSTT = (): STTAdapter => {
    const baseUrl = this.baseUrl;
    const key = this.key;
    return {
      transcribe: async (req: STTRequest): Promise<TranscriptResult> => {
        const format = (req.format ?? "wav").toLowerCase();
        const mime =
          format === "mp3" || format === "mpeg" || format === "mpga"
            ? "audio/mpeg"
            : format === "webm"
              ? "audio/webm"
              : format === "ogg" || format === "opus"
                ? "audio/ogg"
                : format === "m4a" || format === "mp4" || format === "aac"
                  ? "audio/mp4"
                  : format === "flac"
                    ? "audio/flac"
                    : "audio/wav";
        const fileBlob = new Blob([toArrayBuffer(req.audio)], { type: mime });

        // gpt-4o-transcribe-diarize is slow on short Meet slices — use whisper-1 there.
        if (req.diarize && audioLongEnoughForDiarize(req.audio, format)) {
          try {
            return await transcribeDiarized(baseUrl, key!, fileBlob, format);
          } catch (e) {
            logger.warn("openai diarize failed; falling back to whisper-1", {
              err: e instanceof Error ? e.message.slice(0, 160) : String(e),
            });
          }
        }

        const form = new FormData();
        form.append("file", fileBlob, `audio.${format}`);
        form.append("model", "whisper-1");
        form.append("temperature", "0");
        if (req.prompt) form.append("prompt", req.prompt);
        const r = await fetch(`${baseUrl}/v1/audio/transcriptions`, {
          method: "POST",
          headers: { Authorization: `Bearer ${key}` },
          body: form,
          signal: AbortSignal.timeout(45_000),
        });
        if (!r.ok) throw new Error(`openai stt ${r.status}: ${await r.text().catch(() => "")}`);
        const data = (await r.json()) as { text: string };
        const segments = [{ id: "s1", start: 0, end: 0, text: data.text }];
        return {
          segments,
          text: data.text,
          usage: {
            inputTokens: 0,
            outputTokens: 0,
            audioSeconds: 0,
            costUsd: 0.006 / 60,
            providerCalls: 1,
            cacheHits: 0,
          },
        };
      },
    };
  };

  asLLM = (): LLMAdapter => {
    const baseUrl = this.baseUrl;
    const key = this.key;
    return {
      complete: async (req: LLMRequest): Promise<LLMResult> => {
        const body: Record<string, unknown> = {
          model: req.model ?? "gpt-4o-mini",
          messages: req.messages,
          temperature: req.temperature ?? 0.2,
          max_tokens: req.maxTokens,
        };
        if (req.jsonSchema) {
          const schema = req.jsonSchema as Record<string, unknown>;
          if (schema.type === "object" && schema.properties) {
            body.response_format = {
              type: "json_schema",
              json_schema: {
                name: "structured_output",
                // OpenAI strict mode forbids optional properties; keep schema guidance without strict.
                strict: false,
                schema,
              },
            };
          } else {
            body.response_format = { type: "json_object" };
          }
        }
        const r = await fetch(`${baseUrl}/v1/chat/completions`, {
          method: "POST",
          headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!r.ok) throw new Error(`openai chat ${r.status}: ${await r.text().catch(() => "")}`);
        const data = (await r.json()) as {
          choices: Array<{ message: { content: string } }>;
          usage?: { prompt_tokens: number; completion_tokens: number };
        };
        const text = data.choices[0]?.message.content ?? "";
        const parsed = req.jsonSchema ? safeParse(text) : undefined;
        return {
          text,
          model: req.model ?? "gpt-4o-mini",
          parsed,
          usage: {
            inputTokens: data.usage?.prompt_tokens ?? 0,
            outputTokens: data.usage?.completion_tokens ?? 0,
            audioSeconds: 0,
            costUsd: 0,
            providerCalls: 1,
            cacheHits: 0,
          },
        };
      },
    };
  };

  asTTS = (): TTSAdapter => {
    const baseUrl = this.baseUrl;
    const key = this.key;
    return {
      synthesize: async (req): Promise<TTSResult> => {
        const format = req.format ?? "mp3";
        const r = await fetch(`${baseUrl}/v1/audio/speech`, {
          method: "POST",
          headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            model: req.model ?? "tts-1",
            input: req.text,
            voice: req.voice ?? "alloy",
            response_format: format === "wav" ? "wav" : format,
            ...(typeof req.speed === "number" ? { speed: req.speed } : {}),
          }),
        });
        if (!r.ok) throw new Error(`openai tts ${r.status}: ${await r.text().catch(() => "")}`);
        const buf = new Uint8Array(await r.arrayBuffer());
        return {
          audio: buf,
          format,
          usage: {
            inputTokens: 0,
            outputTokens: 0,
            audioSeconds: req.text.length / 15,
            costUsd: (0.015 * (req.text.length / 15)) / 60,
            providerCalls: 1,
            cacheHits: 0,
          },
        };
      },
    };
  };

  asRealtime = (): RealtimeAdapter => createOpenAIRealtime({ apiKey: this.key, baseUrl: this.baseUrl });

  asEmbeddings = (): EmbeddingsAdapter => {
    const baseUrl = this.baseUrl;
    const key = this.key;
    return {
      embed: async (req) => {
        const input = Array.isArray(req.input) ? req.input : [req.input];
        const r = await fetch(`${baseUrl}/v1/embeddings`, { method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, body: JSON.stringify({ model: "text-embedding-3-small", input }) });
        if (!r.ok) throw new Error(`openai embed ${r.status}`);
        const data = (await r.json()) as { data: Array<{ embedding: number[] }> };
        return { embeddings: data.data.map((d) => d.embedding), usage: { inputTokens: 0, outputTokens: 0, audioSeconds: 0, costUsd: 0, providerCalls: 1, cacheHits: 0 } };
      },
    };
  };
}

function safeParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}
function toArrayBuffer(audio: Uint8Array | Buffer): ArrayBuffer {
  return audio.buffer.slice(audio.byteOffset, audio.byteOffset + audio.byteLength) as ArrayBuffer;
}

/** ~10s of 16 kHz mono WAV. Shorter slices use whisper-1 (faster). */
function audioLongEnoughForDiarize(audio: Uint8Array, format: string): boolean {
  const min = format === "wav" || format === "pcm" ? 320_000 : 80_000;
  return audio.byteLength >= min;
}

async function transcribeDiarized(
  baseUrl: string,
  key: string,
  fileBlob: Blob,
  format: string,
): Promise<TranscriptResult> {
  const form = new FormData();
  form.append("file", fileBlob, `audio.${format}`);
  form.append("model", "gpt-4o-transcribe-diarize");
  form.append("response_format", "diarized_json");
  // Required for inputs longer than ~30s; harmless on shorter Meet chunks.
  form.append("chunking_strategy", "auto");

  const r = await fetch(`${baseUrl}/v1/audio/transcriptions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}` },
    body: form,
    signal: AbortSignal.timeout(75_000),
  });
  if (!r.ok) throw new Error(`openai diarize ${r.status}: ${await r.text().catch(() => "")}`);

  const data = (await r.json()) as {
    text?: string;
    segments?: Array<{ id?: string | number; speaker?: string; start?: number; end?: number; text?: string }>;
  };

  const segments = (data.segments ?? [])
    .map((s, i) => ({
      id: String(s.id ?? `s${i + 1}`),
      speaker: normalizeSpeaker(s.speaker),
      start: s.start ?? 0,
      end: s.end ?? 0,
      text: (s.text ?? "").trim(),
    }))
    .filter((s) => s.text.length > 0);

  const text =
    segments.length > 0
      ? segments.map((s) => `${s.speaker ?? "Speaker"}: ${s.text}`).join("\n")
      : (data.text ?? "").trim();

  if (!text) throw new Error("openai diarize returned empty transcript");

  return {
    segments: segments.length
      ? segments
      : [{ id: "s1", start: 0, end: 0, text }],
    text,
    usage: {
      inputTokens: 0,
      outputTokens: 0,
      audioSeconds: 0,
      costUsd: 0.006 / 60,
      providerCalls: 1,
      cacheHits: 0,
    },
  };
}

/** Map API speakers (A/B/SPEAKER_00) to readable labels. */
function normalizeSpeaker(raw?: string): string {
  if (!raw) return "Speaker";
  const t = raw.trim();
  if (/^speaker\s*\d+$/i.test(t)) return t.replace(/\s+/g, " ");
  if (/^[A-Z]$/i.test(t)) return `Speaker ${t.toUpperCase()}`;
  if (/^SPEAKER_(\d+)$/i.test(t)) {
    const n = Number(t.match(/(\d+)/)?.[1] ?? 0) + 1;
    return `Speaker ${n}`;
  }
  return t;
}
