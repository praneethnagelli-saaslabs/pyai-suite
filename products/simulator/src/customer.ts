import type { Scenario } from "./scenarios.js";

export interface CustomerTurn {
  say: string;
  end: boolean;
  reason: string;
}

const FOLLOW_UPS = [
  "I already called twice. Can you actually fix this?",
  "That's not what I was told last time.",
  "Fine — what is the next concrete step?",
  "I need this resolved today or I want a supervisor.",
];

export function buildCustomerSystem(scenario: Scenario): string {
  return [
    "You are roleplaying a phone caller speaking to a voice agent.",
    `Name/persona: ${scenario.customerPersona}`,
    `Mood: ${scenario.emotionalState}`,
    `Personality: ${scenario.personality}`,
    `Goal: ${scenario.goal}`,
    `Patience: ${scenario.patience}`,
    scenario.objections.length ? `Objections: ${scenario.objections.join("; ")}` : "",
    scenario.known.length ? `You know: ${scenario.known.join("; ")}` : "",
    scenario.unknown.length ? `You do not know: ${scenario.unknown.join("; ")}` : "",
    `Escalation: ${scenario.escalation}`,
    "Speak in one short spoken utterance (1–2 sentences). No stage directions.",
    'Return JSON only: {"say":"...","end":false,"reason":""}',
    "Set end=true when the goal is met, you hang up, or you asked for a human.",
  ]
    .filter(Boolean)
    .join("\n");
}

export function parseCustomerTurn(raw: string): CustomerTurn {
  const text = String(raw ?? "").replace(/[\u0000-\u001f]/g, " ").trim().slice(0, 2_000);
  const jsonStart = text.indexOf("{");
  const jsonEnd = text.lastIndexOf("}");
  if (jsonStart >= 0 && jsonEnd > jsonStart) {
    try {
      const parsed = JSON.parse(text.slice(jsonStart, jsonEnd + 1)) as {
        say?: unknown;
        end?: unknown;
        reason?: unknown;
      };
      const say = clipSay(String(parsed.say ?? ""));
      if (say) {
        return {
          say,
          end: Boolean(parsed.end),
          reason: String(parsed.reason ?? "").replace(/[\u0000-\u001f]/g, " ").trim().slice(0, 160),
        };
      }
    } catch {
      /* fall through */
    }
  }
  const say = clipSay(text.replace(/^```(?:json)?/i, "").replace(/```$/i, ""));
  return { say: say || "Hello?", end: false, reason: "" };
}

export function mockCustomerTurn(scenario: Scenario, turnIndex: number, agentLast: string): CustomerTurn {
  if (turnIndex <= 0) {
    return { say: scenario.openingLine, end: false, reason: "opening" };
  }
  const lower = agentLast.toLowerCase();
  if (turnIndex >= 4 || /supervisor|human|transfer|goodbye|resolved/i.test(lower)) {
    return {
      say: scenario.patience === "low" ? "Put me through to a supervisor now." : "Okay, thanks. That's all I needed.",
      end: true,
      reason: "scripted_end",
    };
  }
  const line = FOLLOW_UPS[(turnIndex - 1) % FOLLOW_UPS.length]!;
  if (scenario.objections[0] && turnIndex === 2) {
    return { say: clipSay(scenario.objections[0]) || line, end: false, reason: "objection" };
  }
  return { say: line, end: false, reason: "follow_up" };
}

function clipSay(value: string): string {
  return value.replace(/[\u0000-\u001f]/g, " ").replace(/^["']|["']$/g, "").trim().slice(0, 400);
}
