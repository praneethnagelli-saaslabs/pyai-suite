export type Utterance = {
  id: string;
  speaker: string;
  text: string;
  /** Approximate offset in the source string for highlight/scroll. */
  index: number;
  /** Synthetic seconds from speaking-rate estimate — used for jump UI, not fake audio. */
  t: number;
};

/** Hear batch often emits `[speaker_2] …` or `speaker_1:`. Also `Rep:`, `Me:`. */
const SPEAKER =
  /^(?:\[(speaker[_\s-]?\d+|[^\]]+)\]\s+|(speaker[_\s-]?\d+|speaker\s+\d+|Rep|Customer|Sales Rep|Prospect|Buyer|Me|Them|You|Alex|Dana|Jordan|CallIQ Bot|Speaker\s+\d+)[:\-]\s+)/i;

export function prettySpeakerLabel(raw: string): string {
  const s = raw.trim().replace(/^\[|\]$/g, "").trim();
  const numbered = s.match(/^(?:speaker[_\s-]*)(\d+)$/i) ?? s.match(/^speaker\s+(\d+)$/i);
  if (numbered) return `Speaker ${Number(numbered[1])}`;
  if (/^(me|you)$/i.test(s)) return "You";
  if (/^them$/i.test(s)) return "Them";
  if (/sales rep/i.test(s)) return "Rep";
  if (/prospect|buyer/i.test(s)) return "Customer";
  return s.replace(/\b\w/g, (c) => c.toUpperCase());
}

export function parseTranscript(raw: string): Utterance[] {
  const text = raw.replace(/\r\n/g, "\n").trim();
  if (!text) return [];
  const lines = text.split("\n");
  const out: Utterance[] = [];
  let cursor = 0;
  let t = 0;
  let i = 0;
  for (const line of lines) {
    const trimmed = line.trim();
    const at = raw.indexOf(line, cursor);
    cursor = at >= 0 ? at + line.length : cursor + line.length + 1;
    if (!trimmed) continue;
    const m = trimmed.match(SPEAKER);
    const rawSpeaker = m?.[1] || m?.[2];
    const speaker = rawSpeaker
      ? prettySpeakerLabel(rawSpeaker)
      : out.length
        ? out[out.length - 1]!.speaker
        : "Speaker";
    const body = m ? trimmed.slice(m[0].length).trim() : trimmed;
    if (!body) continue;
    const secs = Math.max(1.2, body.split(/\s+/).length / 2.4);
    out.push({ id: `u${i++}`, speaker, text: body, index: Math.max(0, at), t: Math.round(t) });
    t += secs;
  }
  return out;
}

/** Rewrite Hear `[speaker_2] hi` lines to `Speaker 2: hi` and merge consecutive same-speaker fragments. */
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
