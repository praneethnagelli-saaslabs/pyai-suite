import { useMemo, useState } from "react";
import type { CallAnalysis } from "@/lib/calliqStore";
import { conversationMap, liveSignals } from "@/lib/conversationIntel";
import { parseTranscript } from "@/lib/transcript";
import { WaveformStrip, type WaveMarker } from "@/components/workspace/WaveformStrip";
import { InteractiveTranscript } from "@/components/workspace/InteractiveTranscript";
import { ConversationMap } from "@/components/workspace/ConversationMap";
import { LiveCopilot } from "@/components/workspace/LiveCopilot";
import { InsightCard, ScoreOverview } from "@/components/InsightCard";
import { Button } from "@/components/ui";

export function ConversationWorkspace({
  transcript,
  analysis,
  live,
  llmProvider,
  onUnderstand,
  understanding,
}: {
  transcript: string;
  analysis?: CallAnalysis | null;
  live?: boolean;
  llmProvider: string;
  onUnderstand?: () => void;
  understanding?: boolean;
}) {
  const utterances = useMemo(() => parseTranscript(transcript), [transcript]);
  const signals = useMemo(() => liveSignals(utterances), [utterances]);
  const map = useMemo(() => conversationMap(utterances, analysis), [utterances, analysis]);
  const markers = useMemo<WaveMarker[]>(
    () =>
      signals
        .filter((s) => s.utteranceId)
        .map((s) => ({
          utteranceId: s.utteranceId!,
          kind: s.kind === "objection" ? "risk" : s.kind === "action" ? "action" : "moment",
        })),
    [signals],
  );
  const [activeId, setActiveId] = useState<string | null>(null);

  function jump(id?: string) {
    if (!id) return;
    setActiveId(id);
    document.getElementById(`utt-${id}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-ink-500">
          Select a sentence to ask AI. Click the map or a bar to jump. Hover a turn for its clock.
        </p>
        {onUnderstand ? (
          <Button size="sm" disabled={understanding || !transcript.trim()} onClick={onUnderstand}>
            {understanding ? "Understanding…" : "Understand this conversation"}
          </Button>
        ) : null}
      </div>

      <WaveformStrip utterances={utterances} activeId={activeId} onJump={jump} live={live} markers={markers} />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_280px]">
        <div className="max-h-[480px] overflow-auto border-t border-[var(--hairline)] py-2">
          <InteractiveTranscript
            utterances={utterances}
            activeId={activeId}
            onActive={jump}
            llmProvider={llmProvider}
          />
        </div>
        <LiveCopilot signals={signals} live={live} onJump={jump} />
      </div>

      <ConversationMap nodes={map} activeId={activeId} onJump={jump} />

      {analysis ? (
        <div className="space-y-3">
          <ScoreOverview
            score={typeof analysis.dealHealthScore === "number" ? analysis.dealHealthScore : undefined}
            label="Deal health"
            rows={[
              {
                label: "Talk ratio",
                value: analysis.talkRatio?.map((r) => `${r.speaker} ${r.pct}%`).join(" · ") || "—",
              },
              { label: "Objections", value: String(analysis.objections?.length ?? 0) },
              { label: "Next steps", value: String(analysis.nextSteps?.length ?? 0) },
            ]}
          />
          {analysis.objections?.map((o, i) => (
            <InsightCard key={i} label="Risk" title={o.type} tone="risk">
              {o.detail}
            </InsightCard>
          ))}
          {analysis.nextSteps?.map((n, i) => (
            <InsightCard key={i} label="Action" title={n.owner || "Next step"} tone="action">
              {n.task}
            </InsightCard>
          ))}
        </div>
      ) : null}
    </div>
  );
}
