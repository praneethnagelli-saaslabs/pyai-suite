import type {
  Budget,
  GateResult,
  ProviderId,
  RunStatus,
  Usage,
} from "../types.js";
import { ZERO_USAGE } from "../types.js";
import { BudgetGovernor } from "../budget.js";
import { Tracer } from "../tracer.js";
import { runGates, type GateSet, anyBlock, worstVerdict } from "../gates.js";
import { withRetry, type RetryOptions } from "../retry.js";
import { logger } from "../util/logger.js";
import { taskId } from "../util/ids.js";

export interface TaskContext {
  runId: string;
  tracer: Tracer;
  budget: BudgetGovernor;
  /** Shared inputs resolved from upstream tasks by id. */
  inputs: Record<string, unknown>;
  /** Shared artifacts produced by tasks (keyed by task id). */
  artifacts: Record<string, unknown>;
  usage: Usage;
  product: string;
  workflowId: string;
}

export type TaskFn = (ctx: TaskContext) => Promise<unknown> | unknown;

export interface TaskDef {
  id: string;
  /** Display label for the trace explorer. */
  label?: string;
  /** Task ids this depends on; engine waits for them before running. */
  dependsOn?: string[];
  /** Run concurrently when multiple tasks share the same deps met. */
  run?: TaskFn;
  /** Gates executed after run(); BLOCK aborts the workflow. */
  gates?: GateSet;
  /** Retry policy for this task. */
  retry?: Partial<RetryOptions>;
  /** Estimated usage used by the budget governor pre-check. */
  estimate?: Partial<Usage>;
}

export interface WorkflowDef {
  id: string;
  product: string;
  tasks: TaskDef[];
  budget?: Partial<Budget>;
  /** Tasks whose failure should not abort the whole workflow (partial). */
  optional?: string[];
  onComplete?: (ctx: TaskContext) => Promise<void> | void;
  /** Reproducibility metadata (spec #84, #85). Captured on the run record. */
  version?: string;
  provenance?: import("../types.js").RunProvenance;
}

export interface WorkflowOutcome {
  runId: string;
  status: RunStatus;
  usage: Usage;
  artifacts: Record<string, unknown>;
  gates: GateResult[];
  errors: Record<string, string>;
  startedAt: number;
  completedAt: number;
  durationMs: number;
}

interface TaskState {
  def: TaskDef;
  status: "pending" | "running" | "done" | "failed" | "skipped";
  error?: string;
  retries: import("../types.js").RetryRecord[];
}

/**
 * DAG workflow engine (spec #10, #62, #157).
 *
 * - Tasks with met dependencies run in PARALLEL (bounded by budget.maxParallelTasks).
 * - `merge` is implicit: a downstream task reads any upstream artifacts it needs.
 * - Gates run after each task; any BLOCK aborts with FAILED.
 * - Budgets are checked before each task via the governor.
 * - Retries are bounded and reason-logged.
 * - Every run emits a trace record and a final status (never disappears silently).
 */
export class WorkflowEngine {
  constructor(private tracer: Tracer) {}

  async execute(def: WorkflowDef): Promise<WorkflowOutcome> {
    const runId = this.tracer.startRun(def.id, def.product);
    if (def.provenance) this.tracer.setProvenance(runId, def.provenance);
    else {
      // Best-effort default provenance so every run is at least partially reproducible.
      this.tracer.setProvenance(runId, {
        provider: "unknown",
        model: "unknown",
        promptVersion: "unknown",
        workflowVersion: def.version ?? def.id,
        configurationHash: "unset",
        inputHash: "unset",
        settings: {},
        tools: def.tasks.map((t) => t.id),
      });
    }
    const budget = new BudgetGovernor(def.budget ? { ...def.budget } as Budget : undefined);
    const ctx: TaskContext = {
      runId,
      tracer: this.tracer,
      budget,
      inputs: {},
      artifacts: {},
      usage: { ...ZERO_USAGE },
      product: def.product,
      workflowId: def.id,
    };
    const states = new Map<string, TaskState>();
    for (const t of def.tasks) {
      states.set(t.id, { def: t, status: "pending", retries: [] });
    }

    const startedAt = Date.now();
    const errors: Record<string, string> = {};
    const gateResults: GateResult[] = [];
    let aborted = false;
    let totalRetries = 0;

    try {
      while (this.hasPending(states)) {
        const ready = this.readyTasks(states);
        if (ready.length === 0) break; // nothing runnable but unfinished => cycle/blocked
        const batch = ready.slice(0, budget.current.maxParallelTasks);
        logger.debug("workflow: dispatching batch", { runId, count: batch.length, ids: batch.map((t) => t.id) });

        await Promise.all(
          batch.map(async (t) => {
            if (aborted) {
              this.skip(states, t.id);
              return;
            }
            const s = states.get(t.id)!;
            s.status = "running";
            // gather inputs from deps
            for (const dep of t.dependsOn ?? []) {
              ctx.inputs[dep] = ctx.artifacts[dep];
            }
            // budget pre-check
            const violation = budget.current
              ? budget.checkBefore(ctx.usage, t.estimate)
              : null;
            if (violation) {
              aborted = true;
              s.status = "failed";
              s.error = `BUDGET_EXCEEDED: ${violation}`;
              errors[t.id] = s.error;
              this.tracer.completeRun(runId, "BUDGET_EXCEEDED", s.error);
              return;
            }
            try {
              const { value, retries } = await withRetry(
                { maxRetries: budget.current.maxRetries, label: `${def.id}:${t.id}`, ...t.retry },
                async () => (await t.run?.(ctx)) ?? null,
              );
              s.retries = retries;
              s.status = "done";
              ctx.artifacts[t.id] = value;
              const outUsage = (value as { usage?: Partial<Usage> } | undefined)?.usage;
              if (outUsage) ctx.usage = budget.recordActual(ctx.usage, outUsage);
              totalRetries += retries.length;
              this.tracer.setRetries(runId, totalRetries);
              if (t.gates && t.gates.length) {
                const gr = await runGates(t.gates, value as never);
                for (const g of gr) {
                  gateResults.push(g);
                  this.tracer.recordGate(runId, g.verdict === "BLOCK");
                }
                if (anyBlock(gr)) {
                  aborted = true;
                  s.status = "failed";
                  s.error = `GATE_BLOCKED: ${gr.find((g) => g.verdict === "BLOCK")?.name}`;
                  errors[t.id] = s.error;
                }
              }
            } catch (err: unknown) {
              const msg = err instanceof Error ? err.message : String(err);
              s.status = "failed";
              s.error = msg;
              errors[t.id] = msg;
              this.tracer.recordFailure(runId);
              logger.error("workflow: task failed", { runId, task: t.id, msg });
              if (!def.optional?.includes(t.id)) aborted = true;
            }
          }),
        );
      }

      const failedRequired = Array.from(states.values()).filter(
        (s) => s.status === "failed" && !def.optional?.includes(s.def.id),
      );
      let status: RunStatus;
      if (this.tracer.getRun(runId)?.status === "BUDGET_EXCEEDED") {
        status = "BUDGET_EXCEEDED";
      } else if (failedRequired.length > 0) {
        status = "FAILED";
      } else if (Array.from(states.values()).some((s) => s.status === "failed")) {
        status = "PARTIAL";
      } else {
        status = "SUCCEEDED";
      }
      this.tracer.mergeUsage(runId, ctx.usage);
      this.tracer.completeRun(runId, status, errors["__root"], Object.keys(ctx.artifacts));
      if (status === "SUCCEEDED" && def.onComplete) {
        try {
          await def.onComplete(ctx);
        } catch (e: unknown) {
          logger.warn("workflow: onComplete error", { runId, err: String(e) });
        }
      }
      const completedAt = Date.now();
      return {
        runId,
        status,
        usage: ctx.usage,
        artifacts: ctx.artifacts,
        gates: gateResults,
        errors,
        startedAt,
        completedAt,
        durationMs: completedAt - startedAt,
      };
    } catch (fatal: unknown) {
      const msg = fatal instanceof Error ? fatal.message : String(fatal);
      this.tracer.mergeUsage(runId, ctx.usage);
      this.tracer.completeRun(runId, "FAILED", msg);
      const completedAt = Date.now();
      return {
        runId,
        status: "FAILED",
        usage: ctx.usage,
        artifacts: ctx.artifacts,
        gates: gateResults,
        errors: { __root: msg },
        startedAt,
        completedAt,
        durationMs: completedAt - startedAt,
      };
    }
  }

  private hasPending(states: Map<string, TaskState>): boolean {
    return Array.from(states.values()).some((s) => s.status === "pending" || s.status === "running");
  }

  private readyTasks(states: Map<string, TaskState>): TaskDef[] {
    const out: TaskDef[] = [];
    for (const s of Array.from(states.values())) {
      if (s.status !== "pending") continue;
      const deps = s.def.dependsOn ?? [];
      const satisfied = deps.every((d) => {
        const ds = states.get(d);
        return ds && (ds.status === "done" || ds.status === "skipped");
      });
      if (satisfied) out.push(s.def);
    }
    return out;
  }

  private skip(states: Map<string, TaskState>, id: string): void {
    const s = states.get(id);
    if (s) s.status = "skipped";
  }
}

export { taskId, worstVerdict };
