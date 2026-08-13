import { z } from "zod";

export const MEETING_MODES = [
  "1:1",
  "Sales",
  "Customer discovery",
  "Investor",
  "Standup",
  "Interview",
  "Planning",
  "Brainstorm",
  "Performance review",
  "Custom",
] as const;

export type MeetingMode = (typeof MEETING_MODES)[number];

export const EvidenceSchema = z.object({
  source: z.string(),
  start: z.number().optional(),
  end: z.number().optional(),
  speaker: z.string().optional(),
  excerpt: z.string().optional(),
});

export const MeetingNotesSchema = z.object({
  title: z.string(),
  mode: z.string(),
  summary: z.string(),
  decisions: z.array(z.object({ decision: z.string(), evidence: EvidenceSchema })),
  actionItems: z.array(
    z.object({
      owner: z.string(),
      task: z.string(),
      deadline: z.string().optional(),
      evidence: EvidenceSchema,
    }),
  ),
  questions: z.array(z.object({ question: z.string(), evidence: EvidenceSchema.optional() })),
  importantMoments: z.array(z.object({ moment: z.string(), start: z.number().optional(), end: z.number().optional() })),
  participants: z.array(z.string()),
});

export type MeetingNotes = z.infer<typeof MeetingNotesSchema>;

const EvidenceJson = {
  type: "object",
  properties: {
    source: { type: "string" },
    start: { type: "number" },
    end: { type: "number" },
    speaker: { type: "string" },
    excerpt: { type: "string" },
  },
  required: ["source"],
};

export const NOTES_JSON_SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string", description: "3–7 word meeting title, specific to the discussion" },
    mode: { type: "string" },
    summary: {
      type: "string",
      description: "2–4 sentence past-tense synthesis. Do not quote speaker labels or dump the transcript.",
    },
    decisions: {
      type: "array",
      items: {
        type: "object",
        properties: {
          decision: { type: "string", description: "Paraphrased decision, not a raw transcript line" },
          evidence: EvidenceJson,
        },
        required: ["decision", "evidence"],
      },
    },
    actionItems: {
      type: "array",
      items: {
        type: "object",
        properties: {
          owner: { type: "string" },
          task: { type: "string", description: "Verb phrase" },
          deadline: { type: "string" },
          evidence: EvidenceJson,
        },
        required: ["owner", "task", "evidence"],
      },
    },
    questions: {
      type: "array",
      items: {
        type: "object",
        properties: {
          question: { type: "string" },
          evidence: EvidenceJson,
        },
        required: ["question"],
      },
    },
    importantMoments: {
      type: "array",
      items: {
        type: "object",
        properties: {
          moment: { type: "string" },
          start: { type: "number" },
          end: { type: "number" },
        },
        required: ["moment"],
      },
    },
    participants: { type: "array", items: { type: "string" } },
  },
  required: ["title", "mode", "summary", "decisions", "actionItems", "questions", "importantMoments", "participants"],
};
