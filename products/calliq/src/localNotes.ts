import type { CallAnalysis } from "./schema.js";
import { speakerKey, type RecapMetrics, type RecapSegment } from "./recap.js";

interface Line {
  speaker: string;
  text: string;
  start: number;
  end: number;
}

/**
 * Transcript-grounded deal notes when no live chat LLM is configured.
 * PyAI is Hear-only — never invent Dana / security-pack / pricing from the mock demo.
 */
export function localDealNotes(
  segments: RecapSegment[],
  recap: RecapMetrics,
  rawText = "",
): CallAnalysis {
  const lines: Line[] = segments
    .map((s) => ({
      speaker: speakerKey(s),
      text: String(s.text ?? "").trim(),
      start: s.start,
      end: s.end,
    }))
    .filter((l) => l.text);

  const participants = (
    recap.talkRatio.length
      ? recap.talkRatio
      : [{ speaker: lines[0]?.speaker ?? "Unknown", secs: 0, pct: 100 }]
  ).map((r) => ({
    name: r.speaker === "unknown" ? "Unknown" : r.speaker,
    role: inferRole(r.speaker, lines),
    talkSeconds: r.secs,
  }));

  const objections = lines.flatMap((l) => objectionFrom(l)).slice(0, 6);
  const buyingSignals = lines.flatMap((l) => signalFrom(l, lines)).slice(0, 6);
  const nextSteps = lines.flatMap((l) => stepFrom(l)).slice(0, 6);

  const customerPresent = participants.some((p) => p.role === "Customer");
  const oneSided = participants.length <= 1 || (participants[0]?.pct ?? 0) >= 99;

  const risks: CallAnalysis["risks"] = [];
  const seed = lines[0] ?? { speaker: "Unknown", text: rawText.slice(0, 120), start: 0, end: 0 };
  if (oneSided || !customerPresent) {
    risks.push({
      type: "weak_buying_signal",
      detail: "Only one speaker was captured; no buyer reply is in the transcript.",
      severity: "high",
      evidence: ev(seed),
    });
    risks.push({
      type: "no_decision_maker",
      detail: "No second participant or decision maker appears in the transcript.",
      severity: "high",
      evidence: ev(seed),
    });
  }
  if (!nextSteps.length && lines.length) {
    risks.push({
      type: "no_next_meeting",
      detail: "No concrete next step was spoken on the call.",
      severity: "medium",
      evidence: ev(lines[lines.length - 1] ?? seed),
    });
  }
  if (objections.length && !buyingSignals.length) {
    risks.push({
      type: "unresolved_objection",
      detail: objections[0]!.detail,
      severity: "high",
      evidence: objections[0]!.evidence,
    });
  }

  const offer = lines.find((l) => /sell|product|plan|offer|walk you/.test(l.text.toLowerCase()));
  const ask = lines.find((l) => /\?/.test(l.text));
  const close = lines[lines.length - 1];
  const bits: string[] = [];
  if (offer) bits.push(`${offer.speaker} said “${clip(offer.text)}”`);
  else if (lines[0]) bits.push(`${lines[0].speaker} opened with “${clip(lines[0].text)}”`);
  if (ask && ask !== offer) bits.push(`${ask.speaker} asked “${clip(ask.text)}”`);
  if (close && close !== offer && close !== ask) bits.push(`The call ended with “${clip(close.text)}”`);
  if (oneSided) bits.push("No other speaker appears in the transcript.");
  const summary = bits.join(" ") || "Short call with limited transcript coverage.";

  let score = 52;
  if (oneSided) score = 28;
  if (buyingSignals.length) score += 14;
  if (objections.length) score -= 10;
  if (nextSteps.length) score += 8;
  score = Math.max(10, Math.min(88, score));

  const rationale = oneSided
    ? "One-sided transcript: a pitch was recorded but no buyer response, so deal health is weak."
    : objections.length
      ? "Customer concerns are on the record; follow-up depends on resolving them."
      : "Notes are limited to what was actually spoken.";

  const sales = participants.find((p) => p.role === "Sales Rep")?.name ?? participants[0]?.name ?? "there";
  const other = participants.find((p) => p.role === "Customer")?.name;
  const followUpEmail = other
    ? `Hi ${other}, thanks for the call. ${offer ? `Following up on: ${clip(offer.text, 100)}` : "I'll send a short recap and a proposed next step."}`
    : `Hi there, thanks for the time. ${offer ? `I mentioned: ${clip(offer.text, 100)}` : "Wanted to follow up on our conversation."} Let me know if you want to continue.`;
  const followUpSlack = other
    ? `${other}: recap — ${clip(lines[0]?.text ?? "", 80)}`
    : `Follow-up: ${clip(lines[0]?.text ?? "call recap", 80)}`;

  return {
    summary,
    participants,
    dealStage: buyingSignals.length ? "Evaluation" : "Discovery",
    dealHealthScore: score,
    dealHealthRationale: rationale,
    objections,
    buyingSignals,
    risks,
    competitorMentions: [],
    pricingObjections: objections.filter((o) => o.type === "Pricing").map((o) => o.detail),
    nextSteps,
    followUpEmail,
    followUpSlack,
    crmJson: {
      stage: buyingSignals.length ? "Evaluation" : "Discovery",
      owner: sales,
      next_step: nextSteps[0]?.task ?? null,
    },
  };
}

function ev(line: Line) {
  return {
    source: "transcript" as const,
    start: line.start,
    end: line.end,
    speaker: line.speaker,
    excerpt: line.text,
  };
}

function inferRole(speaker: string, lines: Line[]): "Sales Rep" | "Customer" | "Other" {
  const blob = lines
    .filter((l) => l.speaker === speaker)
    .map((l) => l.text)
    .join(" ")
    .toLowerCase();
  if (
    /willing to sell|walk you through|thanks for hopping|white-glove|enterprise plan|send the security|are you interested/.test(
      blob,
    )
  ) {
    return "Sales Rep";
  }
  if (/holding us back|we need|our procurement|got burned|decision maker|we got/.test(blob)) {
    return "Customer";
  }
  if (/^sales rep$/i.test(speaker)) return "Sales Rep";
  if (/^customer$/i.test(speaker)) return "Customer";
  return "Other";
}

function objectionFrom(l: Line): CallAnalysis["objections"] {
  const t = l.text.toLowerCase();
  if (/price|pricing|too expensive|cost too|budget/.test(t) && !/implement|onboard/.test(t)) {
    return [{ type: "Pricing", detail: l.text, severity: "high", evidence: ev(l) }];
  }
  if (/implement|onboard|got burned|rollout/.test(t)) {
    return [{ type: "Implementation", detail: l.text, severity: "high", evidence: ev(l) }];
  }
  if (/secur|soc\s*2|procurement|compliance/.test(t) && !/send (the |a )?security/.test(t)) {
    return [{ type: "Security", detail: l.text, severity: "medium", evidence: ev(l) }];
  }
  if (/competitor|alternative|vs\.|versus/.test(t)) {
    return [{ type: "Competitor", detail: l.text, severity: "medium", evidence: ev(l) }];
  }
  return [];
}

function signalFrom(l: Line, all: Line[]): CallAnalysis["buyingSignals"] {
  if (inferRole(l.speaker, all) === "Sales Rep") return [];
  const t = l.text.toLowerCase();
  if (!/interested|let'?s (do|go|proceed)|send (me|the)|decision maker|end of month|sounds good/.test(t)) {
    return [];
  }
  const type = /decision maker/.test(t) ? "authority" : /end of month|friday|timeline/.test(t) ? "timeline" : "intent";
  return [{ type, detail: l.text, evidence: ev(l) }];
}

function stepFrom(l: Line): CallAnalysis["nextSteps"] {
  const t = l.text.toLowerCase();
  if (!/send (the |a |me )?(security pack|timeline|proposal|deck|recap)|i('ll| will) (send|own|loop)|follow up/.test(t)) {
    return [];
  }
  return [{ owner: l.speaker, task: clip(l.text, 120), evidence: ev(l) }];
}

function clip(s: string, n = 140): string {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
}
