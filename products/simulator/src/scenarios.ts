import { PERSONAS } from "./personas.js";

export interface Scenario {
  id: string;
  name: string;
  goal: string;
  customerPersona: string;
  personality: string;
  emotionalState: string;
  patience: "low" | "medium" | "high";
  openingLine: string;
  expected: string[];
  failures: string[];
  objections: string[];
  known: string[];
  unknown: string[];
  escalation: string;
  builtIn: boolean;
}

function clip(value: unknown, max: number, fallback = ""): string {
  return String(value ?? fallback).replace(/[\u0000-\u001f]/g, " ").trim().slice(0, max);
}

function lines(value: unknown, maxItems: number, maxLen: number): string[] {
  const raw = Array.isArray(value)
    ? value
    : String(value ?? "")
        .split(/\n|;/)
        .map((s) => s.trim());
  return raw
    .map((s) => clip(s, maxLen))
    .filter(Boolean)
    .slice(0, maxItems);
}

export function sanitizeScenario(input: unknown): Scenario {
  const raw = (input ?? {}) as Record<string, unknown>;
  const patience = clip(raw.patience, 16);
  return {
    id: clip(raw.id, 64) || `scn_${Date.now().toString(36)}`,
    name: clip(raw.name, 80) || "Untitled scenario",
    goal: clip(raw.goal, 400) || "Complete the call professionally.",
    customerPersona: clip(raw.customerPersona, 500) || "A typical caller.",
    personality: clip(raw.personality, 80) || "direct",
    emotionalState: clip(raw.emotionalState, 80) || "neutral",
    patience: patience === "low" || patience === "high" ? patience : "medium",
    openingLine: clip(raw.openingLine, 280) || "Hello?",
    expected: lines(raw.expected, 8, 160),
    failures: lines(raw.failures, 8, 160),
    objections: lines(raw.objections, 6, 200),
    known: lines(raw.known, 8, 160),
    unknown: lines(raw.unknown, 8, 160),
    escalation: clip(raw.escalation, 240) || "Ask for a human if stuck twice.",
    builtIn: Boolean(raw.builtIn),
  };
}

export const BUILTIN_SCENARIOS: Scenario[] = PERSONAS.map((p) =>
  sanitizeScenario({
    id: p.id,
    name: p.label,
    goal: p.goal,
    customerPersona: `${p.label}: ${p.personality}, ${p.emotionalState}. ${p.hiddenObjective ?? ""}`.trim(),
    personality: p.personality,
    emotionalState: p.emotionalState,
    patience: p.patience,
    openingLine: p.openingLine,
    expected: [
      "Acknowledge the caller's state",
      "Stay in character as the agent",
      "Offer a next step",
    ],
    failures: p.failureTriggers,
    objections: p.hiddenObjective ? [p.hiddenObjective] : [],
    known: [p.goal],
    unknown: ["Internal account notes", "Refund policy exceptions"],
    escalation: p.patience === "low" ? "Demand a supervisor quickly." : "Ask for a human if unresolved.",
    builtIn: true,
  }),
);
