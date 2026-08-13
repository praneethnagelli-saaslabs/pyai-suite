import { z } from "zod";

/**
 * CallIQ extraction schema (spec #30, #31, #32). Every field that asserts a
 * fact carries `evidence` pointing at a transcript span. The schema gate and
 * evidence gate enforce this downstream.
 */

export const EvidenceSpanSchema = z.object({
  source: z.string(),
  start: z.number().optional(),
  end: z.number().optional(),
  speaker: z.string().optional(),
  segmentRef: z.string().optional(),
  excerpt: z.string().optional(),
});

export const ObjectionSchema = z.object({
  type: z.enum(["Pricing", "Implementation", "Security", "Competitor", "Timing", "Other"]),
  detail: z.string(),
  severity: z.enum(["low", "medium", "high"]),
  evidence: EvidenceSpanSchema,
});

export const BuyingSignalSchema = z.object({
  type: z.enum(["urgency", "intent", "budget", "authority", "timeline", "objection_resolved"]),
  detail: z.string(),
  evidence: EvidenceSpanSchema,
});

export const RiskSchema = z.object({
  type: z.enum([
    "no_next_meeting",
    "no_decision_maker",
    "unresolved_objection",
    "weak_buying_signal",
    "competitor_risk",
    "timeline_risk",
  ]),
  detail: z.string(),
  severity: z.enum(["low", "medium", "high"]),
  evidence: EvidenceSpanSchema.optional(),
});

export const NextStepSchema = z.object({
  owner: z.string(),
  task: z.string(),
  deadline: z.string().optional(),
  evidence: EvidenceSpanSchema,
});

export const ParticipantSchema = z.object({
  name: z.string(),
  role: z.enum(["Sales Rep", "Customer", "Other"]).optional(),
  talkSeconds: z.number().optional(),
});

export const CallAnalysisSchema = z.object({
  summary: z.string(),
  participants: z.array(ParticipantSchema),
  dealStage: z.enum(["Discovery", "Evaluation", "Proposal", "Negotiation", "Closed Won", "Closed Lost"]),
  dealHealthScore: z.number().min(0).max(100),
  dealHealthRationale: z.string(),
  objections: z.array(ObjectionSchema),
  buyingSignals: z.array(BuyingSignalSchema),
  risks: z.array(RiskSchema),
  competitorMentions: z.array(z.string()),
  pricingObjections: z.array(z.string()),
  nextSteps: z.array(NextStepSchema),
  followUpEmail: z.string(),
  followUpSlack: z.string(),
  crmJson: z.record(z.unknown()),
});

export type CallAnalysis = z.infer<typeof CallAnalysisSchema>;
export type Objection = z.infer<typeof ObjectionSchema>;
export type Risk = z.infer<typeof RiskSchema>;
export type NextStep = z.infer<typeof NextStepSchema>;

export const ANALYSIS_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    summary: {
      type: "string",
      description: "2-4 sentence summary of the sales call and outcome trajectory",
    },
    participants: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          name: { type: "string" },
          role: { type: "string", enum: ["Sales Rep", "Customer", "Other"] },
          talkSeconds: { type: "number" },
        },
        required: ["name", "role"],
      },
    },
    dealStage: {
      type: "string",
      enum: ["Discovery", "Evaluation", "Proposal", "Negotiation", "Closed Won", "Closed Lost"],
    },
    dealHealthScore: { type: "number", minimum: 0, maximum: 100 },
    dealHealthRationale: { type: "string" },
    objections: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          type: {
            type: "string",
            enum: ["Pricing", "Implementation", "Security", "Competitor", "Timing", "Other"],
          },
          detail: { type: "string", description: "Concrete customer concern in one sentence" },
          severity: { type: "string", enum: ["low", "medium", "high"] },
          evidence: {
            type: "object",
            additionalProperties: false,
            properties: {
              source: { type: "string" },
              start: { type: "number" },
              end: { type: "number" },
              speaker: { type: "string" },
              segmentRef: { type: "string" },
              excerpt: { type: "string" },
            },
            required: ["source", "excerpt"],
          },
        },
        required: ["type", "detail", "severity", "evidence"],
      },
    },
    buyingSignals: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          type: {
            type: "string",
            enum: ["urgency", "intent", "budget", "authority", "timeline", "objection_resolved"],
          },
          detail: { type: "string" },
          evidence: {
            type: "object",
            additionalProperties: false,
            properties: {
              source: { type: "string" },
              start: { type: "number" },
              end: { type: "number" },
              speaker: { type: "string" },
              segmentRef: { type: "string" },
              excerpt: { type: "string" },
            },
            required: ["source", "excerpt"],
          },
        },
        required: ["type", "detail", "evidence"],
      },
    },
    risks: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          type: {
            type: "string",
            enum: [
              "no_next_meeting",
              "no_decision_maker",
              "unresolved_objection",
              "weak_buying_signal",
              "competitor_risk",
              "timeline_risk",
            ],
          },
          detail: { type: "string" },
          severity: { type: "string", enum: ["low", "medium", "high"] },
          evidence: {
            type: "object",
            additionalProperties: false,
            properties: {
              source: { type: "string" },
              start: { type: "number" },
              end: { type: "number" },
              speaker: { type: "string" },
              segmentRef: { type: "string" },
              excerpt: { type: "string" },
            },
            required: ["source", "excerpt"],
          },
        },
        required: ["type", "detail", "severity"],
      },
    },
    competitorMentions: { type: "array", items: { type: "string" } },
    pricingObjections: { type: "array", items: { type: "string" } },
    nextSteps: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          owner: { type: "string" },
          task: { type: "string" },
          deadline: { type: "string" },
          evidence: {
            type: "object",
            additionalProperties: false,
            properties: {
              source: { type: "string" },
              start: { type: "number" },
              end: { type: "number" },
              speaker: { type: "string" },
              segmentRef: { type: "string" },
              excerpt: { type: "string" },
            },
            required: ["source", "excerpt"],
          },
        },
        required: ["owner", "task", "evidence"],
      },
    },
    followUpEmail: { type: "string" },
    followUpSlack: { type: "string" },
    crmJson: { type: "object", additionalProperties: true },
  },
  required: [
    "summary",
    "participants",
    "dealStage",
    "dealHealthScore",
    "dealHealthRationale",
    "objections",
    "buyingSignals",
    "risks",
    "competitorMentions",
    "pricingObjections",
    "nextSteps",
    "followUpEmail",
    "followUpSlack",
    "crmJson",
  ],
} as const;
