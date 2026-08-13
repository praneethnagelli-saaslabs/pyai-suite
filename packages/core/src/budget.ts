import type { Budget, BudgetViolation, Usage } from "./types.js";
import { DEFAULT_BUDGET } from "./types.js";
import { logger } from "./util/logger.js";

/**
 * Budget governor (spec #9, #112). No workflow may spend without checking.
 * `checkBefore` is called before each expensive operation; if it returns a
 * violation the engine BLOCKs the operation with BUDGET_EXCEEDED rather than
 * silently overspending.
 */
export class BudgetGovernor {
  constructor(private budget: Budget = DEFAULT_BUDGET) {}

  configure(budget: Partial<Budget>): void {
    this.budget = { ...this.budget, ...budget };
  }

  get current(): Budget {
    return this.budget;
  }

  /** Projected usage = already-spent + estimated next cost. */
  checkBefore(already: Usage, estimated: Partial<Usage> = {}): BudgetViolation | null {
    const estCost = estimated.costUsd ?? 0;
    const estTokens = (estimated.inputTokens ?? 0) + (estimated.outputTokens ?? 0);
    const estAudioMinutes = (estimated.audioSeconds ?? 0) / 60;

    if (already.costUsd + estCost > this.budget.maxCostUsd) {
      const v: BudgetViolation = "max_cost";
      logger.warn("budget: would exceed max cost", {
        already: already.costUsd,
        estimate: estCost,
        limit: this.budget.maxCostUsd,
      });
      return v;
    }
    if (already.inputTokens + already.outputTokens + estTokens > this.budget.maxTokens) {
      return "max_tokens";
    }
    if (already.audioSeconds / 60 + estAudioMinutes > this.budget.maxAudioMinutes) {
      return "max_audio_minutes";
    }
    return null;
  }

  recordActual(already: Usage, actual: Partial<Usage>): Usage {
    return {
      inputTokens: already.inputTokens + (actual.inputTokens ?? 0),
      outputTokens: already.outputTokens + (actual.outputTokens ?? 0),
      audioSeconds: already.audioSeconds + (actual.audioSeconds ?? 0),
      costUsd: already.costUsd + (actual.costUsd ?? 0),
      providerCalls: already.providerCalls + 1,
      cacheHits: already.cacheHits + (actual.cacheHits ?? 0),
    };
  }
}
