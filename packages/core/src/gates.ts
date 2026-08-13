import type { Evidence, GateResult, GateVerdict } from "./types.js";
import { logger } from "./util/logger.js";

export interface GateContext {
  /** Parsed structured output to validate. */
  data?: unknown;
  /** Zod schema id or inline json-schema for schema gate. */
  schema?: Record<string, unknown>;
  /** Extracted claims that must each carry evidence. */
  claims?: Array<{ claim: string; evidence?: Evidence | Evidence[] }>;
  /** Raw text to moderate / check. */
  text?: string;
  /** Confidence floor (0..1). */
  minConfidence?: number;
  /** Arbitrary extra signals a gate needs. */
  extras?: Record<string, unknown>;
}

export interface Gate {
  readonly id: string;
  readonly name: string;
  evaluate(ctx: GateContext): Promise<GateResult> | GateResult;
}

export function verdict(result: Omit<GateResult, "checkedAt">): GateResult {
  return { ...result, checkedAt: Date.now() };
}

/** Schema gate: reject malformed structured output (spec #60). */
export const schemaGate: Gate = {
  id: "schema",
  name: "Structured output schema gate",
  evaluate(ctx) {
    if (!ctx.schema) return verdict({ gateId: "schema", name: "Structured output schema gate", verdict: "PASS", reason: "no schema required" });
    const data = ctx.data as Record<string, unknown> | undefined;
    if (data == null) {
      return verdict({ gateId: "schema", name: "Structured output schema gate", verdict: "BLOCK", reason: "expected structured data but none present" });
    }
    const required = Object.keys(ctx.schema.properties ?? {});
    const missing = required.filter((k) => !(k in (data as Record<string, unknown>)));
    if (missing.length > 0) {
      return verdict({ gateId: "schema", name: "Structured output schema gate", verdict: "BLOCK", reason: `missing required fields: ${missing.join(", ")}`, metrics: { missing: missing.length } });
    }
    return verdict({ gateId: "schema", name: "Structured output schema gate", verdict: "PASS", reason: "schema satisfied", metrics: { fields: required.length } });
  },
};

/** Evidence gate: every factual claim must point at source material (spec #12). */
export const evidenceGate: Gate = {
  id: "evidence",
  name: "Evidence / provenance gate",
  evaluate(ctx) {
    if (!ctx.claims || ctx.claims.length === 0) {
      return verdict({ gateId: "evidence", name: "Evidence / provenance gate", verdict: "WARN", reason: "no claims asserted — nothing to verify" });
    }
    const unsupported = ctx.claims.filter((c) => {
      const ev = c.evidence ? (Array.isArray(c.evidence) ? c.evidence : [c.evidence]) : [];
      return ev.length === 0 || ev.every((e) => !e || !e.source);
    });
    if (unsupported.length > 0) {
      return verdict({
        gateId: "evidence",
        name: "Evidence / provenance gate",
        verdict: "BLOCK",
        reason: `claims without supporting evidence: ${unsupported.map((c) => `"${c.claim}"`).slice(0, 3).join("; ")}`,
        metrics: { unsupported: unsupported.length, total: ctx.claims.length },
      });
    }
    return verdict({ gateId: "evidence", name: "Evidence / provenance gate", verdict: "PASS", reason: "all claims carry provenance", metrics: { supported: ctx.claims.length } });
  },
};

/** Confidence gate: block low-confidence extractions. */
export const confidenceGate: Gate = {
  id: "confidence",
  name: "Confidence floor gate",
  evaluate(ctx) {
    if (ctx.minConfidence == null) return verdict({ gateId: "confidence", name: "Confidence floor gate", verdict: "PASS", reason: "no confidence floor set" });
    const claims = ctx.claims ?? [];
    const low = claims.filter((c) => {
      const ev = c.evidence ? (Array.isArray(c.evidence) ? c.evidence : [c.evidence]) : [];
      return ev.some((e) => e?.confidence != null && e.confidence < ctx.minConfidence!);
    });
    if (low.length > 0) {
      return verdict({ gateId: "confidence", name: "Confidence floor gate", verdict: "WARN", reason: `${low.length} claim(s) below confidence floor`, metrics: { below: low.length } });
    }
    return verdict({ gateId: "confidence", name: "Confidence floor gate", verdict: "PASS", reason: "confidence above floor" });
  },
};

export const BUILT_IN_GATES: Gate[] = [schemaGate, evidenceGate, confidenceGate];

export type GateSet = Gate[];

export async function runGates(gates: GateSet, ctx: GateContext): Promise<GateResult[]> {
  const results: GateResult[] = [];
  for (const g of gates) {
    try {
      results.push(await g.evaluate(ctx));
    } catch (e: unknown) {
      const err = e instanceof Error ? e.message : String(e);
      logger.error("gate threw", { gate: g.id, err });
      results.push(verdict({ gateId: g.id, name: g.name, verdict: "BLOCK", reason: `gate error: ${err}` }));
    }
  }
  return results;
}

export function anyBlock(results: GateResult[]): boolean {
  return results.some((r) => r.verdict === "BLOCK");
}

export function worstVerdict(results: GateResult[]): GateVerdict {
  if (results.some((r) => r.verdict === "BLOCK")) return "BLOCK";
  if (results.some((r) => r.verdict === "WARN")) return "WARN";
  return "PASS";
}
