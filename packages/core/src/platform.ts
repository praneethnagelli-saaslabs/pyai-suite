import { CapabilityRegistry } from "./providers/registry.js";
import { MockProvider } from "./providers/mock.js";
import { PyAIProvider } from "./providers/pyai.js";
import { OpenAIProvider } from "./providers/openai.js";
import { GeminiProvider } from "./providers/gemini.js";
import { Tracer } from "./tracer.js";
import { WorkflowEngine } from "./workflow/engine.js";
import { PromptRegistry } from "./prompts.js";
import { WebhookBus } from "./webhooks.js";
import { FeatureFlags } from "./flags.js";
import type { Capability } from "./types.js";

export interface PlatformConfig {
  /** Always include the deterministic mock so the demo runs without keys. */
  includeMock?: boolean;
  pyai?: { apiKey?: string; baseUrl?: string };
  openai?: { apiKey?: string };
  gemini?: { apiKey?: string };
}

/**
 * Build the whole platform: registry + tracer + workflow engine wired together.
 * (spec #156 — modular monorepo, no premature microservices.)
 */
export function createPlatform(config: PlatformConfig = {}) {
  const registry = new CapabilityRegistry();
  const tracer = new Tracer();
  const engine = new WorkflowEngine(tracer);

  if (config.includeMock !== false) {
    registry.register(new MockProvider());
  }
  const pyai = new PyAIProvider(config.pyai);
  // Always register PyAI so the UI can show Connect / sandbox onboarding even
  // before a key is present (isConfigured() gates real calls).
  registry.register(pyai);
  const openai = new OpenAIProvider(config.openai);
  if (openai.isConfigured()) registry.register(openai);
  const gemini = new GeminiProvider(config.gemini);
  if (gemini.isConfigured()) registry.register(gemini);

  // Registry defaults: PyAI is the primary; falls back across configured ones.
  const defaults: Partial<Record<Capability, string>> = {
    streaming_stt: pyai.isConfigured() ? "pyai" : "mock",
    batch_stt: pyai.isConfigured() ? "pyai" : "mock",
    speaker_diarization: pyai.isConfigured() ? "pyai" : "mock",
    llm: openai.isConfigured() ? "openai" : gemini.isConfigured() ? "gemini" : "mock",
    reasoning_llm: openai.isConfigured() ? "openai" : gemini.isConfigured() ? "gemini" : "mock",
    structured_output: openai.isConfigured() ? "openai" : gemini.isConfigured() ? "gemini" : "mock",
    tts: pyai.isConfigured() ? "pyai" : "mock",
    streaming_tts: pyai.isConfigured() ? "pyai" : "mock",
    embeddings: openai.isConfigured() ? "openai" : gemini.isConfigured() ? "gemini" : "mock",
    realtime_voice: pyai.isConfigured() ? "pyai" : "mock",
    moderation: pyai.isConfigured() ? "pyai" : "mock",
    translation: gemini.isConfigured() ? "gemini" : "mock",
  };
  for (const [cap, prov] of Object.entries(defaults)) {
    if (prov) registry.setDefault(cap as Capability, prov);
  }

  const prompts = new PromptRegistry();
  const webhooks = new WebhookBus();
  const flags = new FeatureFlags();

  return { registry, tracer, engine, prompts, webhooks, flags };
}

export type Platform = ReturnType<typeof createPlatform>;
