/** Detect / normalize meeting URLs for CallIQ bot join. */

const MEET_RE = /https?:\/\/meet\.google\.com\/[a-z0-9]{3}-[a-z0-9]{4}-[a-z0-9]{3}\b/i;
const ZOOM_RE = /https?:\/\/(?:[\w.-]+\.)?zoom\.us\/j\/\d+[^\s]*/i;
const TEAMS_RE = /https?:\/\/teams\.microsoft\.com\/l\/meetup-join\/[^\s]+/i;

export function extractMeetingUrl(text: string): string | null {
  const t = text.trim();
  if (!t) return null;
  for (const re of [MEET_RE, ZOOM_RE, TEAMS_RE]) {
    const m = t.match(re);
    if (m?.[0]) return m[0].replace(/[),.;]+$/, "");
  }
  // Allow raw meet codes like abc-defg-hij
  if (/^[a-z0-9]{3}-[a-z0-9]{4}-[a-z0-9]{3}$/i.test(t)) {
    return `https://meet.google.com/${t.toLowerCase()}`;
  }
  return null;
}

export function isUsableMeetingUrl(url: string): boolean {
  const u = url.trim();
  if (!u) return false;
  if (/meet\.google\.com\/new\/?$/i.test(u)) return false;
  return Boolean(extractMeetingUrl(u));
}

export function meetingHostLabel(url: string): string {
  if (/meet\.google\.com/i.test(url)) return "Google Meet";
  if (/zoom\.us/i.test(url)) return "Zoom";
  if (/teams\.microsoft\.com/i.test(url)) return "Teams";
  return "Meeting";
}
