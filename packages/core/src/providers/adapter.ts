import type { Capability, ProviderHealth, ProviderId, ModelInfo, Usage } from "../types.js";

/**
 * Provider adapter interfaces (spec #110). Product code NEVER calls a vendor
 * SDK directly — it calls these capability-shaped interfaces. A provider
 * adapter implements only the capabilities it supports. Adding a new vendor is
 * "implement these methods + register", with zero changes to product code.
 */

export interface TranscriptSegment {
  id: string;
  speaker?: string;
  start: number; // seconds
  end: number; // seconds
  text: string;
}

export interface TranscriptResult {
  segments: TranscriptSegment[];
  text: string;
  language?: string;
  usage: Usage;
}

export interface STTRequest {
  audio: Buffer | Uint8Array;
  format?: string; // wav | mp3 | webm | opus | pcm
  sampleRate?: number;
  channels?: number;
  diarize?: boolean;
  prompt?: string;
}

export interface STTPartial {
  text: string;
  isFinal: boolean;
  segment?: TranscriptSegment;
}

export interface STTAdapter {
  transcribe(req: STTRequest): Promise<TranscriptResult>;
  streamTranscribe?(req: STTRequest): AsyncIterable<STTPartial>;
}

export interface LLMMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface LLMRequest {
  messages: LLMMessage[];
  model?: string;
  temperature?: number;
  maxTokens?: number;
  /** When present, request structured output; adapter validates it. */
  jsonSchema?: Record<string, unknown>;
  promptVersion?: string;
}

export interface LLMResult {
  text: string;
  model: string;
  usage: Usage;
  /** Parsed JSON when jsonSchema was requested and the model complied. */
  parsed?: unknown;
}

export interface LLMAdapter {
  complete(req: LLMRequest): Promise<LLMResult>;
  streamComplete?(req: LLMRequest): AsyncIterable<string>;
}

export interface TTSRequest {
  text: string;
  voice?: string;
  format?: string;
  /** Provider-specific model id (e.g. openai `tts-1-hd`). */
  model?: string;
  /** Playback rate when supported (openai speech API). */
  speed?: number;
}

export interface TTSResult {
  audio: Uint8Array;
  format: string;
  usage: Usage;
}

export interface TTSAdapter {
  synthesize(req: TTSRequest): Promise<TTSResult>;
}

export interface EmbeddingsRequest {
  input: string | string[];
}

export interface EmbeddingsResult {
  embeddings: number[][];
  usage: Usage;
}

export interface EmbeddingsAdapter {
  embed(req: EmbeddingsRequest): Promise<EmbeddingsResult>;
}

export interface RealtimeSessionHandle {
  sendAudio(chunk: Uint8Array): void;
  events(): AsyncIterable<RealtimeEvent>;
  close(): Promise<void>;
}

export interface RealtimeEvent {
  type: string;
  text?: string;
}

export interface RealtimeAdapter {
  startSession(opts: { model?: string; systemPrompt?: string }): Promise<RealtimeSessionHandle>;
}

/**
 * A provider adapter aggregates one or more capability adapters. The registry
 * queries `capabilities` to decide which adapter satisfies a given task.
 */
export interface ProviderAdapter {
  readonly id: ProviderId;
  readonly name: string;
  readonly capabilities: Capability[];
  isConfigured(): boolean;
  models(): Promise<ModelInfo[]>;
  health(): Promise<ProviderHealth>;

  asSTT?(): STTAdapter;
  asLLM?(): LLMAdapter;
  asTTS?(): TTSAdapter;
  asEmbeddings?(): EmbeddingsAdapter;
  asRealtime?(): RealtimeAdapter;
}
