import { useMemo, useState } from "react";
import { cn } from "@/lib/cn";
import { formatClock, type Utterance } from "@/lib/transcript";
import { AskAiMenu } from "@/components/workspace/AskAiMenu";

export function InteractiveTranscript({
  utterances,
  activeId,
  onActive,
  llmProvider,
}: {
  utterances: Utterance[];
  activeId?: string | null;
  onActive?: (id: string) => void;
  llmProvider: string;
}) {
  const [ask, setAsk] = useState<{ text: string; x: number; y: number } | null>(null);
  const bySpeaker = useMemo(() => {
    const colors = ["bg-accent", "bg-ink-400"];
    const map = new Map<string, string>();
    let i = 0;
    for (const u of utterances) {
      if (!map.has(u.speaker)) map.set(u.speaker, colors[i++ % colors.length]!);
    }
    return map;
  }, [utterances]);

  if (!utterances.length) {
    return <p className="text-sm text-ink-400">Transcript will appear here as people speak.</p>;
  }

  return (
    <div
      className="space-y-3"
      onMouseUp={(e) => {
        const sel = window.getSelection();
        const text = sel?.toString().trim() ?? "";
        if (text.length < 8) {
          setAsk(null);
          return;
        }
        setAsk({ text, x: e.clientX + 8, y: e.clientY + 8 });
      }}
    >
      {utterances.map((u) => (
        <button
          key={u.id}
          id={`utt-${u.id}`}
          type="button"
          onClick={() => onActive?.(u.id)}
          className={cn(
            "group flex w-full gap-3 rounded-xl px-2 py-2 text-left transition",
            activeId === u.id ? "bg-accent-soft ai-mark" : "hover:bg-interactive",
          )}
        >
          <span className={cn("mt-1.5 h-2 w-2 shrink-0 rounded-full", bySpeaker.get(u.speaker))} />
          <span className="min-w-0 flex-1">
            <span className="flex items-baseline justify-between gap-2">
              <span className="text-xs font-semibold text-ink-800">{u.speaker}</span>
              <span className="font-mono text-[10px] text-ink-400 opacity-0 transition group-hover:opacity-100">
                {formatClock(u.t)}
              </span>
            </span>
            <span className="mt-0.5 block text-sm leading-relaxed text-ink-700">“{u.text}”</span>
          </span>
        </button>
      ))}
      {ask ? (
        <AskAiMenu text={ask.text} provider={llmProvider} anchor={{ x: ask.x, y: ask.y }} onClose={() => setAsk(null)} />
      ) : null}
    </div>
  );
}
