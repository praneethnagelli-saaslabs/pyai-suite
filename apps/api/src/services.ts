import { Capability, createPlatform, type Platform } from "@pyai/core";
import { MeetingMemory } from "@pyai/brief";
import { createMeetingStore, createRunStore, type RunStore } from "@pyai/db";
import { createJobQueue, type JobQueue, InMemoryQueue } from "@pyai/worker";
import { createSimulatorCatalog, type SimulatorCatalog } from "@pyai/simulator";

/**
 * App-wide services built once and shared by every route (spec #55).
 */
export interface AppServices {
  platform: Platform;
  meetingMemory: MeetingMemory;
  runStore: RunStore;
  jobs: JobQueue;
  simulator: SimulatorCatalog;
}

export async function createServices(): Promise<AppServices> {
  const platform = createPlatform({
    includeMock: true,
    pyai: { apiKey: process.env.PYAI_API_KEY, baseUrl: process.env.PYAI_BASE_URL },
    openai: { apiKey: process.env.OPENAI_API_KEY },
    gemini: { apiKey: process.env.GEMINI_API_KEY },
  });
  const runStore = await createRunStore(process.env.DATABASE_URL);
  const meetingStore = await createMeetingStore(process.env.DATABASE_URL);
  const embeddings =
    platform.registry.getAdapterFor(Capability.EMBEDDINGS)?.asEmbeddings?.() ??
    platform.registry.getAdapterFor(Capability.EMBEDDINGS, "mock")?.asEmbeddings?.();
  const llm =
    platform.registry.getAdapterFor(Capability.LLM)?.asLLM?.() ??
    platform.registry.getAdapterFor(Capability.LLM, "mock")?.asLLM?.();
  if (!embeddings || !llm) {
    throw new Error("meeting memory needs embeddings and LLM adapters");
  }
  // API enqueues only — worker process owns the BullMQ consumer when REDIS_URL is set.
  let jobs: JobQueue;
  try {
    jobs = await createJobQueue({ redisUrl: process.env.REDIS_URL, startWorker: false });
  } catch {
    jobs = new InMemoryQueue();
  }
  return {
    platform,
    meetingMemory: new MeetingMemory(meetingStore, embeddings, llm),
    runStore,
    jobs,
    simulator: createSimulatorCatalog(),
  };
}
