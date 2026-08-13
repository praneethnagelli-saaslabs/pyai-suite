import { createPlatform, type Platform } from "@pyai/core";
import { MeetingMemory } from "@pyai/brief";
import { createRunStore, type RunStore } from "@pyai/db";
import { createJobQueue, type JobQueue, InMemoryQueue } from "@pyai/worker";

/**
 * App-wide services built once and shared by every route (spec #55).
 */
export interface AppServices {
  platform: Platform;
  meetingMemory: MeetingMemory;
  runStore: RunStore;
  jobs: JobQueue;
}

export async function createServices(): Promise<AppServices> {
  const platform = createPlatform({
    includeMock: true,
    pyai: { apiKey: process.env.PYAI_API_KEY, baseUrl: process.env.PYAI_BASE_URL },
    openai: { apiKey: process.env.OPENAI_API_KEY },
    gemini: { apiKey: process.env.GEMINI_API_KEY },
  });
  const runStore = await createRunStore(process.env.DATABASE_URL);
  // API enqueues only — worker process owns the BullMQ consumer when REDIS_URL is set.
  let jobs: JobQueue;
  try {
    jobs = await createJobQueue({ redisUrl: process.env.REDIS_URL, startWorker: false });
  } catch {
    jobs = new InMemoryQueue();
  }
  return { platform, meetingMemory: new MeetingMemory(), runStore, jobs };
}
