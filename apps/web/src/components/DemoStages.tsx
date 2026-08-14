import { useEffect, useState } from "react";
import { cn } from "@/lib/cn";

export type DemoStage = {
  id: string;
  label: string;
  detail?: string;
  ms?: number;
};

/**
 * Pipeline checklist.
 * - Controlled: pass `activeId` + `completedIds` (live bot / Scrib).
 * - Auto: pass `running` to reveal stages on a timer (short demos).
 *   Stage *detail* updates must not restart the reveal animation.
 */
export function DemoStages({
  stages,
  running,
  activeId,
  completedIds,
  stepMs = 550,
}: {
  stages: DemoStage[];
  running?: boolean;
  activeId?: string | null;
  completedIds?: string[];
  stepMs?: number;
}) {
  const controlled = activeId !== undefined || completedIds !== undefined;
  const [visible, setVisible] = useState(0);
  const structureKey = stages.map((s) => s.id).join("|");

  useEffect(() => {
    if (controlled) return;
    if (!stages.length) {
      setVisible(0);
      return;
    }
    setVisible(running ? 1 : stages.length);
    if (!running) return;
    let i = 1;
    const id = window.setInterval(() => {
      i += 1;
      setVisible(Math.min(i, stages.length));
      if (i >= stages.length) window.clearInterval(id);
    }, stepMs);
    return () => window.clearInterval(id);
    // Only restart when the checklist structure changes — not when details update every poll.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- structureKey captures stage ids
  }, [structureKey, running, stepMs, controlled, stages.length]);

  if (!stages.length && !running) return null;

  const list = stages.length
    ? stages
    : [{ id: "working", label: "Working…", detail: "Running product pipeline" }];
  const doneSet = new Set(completedIds ?? []);
  const showCount = controlled ? list.length : running ? Math.max(visible, 1) : list.length;

  return (
    <ol className="space-y-2">
      {list.slice(0, showCount).map((s, idx) => {
        let active: boolean;
        let done: boolean;
        let pending: boolean;
        if (controlled) {
          active = activeId === s.id;
          done = doneSet.has(s.id);
          pending = !done && !active;
        } else {
          // While running, keep the last revealed step as active until the run finishes
          // (do not mark all steps done just because the timer reached the end).
          const allRevealed = visible >= list.length;
          active = Boolean(running && (idx === visible - 1 || (allRevealed && idx === list.length - 1)));
          done = Boolean(!running ? true : idx < visible - 1 && !(allRevealed && idx === list.length - 1));
          if (running && allRevealed) {
            active = idx === list.length - 1;
            done = idx < list.length - 1;
          }
          pending = false;
        }
        return (
          <li
            key={s.id}
            className={cn(
              "flex items-start gap-3 rounded-lg border px-3 py-2 text-sm transition",
              active && "border-accent/40 bg-accent/5",
              done && !active && "border-ink-100 bg-ink-50/80",
              pending && "border-ink-100 opacity-45",
              !controlled && !done && !active && "border-ink-100 opacity-60",
              /fallback/i.test(`${s.label} ${s.detail ?? ""}`) &&
                "border-amber-300/70 bg-amber-50/80 dark:border-amber-700/50 dark:bg-amber-950/30",
            )}
          >
            <span
              className={cn(
                "mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full font-mono text-[10px]",
                active && "bg-accent text-white dark:text-ink-950",
                done && !active && "bg-ink-800 text-white dark:bg-ink-200 dark:text-ink-950",
                !done && !active && "bg-ink-200 text-ink-500",
              )}
            >
              {done && !active ? "✓" : active ? (
                <span className="ai-dots flex gap-px" aria-hidden>
                  <span className="h-0.5 w-0.5 rounded-full bg-current" />
                  <span className="h-0.5 w-0.5 rounded-full bg-current" />
                  <span className="h-0.5 w-0.5 rounded-full bg-current" />
                </span>
              ) : (
                idx + 1
              )}
            </span>
            <div className="min-w-0 flex-1">
              <div className="font-medium text-ink-800">{s.label}</div>
              {s.detail ? <div className="mt-0.5 truncate font-mono text-[11px] text-ink-500">{s.detail}</div> : null}
            </div>
            {s.ms != null ? (
              <div className="font-mono text-[11px] text-ink-400">
                {s.ms < 1 ? "<1ms" : `${Math.round(s.ms)}ms`}
              </div>
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}
