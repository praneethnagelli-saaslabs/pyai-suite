import { cn } from "@/lib/cn";
import { formatClock, type Utterance } from "@/lib/transcript";

export type WaveMarker = { utteranceId: string; kind: "risk" | "moment" | "action" };

export function WaveformStrip({
  utterances,
  activeId,
  onJump,
  live,
  markers = [],
}: {
  utterances: Utterance[];
  activeId?: string | null;
  onJump: (id: string) => void;
  live?: boolean;
  markers?: WaveMarker[];
}) {
  const max = Math.max(...utterances.map((u) => u.text.length), 1);
  const last = utterances[utterances.length - 1];
  const mark = new Map(markers.map((m) => [m.utteranceId, m.kind]));

  return (
    <div className="relative bg-ink-950 px-5 py-4 text-white">
      <div className="mb-3 flex items-center justify-between text-caption uppercase tracking-wide text-white/45">
        <span>{live ? "Live signal" : "Conversation shape"}</span>
        <span className="font-mono normal-case">
          0:00 — {last ? formatClock(last.t) : "0:00"} · {utterances.length} turns
        </span>
      </div>
      <div className="relative flex h-20 items-center gap-px">
        {utterances.length === 0 ? (
          <div className="h-px w-full bg-white/15" />
        ) : (
          utterances.map((u) => {
            const h = Math.max(10, (u.text.length / max) * 88);
            const kind = mark.get(u.id);
            const active = u.id === activeId;
            const fill = active
              ? "bg-accent"
              : kind === "risk"
                ? "bg-status-warn/70"
                : "bg-white/28";
            const fillLo = active ? "bg-accent/80" : kind === "risk" ? "bg-status-warn/40" : "bg-white/14";
            return (
              <button
                key={u.id}
                type="button"
                title={`${u.speaker} · ${formatClock(u.t)}`}
                onClick={() => onJump(u.id)}
                className="group relative flex h-full min-w-[3px] flex-1 flex-col items-center justify-center"
              >
                <span className={cn("w-full rounded-sm transition duration-150", fill)} style={{ height: `${h / 2}%` }} />
                <span className="my-px h-px w-full bg-white/15" />
                <span className={cn("w-full rounded-sm transition duration-150", fillLo)} style={{ height: `${h / 2}%` }} />
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
