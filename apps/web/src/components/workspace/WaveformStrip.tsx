import { useMemo } from "react";
import { cn } from "@/lib/cn";
import { speakerLanes } from "@/lib/conversationIntel";
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
  const lanes = useMemo(() => speakerLanes(utterances.map((u) => u.speaker)), [utterances]);
  const legend = [...lanes.entries()];

  return (
    <div className="relative bg-ink-950 px-5 py-4 text-white">
      <div className="mb-3 flex items-center justify-between gap-3 text-caption uppercase tracking-wide text-white/45">
        <span>{live ? "Live signal" : "Conversation shape"}</span>
        <span className="font-mono normal-case">
          0:00 — {last ? formatClock(last.t) : "0:00"} · {utterances.length} turns
        </span>
      </div>
      <div className="relative flex h-24 items-stretch gap-px">
        {utterances.length === 0 ? (
          <div className="h-px w-full self-center bg-white/15" />
        ) : (
          utterances.map((u) => {
            const h = Math.max(18, (u.text.length / max) * 100);
            const lane = lanes.get(u.speaker);
            const kind = mark.get(u.id);
            const active = u.id === activeId;
            const fill = active ? "bg-white" : (lane?.fill ?? "bg-white/30");
            const up = lane?.lane !== "down";
            return (
              <button
                key={u.id}
                type="button"
                title={`${u.speaker} · ${formatClock(u.t)}`}
                onClick={() => onJump(u.id)}
                className="group relative flex min-w-[3px] flex-1 flex-col"
              >
                <span className="flex flex-1 items-end">
                  {up ? (
                    <span
                      className={cn("w-full rounded-sm transition duration-150", fill, kind === "risk" && "ring-1 ring-status-warn")}
                      style={{ height: `${h}%` }}
                    />
                  ) : null}
                </span>
                <span className="h-px w-full bg-white/20" />
                <span className="flex flex-1 items-start">
                  {!up ? (
                    <span
                      className={cn("w-full rounded-sm transition duration-150", fill, kind === "risk" && "ring-1 ring-status-warn")}
                      style={{ height: `${h}%` }}
                    />
                  ) : null}
                </span>
              </button>
            );
          })
        )}
      </div>
      {legend.length > 1 ? (
        <ul className="mt-3 flex flex-wrap gap-4 text-[11px] uppercase tracking-wide text-white/55">
          {legend.map(([name, lane]) => (
            <li key={name} className="flex items-center gap-1.5">
              <span className={cn("h-2 w-2 rounded-full", lane.fill)} />
              {name}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
