/**
 * Recap — turn a Hear transcript into conversation intelligence.
 *
 * PyAI Recap is the post-call loop on top of Hear (docs: recap-call-intelligence):
 * diarized segments → talk-ratio + keyword hits, then a structured deal record.
 * Metrics are computed here; the LLM summary/extraction stays on the configured
 * analysis provider (PyAI does not run a public chat/completions Recap endpoint).
 */

export interface RecapSegment {
  id?: string;
  speaker?: string;
  start: number;
  end: number;
  text: string;
}

export interface TalkRatioRow {
  speaker: string;
  secs: number;
  pct: number;
}

export interface KeywordHit {
  term: string;
  count: number;
  at: number[];
  speakers: string[];
}

export interface RecapMetrics {
  talkRatio: TalkRatioRow[];
  keywords: KeywordHit[];
  speakers: number;
  durationSecs: number;
}

const TRACKED_TERMS = [
  "pricing",
  "price",
  "discount",
  "budget",
  "contract",
  "competitor",
  "security",
  "implementation",
  "onboarding",
  "timeline",
  "decision",
  "procurement",
];

const STOP = new Set(
  (
    "a an and the of to for in on at is are was were be been i you he she it we they this that with my your " +
    "me so can could would will just need help how what when okay ok hi hello thanks thank yeah yes no"
  ).split(" "),
);

export function speakerKey(seg: RecapSegment): string {
  const s = seg.speaker?.trim();
  return s || "unknown";
}

export function talkRatio(segments: RecapSegment[]): TalkRatioRow[] {
  const bySpeaker = new Map<string, number>();
  for (const s of segments) {
    const dur = Math.max(0, (s.end ?? 0) - (s.start ?? 0));
    const key = speakerKey(s);
    bySpeaker.set(key, (bySpeaker.get(key) ?? 0) + dur);
  }
  const total = [...bySpeaker.values()].reduce((a, b) => a + b, 0) || 1;
  return [...bySpeaker.entries()]
    .map(([speaker, secs]) => ({
      speaker,
      secs: Math.round(secs * 10) / 10,
      pct: Math.round((secs / total) * 100),
    }))
    .sort((a, b) => b.secs - a.secs);
}

export function trackKeywords(segments: RecapSegment[], terms: string[] = TRACKED_TERMS): KeywordHit[] {
  const hits = new Map<string, KeywordHit>();
  for (const term of terms) {
    hits.set(term.toLowerCase(), { term: term.toLowerCase(), count: 0, at: [], speakers: [] });
  }
  for (const s of segments) {
    const low = s.text.toLowerCase();
    for (const term of terms) {
      const key = term.toLowerCase();
      if (!low.includes(key)) continue;
      const row = hits.get(key)!;
      row.count += 1;
      row.at.push(s.start);
      const who = speakerKey(s);
      if (!row.speakers.includes(who)) row.speakers.push(who);
    }
  }
  return [...hits.values()].filter((h) => h.count > 0).sort((a, b) => b.count - a.count);
}

export function topTerms(text: string, n = 8): Array<{ term: string; count: number }> {
  const counts = new Map<string, number>();
  for (const w of text.toLowerCase().match(/[a-z']+/g) ?? []) {
    if (w.length < 3 || STOP.has(w)) continue;
    counts.set(w, (counts.get(w) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([term, count]) => ({ term, count }));
}

export function recapFromSegments(segments: RecapSegment[]): RecapMetrics {
  const ratio = talkRatio(segments);
  const durationSecs = Math.round(segments.reduce((sum, s) => sum + Math.max(0, s.end - s.start), 0) * 10) / 10;
  return {
    talkRatio: ratio,
    keywords: trackKeywords(segments),
    speakers: ratio.length,
    durationSecs,
  };
}

export function labeledTranscript(segments: RecapSegment[]): string {
  return segments
    .map((s) => {
      const who = speakerKey(s);
      return who === "unknown" ? s.text : `[${who}] ${s.text}`;
    })
    .join("\n");
}

export function applyTalkSeconds<T extends { name: string; talkSeconds?: number }>(
  participants: T[],
  ratio: TalkRatioRow[],
): T[] {
  if (!participants.length || !ratio.length) return participants;
  return participants.map((p, i) => {
    if (typeof p.talkSeconds === "number" && p.talkSeconds > 0) return p;
    const byName = ratio.find((r) => r.speaker.toLowerCase() === p.name.toLowerCase());
    const byIndex = ratio[i];
    const secs = byName?.secs ?? byIndex?.secs;
    return secs != null ? { ...p, talkSeconds: secs } : p;
  });
}
