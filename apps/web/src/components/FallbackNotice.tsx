import { cn } from "@/lib/cn";

/** Visible cue whenever a later provider was used after PyAI (or preferred) failed. */
export function FallbackNotice({
  note,
  className,
}: {
  note?: string | null;
  className?: string;
}) {
  if (!note?.trim()) return null;
  return (
    <div
      role="status"
      className={cn(
        "rounded-lg border border-amber-300/80 bg-amber-50 px-3 py-2 text-sm text-amber-950 dark:border-amber-700/60 dark:bg-amber-950/40 dark:text-amber-100",
        className,
      )}
    >
      <span className="font-semibold">Provider fallback</span>
      <span className="mt-0.5 block font-mono text-[11px] leading-snug opacity-90">{note}</span>
    </div>
  );
}
