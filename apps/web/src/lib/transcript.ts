export type Utterance = {
  id: string;
  speaker: string;
  text: string;
  /** Approximate offset in the source string for highlight/scroll. */
  index: number;
  /** Synthetic seconds from speaking-rate estimate — used for jump UI, not fake audio. */
  t: number;
};

/** OpenAI diarize uses `Speaker A:`; Hear uses `[speaker_2]` / `speaker_1:`. */
const NAMED =
  "Sales Rep|CallIQ Bot|Speaker\\s+[A-Z0-9]+|speaker[_\\s-]?\\d+|speaker\\s+\\d+|Rep|Customer|Prospect|Buyer|Me|Them|You|Alex|Dana";

function speakerLabelRe(): RegExp {
  return new RegExp(
    String.raw`(?:\[(speaker[_\s-]?\d+|[^\]]+)\]\s+|(${NAMED})\s*[:\-]\s*)`,
    "gi",
  );
}

export function prettySpeakerLabel(raw: string): string {
  const s = raw.trim().replace(/^\[|\]$/g, "").trim();
  if (/^[A-Z]$/i.test(s)) return `Speaker ${s.toUpperCase()}`;
  const numbered = s.match(/^(?:speaker[_\s-]*)(\d+)$/i) ?? s.match(/^speaker\s+(\d+)$/i);
  if (numbered) return `Speaker ${Number(numbered[1])}`;
  const lettered = s.match(/^speaker\s+([A-Z])$/i);
  if (lettered) return `Speaker ${lettered[1]!.toUpperCase()}`;
  if (/^(me|you)$/i.test(s)) return "You";
  if (/^them$/i.test(s)) return "Them";
  if (/sales rep/i.test(s)) return "Rep";
  if (/prospect|buyer/i.test(s)) return "Customer";
  return s.replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Drop the extra `Speaker:` wrapper OpenAI fallback + old parse used to add. */
function stripOuterSpeaker(raw: string): string {
  return raw
    .replace(/\r\n/g, "\n")
    .replace(/\bSpeaker:\s*(?=Speaker\s+[A-Z0-9]+\s*[:\-])/gi, "")
    .trim();
}

function splitTurns(raw: string): Array<{ speaker: string; text: string; index: number }> {
  const text = stripOuterSpeaker(raw);
  if (!text) return [];
  const matches = [...text.matchAll(speakerLabelRe())];
  if (!matches.length) {
    return [{ speaker: "Speaker", text: text.replace(/\s+/g, " ").trim(), index: 0 }];
  }
  const out: Array<{ speaker: string; text: string; index: number }> = [];
  const first = matches[0]!;
  if ((first.index ?? 0) > 0) {
    const lead = text.slice(0, first.index).replace(/\s+/g, " ").trim();
    if (lead) out.push({ speaker: "Speaker", text: lead, index: 0 });
  }
  for (let i = 0; i < matches.length; i++) {
    const m = matches[i]!;
    const start = (m.index ?? 0) + m[0].length;
    const end = i + 1 < matches.length ? (matches[i + 1]!.index ?? text.length) : text.length;
    const body = text.slice(start, end).replace(/\s+/g, " ").trim();
    if (!body) continue;
    const rawSpeaker = (m[1] || m[2] || "").trim();
    out.push({ speaker: prettySpeakerLabel(rawSpeaker), text: body, index: m.index ?? 0 });
  }
  return out;
}

export function parseTranscript(raw: string): Utterance[] {
  const text = raw.replace(/\r\n/g, "\n").trim();
  if (!text) return [];
  let t = 0;
  return splitTurns(text).map((turn, i) => {
    const secs = Math.max(1.2, turn.text.split(/\s+/).length / 2.4);
    const u: Utterance = {
      id: `u${i}`,
      speaker: turn.speaker,
      text: turn.text,
      index: Math.max(0, turn.index),
      t: Math.round(t),
    };
    t += secs;
    return u;
  });
}

/** Rewrite Hear / OpenAI diarize labels and merge consecutive same-speaker fragments. */
export function normalizeDiarizedTranscript(raw: string): string {
  const parsed = parseTranscript(raw);
  if (!parsed.length) return raw.trim();
  const merged: Array<{ speaker: string; text: string }> = [];
  for (const u of parsed) {
    const last = merged[merged.length - 1];
    if (last && last.speaker === u.speaker) {
      last.text = `${last.text} ${u.text}`.replace(/\s+/g, " ").trim();
    } else {
      merged.push({ speaker: u.speaker, text: u.text });
    }
  }
  return merged.map((u) => `${u.speaker}: ${u.text}`).join("\n");
}

export function formatClock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, "0")}`;
}

export function findUtterance(utterances: Utterance[], needle: string): Utterance | undefined {
  const n = needle.trim().toLowerCase();
  if (!n) return undefined;
  return utterances.find((u) => u.text.toLowerCase().includes(n.slice(0, 80)) || n.includes(u.text.toLowerCase().slice(0, 40)));
}
