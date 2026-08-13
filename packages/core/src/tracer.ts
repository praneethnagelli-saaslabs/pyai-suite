import { callId, runId, taskId } from "./util/ids.js";
import type {
  Capability,
  ProviderCallRecord,
  ProviderId,
  Usage,
} from "./types.js";
import { ZERO_USAGE } from "./types.js";

export interface RunSummary {
  runId: string;
  workflowId: string;
  product: string;
  status: string;
  startedAt: number;
  completedAt?: number;
  durationMs?: number;
  providerCalls: number;
  usage: Usage;
  retries: number;
  failures: number;
  gates: number;
  gatesBlocked: number;
  artifacts: string[];
  error?: string;
  provenance?: import("./types.js").RunProvenance;
}

/**
 * Lightweight in-process tracer used by the workflow engine to emit the
 * per-provider-call records that power the Trace Explorer and dashboards.
 * In production this would forward to OpenTelemetry; here it keeps a bounded
 * in-memory record so the demo works without an OTel collector.
 */
export class Tracer {
  private calls = new Map<string, ProviderCallRecord>();
  private runs = new Map<string, RunSummary>();

  startRun(workflowId: string, product: string): string {
    const id = runId();
    const startedAt = Date.now();
    this.runs.set(id, {
      runId: id,
      workflowId,
      product,
      status: "RUNNING",
      startedAt,
      providerCalls: 0,
      usage: { ...ZERO_USAGE },
      retries: 0,
      failures: 0,
      gates: 0,
      gatesBlocked: 0,
      artifacts: [],
    });
    return id;
  }

  beginCall(opts: {
    runId: string;
    taskId?: string;
    provider: ProviderId;
    model: string;
    capability: Capability;
  }): { callRecordId: string; mark: (label: string) => void } {
    const id = callId();
    const startedAt = Date.now();
    const record: ProviderCallRecord = {
      id,
      runId: opts.runId,
      taskId: opts.taskId,
      provider: opts.provider,
      model: opts.model,
      capability: opts.capability,
      startedAt,
      inputTokens: 0,
      outputTokens: 0,
      audioSeconds: 0,
      costUsd: 0,
      status: "ok",
      retryCount: 0,
      timeline: [{ ts: startedAt, label: "started" }],
    };
    this.calls.set(id, record);
    this.bumpRun(opts.runId, (r) => {
      r.providerCalls += 1;
    });
    return {
      callRecordId: id,
      mark: (label: string) => {
        const rec = this.calls.get(id);
        if (rec) rec.timeline.push({ ts: Date.now(), label });
      },
    };
  }

  finishCall(
    callRecordId: string,
    usage: Partial<Usage> & { status?: ProviderCallRecord["status"]; error?: string; ttfbMs?: number },
  ): void {
    const rec = this.calls.get(callRecordId);
    if (!rec) return;
    const completedAt = Date.now();
    rec.completedAt = completedAt;
    rec.durationMs = completedAt - rec.startedAt;
    rec.inputTokens = usage.inputTokens ?? rec.inputTokens;
    rec.outputTokens = usage.outputTokens ?? rec.outputTokens;
    rec.audioSeconds = usage.audioSeconds ?? rec.audioSeconds;
    rec.costUsd = usage.costUsd ?? rec.costUsd;
    rec.status = usage.status ?? rec.status;
    rec.error = usage.error;
    if (usage.ttfbMs != null) rec.ttfbMs = usage.ttfbMs;
    rec.timeline.push({ ts: completedAt, label: "complete" });
    const run = this.runs.get(rec.runId);
    if (run) {
      run.usage = {
        inputTokens: run.usage.inputTokens + rec.inputTokens,
        outputTokens: run.usage.outputTokens + rec.outputTokens,
        audioSeconds: run.usage.audioSeconds + rec.audioSeconds,
        costUsd: run.usage.costUsd + rec.costUsd,
        providerCalls: run.usage.providerCalls,
        cacheHits: run.usage.cacheHits,
      };
      if (rec.status !== "ok") run.failures += 1;
    }
  }

  recordGate(runId: string, blocked: boolean): void {
    this.bumpRun(runId, (r) => {
      r.gates += 1;
      if (blocked) r.gatesBlocked += 1;
    });
  }

  recordRetry(runId: string): void {
    this.bumpRun(runId, (r) => {
      r.retries += 1;
    });
  }

  setRetries(runId: string, n: number): void {
    this.bumpRun(runId, (r) => {
      r.retries = n;
    });
  }

  setProvenance(runId: string, p: import("./types.js").RunProvenance): void {
    this.bumpRun(runId, (r) => {
      r.provenance = p;
    });
  }

  /** Record a failed provider/task attempt against a run (failure record, spec #88). */
  recordFailure(runId: string): void {
    this.bumpRun(runId, (r) => {
      r.failures += 1;
    });
  }

  /** Merge usage accumulated by workflow tasks into the run record. */
  mergeUsage(runId: string, usage: Usage): void {
    this.bumpRun(runId, (r) => {
      r.usage = {
        inputTokens: r.usage.inputTokens + usage.inputTokens,
        outputTokens: r.usage.outputTokens + usage.outputTokens,
        audioSeconds: r.usage.audioSeconds + usage.audioSeconds,
        costUsd: r.usage.costUsd + usage.costUsd,
        providerCalls: r.usage.providerCalls + usage.providerCalls,
        cacheHits: r.usage.cacheHits + usage.cacheHits,
      };
      r.providerCalls = r.usage.providerCalls;
    });
  }

  completeRun(runId: string, status: string, error?: string, artifacts: string[] = []): void {
    this.bumpRun(runId, (r) => {
      r.status = status;
      r.completedAt = Date.now();
      r.durationMs = (r.completedAt ?? Date.now()) - r.startedAt;
      r.providerCalls = r.usage.providerCalls; // reflect actual, not just beginCall probes
      if (error) r.error = error;
      if (artifacts.length) r.artifacts.push(...artifacts);
    });
  }

  getRun(runId: string): RunSummary | undefined {
    return this.runs.get(runId);
  }

  getCall(callRecordId: string): ProviderCallRecord | undefined {
    return this.calls.get(callRecordId);
  }

  getRunCalls(runId: string): ProviderCallRecord[] {
    return Array.from(this.calls.values()).filter((c) => c.runId === runId);
  }

  listRuns(limit = 50): RunSummary[] {
    return Array.from(this.runs.values())
      .sort((a, b) => b.startedAt - a.startedAt)
      .slice(0, limit);
  }

  private bumpRun(runId: string, fn: (r: RunSummary) => void): void {
    const r = this.runs.get(runId);
    if (r) fn(r);
  }
}

export { runId, taskId };
