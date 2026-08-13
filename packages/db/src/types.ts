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

export type MeetingListItem = {
  id: string;
  date: string;
  title: string;
  mode: string;
};

export type StoredMeeting = MeetingListItem & {
  notes: unknown;
  transcript: string;
};

export type StoredChunk = {
  id: string;
  meetingId: string;
  date: string;
  title: string;
  kind: string;
  text: string;
  evidence: string;
  embedding: number[];
};

export interface MeetingStore {
  readonly backend: "memory" | "postgres";
  saveMeeting(meeting: StoredMeeting): Promise<void>;
  listMeetings(): Promise<MeetingListItem[]>;
  replaceChunks(meetingId: string, chunks: StoredChunk[]): Promise<void>;
  loadChunks(): Promise<StoredChunk[]>;
}
