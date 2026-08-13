// Public surface of @pyai/core — the shared platform.
// Product & provider code import only from here.

export * from "./types.js";
export * from "./providers/adapter.js";
export * from "./providers/registry.js";
export { classifyRealtimeFailure, PCM_RATE, tonePcm } from "./providers/realtime-shared.js";
export { MockProvider } from "./providers/mock.js";
export { PyAIProvider, mintPyAISandboxKey, PYAI_DEFAULT_BASE_URL } from "./providers/pyai.js";
export { OpenAIProvider } from "./providers/openai.js";
export { GeminiProvider } from "./providers/gemini.js";
export { BudgetGovernor } from "./budget.js";
export { Tracer, type RunSummary } from "./tracer.js";
export {
  WorkflowEngine,
  type WorkflowDef,
  type TaskDef,
  type TaskContext,
  type WorkflowOutcome,
  type TaskFn,
} from "./workflow/engine.js";
export {
  type Gate,
  type GateContext,
  type GateSet,
  BUILT_IN_GATES,
  schemaGate,
  evidenceGate,
  confidenceGate,
  runGates,
  anyBlock,
  worstVerdict,
  verdict,
} from "./gates.js";
export { withRetry, RetryError, type RetryOptions } from "./retry.js";
export { createPlatform, type Platform, type PlatformConfig } from "./platform.js";
export { PromptRegistry, PromptDefSchema, makePrompt, type PromptDef } from "./prompts.js";
export { WebhookBus } from "./webhooks.js";
export { FeatureFlags, type FlagName } from "./flags.js";
export { ChaosProvider, type ChaosConfig } from "./chaos.js";
export { logger } from "./util/logger.js";
export { shortId, runId, taskId, traceId, callId, workflowId } from "./util/ids.js";
