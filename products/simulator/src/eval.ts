import type { Scenario } from "./scenarios.js";

export interface EvalInput {
  transcript: string;
  scenario?: Pick<Scenario, "name" | "goal" | "expected" | "failures" | "emotionalState">;
  durationMs: number;
  turnCount: number;
  interruptions: number;
  fallbackUsed: boolean;
}

export interface EvalCheck {
  id: string;
  label: string;
  status: "pass" | "fail" | "warn";
  detail: string;
}

export interface EvalScores {
  overall: number;
  goal: number;
  adherence: number;
  empathy: number;
  latency: number;
  voice: number;
}

export interface Evaluation {
  passed: boolean;
  scores: EvalScores;
  checks: EvalCheck[];
  summary: string;
}

const ANGRY = /angry|frustrat|upset|impatient/i;
const EMPATHY = /\b(sorry|apolog|understand|frustrat|hear you|that sounds|i know this)\b/i;
const BROKE = /\b(as an ai|language model|i('m| am) just a)\b/i;
const REFUND_PROMISE = /\b(i('ll| will) (issue|process|give) (you )?a (full )?refund|refunded (immediately|right now))\b/i;

function clip(value: string, max: number): string {
  return value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, " ").trim().slice(0, max);
}

function clamp(n: number, lo = 0, hi = 100): number {
  return Math.max(lo, Math.min(hi, Math.round(n)));
}

export function formatTranscript(turns: Array<{ speaker: string; text: string }>): string {
  return turns
    .map((t) => `${t.speaker === "agent" ? "Agent" : "Customer"}: ${clip(t.text, 800)}`)
    .filter((line) => /: ./.test(line))
    .join("\n")
    .slice(0, 8_000);
}

export function speakerBlob(transcript: string, who: "agent" | "customer"): string {
  const tag = who === "agent" ? /^agent\s*:/i : /^(customer|user)\s*:/i;
  return transcript
    .split("\n")
    .filter((line) => tag.test(line))
    .map((line) => line.replace(/^[^:]+:\s*/, ""))
    .join(" ")
    .toLowerCase();
}

const HINTS: Record<string, string[]> = {
  acknowledge: ["sorry", "apolog", "understand", "hear you", "upset"],
  frustration: ["upset", "frustrat", "sorry"],
  apologize: ["sorry", "apolog"],
  resolution: ["help", "assist", "connect", "transfer"],
  transfer: ["connect", "transfer", "supervisor", "human", "specialist"],
  next: ["connect", "transfer", "help", "assist"],
  step: ["connect", "help", "assist"],
  professional: ["happy to help", "certainly", "absolutely"],
};

function keywords(label: string): string[] {
  return clip(label, 160)
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 3 && !/^(this|that|with|from|have|been|will|your|their|into|about)$/.test(w));
}

function observed(haystack: string, label: string): boolean {
  const words = keywords(label);
  if (!words.length) return haystack.includes(clip(label, 80).toLowerCase());
  const hits = words.filter((w) => haystack.includes(w) || (HINTS[w] ?? []).some((h) => haystack.includes(h))).length;
  return hits >= Math.ceil(words.length * 0.5);
}

export function evaluateCall(input: EvalInput): Evaluation {
  const transcript = clip(input.transcript, 8_000).replace(/[ \t]+\n/g, "\n");
  const agent = speakerBlob(transcript, "agent");
  const customer = speakerBlob(transcript, "customer");
  const checks: EvalCheck[] = [];
  const expected = input.scenario?.expected ?? [];
  const failures = input.scenario?.failures ?? [];

  let goalHits = 0;
  for (const exp of expected.slice(0, 8)) {
    const hit = observed(agent, exp);
    if (hit) goalHits += 1;
    checks.push({
      id: `expected:${clip(exp, 40)}`,
      label: exp,
      status: hit ? "pass" : "warn",
      detail: hit ? "Heard in the agent's replies." : "Not clearly observed.",
    });
  }
  if (agent.length < 12) {
    checks.push({
      id: "too_short",
      label: "Agent spoke enough to evaluate",
      status: "fail",
      detail: "Almost no agent speech was recorded.",
    });
  }
  const goal = expected.length
    ? clamp((goalHits / expected.length) * 100)
    : agent.length > 40
      ? 78
      : 40;

  let failHits = 0;
  for (const fail of failures.slice(0, 8)) {
    if (!observed(agent, fail) && !agent.includes(clip(fail, 80).toLowerCase())) continue;
    failHits += 1;
    checks.push({
      id: `failure:${clip(fail, 40)}`,
      label: fail,
      status: "fail",
      detail: "Matched a scenario failure condition.",
    });
  }
  if (BROKE.test(agent)) {
    failHits += 1;
    checks.push({
      id: "broke_character",
      label: "Stay in character",
      status: "fail",
      detail: "The agent referred to itself as an AI/language model.",
    });
  }
  if (REFUND_PROMISE.test(agent)) {
    failHits += 1;
    checks.push({
      id: "unsupported_promise",
      label: "No unsupported promises",
      status: "fail",
      detail: "Promised a refund without a verification step.",
    });
  }
  const adherence = clamp(100 - failHits * 28);

  const angry = ANGRY.test(input.scenario?.emotionalState ?? "") || ANGRY.test(customer);
  const kind = EMPATHY.test(agent);
  let empathy = kind ? 88 : 70;
  if (angry && kind) empathy = 92;
  if (angry && !kind) {
    empathy = 48;
    checks.push({
      id: "empathy",
      label: "Acknowledge the caller's state",
      status: "warn",
      detail: "Frustrated caller, little empathy in the agent's replies.",
    });
  } else if (kind) {
    checks.push({
      id: "empathy",
      label: "Acknowledge the caller's state",
      status: "pass",
      detail: "Empathy language was present.",
    });
  }

  const turns = Math.max(1, input.turnCount);
  const perTurn = Math.max(0, input.durationMs) / turns;
  const latency = perTurn < 1_600 ? 94 : perTurn < 3_000 ? 80 : perTurn < 5_000 ? 62 : 42;

  let voice = 90;
  if (input.fallbackUsed) {
    voice -= 8;
    checks.push({
      id: "fallback",
      label: "Primary voice provider",
      status: "warn",
      detail: "Call used a fallback provider.",
    });
  }
  if (input.interruptions > 3) voice -= 12;
  if (turns < 2) voice -= 16;
  voice = clamp(voice);

  const overall = clamp(goal * 0.3 + adherence * 0.3 + empathy * 0.15 + latency * 0.15 + voice * 0.1);
  const passed = failHits === 0 && overall >= 70 && agent.length >= 12;
  const summary = passed
    ? "The agent stayed within policy and mostly hit the scenario."
    : failHits
      ? "Failed checks — see the list before you ship this version."
      : "Score is below the 70 bar. Iterate on the prompt and re-run.";

  return {
    passed,
    scores: { overall, goal, adherence, empathy, latency, voice },
    checks: checks.slice(0, 16),
    summary,
  };
}

export function compareEvaluations(a: Evaluation, b: Evaluation): Record<keyof EvalScores, number> {
  return {
    overall: b.scores.overall - a.scores.overall,
    goal: b.scores.goal - a.scores.goal,
    adherence: b.scores.adherence - a.scores.adherence,
    empathy: b.scores.empathy - a.scores.empathy,
    latency: b.scores.latency - a.scores.latency,
    voice: b.scores.voice - a.scores.voice,
  };
}
