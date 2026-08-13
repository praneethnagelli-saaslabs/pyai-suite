import { cn } from "@/lib/cn";
import type { MapNode } from "@/lib/conversationIntel";

export function ConversationMap({
  nodes,
  activeId,
  onJump,
}: {
  nodes: MapNode[];
  activeId?: string | null;
  onJump: (utteranceId?: string) => void;
}) {
  if (nodes.length < 2) return null;
  return (
    <div className="border-t border-[var(--hairline)] py-5">
      <div className="mb-4 text-caption uppercase text-ink-400">Timeline</div>
      <div className="relative flex min-w-0 items-start gap-0 overflow-x-auto pb-2">
        <div className="absolute left-3 right-3 top-2 h-px bg-[var(--hairline)]" aria-hidden />
        {nodes.map((n) => {
          const hot = activeId && n.utteranceId === activeId;
          return (
            <button
              key={n.id}
              type="button"
              title={n.hint}
              onClick={() => onJump(n.utteranceId)}
              className="relative z-[1] flex min-w-[7rem] flex-1 flex-col items-start gap-2 pr-4 text-left"
            >
              <span
                className={cn(
                  "h-2.5 w-2.5 rounded-full border-2 border-canvas transition duration-200 ease-spring",
                  n.kind === "risk" && "bg-status-warn",
                  n.kind === "resolve" && "bg-accent",
                  n.kind === "open" && "bg-ink-400",
                  n.kind === "topic" && "bg-ink-500",
                  hot && "scale-110",
                )}
              />
              <span className="text-caption uppercase text-ink-400">{n.kind}</span>
              <span className="font-display text-sm tracking-tight text-ink-900">{n.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
