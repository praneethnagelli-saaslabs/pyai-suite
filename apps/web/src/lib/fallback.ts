/** Build a short UI note when STT/TTS fell through the PyAI-first chain. */
export function formatFallbackNote(
  used: string,
  errors?: string[] | null,
  explicit?: string | null,
): string | undefined {
  if (explicit?.trim()) return explicit.trim();
  if (!errors?.length) return undefined;
  const first = errors[0] ?? "earlier provider failed";
  const more = errors.length > 1 ? ` (+${errors.length - 1} more)` : "";
  return `Fell back to ${used} — ${first}${more}`;
}
