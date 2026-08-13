import { MemoryRunStore } from "./memory.js";
import { PostgresRunStore } from "./postgres.js";
import type { RunStore } from "./types.js";

export type { RunStore, StoredRun } from "./types.js";
export { MemoryRunStore } from "./memory.js";
export { PostgresRunStore } from "./postgres.js";

/**
 * Prefer Postgres when DATABASE_URL is reachable; otherwise in-memory.
 * Never throws — local demo always works without Docker.
 */
export async function createRunStore(databaseUrl = process.env.DATABASE_URL): Promise<RunStore> {
  if (!databaseUrl?.trim()) return new MemoryRunStore();
  try {
    return await PostgresRunStore.connect(databaseUrl.trim());
  } catch {
    return new MemoryRunStore();
  }
}
