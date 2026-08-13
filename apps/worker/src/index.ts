/**
 * Async job worker (spec #19).
 * In-memory by default; BullMQ + Redis when REDIS_URL is set.
 * Streaming workloads must NOT go through this queue.
 */

import { createPlatform, type Platform } from "@pyai/core";
import { buildCallIQWorkflow } from "@pyai/calliq";
import { buildBriefWorkflow } from "@pyai/brief";
import { buildSimulatorWorkflow } from "@pyai/simulator";
import { buildScribWorkflow } from "@pyai/scrib";

export type JobKind =
  | "calliq.analyze"
  | "brief.analyze"
  | "scrib.dictate"
  | "simulator.run"
  | "eval.run";

export interface Job {
  id: string;
  kind: JobKind;
  payload: Record<string, unknown>;
  createdAt: number;
}

export interface JobResult {
  id: string;
  kind: JobKind;
  status: string;
  runId?: string;
  error?: string;
  finishedAt: number;
}

export interface JobQueue {
  enqueue(kind: JobKind, payload: Record<string, unknown>): Promise<Job>;
  /** Drain pending in-memory jobs (no-op for Redis — workers process async). */
  drain?(platform?: Platform): Promise<JobResult[]>;
  listResults?(): JobResult[];
  backend: "memory" | "redis";
  close?(): Promise<void>;
}

const QUEUE_NAME = "pyai-jobs";

export async function processJob(
  platform: Platform,
  job: Pick<Job, "id" | "kind" | "payload">,
): Promise<JobResult> {
  try {
    if (job.kind === "calliq.analyze") {
      const { def } = buildCallIQWorkflow(platform, {
        transcriptText: String(job.payload.transcriptText ?? ""),
        llmProvider: String(job.payload.llmProvider ?? "mock"),
      });
      const r = await platform.engine.execute(def);
      return { id: job.id, kind: job.kind, status: r.status, runId: r.runId, finishedAt: Date.now() };
    }
    if (job.kind === "brief.analyze") {
      const { def } = buildBriefWorkflow(platform, {
        transcriptText: String(job.payload.transcriptText ?? ""),
        mode: (job.payload.mode as never) ?? "Planning",
        llmProvider: String(job.payload.llmProvider ?? "mock"),
      });
      const r = await platform.engine.execute(def);
      return { id: job.id, kind: job.kind, status: r.status, runId: r.runId, finishedAt: Date.now() };
    }
    if (job.kind === "scrib.dictate") {
      const { def } = buildScribWorkflow(platform, {
        rawText: String(job.payload.rawText ?? ""),
        mode: (job.payload.mode as never) ?? "light",
        cleanupProvider: String(job.payload.cleanupProvider ?? "mock"),
      });
      const r = await platform.engine.execute(def);
      return { id: job.id, kind: job.kind, status: r.status, runId: r.runId, finishedAt: Date.now() };
    }
    if (job.kind === "simulator.run") {
      const { def } = buildSimulatorWorkflow(platform, {
        count: Number(job.payload.count ?? 5),
        concurrency: Number(job.payload.concurrency ?? 5),
        personaId: job.payload.personaId ? String(job.payload.personaId) : undefined,
        llmProvider: String(job.payload.llmProvider ?? "mock"),
      });
      const r = await platform.engine.execute(def);
      return { id: job.id, kind: job.kind, status: r.status, runId: r.runId, finishedAt: Date.now() };
    }
    return { id: job.id, kind: job.kind, status: "FAILED", error: "unknown_kind", finishedAt: Date.now() };
  } catch (e) {
    return { id: job.id, kind: job.kind, status: "FAILED", error: String(e), finishedAt: Date.now() };
  }
}

export class InMemoryQueue implements JobQueue {
  readonly backend = "memory" as const;
  private q: Job[] = [];
  private results: JobResult[] = [];

  async enqueue(kind: JobKind, payload: Record<string, unknown>): Promise<Job> {
    const job: Job = {
      id: `job_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      kind,
      payload,
      createdAt: Date.now(),
    };
    this.q.push(job);
    return job;
  }

  async drain(platform = createPlatform({ includeMock: true })): Promise<JobResult[]> {
    const out: JobResult[] = [];
    while (this.q.length) {
      const job = this.q.shift()!;
      out.push(await processJob(platform, job));
    }
    this.results.push(...out);
    return out;
  }

  listResults(): JobResult[] {
    return [...this.results];
  }
}

export class RedisJobQueue implements JobQueue {
  readonly backend = "redis" as const;
  private queue: import("bullmq").Queue;
  private worker?: import("bullmq").Worker;
  private connection: { host: string; port: number; password?: string };

  private constructor(
    queue: import("bullmq").Queue,
    connection: { host: string; port: number; password?: string },
  ) {
    this.queue = queue;
    this.connection = connection;
  }

  static async connect(redisUrl: string, opts?: { startWorker?: boolean }): Promise<RedisJobQueue> {
    const { Queue, Worker } = await import("bullmq");
    const u = new URL(redisUrl);
    const connection = {
      host: u.hostname,
      port: Number(u.port || 6379),
      ...(u.password ? { password: decodeURIComponent(u.password) } : {}),
    };
    const queue = new Queue(QUEUE_NAME, { connection });
    const jq = new RedisJobQueue(queue, connection);
    if (opts?.startWorker !== false) {
      jq.worker = new Worker(
        QUEUE_NAME,
        async (bullJob) => {
          const platform = createPlatform({
            includeMock: true,
            pyai: { apiKey: process.env.PYAI_API_KEY, baseUrl: process.env.PYAI_BASE_URL },
            openai: { apiKey: process.env.OPENAI_API_KEY },
            gemini: { apiKey: process.env.GEMINI_API_KEY },
          });
          const data = bullJob.data as { kind: JobKind; payload: Record<string, unknown> };
          return processJob(platform, { id: String(bullJob.id), kind: data.kind, payload: data.payload });
        },
        { connection },
      );
    }
    return jq;
  }

  async enqueue(kind: JobKind, payload: Record<string, unknown>): Promise<Job> {
    const id = `job_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    await this.queue.add(kind, { kind, payload }, { jobId: id, removeOnComplete: 100, removeOnFail: 50 });
    return { id, kind, payload, createdAt: Date.now() };
  }

  async close(): Promise<void> {
    await this.worker?.close();
    await this.queue.close();
  }
}

export async function createJobQueue(opts?: {
  redisUrl?: string;
  /** When true and Redis is used, start a BullMQ Worker in-process. */
  startWorker?: boolean;
}): Promise<JobQueue> {
  const redisUrl = opts?.redisUrl ?? process.env.REDIS_URL;
  const forceMemory =
    process.env.JOBS_BACKEND === "memory" ||
    process.env.VITEST === "true" ||
    process.env.NODE_ENV === "test";
  if (!forceMemory && redisUrl?.trim()) {
    try {
      const Redis = (await import("ioredis")).default;
      const probe = new Redis(redisUrl.trim(), {
        maxRetriesPerRequest: 1,
        connectTimeout: 1500,
        lazyConnect: true,
        enableOfflineQueue: false,
      });
      await probe.connect();
      await probe.ping();
      await probe.quit();
      return await RedisJobQueue.connect(redisUrl.trim(), { startWorker: opts?.startWorker });
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn("Redis queue unavailable, falling back to memory:", String(e));
    }
  }
  return new InMemoryQueue();
}

export async function startWorker(): Promise<void> {
  const queue = await createJobQueue({ startWorker: true });
  // eslint-disable-next-line no-console
  console.log(`PyAI worker ready (backend=${queue.backend}).`);
  if (process.env.WORKER_DEMO === "1" && queue.backend === "memory") {
    await queue.enqueue("scrib.dictate", { rawText: "hello uh team" });
    const results = await queue.drain?.();
    // eslint-disable-next-line no-console
    console.log(results);
  }
  // Redis workers stay alive via BullMQ; memory mode parks for process managers.
  if (queue.backend === "redis") {
    await new Promise(() => {});
  }
}

const isMain =
  typeof process.argv[1] === "string" &&
  (process.argv[1].includes(`${"/"}apps${"/"}worker${"/"}`) ||
    /[/\\]worker[/\\]src[/\\]index\.ts$/.test(process.argv[1]));
if (isMain) {
  startWorker().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
