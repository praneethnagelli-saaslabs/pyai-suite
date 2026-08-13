import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { EmptyState } from "@/components/EmptyState";
import { StatusBadge } from "@/components/StatusBadge";
import { Button, Label, Select } from "@/components/ui";
import { ErrorBanner } from "@/components/ErrorBanner";
import { EvalCard } from "@/components/simulator/EvalCard";
import { api, type SimulatorEvaluation, type SimulatorSimSummary } from "@/lib/api";
import { cn } from "@/lib/cn";

function formatWhen(ts: number): string {
  return new Date(ts).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function formatDur(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function deltaClass(n: number): string {
  if (n > 0) return "text-status-pass";
  if (n < 0) return "text-status-block";
  return "text-ink-500";
}

export function DashboardPanel({ onOpenCompare }: { onOpenCompare?: (id: string) => void }) {
  const dash = useQuery({ queryKey: ["simulator-dashboard"], queryFn: api.simulatorDashboard });
  const [openId, setOpenId] = useState<string | null>(null);
  const detail = useQuery({
    queryKey: ["simulator-sim", openId],
    queryFn: () => api.simulatorSim(openId!),
    enabled: Boolean(openId),
  });

  if (dash.error) {
    return <ErrorBanner title="Dashboard unavailable" message={dash.error instanceof Error ? dash.error.message : "Retry."} onRetry={() => void dash.refetch()} />;
  }
  const data = dash.data;
  if (!data) return <p className="text-sm text-ink-500">Loading lab stats…</p>;
  if (!data.total) {
    return (
      <EmptyState
        title="No simulations yet"
        body="Run a live call or persona scenario. Scores land here after hangup."
      />
    );
  }

  const metrics = [
    { label: "Simulations", value: String(data.total) },
    { label: "Success rate", value: `${data.successRate}%` },
    { label: "Avg score", value: String(data.avgScore) },
    { label: "Avg turn", value: `${data.avgLatencyMs}ms` },
    { label: "Fallback rate", value: `${data.fallbackRate}%` },
  ];

  return (
    <div className="space-y-5">
      <section className="grid gap-3 sm:grid-cols-5">
        {metrics.map((m) => (
          <div key={m.label} className="panel p-4">
            <div className="text-[11px] uppercase tracking-wide text-ink-400">{m.label}</div>
            <div className="mt-1 font-display text-2xl text-ink-950">{m.value}</div>
          </div>
        ))}
      </section>
      <section className="panel overflow-auto">
        <table className="w-full text-left text-sm">
          <thead className="text-[11px] uppercase tracking-wide text-ink-400">
            <tr>
              <th className="px-4 py-2 font-medium">When</th>
              <th className="px-4 py-2 font-medium">Agent</th>
              <th className="px-4 py-2 font-medium">Scenario</th>
              <th className="px-4 py-2 font-medium">Score</th>
              <th className="px-4 py-2 font-medium">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-ink-100">
            {data.recent.map((row) => (
              <tr
                key={row.id}
                className="cursor-pointer hover:bg-ink-50/60"
                onClick={() => setOpenId(row.id)}
              >
                <td className="px-4 py-2 font-mono text-xs text-ink-500">{formatWhen(row.createdAt)}</td>
                <td className="px-4 py-2">
                  {row.agentName} · v{row.version}
                </td>
                <td className="px-4 py-2 text-ink-600">{row.scenarioName ?? row.mode}</td>
                <td className="px-4 py-2 font-mono">{row.score}</td>
                <td className="px-4 py-2">
                  <StatusBadge status={row.passed ? "SUCCEEDED" : "FAILED"} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      {detail.data?.simulation ? (
        <EvalCard
          sim={detail.data.simulation}
          onCompare={onOpenCompare ? () => onOpenCompare(detail.data.simulation.id) : undefined}
        />
      ) : null}
    </div>
  );
}

export function ComparePanel({ preset }: { preset?: string | null }) {
  const list = useQuery({ queryKey: ["simulator-sims"], queryFn: api.simulatorSims });
  const [a, setA] = useState(preset ?? "");
  const [b, setB] = useState("");
  const rows = list.data?.simulations ?? [];
  const ready = a && b && a !== b;
  const cmp = useQuery({
    queryKey: ["simulator-compare", a, b],
    queryFn: () => api.simulatorCompare(a, b),
    enabled: Boolean(ready),
  });

  const options = useMemo(
    () =>
      rows.map((s) => ({
        id: s.id,
        label: `${s.agentName} v${s.version} · ${s.score} · ${formatWhen(s.createdAt)}`,
      })),
    [rows],
  );

  if (!rows.length && !list.isLoading) {
    return (
      <EmptyState
        title="Nothing to compare yet"
        body="Save at least two simulations from Live call or Persona, then pick them here."
      />
    );
  }

  return (
    <div className="space-y-5">
      <section className="panel grid gap-3 p-4 md:grid-cols-[1fr_1fr_auto]">
        <div>
          <Label>Baseline</Label>
          <Select value={a} onChange={(e) => setA(e.target.value)}>
            <option value="">Select a run</option>
            {options.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label>Challenger</Label>
          <Select value={b} onChange={(e) => setB(e.target.value)}>
            <option value="">Select a run</option>
            {options.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </Select>
        </div>
        <div className="flex items-end">
          <Button disabled={!ready || cmp.isFetching} onClick={() => void cmp.refetch()}>
            {cmp.isFetching ? "Comparing…" : "Compare"}
          </Button>
        </div>
      </section>
      {cmp.error ? (
        <ErrorBanner title="Compare failed" message={cmp.error instanceof Error ? cmp.error.message : "Retry."} />
      ) : null}
      {cmp.data ? <CompareResult a={cmp.data.a} b={cmp.data.b} evalA={cmp.data.evalA} evalB={cmp.data.evalB} deltas={cmp.data.deltas} /> : null}
    </div>
  );
}

function CompareResult({
  a,
  b,
  evalA,
  evalB,
  deltas,
}: {
  a: SimulatorSimSummary;
  b: SimulatorSimSummary;
  evalA: SimulatorEvaluation;
  evalB: SimulatorEvaluation;
  deltas: SimulatorEvaluation["scores"];
}) {
  const keys: Array<keyof SimulatorEvaluation["scores"]> = ["overall", "goal", "adherence", "empathy", "latency", "voice"];
  return (
    <section className="panel overflow-auto p-4">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="text-[11px] uppercase tracking-wide text-ink-400">
            <th className="px-3 py-2 font-medium">Metric</th>
            <th className="px-3 py-2 font-medium">
              {a.agentName} v{a.version}
            </th>
            <th className="px-3 py-2 font-medium">
              {b.agentName} v{b.version}
            </th>
            <th className="px-3 py-2 font-medium">Δ</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-ink-100">
          {keys.map((k) => (
            <tr key={k}>
              <td className="px-3 py-2 capitalize text-ink-600">{k}</td>
              <td className="px-3 py-2 font-mono">{evalA.scores[k]}</td>
              <td className="px-3 py-2 font-mono">{evalB.scores[k]}</td>
              <td className={cn("px-3 py-2 font-mono", deltaClass(deltas[k]))}>
                {deltas[k] > 0 ? "+" : ""}
                {deltas[k]}
              </td>
            </tr>
          ))}
          <tr>
            <td className="px-3 py-2 text-ink-600">Duration</td>
            <td className="px-3 py-2 font-mono">{formatDur(a.durationMs)}</td>
            <td className="px-3 py-2 font-mono">{formatDur(b.durationMs)}</td>
            <td className="px-3 py-2 font-mono text-ink-500">—</td>
          </tr>
        </tbody>
      </table>
      <p className="mt-3 text-xs text-ink-500">
        Green means the challenger improved. Latency score is higher when turns completed faster — not raw milliseconds.
      </p>
    </section>
  );
}
