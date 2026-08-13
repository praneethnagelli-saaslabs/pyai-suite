import type { RunStore, StoredRun } from "./types.js";

export class MemoryRunStore implements RunStore {
  readonly backend = "memory" as const;
  private runs = new Map<string, StoredRun>();

  async upsert(run: StoredRun): Promise<void> {
    this.runs.set(run.runId, { ...run });
  }

  async list(limit = 50): Promise<StoredRun[]> {
    return [...this.runs.values()]
      .sort((a, b) => b.startedAt - a.startedAt)
      .slice(0, limit);
  }

  async get(runId: string): Promise<StoredRun | null> {
    return this.runs.get(runId) ?? null;
  }
}
