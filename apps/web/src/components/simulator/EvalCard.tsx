import { StatusBadge } from "@/components/StatusBadge";
import type { SimulatorEvaluation, SimulatorSimulation } from "@/lib/api";
import { cn } from "@/lib/cn";

const SCORE_LABELS: Array<{ key: keyof SimulatorEvaluation["scores"]; label: string }> = [
  { key: "goal", label: "Goal" },
  { key: "adherence", label: "Adherence" },
  { key: "empathy", label: "Empathy" },
  { key: "latency", label: "Latency" },
  { key: "voice", label: "Voice" },
];

export function EvalCard({
  sim,
  onCompare,
}: {
  sim: SimulatorSimulation;
  onCompare?: () => void;
}) {
  const ev = sim.evaluation;
  return (
    <section className="panel space-y-4 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[11px] uppercase tracking-wide text-ink-400">Simulation complete</p>
          <h3 className="mt-1 font-display text-2xl text-ink-950">{ev.scores.overall} / 100</h3>
          <p className="mt-1 text-sm text-ink-600">{ev.summary}</p>
        </div>
        <div className="flex items-center gap-2">
          <StatusBadge status={ev.passed ? "SUCCEEDED" : "FAILED"} />
          {onCompare ? (
            <button type="button" className="text-[11px] text-ink-500 underline-offset-2 hover:underline" onClick={onCompare}>
              Compare
            </button>
          ) : null}
        </div>
      </div>
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        {SCORE_LABELS.map((row) => (
          <div key={row.key}>
            <dt className="text-[11px] uppercase tracking-wide text-ink-400">{row.label}</dt>
            <dd className="mt-0.5 font-mono text-lg text-ink-900">{ev.scores[row.key]}</dd>
          </div>
        ))}
      </dl>
      {ev.checks.length ? (
        <ul className="space-y-2">
          {ev.checks.map((c) => (
            <li key={c.id} className="text-sm">
              <span
                className={cn(
                  "mr-2 font-mono text-[10px] uppercase",
                  c.status === "pass" && "text-status-pass",
                  c.status === "warn" && "text-status-warn",
                  c.status === "fail" && "text-status-block",
                )}
              >
                {c.status}
              </span>
              <span className="text-ink-800">{c.label}</span>
              <p className="ml-10 text-xs text-ink-500">{c.detail}</p>
            </li>
          ))}
        </ul>
      ) : null}
      <p className="text-[11px] text-ink-400">
        {sim.agentName} · v{sim.version}
        {sim.scenarioName ? ` · ${sim.scenarioName}` : ""} · {sim.provider}
        {sim.fallbackUsed ? " · fallback" : ""}
      </p>
    </section>
  );
}
