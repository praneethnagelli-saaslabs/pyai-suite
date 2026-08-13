export function sanitizeLiveText(text: string): string {
  return text.replace(/[\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 4_000);
}

function compact(s: string): string {
  return s.replace(/\s+/g, "").toLowerCase();
}

function spaceScore(s: string): number {
  return (s.match(/\s/g) ?? []).length;
}

function pickReadable(a: string, b: string): string {
  const sa = spaceScore(a);
  const sb = spaceScore(b);
  if (sb !== sa) return sb > sa ? b : a;
  return b.length >= a.length ? b : a;
}

function almostSame(a: string, b: string): boolean {
  const ca = compact(a);
  const cb = compact(b);
  if (ca === cb) return true;
  if (!ca || !cb) return false;
  const [shorter, longer] = ca.length <= cb.length ? [ca, cb] : [cb, ca];
  if (longer.length < 20) return false;
  const drift = longer.length - shorter.length;
  if (drift > Math.max(6, Math.floor(longer.length * 0.12))) return false;
  let i = 0;
  for (const ch of longer) {
    if (ch === shorter[i]) i += 1;
    if (i === shorter.length) return true;
  }
  return false;
}

function needsSpace(left: string, right: string): boolean {
  if (!left || !right) return false;
  if (/\s$/.test(left) || /^\s/.test(right)) return false;
  if (/^[.,!?;:'’)\]}]/.test(right)) return false;
  if (/[("'‘“[]$/.test(left)) return false;
  return true;
}

function joinTokens(shown: string, incoming: string): string {
  const gap = needsSpace(shown, incoming) ? " " : "";
  return `${shown}${gap}${incoming}`.replace(/\s+/g, " ").trim().slice(0, 4_000);
}

function prefixBeforeCompactTail(shown: string, incoming: string): string {
  const cb = compact(incoming);
  let need = cb.length;
  let i = shown.length;
  while (i > 0 && need > 0) {
    i -= 1;
    if (/\s/.test(shown[i] ?? "")) continue;
    need -= 1;
  }
  while (i > 0 && /\s/.test(shown[i - 1] ?? "")) i -= 1;
  return sanitizeLiveText(shown.slice(0, i));
}

/**
 * Merge streaming caption pieces. Same words with/without spaces stay one line;
 * jammed tokens get spaces; a spaced final replaces a jammed draft — never both.
 */
export function growCaption(shown: string, incoming: string): string {
  const a = sanitizeLiveText(shown);
  const b = sanitizeLiveText(incoming);
  if (!b) return a;
  if (!a) return b;
  if (a === b) return a;
  if (almostSame(a, b)) return pickReadable(a, b);

  const ca = compact(a);
  const cb = compact(b);
  if (!cb) return a;
  if (!ca) return b;

  if (cb.length > 8 && ca.endsWith(cb)) {
    const prefix = prefixBeforeCompactTail(a, b);
    if (!prefix || almostSame(prefix, b)) return b;
    return joinTokens(prefix, b);
  }

  if (cb.startsWith(ca)) return spaceScore(b) >= spaceScore(a) ? b : joinTokens(a, b);
  if (ca.startsWith(cb)) return a;

  return joinTokens(a, b);
}

export function applyTranscriptDelta(full: string, delta: string, final: boolean): string {
  const clean = sanitizeLiveText(delta);
  if (!clean) return full;
  if (final && full) {
    if (almostSame(full, clean)) return pickReadable(full, clean);
    const cf = compact(full);
    const cc = compact(clean);
    if (cf.startsWith(cc) && cc.length + 8 < cf.length) return full;
    if (cc.length > 8 && cf.endsWith(cc)) {
      const prefix = prefixBeforeCompactTail(full, clean);
      if (!prefix || almostSame(prefix, clean)) return clean;
      return joinTokens(prefix, clean);
    }
    if (cc.startsWith(cf) || (cc.includes(cf) && cc.length >= cf.length)) return pickReadable(full, clean);
  }
  return growCaption(full, clean);
}

/** Replace a speaker's live turn in place so rows do not swap on every token. */
export function upsertTurn<T extends { id: string; speaker: "user" | "agent"; text: string; final: boolean }>(
  prev: T[],
  turn: T,
): T[] {
  const liveId = `${turn.speaker}-live`;
  const idx = prev.findIndex((t) => t.id === liveId || t.id === turn.id);
  if (idx < 0) return [...prev, turn];
  if (prev[idx]?.text === turn.text && prev[idx]?.final === turn.final && prev[idx]?.id === turn.id) {
    return prev;
  }
  const next = prev.slice();
  next[idx] = turn;
  return next;
}
