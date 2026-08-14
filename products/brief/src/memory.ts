import type { EmbeddingsAdapter, LLMAdapter } from "@pyai/core";
import type { MeetingStore, StoredChunk } from "@pyai/db";
import type { MeetingNotes } from "./schema.js";

const SEARCH_STOP = new Set([
  "a", "an", "the", "and", "or", "but", "if", "to", "of", "in", "on", "for", "at", "by", "from", "with", "as",
  "is", "are", "was", "were", "be", "been", "do", "did", "does", "what", "when", "where", "who", "whom", "which",
  "how", "why", "about", "this", "that", "these", "those", "we", "our", "you", "your", "i", "me", "my", "it",
  "its", "any", "can", "could", "should", "would", "will", "let", "lets", "decide", "decided", "decision",
  "decisions", "meeting", "notes", "please", "tell",
]);

const ANSWER_SCHEMA = {
  type: "object",
  properties: {
    answer: { type: "string", description: "1–3 sentence answer grounded only in the excerpts" },
    grounded: { type: "boolean", description: "true only if the excerpts actually answer the question" },
  },
  required: ["answer", "grounded"],
};

export function searchTokens(query: string): string[] {
  return query
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]+/gu, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 2 && !SEARCH_STOP.has(w));
}

function normalizeHay(hay: string): string {
  return ` ${hay.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim()} `;
}

function scoreHay(hay: string, phrase: string, words: string[]): number {
  const h = hay.toLowerCase();
  if (!h.trim()) return 0;
  let score = 0;
  const p = phrase.trim().toLowerCase();
  if (p.length >= 3 && h.includes(p)) score += 12;
  if (!words.length) return score;
  const padded = normalizeHay(hay);
  const hits = words.filter((w) => padded.includes(` ${w} `));
  if (!hits.length) return score;
  score += hits.length * 3;
  if (hits.length === words.length) score += 6;
  return score;
}

function cosine(a: number[], b: number[]): number {
  if (!a.length || a.length !== b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  const d = Math.sqrt(na) * Math.sqrt(nb);
  return d ? dot / d : 0;
}

function chunkMeeting(
  id: string,
  date: string,
  notes: MeetingNotes,
  transcript: string,
): Array<Omit<StoredChunk, "embedding">> {
  const title = notes.title || "Untitled meeting";
  const out: Array<Omit<StoredChunk, "embedding">> = [];
  const push = (kind: string, text: string, evidence: string, i: number) => {
    const t = text.trim();
    if (t.length < 4) return;
    out.push({
      id: `${id}:${kind}:${i}`,
      meetingId: id,
      date,
      title,
      kind,
      text: t.slice(0, 1200),
      evidence: (evidence || t).slice(0, 240),
    });
  };

  push("summary", `${notes.title}. ${notes.summary}`, notes.summary, 0);
  notes.decisions.forEach((d, i) =>
    push("decision", d.decision, d.evidence.excerpt ?? d.decision, i),
  );
  notes.actionItems.forEach((a, i) =>
    push("action", `${a.owner}: ${a.task}${a.deadline ? ` by ${a.deadline}` : ""}`, a.evidence.excerpt ?? a.task, i),
  );
  notes.questions.forEach((q, i) => push("question", q.question, q.evidence?.excerpt ?? q.question, i));
  notes.importantMoments.forEach((m, i) => push("moment", m.moment, m.moment, i));

  const lines = transcript
    .split(/\n+/)
    .map((l) => l.trim())
    .filter((l) => l.length >= 8);
  for (let i = 0; i < lines.length; i += 2) {
    const block = lines.slice(i, i + 2).join(" ");
    push("transcript", block.replace(/^[^:]{1,24}:\s*/, ""), block, i);
  }
  return out;
}

async function embedBatch(embed: EmbeddingsAdapter, texts: string[]): Promise<number[][]> {
  if (!texts.length) return [];
  const out: number[][] = [];
  for (let i = 0; i < texts.length; i += 16) {
    const batch = texts.slice(i, i + 16);
    try {
      const res = await embed.embed({ input: batch });
      for (let j = 0; j < batch.length; j++) {
        out.push(res.embeddings[j] ?? []);
      }
    } catch {
      for (let j = 0; j < batch.length; j++) out.push([]);
    }
  }
  return out;
}

export type MemoryHit = {
  meetingId: string;
  date: string;
  title?: string;
  kind?: string;
  answer: string;
  evidence: string;
};

export type MemorySearchResult = {
  query: string;
  answer: string | null;
  grounded: boolean;
  backend: "memory" | "postgres";
  results: MemoryHit[];
  meetings: Array<{ id: string; date: string; title: string; mode: string }>;
};

/** Durable meeting memory: store in MeetingStore, retrieve with embeddings, answer with LLM. */
export class MeetingMemory {
  constructor(
    private readonly store: MeetingStore,
    private readonly embeddings: EmbeddingsAdapter,
    private readonly llm: LLMAdapter,
  ) {}

  get backend(): "memory" | "postgres" {
    return this.store.backend;
  }

  async add(id: string, notes: MeetingNotes, transcript: string, date = new Date().toISOString()): Promise<void> {
    const safeId = id.trim().slice(0, 120);
    if (!safeId) return;
    await this.store.saveMeeting({
      id: safeId,
      date,
      title: notes.title,
      mode: notes.mode,
      notes,
      transcript,
    });
    const parts = chunkMeeting(safeId, date, notes, transcript);
    const vectors = await embedBatch(
      this.embeddings,
      parts.map((p) => p.text),
    );
    await this.store.replaceChunks(
      safeId,
      parts.map((p, i) => ({ ...p, embedding: vectors[i] ?? [] })),
    );
  }

  async search(query: string): Promise<MemorySearchResult> {
    const q = query.trim().slice(0, 400);
    const meetings = await this.store.listMeetings();
    if (!q) {
      return { query: q, answer: null, grounded: false, backend: this.store.backend, results: [], meetings };
    }

    const chunks = await this.store.loadChunks();
    if (!chunks.length) {
      return { query: q, answer: null, grounded: false, backend: this.store.backend, results: [], meetings };
    }

    const words = searchTokens(q);
    let qVec: number[] = [];
    try {
      qVec = (await this.embeddings.embed({ input: q })).embeddings[0] ?? [];
    } catch {
      qVec = [];
    }

    const ranked = chunks
      .map((c) => {
        const kw = scoreHay(`${c.text} ${c.evidence} ${c.title}`, q, words);
        const sem = cosine(qVec, c.embedding);
        return { chunk: c, kw, sem, score: sem * 8 + kw };
      })
      .filter((r) => r.kw > 0 || r.sem >= 0.55)
      .sort((a, b) => b.score - a.score || a.chunk.text.localeCompare(b.chunk.text))
      .slice(0, 8);

    if (!ranked.length) {
      return { query: q, answer: null, grounded: false, backend: this.store.backend, results: [], meetings };
    }

    const hits: MemoryHit[] = ranked.map(({ chunk: c }) => ({
      meetingId: c.meetingId,
      date: c.date,
      title: c.title,
      kind: c.kind,
      answer: c.text,
      evidence: c.evidence,
    }));

    const excerpts = ranked
      .map(
        ({ chunk: c }, i) =>
          `[${i + 1}] kind=${c.kind} meeting=${c.title || c.meetingId}\n${c.text}\nEvidence: ${c.evidence}`,
      )
      .join("\n\n");

    let answer: string | null = hits[0]?.answer ?? null;
    let grounded = false;
    try {
      const res = await this.llm.complete({
        messages: [
          {
            role: "system",
            content:
              "You answer questions about stored meetings. Use only the excerpts. If they do not contain the answer, set grounded=false and say you do not have that in stored meetings. Never invent meetings, dates, or decisions.",
          },
          {
            role: "user",
            content: `QUESTION:\n${q}\n\nEXCERPTS:\n${excerpts}\n\nAnswer using only these excerpts.`,
          },
        ],
        jsonSchema: ANSWER_SCHEMA,
        temperature: 0,
        maxTokens: 400,
      });
      const parsed = res.parsed as { answer?: unknown; grounded?: unknown } | undefined;
      const text =
        typeof parsed?.answer === "string"
          ? parsed.answer.trim()
          : typeof res.text === "string"
            ? res.text.trim()
            : "";
      if (text) answer = text.slice(0, 800);
      grounded = parsed?.grounded === true && Boolean(answer);
      if (parsed?.grounded === false) {
        grounded = false;
        answer = text || "I don't have that in stored meetings.";
      } else if (parsed?.grounded === true) {
        grounded = true;
      }
    } catch {
      grounded = ranked[0]!.kw > 0;
    }

    return {
      query: q,
      answer,
      grounded,
      backend: this.store.backend,
      results: grounded ? hits : [],
      meetings,
    };
  }

  async list() {
    return this.store.listMeetings();
  }

  async get(id: string) {
    return this.store.getMeeting(id.trim().slice(0, 120));
  }
}
