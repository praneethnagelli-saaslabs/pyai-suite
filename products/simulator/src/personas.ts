/**
 * Persona + adversarial scenario engine (spec #49, #50).
 */

export interface Persona {
  id: string;
  label: string;
  goal: string;
  personality: string;
  emotionalState: string;
  patience: "low" | "medium" | "high";
  hiddenObjective?: string;
  failureTriggers: string[];
  openingLine: string;
}

export interface AdversarialScenario {
  id: string;
  label: string;
  behaviors: string[];
}

export const PERSONAS: Persona[] = [
  {
    id: "angry_customer",
    label: "Angry customer",
    goal: "Get a refund immediately",
    personality: "confrontational",
    emotionalState: "angry",
    patience: "low",
    failureTriggers: ["holds", "upsell", "scripted apology"],
    openingLine: "This is ridiculous. I want a refund right now.",
  },
  {
    id: "confused_customer",
    label: "Confused customer",
    goal: "Understand the bill",
    personality: "hesitant",
    emotionalState: "confused",
    patience: "medium",
    failureTriggers: ["jargon", "fast speech"],
    openingLine: "Um… I think something is wrong with my bill but I'm not sure.",
  },
  {
    id: "price_shopper",
    label: "Price shopper",
    goal: "Compare competitors and get a discount",
    personality: "transactional",
    emotionalState: "skeptical",
    patience: "medium",
    hiddenObjective: "Mention competitor X mid-call",
    failureTriggers: ["no price match", "ignore competitor"],
    openingLine: "Your competitor offered me 30% off. Can you beat that?",
  },
  {
    id: "silent_customer",
    label: "Silent customer",
    goal: "Force the agent to lead",
    personality: "minimal",
    emotionalState: "neutral",
    patience: "high",
    failureTriggers: ["dead air > 5s", "ending call early"],
    openingLine: "Hello.",
  },
  {
    id: "technical_customer",
    label: "Technical customer",
    goal: "Debug an API integration",
    personality: "precise",
    emotionalState: "impatient",
    patience: "low",
    failureTriggers: ["wrong tool call", "hallucinated error codes"],
    openingLine: "Your webhook returns 401 even with a valid HMAC signature.",
  },
];

export const SCENARIOS: AdversarialScenario[] = [
  { id: "interrupt", label: "Interrupt repeatedly", behaviors: ["barge-in", "talk over agent"] },
  { id: "topic_shift", label: "Change topic unexpectedly", behaviors: ["topic shift"] },
  { id: "contradict", label: "Ask contradictory questions", behaviors: ["contradiction"] },
  { id: "incomplete", label: "Provide incomplete information", behaviors: ["omit details"] },
  { id: "escalate", label: "Demand escalation", behaviors: ["ask for human"] },
  { id: "ambiguous", label: "Use ambiguous language", behaviors: ["ambiguity"] },
];

export function pickPersona(id?: string): Persona {
  return PERSONAS.find((p) => p.id === id) ?? PERSONAS[0]!;
}

export function pickScenario(id?: string): AdversarialScenario {
  return SCENARIOS.find((s) => s.id === id) ?? SCENARIOS[0]!;
}
