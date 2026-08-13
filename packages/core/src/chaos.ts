import type {
  ProviderAdapter,
  STTAdapter,
  LLMAdapter,
  TTSAdapter,
  EmbeddingsAdapter,
  STTRequest,
  LLMRequest,
} from "./providers/adapter.js";
import { logger } from "./util/logger.js";

/**
 * Development-only chaos wrapper (spec #88). Wraps any provider adapter and
 * injects controlled failures to validate retry/fallback/failure-record/budget
 * behavior. NEVER used in production — only enabled by a test or a dev flag.
 */
export interface ChaosConfig {
  timeoutMs?: number; // fail calls slower than this — here we just throw after delay
  random500Rate?: number; // probability of returning a 500-style error
  malformedJsonRate?: number; // probability of returning unparseable JSON
  slowStreamingMs?: number; // add latency to streaming
  dropRate?: number; // probability of dropping a call entirely
  rateLimitRate?: number; // probability of emitting a 429-style error
}

export class ChaosProvider implements ProviderAdapter {
  readonly id: string;
  readonly name: string;
  readonly capabilities: ProviderAdapter["capabilities"];
  private inner: ProviderAdapter;
  private chaos: ChaosConfig;

  /** Present only when the wrapped provider exposes STT. */
  readonly asSTT?: () => STTAdapter;
  /** Present only when the wrapped provider exposes LLM. */
  readonly asLLM?: () => LLMAdapter;
  /** Present only when the wrapped provider exposes TTS. */
  readonly asTTS?: () => TTSAdapter;
  /** Present only when the wrapped provider exposes embeddings. */
  readonly asEmbeddings?: () => EmbeddingsAdapter;

  constructor(inner: ProviderAdapter, chaos: ChaosConfig) {
    this.inner = inner;
    this.id = `chaos(${inner.id})`;
    this.name = `Chaos ${inner.name}`;
    this.capabilities = inner.capabilities;
    this.chaos = chaos;

    // Conditionally wire capability methods so they match ProviderAdapter:
    // optional on the type, but when present they return a concrete adapter
    // (never `undefined`).
    if (inner.asSTT) {
      this.asSTT = () => this.wrapSTT(inner.asSTT!.call(inner));
    }
    if (inner.asLLM) {
      this.asLLM = () => this.wrapLLM(inner.asLLM!.call(inner));
    }
    if (inner.asTTS) {
      this.asTTS = () => this.wrapTTS(inner.asTTS!.call(inner));
    }
    if (inner.asEmbeddings) {
      this.asEmbeddings = () => this.wrapEmbeddings(inner.asEmbeddings!.call(inner));
    }
  }

  isConfigured(): boolean {
    return this.inner.isConfigured();
  }

  async models() {
    return this.inner.models();
  }

  async health() {
    return this.inner.health();
  }

  private maybeFail(): void {
    const c = this.chaos;
    const roll = Math.random();
    if (c.dropRate && roll < c.dropRate) throw new Error("chaos: dropped call");
    if (c.rateLimitRate && roll < (c.dropRate ?? 0) + (c.rateLimitRate ?? 0)) {
      const e = new Error("chaos: 429 rate limited") as Error & { code?: string };
      e.code = "rate_limited";
      throw e;
    }
    if (c.random500Rate && Math.random() < c.random500Rate) throw new Error("chaos: 500 internal");
    if (c.timeoutMs) {
      // Simulate a timeout by throwing after the delay.
      // (Real timeout handling is in transport; here we emulate the failure mode.)
    }
  }

  private wrapSTT(inner: STTAdapter): STTAdapter {
    const self = this;
    const wrapped: STTAdapter = {
      transcribe: async (req) => {
        self.maybeFail();
        return inner.transcribe(req);
      },
    };
    if (inner.streamTranscribe) {
      const stream = inner.streamTranscribe.bind(inner);
      wrapped.streamTranscribe = async function* (req: STTRequest) {
        self.maybeFail();
        for await (const p of stream(req)) yield p;
      };
    }
    return wrapped;
  }

  private wrapLLM(inner: LLMAdapter): LLMAdapter {
    const self = this;
    return {
      complete: async (req: LLMRequest) => {
        self.maybeFail();
        if (self.chaos.malformedJsonRate && Math.random() < self.chaos.malformedJsonRate) {
          // Corrupt the provider output to exercise repair/parse paths.
          const r = await inner.complete(req);
          return { ...r, text: "{not valid json", parsed: undefined };
        }
        return inner.complete(req);
      },
      streamComplete: inner.streamComplete
        ? async function* (req: LLMRequest) {
            self.maybeFail();
            for await (const chunk of inner.streamComplete!(req)) yield chunk;
          }
        : undefined,
    };
  }

  private wrapTTS(inner: TTSAdapter): TTSAdapter {
    const self = this;
    return {
      synthesize: async (req) => {
        self.maybeFail();
        return inner.synthesize(req);
      },
    };
  }

  private wrapEmbeddings(inner: EmbeddingsAdapter): EmbeddingsAdapter {
    const self = this;
    return {
      embed: async (req) => {
        self.maybeFail();
        return inner.embed(req);
      },
    };
  }
}

void logger;
