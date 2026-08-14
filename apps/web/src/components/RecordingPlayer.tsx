/** Compact audio player for saved Brief / CallIQ recordings. */
export function RecordingPlayer({
  src,
  label = "Recording",
}: {
  src: string | null | undefined;
  label?: string;
}) {
  if (!src) return null;
  return (
    <div className="rounded-lg border border-ink-100 bg-ink-50/80 px-3 py-2">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-ink-400">{label}</div>
      <audio className="mt-1.5 w-full" controls preload="metadata" src={src}>
        <track kind="captions" />
      </audio>
    </div>
  );
}

export function recordingPlayUrl(
  product: "brief" | "calliq",
  entityId: string,
): string {
  const id = encodeURIComponent(entityId);
  return product === "brief"
    ? `/api/brief/meetings/${id}/recording`
    : `/api/calliq/calls/${id}/recording`;
}
