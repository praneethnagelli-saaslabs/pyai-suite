/**
 * Core type vocabulary for the PyAI Suite platform.
 *
 * Every capability, provider, workflow, gate and run is described with these
 * types. Product code and provider adapters share this vocabulary so that a
 * new provider or product never has to modify another module.
 */

import { z } from "zod";

// ---------------------------------------------------------------------------
// Capabilities — the verbs of the platform, not the vendors.
// ---------------------------------------------------------------------------

export const Capability = {
  STREAMING_STT: "streaming_stt",
  BATCH_STT: "batch_stt",
  SPEAKER_DIARIZATION: "speaker_diarization",
  LLM: "llm",
  REASONING_LLM: "reasoning_llm",
  STRUCTURED_OUTPUT: "structured_output",
  TOOL_CALLING: "tool_calling",
  VISION: "vision",
  TTS: "tts",
  STREAMING_TTS: "streaming_tts",
  REALTIME_VOICE: "realtime_voice",
  EMBEDDINGS: "embeddings",
  RERANKING: "reranking",
  TRANSLATION: "translation",
  MODERATION: "moderation",
} as const;

export type Capability = (typeof Capability)[keyof typeof Capability];

export const ALL_CAPABILITIES: readonly Capability[] = Object.values(Capability);

// ---------------------------------------------------------------------------
// Providers & models
// ---------------------------------------------------------------------------

export type ProviderId = string;

export interface ProviderHealth {
  status: "healthy" | "degraded" | "down";
  latencyMs: number;
  detail?: string;
  checkedAt: number;
}

export interface ModelPricing {
  /** USD per 1 input token for text, or per second of audio for audio. */
  inputCostPerUnit?: number;
  outputCostPerUnit?: number;
  /** For audio capabilities: USD per minute. */
  audioCostPerMinute?: number;
  currency: "USD";
}

export interface ModelInfo {
  id: string;
  provider: ProviderId;
  label: string;
  capabilities: Capability[];
  contextWindow?: number;
  /** Quality / latency classification buckets used by routing policies. */
  qualityClass?: "low" | "medium" | "high" | "frontier";
  latencyClass?: "low" | "medium" | "high";
  pricing?: ModelPricing;
  supportsStreaming?: boolean;
  supportsStructuredOutput?: boolean;
  supportsToolCalling?: boolean;
  /** Audio codecs/formats accepted by the model. */
  audioFormats?: string[];
  maxInputSeconds?: number;
  metadata?: Record<string, unknown>;
}

export interface AIProvider {
  readonly id: ProviderId;
  readonly name: string;
  readonly capabilities: Capability[];
  /** Whether the adapter can actually issue calls (credentials present). */
  isConfigured(): boolean;
  models(): Promise<ModelInfo[]>;
  health(): Promise<ProviderHealth>;
}

// ---------------------------------------------------------------------------
// Usage / budgets
// ---------------------------------------------------------------------------

export interface Usage {
  inputTokens: number;
  outputTokens: number;
  audioSeconds: number;
  /** Computed cost in USD. */
  costUsd: number;
  providerCalls: number;
  cacheHits: number;
}

export const ZERO_USAGE: Usage = {
  inputTokens: 0,
  outputTokens: 0,
  audioSeconds: 0,
  costUsd: 0,
  providerCalls: 0,
  cacheHits: 0,
};

export function addUsage(a: Usage, b: Usage): Usage {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    audioSeconds: a.audioSeconds + b.audioSeconds,
    costUsd: a.costUsd + b.costUsd,
    providerCalls: a.providerCalls + b.providerCalls,
    cacheHits: a.cacheHits + b.cacheHits,
  };
}

export interface Budget {
  maxDurationMs: number;
  maxTokens: number;
  maxAudioMinutes: number;
  maxCostUsd: number;
  maxRetries: number;
  maxParallelTasks: number;
}

export const DEFAULT_BUDGET: Budget = {
  maxDurationMs: 120_000,
  maxTokens: 200_000,
  maxAudioMinutes: 60,
  maxCostUsd: 0.5,
  maxRetries: 4,
  maxParallelTasks: 8,
};

export type BudgetViolation =
  | "max_duration"
  | "max_tokens"
  | "max_audio_minutes"
  | "max_cost"
  | "max_parallel_tasks";

// ---------------------------------------------------------------------------
// Run lifecycle
// ---------------------------------------------------------------------------

export type RunStatus =
  | "QUEUED"
  | "RUNNING"
  | "PARTIAL"
  | "SUCCEEDED"
  | "FAILED"
  | "CANCELLED"
  | "TIMEOUT"
  | "BUDGET_EXCEEDED";

export type TaskStatus = "PENDING" | "RUNNING" | "DONE" | "FAILED" | "SKIPPED";

// ---------------------------------------------------------------------------
// Evidence / provenance (spec #12, #129) — every claim is traceable.
// ---------------------------------------------------------------------------

export interface EvidenceSpan {
  sourceId: string;
  start?: number; // seconds
  end?: number; // seconds
  speaker?: string;
  segmentRef?: string; // e.g. transcript line id
  excerpt?: string;
}

export interface Evidence {
  source: string;
  start?: number;
  end?: number;
  speaker?: string;
  segmentRef?: string;
  excerpt?: string;
  model?: string;
  modelVersion?: string;
  promptVersion?: string;
  confidence?: number;
}

// ---------------------------------------------------------------------------
// Gates (spec #11) — blocking validation with explicit verdicts.
// ---------------------------------------------------------------------------

export type GateVerdict = "PASS" | "WARN" | "BLOCK";

export interface GateResult {
  gateId: string;
  name: string;
  verdict: GateVerdict;
  reason: string;
  /** Free-form metrics the gate produced (e.g. confidence, coverage). */
  metrics?: Record<string, number>;
  /** Evidence attached by the gate, surfaced to the UI. */
  evidence?: EvidenceSpan[];
  checkedAt: number;
}

// ---------------------------------------------------------------------------
// Retries (spec #61) — bounded, reason-logged.
// ---------------------------------------------------------------------------

export interface RetryRecord {
  attempt: number;
  reason: string;
  provider?: ProviderId;
  model?: string;
  latencyMs?: number;
  costUsd?: number;
  at: number;
}

// ---------------------------------------------------------------------------
// Provider call trace (spec #22, #153) — observability record.
// ---------------------------------------------------------------------------

export interface ProviderCallRecord {
  id: string;
  runId: string;
  taskId?: string;
  provider: ProviderId;
  model: string;
  capability: Capability;
  startedAt: number;
  ttfbMs?: number;
  completedAt?: number;
  durationMs?: number;
  inputTokens: number;
  outputTokens: number;
  audioSeconds: number;
  costUsd: number;
  status: "ok" | "error" | "timeout";
  error?: string;
  retryCount: number;
  // Live trace timeline events for the trace explorer.
  timeline: Array<{ ts: number; label: string }>;
}

// ---------------------------------------------------------------------------
// Routing
// ---------------------------------------------------------------------------

export type RoutingPolicy =
  | "cheapest"
  | "fastest"
  | "best_quality"
  | "balanced"
  | "fallback";

export interface RoutingDecision {
  primary: ProviderId;
  fallback: ProviderId[];
  reason: string;
}

// ---------------------------------------------------------------------------
// Zod runtime schemas for the most safety-critical structures.
// ---------------------------------------------------------------------------

export const UsageSchema = z.object({
  inputTokens: z.number(),
  outputTokens: z.number(),
  audioSeconds: z.number(),
  costUsd: z.number(),
  providerCalls: z.number(),
  cacheHits: z.number(),
});

export const BudgetSchema = z.object({
  maxDurationMs: z.number().positive(),
  maxTokens: z.number().positive(),
  maxAudioMinutes: z.number().positive(),
  maxCostUsd: z.number().positive(),
  maxRetries: z.number().int().nonnegative().max(10),
  maxParallelTasks: z.number().int().positive().max(64),
});

export const EvidenceSchema = z.object({
  source: z.string(),
  start: z.number().optional(),
  end: z.number().optional(),
  speaker: z.string().optional(),
  segmentRef: z.string().optional(),
  excerpt: z.string().optional(),
  model: z.string().optional(),
  modelVersion: z.string().optional(),
  promptVersion: z.string().optional(),
  confidence: z.number().min(0).max(1).optional(),
});

// ---------------------------------------------------------------------------
// Reproducibility (spec #85) — a run captures everything needed to replay it.
// ---------------------------------------------------------------------------

export interface RunProvenance {
  provider: string;
  model: string;
  promptVersion: string;
  workflowVersion: string;
  configurationHash: string;
  inputHash: string;
  settings: {
    temperature?: number;
    maxTokens?: number;
    [key: string]: unknown;
  };
  tools: string[];
  providerResponseMeta?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Webhooks (spec #80)
// ---------------------------------------------------------------------------

export type WebhookEvent =
  | "workflow.completed"
  | "workflow.failed"
  | "transcript.completed"
  | "meeting.completed"
  | "benchmark.completed"
  | "provider.failed"
  | "budget.exceeded";

export interface WebhookSubscription {
  id: string;
  url: string;
  events: WebhookEvent[];
  secret?: string; // for HMAC signing; never returned to clients
  active: boolean;
}

export interface WebhookDelivery {
  event: WebhookEvent;
  runId?: string;
  product: string;
  payload: Record<string, unknown>;
  at: number;
}
