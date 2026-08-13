import { useEffect, useRef, useState } from "react";
import { Mic, MicOff, PhoneOff } from "lucide-react";
import { Button } from "@/components/ui";
import { cn } from "@/lib/cn";
import type { CallState, CallTurn } from "@/lib/simulatorCall";

const STATE_LABEL: Record<CallState, string> = {
  idle: "Idle",
  connecting: "Connecting",
  listening: "Listening",
  user_speaking: "You're speaking",
  processing: "Thinking",
  agent_speaking: "Speaking",
  overlapping: "Both speaking",
  interrupted: "Interrupted",
  error: "Error",
  ended: "Ended",
};

export function CallConsole({
  agentName,
  state,
  level,
  muted,
  startedAt,
  provider,
  fallbackUsed,
  notice,
  turns,
  onMute,
  onEnd,
  userLabel,
}: {
  agentName: string;
  state: CallState;
  level: number;
  muted: boolean;
  startedAt: number | null;
  provider?: string;
  fallbackUsed?: boolean;
  notice?: string | null;
  turns: CallTurn[];
  onMute: () => void;
  onEnd: () => void;
  userLabel?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const history = useRef<number[]>(Array.from({ length: 48 }, () => 0.04));

  useEffect(() => {
    const next = [...history.current.slice(1), Math.min(1, muted ? 0.03 : Math.max(0.04, level * 4))];
    history.current = next;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);
    const mid = h / 2;
    const gap = w / next.length;
    ctx.strokeStyle = getComputedStyle(canvas).getPropertyValue("--accent").trim() || "#0f766e";
    ctx.lineWidth = 2;
    ctx.beginPath();
    next.forEach((v, i) => {
      const x = i * gap + gap / 2;
      const amp = v * (h * 0.42);
      ctx.moveTo(x, mid - amp);
      ctx.lineTo(x, mid + amp);
    });
    ctx.stroke();
  }, [level, muted]);

  const elapsed = useCallTimer(startedAt);
  const live = state !== "ended" && state !== "error" && state !== "idle";

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
      <section className="panel flex flex-col items-center px-6 py-10 text-center">
        <div
          className={cn(
            "flex h-16 w-16 items-center justify-center rounded-full bg-ink-900 text-lg font-semibold text-white dark:bg-accent dark:text-accent-ink",
            live && state === "listening" && "animate-pulse",
          )}
        >
          {initials(agentName)}
        </div>
        <h2 className="mt-4 font-display text-2xl text-ink-950">{agentName}</h2>
        <p className="mt-1 text-sm text-ink-500">{STATE_LABEL[state]}</p>
        <canvas ref={canvasRef} width={320} height={56} className="mt-6 w-full max-w-sm" aria-hidden />
        <p className="mt-4 font-mono text-sm tabular-nums text-ink-700">{elapsed}</p>
        <p className="mt-2 text-[11px] uppercase tracking-wide text-ink-400">
          {provider ?? "connecting"}
          {fallbackUsed ? " · fallback" : ""}
        </p>
        {notice ? <p className="mt-3 max-w-sm text-xs leading-relaxed text-status-warn">{notice}</p> : null}
        <div className="mt-8 flex items-center gap-3">
          <Button type="button" variant="secondary" onClick={onMute} disabled={!live}>
            {muted ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
            {muted ? "Unmute" : "Mute"}
          </Button>
          <Button type="button" variant="danger" onClick={onEnd}>
            <PhoneOff className="h-4 w-4" />
            End
          </Button>
        </div>
      </section>

      <section className="panel max-h-[520px] overflow-auto p-4">
        <h3 className="text-[11px] font-semibold uppercase tracking-wide text-ink-400">Transcript</h3>
        {turns.length === 0 ? (
          <p className="mt-4 text-sm text-ink-500">The conversation will appear here as you talk.</p>
        ) : (
          <ol className="mt-4 space-y-4">
            {turns.map((t) => (
              <li key={t.id}>
                <div className="text-[11px] font-semibold uppercase tracking-wide text-ink-400">
                  {t.speaker === "agent" ? agentName : userLabel ?? "You"}
                  <span className="ml-2 font-mono font-normal normal-case text-ink-300">
                    {new Date(t.ts).toLocaleTimeString()}
                  </span>
                </div>
                <p className={cn("mt-1 text-sm leading-relaxed text-ink-800", !t.final && "text-ink-500")}>
                  {t.text}
                </p>
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "A") + (parts[1]?.[0] ?? "")).toUpperCase();
}

function useCallTimer(startedAt: number | null): string {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!startedAt) return;
    const id = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(id);
  }, [startedAt]);
  if (!startedAt) return "00:00";
  return formatElapsed(now - startedAt);
}

function formatElapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(s / 60);
  return `${String(m).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}
