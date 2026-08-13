import postgres from "postgres";
import type { RunStore, StoredRun } from "./types.js";

type Sql = ReturnType<typeof postgres>;

export class PostgresRunStore implements RunStore {
  readonly backend = "postgres" as const;

  private constructor(private sql: Sql) {}

  static async connect(databaseUrl: string): Promise<PostgresRunStore> {
    const sql = postgres(databaseUrl, { max: 5, idle_timeout: 20, connect_timeout: 5 });
    await sql`
      CREATE TABLE IF NOT EXISTS runs (
        run_id TEXT PRIMARY KEY,
        product TEXT NOT NULL,
        status TEXT NOT NULL,
        started_at BIGINT NOT NULL,
        finished_at BIGINT,
        duration_ms BIGINT,
        usage JSONB,
        meta JSONB
      )
    `;
    await sql`CREATE INDEX IF NOT EXISTS runs_started_at_idx ON runs (started_at DESC)`;
    return new PostgresRunStore(sql);
  }

  async upsert(run: StoredRun): Promise<void> {
    await this.sql`
      INSERT INTO runs (run_id, product, status, started_at, finished_at, duration_ms, usage, meta)
      VALUES (
        ${run.runId},
        ${run.product},
        ${run.status},
        ${run.startedAt},
        ${run.finishedAt ?? null},
        ${run.durationMs ?? null},
        ${this.sql.json((run.usage ?? {}) as never)},
        ${this.sql.json((run.meta ?? {}) as never)}
      )
      ON CONFLICT (run_id) DO UPDATE SET
        product = EXCLUDED.product,
        status = EXCLUDED.status,
        started_at = EXCLUDED.started_at,
        finished_at = EXCLUDED.finished_at,
        duration_ms = EXCLUDED.duration_ms,
        usage = EXCLUDED.usage,
        meta = EXCLUDED.meta
    `;
  }

  async list(limit = 50): Promise<StoredRun[]> {
    const rows = await this.sql<{
      run_id: string;
      product: string;
      status: string;
      started_at: string | number;
      finished_at: string | number | null;
      duration_ms: string | number | null;
      usage: Record<string, unknown> | null;
      meta: Record<string, unknown> | null;
    }[]>`
      SELECT run_id, product, status, started_at, finished_at, duration_ms, usage, meta
      FROM runs
      ORDER BY started_at DESC
      LIMIT ${limit}
    `;
    return rows.map((r) => ({
      runId: r.run_id,
      product: r.product,
      status: r.status,
      startedAt: Number(r.started_at),
      finishedAt: r.finished_at == null ? undefined : Number(r.finished_at),
      durationMs: r.duration_ms == null ? undefined : Number(r.duration_ms),
      usage: r.usage ?? undefined,
      meta: r.meta ?? undefined,
    }));
  }

  async get(runId: string): Promise<StoredRun | null> {
    const rows = await this.sql<{
      run_id: string;
      product: string;
      status: string;
      started_at: string | number;
      finished_at: string | number | null;
      duration_ms: string | number | null;
      usage: Record<string, unknown> | null;
      meta: Record<string, unknown> | null;
    }[]>`
      SELECT run_id, product, status, started_at, finished_at, duration_ms, usage, meta
      FROM runs WHERE run_id = ${runId} LIMIT 1
    `;
    const r = rows[0];
    if (!r) return null;
    return {
      runId: r.run_id,
      product: r.product,
      status: r.status,
      startedAt: Number(r.started_at),
      finishedAt: r.finished_at == null ? undefined : Number(r.finished_at),
      durationMs: r.duration_ms == null ? undefined : Number(r.duration_ms),
      usage: r.usage ?? undefined,
      meta: r.meta ?? undefined,
    };
  }

  async close(): Promise<void> {
    await this.sql.end({ timeout: 5 });
  }
}
