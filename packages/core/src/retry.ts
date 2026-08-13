import type { RetryRecord } from "./types.js";
import { logger } from "./util/logger.js";

export interface RetryOptions {
  maxRetries: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  /** Decide whether a given error is retryable. */
  isRetryable?: (err: unknown) => boolean;
  /** Optional label for logs. */
  label?: string;
}

export class RetryError extends Error {
  constructor(
    message: string,
    public readonly records: RetryRecord[],
  ) {
    super(message);
    this.name = "RetryError";
  }
}

/**
 * Bounded, reason-logged retry (spec #61). Each attempt records WHY it failed
 * so the run explorer can show the full attempt history. Uses exponential
 * backoff with jitter. Always bounded by maxRetries — no silent infinite loops.
 */
export async function withRetry<T>(
  opts: RetryOptions,
  fn: (attempt: number) => Promise<T>,
): Promise<{ value: T; retries: RetryRecord[] }> {
  const records: RetryRecord[] = [];
  const base = opts.baseDelayMs ?? 250;
  const max = opts.maxDelayMs ?? 8000;
  let attempt = 0;
  for (;;) {
    try {
      const value = await fn(attempt);
      return { value, retries: records };
    } catch (err: unknown) {
      const reason = err instanceof Error ? err.message : String(err);
      const retryable = opts.isRetryable ? opts.isRetryable(err) : true;
      records.push({ attempt, reason, at: Date.now() });
      logger.warn("retry: attempt failed", { label: opts.label, attempt, reason, retryable });
      if (attempt >= opts.maxRetries || !retryable) {
        throw new RetryError(`failed after ${records.length} attempt(s): ${reason}`, records);
      }
      const delay = Math.min(max, base * 2 ** attempt) + Math.floor(Math.random() * 100);
      await new Promise((r) => setTimeout(r, delay));
      attempt += 1;
    }
  }
}
