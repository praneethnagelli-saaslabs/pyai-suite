import type { CallAnalysis } from "@/lib/calliqStore";
import type { Utterance } from "@/lib/transcript";

export type CopilotSignal = {
  id: string;
  kind: "intent" | "objection" | "action" | "moment";
  label: string;
  detail: string;
  utteranceId?: string;
};

export type MapNode = {
  id: string;
  label: string;
  kind: "open" | "topic" | "risk" | "resolve";
  utteranceId?: string;
  hint?: string;
};

const RULES: Array<{ kind: CopilotSignal["kind"]; label: string; re: RegExp; tag: string }> = [
  { kind: "objection", label: "Pricing pressure", re: /\b(pric|cost|budget|expensive|cheaper|roi)\w*/i, tag: "price" },
  { kind: "objection", label: "Implementation risk", re: /\b(implement|onboard|rollout|migration|timeline|weeks?)\b/i, tag: "impl" },
  { kind: "objection", label: "Security / procurement", re: /\b(security|soc\s*2|compliance|procurement|legal|residency)\b/i, tag: "sec" },
  { kind: "moment", label: "Competitor mentioned", re: /\b(competitor|alternative|switch(ing)? from|versus|vs\.?)\b/i, tag: "comp" },
  { kind: "intent", label: "Evaluating plan", re: /\b(enterprise|plan|pilot|trial|eval)\b/i, tag: "eval" },
  { kind: "action", label: "Next step offered", re: /\b(send|follow[- ]?up|loop in|next week|decision|pack)\b/i, tag: "next" },
];

/** Grounded in the transcript text — not a fake “thinking” animation. */
export function liveSignals(utterances: Utterance[]): CopilotSignal[] {
  const seen = new Set<string>();
  const out: CopilotSignal[] = [];
  for (const u of utterances) {
    for (const rule of RULES) {
      if (seen.has(rule.tag) || !rule.re.test(u.text)) continue;
      seen.add(rule.tag);
      out.push({
        id: `${rule.tag}-${u.id}`,
        kind: rule.kind,
        label: rule.label,
        detail: quote(u.text),
        utteranceId: u.id,
      });
    }
  }
  return out.slice(0, 6);
}

export function conversationMap(utterances: Utterance[], analysis?: CallAnalysis | null): MapNode[] {
  const nodes: MapNode[] = [];
  const first = utterances[0];
  if (first) {
    nodes.push({ id: "open", label: "Opening", kind: "open", utteranceId: first.id, hint: first.text });
  }
  for (const k of (analysis?.keywords ?? []).slice(0, 3)) {
    const hit = utterances.find((u) => u.text.toLowerCase().includes(k.term.toLowerCase()));
    nodes.push({
      id: `kw-${k.term}`,
      label: titleCase(k.term),
      kind: "topic",
      utteranceId: hit?.id,
      hint: `${k.count} mention${k.count === 1 ? "" : "s"}`,
    });
  }
  (analysis?.objections ?? []).forEach((o, i) => {
    const hit = utterances.find((u) => u.text.toLowerCase().includes(o.detail.slice(0, 24).toLowerCase()));
    nodes.push({
      id: `obj-${i}`,
      label: o.type || "Objection",
      kind: "risk",
      utteranceId: hit?.id,
      hint: o.detail,
    });
  });
  const lastStep = analysis?.nextSteps?.[analysis.nextSteps.length - 1];
  const last = utterances[utterances.length - 1];
  if (lastStep || last) {
    nodes.push({
      id: "resolve",
      label: lastStep ? "Next step" : "Close",
      kind: "resolve",
      utteranceId: last?.id,
      hint: lastStep ? lastStep.task : last?.text,
    });
  }
  return nodes.slice(0, 8);
}

function quote(text: string): string {
  const t = text.trim();
  return t.length > 110 ? `“${t.slice(0, 107)}…”` : `“${t}”`;
}

function titleCase(s: string): string {
  return s.replace(/\b\w/g, (c) => c.toUpperCase());
}
