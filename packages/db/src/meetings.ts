import postgres from "postgres";
import type { MeetingListItem, MeetingStore, StoredChunk, StoredMeeting } from "./types.js";

type Sql = ReturnType<typeof postgres>;

export class MemoryMeetingStore implements MeetingStore {
  readonly backend = "memory" as const;
  private meetings = new Map<string, StoredMeeting>();
  private chunks: StoredChunk[] = [];

  async saveMeeting(meeting: StoredMeeting): Promise<void> {
    this.meetings.set(meeting.id, { ...meeting });
  }

  async listMeetings(): Promise<MeetingListItem[]> {
    return [...this.meetings.values()]
      .sort((a, b) => b.date.localeCompare(a.date))
      .map(({ id, date, title, mode }) => ({ id, date, title, mode }));
  }

  async replaceChunks(meetingId: string, chunks: StoredChunk[]): Promise<void> {
    this.chunks = this.chunks.filter((c) => c.meetingId !== meetingId).concat(chunks.map((c) => ({ ...c })));
  }

  async loadChunks(): Promise<StoredChunk[]> {
    return this.chunks.map((c) => ({ ...c, embedding: [...c.embedding] }));
  }
}

export class PostgresMeetingStore implements MeetingStore {
  readonly backend = "postgres" as const;

  private constructor(private sql: Sql) {}

  static async connect(databaseUrl: string): Promise<PostgresMeetingStore> {
    const sql = postgres(databaseUrl, { max: 5, idle_timeout: 20, connect_timeout: 5 });
    await sql`
      CREATE TABLE IF NOT EXISTS brief_meetings (
        id TEXT PRIMARY KEY,
        date TIMESTAMPTZ NOT NULL,
        title TEXT NOT NULL DEFAULT '',
        mode TEXT NOT NULL DEFAULT '',
        notes JSONB NOT NULL,
        transcript TEXT NOT NULL
      )
    `;
    await sql`
      CREATE TABLE IF NOT EXISTS brief_chunks (
        id TEXT PRIMARY KEY,
        meeting_id TEXT NOT NULL REFERENCES brief_meetings(id) ON DELETE CASCADE,
        date TIMESTAMPTZ NOT NULL,
        title TEXT NOT NULL DEFAULT '',
        kind TEXT NOT NULL,
        text TEXT NOT NULL,
        evidence TEXT NOT NULL,
        embedding JSONB NOT NULL
      )
    `;
    await sql`CREATE INDEX IF NOT EXISTS brief_chunks_meeting_idx ON brief_chunks (meeting_id)`;
    await sql`CREATE INDEX IF NOT EXISTS brief_meetings_date_idx ON brief_meetings (date DESC)`;
    return new PostgresMeetingStore(sql);
  }

  async saveMeeting(meeting: StoredMeeting): Promise<void> {
    await this.sql`
      INSERT INTO brief_meetings (id, date, title, mode, notes, transcript)
      VALUES (
        ${meeting.id},
        ${meeting.date},
        ${meeting.title},
        ${meeting.mode},
        ${this.sql.json((meeting.notes ?? {}) as never)},
        ${meeting.transcript}
      )
      ON CONFLICT (id) DO UPDATE SET
        date = EXCLUDED.date,
        title = EXCLUDED.title,
        mode = EXCLUDED.mode,
        notes = EXCLUDED.notes,
        transcript = EXCLUDED.transcript
    `;
  }

  async listMeetings(): Promise<MeetingListItem[]> {
    const rows = await this.sql<{ id: string; date: Date | string; title: string; mode: string }[]>`
      SELECT id, date, title, mode FROM brief_meetings ORDER BY date DESC
    `;
    return rows.map((r) => ({
      id: r.id,
      date: typeof r.date === "string" ? r.date : r.date.toISOString(),
      title: r.title,
      mode: r.mode,
    }));
  }

  async replaceChunks(meetingId: string, chunks: StoredChunk[]): Promise<void> {
    await this.sql`DELETE FROM brief_chunks WHERE meeting_id = ${meetingId}`;
    for (const c of chunks) {
      await this.sql`
        INSERT INTO brief_chunks (id, meeting_id, date, title, kind, text, evidence, embedding)
        VALUES (
          ${c.id},
          ${c.meetingId},
          ${c.date},
          ${c.title},
          ${c.kind},
          ${c.text},
          ${c.evidence},
          ${this.sql.json(c.embedding as never)}
        )
      `;
    }
  }

  async loadChunks(): Promise<StoredChunk[]> {
    const rows = await this.sql<
      {
        id: string;
        meeting_id: string;
        date: Date | string;
        title: string;
        kind: string;
        text: string;
        evidence: string;
        embedding: number[] | unknown;
      }[]
    >`
      SELECT id, meeting_id, date, title, kind, text, evidence, embedding FROM brief_chunks
    `;
    return rows.map((r) => ({
      id: r.id,
      meetingId: r.meeting_id,
      date: typeof r.date === "string" ? r.date : r.date.toISOString(),
      title: r.title,
      kind: r.kind,
      text: r.text,
      evidence: r.evidence,
      embedding: Array.isArray(r.embedding) ? r.embedding.map(Number) : [],
    }));
  }

  async close(): Promise<void> {
    await this.sql.end({ timeout: 5 });
  }
}

/** Prefer Postgres when DATABASE_URL is reachable; otherwise in-process (tests / no Docker). */
export async function createMeetingStore(databaseUrl = process.env.DATABASE_URL): Promise<MeetingStore> {
  if (!databaseUrl?.trim()) return new MemoryMeetingStore();
  try {
    return await PostgresMeetingStore.connect(databaseUrl.trim());
  } catch {
    return new MemoryMeetingStore();
  }
}
