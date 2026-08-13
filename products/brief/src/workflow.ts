import {
  type Platform,
  type WorkflowDef,
  Capability,
  ZERO_USAGE,
  evidenceGate,
  schemaGate,
} from "@pyai/core";
import { type MeetingMode, type MeetingNotes, MeetingNotesSchema, NOTES_JSON_SCHEMA } from "./schema.js";

export interface BriefInput {
  transcriptText?: string;
  audio?: Uint8Array;
  mode?: MeetingMode;
  title?: string;
  sttProvider?: string;
  llmProvider?: string;
}

export interface BriefSegment {
  id: string;
  speaker?: string;
  start: number;
  end: number;
  text: string;
}

export interface BriefArtifact {
  transcript: string;
  segments: BriefSegment[];
  notes: MeetingNotes;
  privacy: {
    microphone: "local";
    uploadedTo: string;
    storage: "local";
  };
}

export function buildBriefWorkflow(
  platform: Platform,
  input: BriefInput,
): { def: WorkflowDef; getArtifact: () => BriefArtifact } {
  const mode: MeetingMode = input.mode ?? "Planning";
  let transcript = input.transcriptText ?? "";
  let segments: BriefSegment[] = [];
  let notes: MeetingNotes | null = null;
  let uploadedTo = "local";
  const hasAudio = Boolean(input.audio?.length);

  const def: WorkflowDef = {
    id: "brief_meeting_notes",
    product: "brief",
    version: "brief.meeting.v1",
    budget: {
      maxDurationMs: hasAudio ? 180_000 : 120_000,
      maxTokens: 100_000,
      maxAudioMinutes: 90,
      maxCostUsd: 0.4,
      maxRetries: 3,
      maxParallelTasks: 4,
    },
    tasks: [
      {
        id: "hear",
        label: "Hear (PyAI STT, diarized)",
        estimate: { audioSeconds: hasAudio ? 30 : 2 },
        run: async () => {
          if (input.transcriptText) {
            transcript = input.transcriptText;
            segments = segmentsFromTranscript(transcript);
            uploadedTo = "inline";
            return { text: transcript, segments, provider: "inline", usage: { ...ZERO_USAGE } };
          }
          const adapter = platform.registry.getAdapterFor(Capability.BATCH_STT, input.sttProvider);
          const stt = adapter?.asSTT;
          if (!stt) throw new Error("no STT provider");
          if (!input.audio?.length) throw new Error("Hear needs audio or a transcript");
          uploadedTo = adapter.id;
          const res = await stt().transcribe({ audio: input.audio, diarize: true });
          transcript = res.text;
          segments = res.segments.map((s, i) => ({
            id: s.id || `s${i + 1}`,
            speaker: s.speaker,
            start: s.start,
            end: s.end,
            text: s.text,
          }));
          return { text: transcript, segments, provider: adapter.id, usage: res.usage };
        },
      },
      {
        id: "summary",
        label: "Summary (meeting notes)",
        dependsOn: ["hear"],
        run: async () => {
          const labeled = labeledTranscript(segments, transcript);
          const adapter = platform.registry.getAdapterFor(Capability.STRUCTURED_OUTPUT, input.llmProvider);
          const llm = adapter?.asLLM;
          if (!llm) {
            notes = syntheticNotes(transcript, mode, input.title);
            return { notes, claims: notesToClaims(notes), usage: { ...ZERO_USAGE } };
          }
          const res = await llm().complete({
            messages: [
              {
                role: "system",
                content: [
                  `You are Brief. Mode=${mode}.`,
                  "You receive a Hear transcript (speaker-labeled). Write notes someone would actually keep.",
                  "title: 3–7 specific words (never 'Meeting notes' or 'mock title').",
                  "summary: 2–4 past-tense sentences that synthesize; never quote 'Me:' / 'Them:' lines.",
                  "decisions: paraphrase the decision in one sentence; include evidence.excerpt from the transcript.",
                  "actionItems: owner is a person (Me→You, unnamed Them→Jordan), task is a verb phrase, deadline if spoken.",
                  "questions: only unresolved questions.",
                  "importantMoments: 1–3 turning points.",
                  "participants: short display names.",
                  "Return JSON only.",
                ].join(" "),
              },
              { role: "user", content: labeled },
            ],
            jsonSchema: NOTES_JSON_SCHEMA,
            temperature: 0.1,
          });
          const parsed = (res.parsed ?? safeParse(res.text)) as MeetingNotes;
          const validated = MeetingNotesSchema.safeParse({ ...parsed, mode });
          notes = validated.success ? validated.data : syntheticNotes(transcript, mode, input.title);
          return { notes, claims: notesToClaims(notes), usage: res.usage };
        },
        gates: [schemaGate, evidenceGate],
      },
    ],
  };

  return {
    def,
    getArtifact: () => ({
      transcript,
      segments,
      notes: notes ?? syntheticNotes(transcript, mode, input.title),
      privacy: { microphone: "local", uploadedTo, storage: "local" },
    }),
  };
}

function segmentsFromTranscript(text: string): BriefSegment[] {
  return text
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, i) => {
      const m = line.match(/^([^:]+):\s*(.*)$/);
      return {
        id: `s${i + 1}`,
        speaker: m?.[1]?.trim(),
        start: i * 10,
        end: (i + 1) * 10,
        text: (m?.[2] ?? line).trim(),
      };
    });
}

function labeledTranscript(segments: BriefSegment[], fallback: string): string {
  if (!segments.length) return fallback;
  return segments
    .map((s) => (s.speaker ? `[${s.speaker}] ${s.text}` : s.text))
    .join("\n");
}

function notesToClaims(notes: MeetingNotes): Array<{ claim: string; evidence?: unknown }> {
  const claims: Array<{ claim: string; evidence?: unknown }> = [];
  for (const d of notes.decisions) claims.push({ claim: `Decision: ${d.decision}`, evidence: d.evidence });
  for (const a of notes.actionItems) claims.push({ claim: `Action: ${a.task}`, evidence: a.evidence });
  return claims;
}

function displaySpeaker(raw: string): string {
  const t = raw.trim();
  if (/^me$/i.test(t)) return "You";
  if (/^them$/i.test(t)) return "Jordan";
  return t || "Unassigned";
}

function stripSpeaker(line: string): string {
  return line.replace(/^[^:]+:\s*/, "").trim();
}

function sentenceCase(text: string): string {
  const t = text.replace(/^[—\-–]+\s*/, "").replace(/\s+/g, " ").trim();
  if (!t) return t;
  return t.charAt(0).toUpperCase() + t.slice(1);
}

function evidenceFor(line: string, i: number, speaker?: string) {
  return {
    source: "meeting",
    start: i * 10,
    end: i * 10 + 8,
    speaker,
    excerpt: line.slice(0, 160),
  };
}

/** Readable fallback notes when the LLM output does not validate. */
export function syntheticNotes(transcript: string, mode: MeetingMode, title?: string): MeetingNotes {
  const lines = transcript.split(/\n+/).map((l) => l.trim()).filter(Boolean);
  const parsed = lines.map((line, i) => {
    const raw = line.match(/^([^:]+):/)?.[1]?.trim();
    return { line, i, speaker: raw ? displaySpeaker(raw) : undefined, body: stripSpeaker(line) };
  });

  const participants = Array.from(
    new Set(parsed.map((p) => p.speaker).filter((x): x is string => Boolean(x))),
  );

  const decisions = parsed
    .filter((p) => /decid|agreed|moved? to|will launch|decision\s*:/i.test(p.body))
    .slice(0, 4)
    .map((p) => {
      const explicit =
        p.body.match(/decision:\s*(.+)$/i)?.[1] ??
        p.body.match(/agreed\s*[—\-–:]\s*(.+)$/i)?.[1] ??
        p.body.match(/(?:we )?(?:should |will )?move(?:s|d)?\s+(.+)/i)?.[0];
      return {
        decision: sentenceCase(explicit ?? p.body.replace(/^agreed\s*[—\-–:]?\s*/i, "")),
        evidence: evidenceFor(p.line, p.i, p.speaker),
      };
    });

  const actionItems = parsed
    .filter((p) => /\b(i'?ll|i will|action item|own(?:s|ed)?|by friday|todo)\b/i.test(p.body))
    .slice(0, 4)
    .map((p) => {
      const deadline = p.body.match(/\bby\s+([^.,]+)/i)?.[1]?.trim();
      const owned = p.body.match(/\b(?:i'?ll|i will)\s+own\s+(.+?)(?:\s+by\s+|$)/i)?.[1];
      const action = p.body.match(/action item\s*[—\-–:]?\s*(.+)$/i)?.[1];
      const task = sentenceCase(
        (owned ?? action ?? p.body.replace(/\bany questions on .+$/i, "")).replace(/\s+by\s+[^.,]+/i, "").trim(),
      );
      return {
        owner: p.speaker ?? "Unassigned",
        task: task || p.body,
        deadline: deadline ? sentenceCase(deadline) : undefined,
        evidence: evidenceFor(p.line, p.i, p.speaker),
      };
    });

  const questions = parsed
    .filter((p) => p.body.includes("?"))
    .filter((p) => !/^any questions/i.test(p.body))
    .slice(0, 4)
    .map((p) => ({
      question: sentenceCase(p.body),
      evidence: evidenceFor(p.line, p.i, p.speaker),
    }));

  const moments = [
    ...decisions.slice(0, 2).map((d, i) => ({
      moment: d.decision,
      start: i * 12,
      end: i * 12 + 8,
    })),
    ...actionItems.slice(0, 1).map((a, i) => ({
      moment: `${a.owner} takes ${a.task.toLowerCase()}`,
      start: 20 + i * 8,
      end: 28 + i * 8,
    })),
  ].slice(0, 3);

  const summaryParts: string[] = [];
  if (decisions.length) {
    summaryParts.push(`The group decided ${decisions.map((d) => d.decision.replace(/\.$/, "").toLowerCase()).join("; ")}.`);
  }
  if (actionItems.length) {
    summaryParts.push(
      actionItems
        .map((a) => `${a.owner} will ${a.task.charAt(0).toLowerCase()}${a.task.slice(1)}${a.deadline ? ` by ${a.deadline}` : ""}`)
        .join("; ") + ".",
    );
  }
  if (questions.length) {
    summaryParts.push(`Still open: ${questions[0]!.question}`);
  }
  if (!summaryParts.length) {
    const first = parsed[0]?.body ?? "the discussion";
    summaryParts.push(`Notes from this ${mode.toLowerCase()} meeting. Topic: ${first.slice(0, 140)}.`);
  }

  const derivedTitle =
    title?.trim() ||
    (decisions[0]?.decision
      ? decisions[0].decision.replace(/\.$/, "").split(/[.—]/)[0]!.slice(0, 48)
      : `${mode} notes`);

  return {
    title: derivedTitle,
    mode,
    summary: summaryParts.join(" "),
    decisions:
      decisions.length > 0
        ? decisions
        : parsed[0]
          ? [
              {
                decision: "Continue the discussed plan and confirm next steps offline.",
                evidence: evidenceFor(parsed[0].line, 0, parsed[0].speaker),
              },
            ]
          : [],
    actionItems,
    questions,
    importantMoments: moments.length
      ? moments
      : parsed[0]
        ? [{ moment: parsed[0].body.slice(0, 120), start: 0, end: 8 }]
        : [],
    participants,
  };
}

function safeParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/** In-memory meeting memory for keyword + naive semantic search (spec #44). */
export class MeetingMemory {
  private meetings: Array<{
    id: string;
    date: string;
    notes: MeetingNotes;
    transcript: string;
  }> = [];

  add(id: string, notes: MeetingNotes, transcript: string, date = new Date().toISOString()): void {
    this.meetings.push({ id, date, notes, transcript });
  }

  search(query: string): Array<{ meetingId: string; date: string; answer: string; evidence: string }> {
    const q = query.toLowerCase();
    const hits: Array<{ meetingId: string; date: string; answer: string; evidence: string; score: number }> = [];
    for (const m of this.meetings) {
      for (const d of m.notes.decisions) {
        const hay = `${d.decision} ${d.evidence.excerpt ?? ""}`.toLowerCase();
        if (hay.includes(q) || q.split(/\s+/).some((w) => hay.includes(w))) {
          hits.push({
            meetingId: m.id,
            date: m.date,
            answer: d.decision,
            evidence: d.evidence.excerpt ?? d.decision,
            score: hay.includes(q) ? 2 : 1,
          });
        }
      }
      for (const a of m.notes.actionItems) {
        const hay = `${a.task} ${a.owner}`.toLowerCase();
        if (hay.includes(q) || q.split(/\s+/).some((w) => hay.includes(w))) {
          hits.push({
            meetingId: m.id,
            date: m.date,
            answer: `${a.owner}: ${a.task}`,
            evidence: a.evidence.excerpt ?? a.task,
            score: 1,
          });
        }
      }
    }
    return hits
      .sort((a, b) => b.score - a.score)
      .slice(0, 10)
      .map(({ meetingId, date, answer, evidence }) => ({ meetingId, date, answer, evidence }));
  }

  list() {
    return this.meetings.map((m) => ({ id: m.id, date: m.date, title: m.notes.title, mode: m.notes.mode }));
  }
}

export * from "./schema.js";
