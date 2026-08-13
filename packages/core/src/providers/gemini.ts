import type { Capability, ModelInfo, ProviderHealth } from "../types.js";
import {
  type ProviderAdapter,
  type LLMAdapter,
  type LLMRequest,
  type LLMResult,
  type EmbeddingsAdapter,
} from "./adapter.js";

/**
 * Gemini adapter — alternative provider (spec #5). Activates on GEMINI_API_KEY.
 * Used by the platform as a cleanup / reasoning fallback and for routing tests.
 */
export class GeminiProvider implements ProviderAdapter {
  readonly id = "gemini";
  readonly name = "Google Gemini";
  readonly capabilities: Capability[] = [
    "llm",
    "reasoning_llm",
    "structured_output",
    "tool_calling",
    "vision",
    "embeddings",
    "translation",
  ];
  private key: string | undefined;
  private baseUrl = "https://generativelanguage.googleapis.com/v1beta";

  constructor(opts?: { apiKey?: string }) {
    this.key = opts?.apiKey ?? process.env.GEMINI_API_KEY;
  }

  isConfigured(): boolean {
    return Boolean(this.key);
  }

  async models(): Promise<ModelInfo[]> {
    return [
      { id: "gemini-flash-latest", provider: "gemini", label: "Gemini Flash (LLM/cleanup)", capabilities: ["llm", "structured_output", "tool_calling", "vision", "translation"], contextWindow: 1_000_000, latencyClass: "low", qualityClass: "medium", pricing: { inputCostPerUnit: 0.0000001, outputCostPerUnit: 0.0000004, currency: "USD" } },
      { id: "gemini-2.5-pro", provider: "gemini", label: "Gemini 2.5 Pro (reasoning)", capabilities: ["llm", "reasoning_llm", "structured_output"], contextWindow: 1_000_000, latencyClass: "medium", qualityClass: "high", pricing: { inputCostPerUnit: 0.000001, outputCostPerUnit: 0.000004, currency: "USD" } },
      { id: "gemini-embedding-001", provider: "gemini", label: "Gemini Embeddings", capabilities: ["embeddings"], latencyClass: "low", pricing: { inputCostPerUnit: 0.000000025, currency: "USD" } },
    ];
  }

  async health(): Promise<ProviderHealth> {
    if (!this.isConfigured()) return { status: "down", latencyMs: 0, detail: "not configured", checkedAt: Date.now() };
    const t = Date.now();
    try {
      const r = await fetch(`${this.baseUrl}/models?key=${this.key}`);
      return { status: r.ok ? "healthy" : "degraded", latencyMs: Date.now() - t, checkedAt: Date.now() };
    } catch (e: unknown) {
      return { status: "down", latencyMs: Date.now() - t, detail: String(e), checkedAt: Date.now() };
    }
  }

  asLLM = (): LLMAdapter => {
    const baseUrl = this.baseUrl;
    const key = this.key;
    return {
      complete: async (req: LLMRequest): Promise<LLMResult> => {
        const model = req.model ?? "gemini-flash-latest";
        const contents = req.messages
          .filter((m) => m.role !== "system")
          .map((m) => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] }));
        const system = req.messages.find((m) => m.role === "system")?.content;
        const body: Record<string, unknown> = {
          contents,
          generationConfig: { temperature: req.temperature ?? 0.2, maxOutputTokens: req.maxTokens },
          systemInstruction: system ? { parts: [{ text: system }] } : undefined,
        };
        if (req.jsonSchema) body.generationConfig = { ...(body.generationConfig as object), responseMimeType: "application/json" };
        const r = await fetch(`${baseUrl}/models/${model}:generateContent?key=${key}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
        if (!r.ok) throw new Error(`gemini generate ${r.status}`);
        const data = (await r.json()) as { candidates: Array<{ content: { parts: Array<{ text: string }> } }>; usageMetadata?: { promptTokenCount: number; candidatesTokenCount: number } };
        const text = data.candidates?.[0]?.content.parts.map((p) => p.text).join("") ?? "";
        const parsed = req.jsonSchema ? safeParse(text) : undefined;
        return {
          text,
          model,
          parsed,
          usage: { inputTokens: data.usageMetadata?.promptTokenCount ?? 0, outputTokens: data.usageMetadata?.candidatesTokenCount ?? 0, audioSeconds: 0, costUsd: 0, providerCalls: 1, cacheHits: 0 },
        };
      },
    };
  };

  asEmbeddings = (): EmbeddingsAdapter => {
    const baseUrl = this.baseUrl;
    const key = this.key;
    return {
      embed: async (req) => {
        const input = Array.isArray(req.input) ? req.input : [req.input];
        const embeddings: number[][] = [];
        // Prefer current embed model; fall back if the account still has the older id.
        const models = ["gemini-embedding-001", "text-embedding-004"];
        for (const t of input) {
          let lastErr = "gemini embed failed";
          let ok = false;
          for (const model of models) {
            const r = await fetch(`${baseUrl}/models/${model}:embedContent?key=${key}`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ model: `models/${model}`, content: { parts: [{ text: t }] } }),
            });
            if (!r.ok) {
              lastErr = `gemini embed ${r.status}`;
              continue;
            }
            const data = (await r.json()) as { embedding?: { values: number[] }; embeddings?: Array<{ values: number[] }> };
            const values = data.embedding?.values ?? data.embeddings?.[0]?.values;
            if (!values?.length) {
              lastErr = "gemini embed empty";
              continue;
            }
            embeddings.push(values);
            ok = true;
            break;
          }
          if (!ok) throw new Error(lastErr);
        }
        return { embeddings, usage: { inputTokens: 0, outputTokens: 0, audioSeconds: 0, costUsd: 0, providerCalls: 1, cacheHits: 0 } };
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
