import type { CopilotSignal } from "@/lib/conversationIntel";
import { AiWorking } from "@/components/ui";
import { cn } from "@/lib/cn";

const RULE: Record<CopilotSignal["kind"], string> = {
  intent: "bg-accent",
  objection: "bg-status-warn",
  action: "bg-accent",
  moment: "bg-accent",
};

export function LiveCopilot({
  signals,
  live,
  onJump,
}: {
  signals: CopilotSignal[];
  live?: boolean;
  onJump: (utteranceId?: string) => void;
}) {
  return (
    <aside className="flex h-full flex-col border-[var(--hairline)] max-lg:border-t max-lg:pt-5 lg:border-l lg:pl-5">
      <div className="mb-4 flex items-center justify-between">
        <div className="text-caption uppercase text-ink-400">Live AI</div>
        {live ? <AiWorking label="Listening" /> : null}
      </div>
      {signals.length === 0 ? (
        <p className="text-sm text-ink-400">
          {live ? "Waiting for a moment worth surfacing…" : "Insights appear as the transcript names intent, risk, or next steps."}
        </p>
      ) : (
        <ul className="space-y-4">
          {signals.map((s) => (
            <li key={s.id}>
              <button type="button" onClick={() => onJump(s.utteranceId)} className="w-full pl-3 text-left ai-mark">
                <div className="flex items-center gap-2">
                  <span className={cn("h-1.5 w-1.5 rounded-full", RULE[s.kind])} />
                  <span className="text-caption uppercase text-ink-400">{s.label}</span>
                </div>
                <div className="mt-1 text-sm leading-snug text-ink-800">{s.detail}</div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </aside>
  );
}
