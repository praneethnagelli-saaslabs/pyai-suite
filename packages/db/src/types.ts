export interface StoredRun {
  runId: string;
  product: string;
  status: string;
  startedAt: number;
  finishedAt?: number;
  durationMs?: number;
  usage?: Record<string, unknown>;
  meta?: Record<string, unknown>;
}

export interface RunStore {
  upsert(run: StoredRun): Promise<void>;
  list(limit?: number): Promise<StoredRun[]>;
  get(runId: string): Promise<StoredRun | null>;
  backend: "memory" | "postgres";
}
