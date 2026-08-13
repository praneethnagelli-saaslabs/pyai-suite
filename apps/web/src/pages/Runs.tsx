import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { PageHeader, EmptyState } from "@/components/EmptyState";
import { StatusBadge } from "@/components/StatusBadge";
import { Button } from "@/components/ui";
import { ErrorBanner } from "@/components/ErrorBanner";
import { ListSkeleton } from "@/components/Skeleton";

export function RunsPage() {
  const navigate = useNavigate();
  const runs = useQuery({ queryKey: ["runs"], queryFn: () => api.runs(100), refetchInterval: 4000 });
  const [selected, setSelected] = useState<string | null>(null);
  const detail = useQuery({
    queryKey: ["run", selected],
    queryFn: () => api.run(selected!),
    enabled: !!selected,
  });

  const list = runs.data?.runs ?? [];

  return (
    <div>
      <PageHeader
        kicker="Platform"
        title="Runs"
        description="Every AI operation ends in an explicit status — latency, provider calls, and failures stay inspectable."
        actions={
          <Button variant="secondary" onClick={() => void runs.refetch()}>
            Refresh
          </Button>
        }
      />

      {runs.isLoading ? (
        <div className="panel overflow-hidden">
          <ListSkeleton rows={8} />
        </div>
      ) : list.length === 0 ? (
        <EmptyState
          title="No runs yet"
          body="CallIQ analysis, Scrib dictation, Brief summaries, and playground executions appear here with latency and provider calls."
          actionLabel="Open playground"
          onAction={() => navigate("/playground")}
        />
      ) : (
        <div className="grid gap-4 lg:grid-cols-[1fr_1.1fr]">
          <div className="panel overflow-hidden">
            <ul className="max-h-[70vh] divide-y divide-ink-100 overflow-auto">
              {list.map((r) => (
                <li key={r.runId}>
                  <button
                    type="button"
                    onClick={() => setSelected(r.runId)}
                    className={`flex w-full items-center justify-between gap-3 px-4 py-3 text-left text-sm transition hover:bg-ink-50 ${selected === r.runId ? "bg-accent-soft/60" : ""}`}
                  >
                    <div className="min-w-0">
                      <div className="truncate font-medium text-ink-900">{r.workflowId}</div>
                      <div className="truncate font-mono text-[11px] text-ink-400">
                        {r.runId} · {r.product}
                      </div>
                    </div>
                    <StatusBadge status={r.status} />
                  </button>
                </li>
              ))}
            </ul>
          </div>

          <div className="panel p-4">
            {!selected ? (
              <p className="text-sm text-ink-400">Select a run to inspect timeline, latency, and provider calls.</p>
            ) : detail.isLoading ? (
              <ListSkeleton rows={4} />
            ) : detail.data ? (
              <div className="animate-fade-up">
                <div className="flex flex-wrap items-center gap-2">
                  <StatusBadge status={detail.data.run.status} />
                  <span className="font-mono text-xs text-ink-500">{detail.data.run.runId}</span>
                </div>
                <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <dt className="text-caption uppercase text-ink-400">Latency</dt>
                    <dd className="font-mono">{detail.data.run.durationMs ?? "—"}ms</dd>
                  </div>
                  <div>
                    <dt className="text-caption uppercase text-ink-400">Provider calls</dt>
                    <dd className="font-mono">{detail.data.calls.length}</dd>
                  </div>
                </dl>
                {detail.data.run.error ? (
                  <div className="mt-4">
                    <ErrorBanner title="This run failed" message={String(detail.data.run.error)} />
                  </div>
                ) : null}
                <h3 className="mt-5 text-sm font-semibold">Provider calls</h3>
                <ul className="mt-2 space-y-2">
                  {detail.data.calls.length === 0 ? (
                    <li className="text-sm text-ink-400">No provider call spans recorded.</li>
                  ) : (
                    detail.data.calls.map((c, i) => {
                      const started = typeof c.startedAt === "number" ? c.startedAt : undefined;
                      const completed = typeof c.completedAt === "number" ? c.completedAt : undefined;
                      const ms =
                        started != null && completed != null ? Math.max(0, completed - started) : undefined;
                      const label = [c.provider, c.capability, c.model].filter(Boolean).join(" · ") || "call";
                      return (
                        <li
                          key={i}
                          className="rounded-lg border border-ink-100 bg-ink-50/70 px-3 py-2 font-mono text-[11px] text-ink-700"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="truncate">{String(label)}</span>
                            <span className="shrink-0 text-ink-500">{ms != null ? `${ms}ms` : "—"}</span>
                          </div>
                        </li>
                      );
                    })
                  )}
                </ul>
              </div>
            ) : (
              <p className="text-sm text-status-block">Run not found</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
