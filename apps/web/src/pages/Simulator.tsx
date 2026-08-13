import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { PageHeader, EmptyState } from "@/components/EmptyState";
import { StatusBadge } from "@/components/StatusBadge";
import { DemoStages, type DemoStage } from "@/components/DemoStages";
import { Button, Input, Label, Select } from "@/components/ui";
import { api } from "@/lib/api";
import { pickPreferred, sortProviders } from "@/lib/providers";

type Result = Awaited<ReturnType<typeof api.simulatorRun>>;

export function SimulatorPage() {
  const providers = useQuery({ queryKey: ["providers"], queryFn: api.providers });
  const [agentName, setAgentName] = useState("Acme Receptionist");
  const [count, setCount] = useState(10);
  const [llmProvider, setLlmProvider] = useState("mock");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [stages, setStages] = useState<DemoStage[]>([]);
  const [showSettings, setShowSettings] = useState(false);

  const llmOptions = useMemo(
    () => sortProviders(providers.data?.providers.filter((p) => p.capabilities.includes("llm")) ?? []),
    [providers.data],
  );

  useEffect(() => {
    if (!providers.data) return;
    setLlmProvider(pickPreferred(providers.data.providers, "llm"));
  }, [providers.data]);

  async function runDemo() {
    setBusy(true);
    setError(null);
    setResult(null);
    setStages([
      { id: "spawn", label: "Spawn adversarial callers…", detail: `${count} personas` },
      { id: "score", label: "Score conversations…", detail: llmProvider },
      { id: "card", label: "Build benchmark card…", detail: agentName },
    ]);
    try {
      const out = await api.simulatorRun({
        agentName,
        count,
        concurrency: Math.min(count, 5),
        llmProvider,
      });
      setStages(out.stages ?? []);
      setResult(out);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStages([]);
    } finally {
      setBusy(false);
    }
  }

  const card = result?.card;

  return (
    <div>
      <PageHeader
        title="Simulator"
        description="Stress-test your voice agent with adversarial callers."
        actions={
          <Button disabled={busy} onClick={() => void runDemo()}>
            {busy ? "Running stress test…" : "Run stress test"}
          </Button>
        }
      />

      <section className="panel mb-5 space-y-3 p-4">
        <div>
          <Label>Agent name</Label>
          <Input
            value={agentName}
            onChange={(e) => setAgentName(e.target.value)}
            placeholder="Acme Receptionist"
            disabled={busy}
          />
          <p className="mt-1 text-xs text-ink-500">
            Name the agent under test. We spawn adversarial callers, score each conversation, and build a
            shareable benchmark card.
          </p>
        </div>
        <button
          type="button"
          className="text-[11px] text-ink-500 underline-offset-2 hover:text-ink-800 hover:underline"
          onClick={() => setShowSettings((v) => !v)}
        >
          {showSettings ? "Hide settings" : "Settings"}
        </button>
        {showSettings ? (
          <div className="grid gap-3 border-t border-ink-100 pt-3 md:grid-cols-2">
            <div>
              <Label>Callers</Label>
              <Select value={String(count)} onChange={(e) => setCount(Number(e.target.value))} disabled={busy}>
                {[1, 5, 10, 20, 50].map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label>LLM provider</Label>
              <Select value={llmProvider} onChange={(e) => setLlmProvider(e.target.value)} disabled={busy}>
                {llmOptions.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                    {p.configured ? "" : " (needs key)"}
                  </option>
                ))}
              </Select>
            </div>
          </div>
        ) : null}
      </section>

      {error ? <div className="mb-4 text-sm text-status-block">{error}</div> : null}
      {(busy || stages.length > 0) && (
        <div className="panel mb-5 p-4">
          <h3 className="mb-3 text-sm font-semibold">Pipeline</h3>
          <DemoStages stages={stages} running={busy} />
        </div>
      )}
      {!card && !busy ? (
        <EmptyState
          title="No benchmark yet"
          body="Run stress test to spawn callers and build a benchmark card."
          actionLabel="Run stress test"
          onAction={() => void runDemo()}
        />
      ) : card ? (
        <div className="grid gap-4 lg:grid-cols-[0.9fr_1.1fr]">
          <div className="panel p-5 animate-fade-up">
            <div className="text-[11px] uppercase tracking-wide text-ink-400">Benchmark card</div>
            <h2 className="mt-1 text-2xl font-semibold">{card.agent}</h2>
            <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
              <div>
                <div className="text-ink-400">Tests</div>
                <div className="text-xl font-semibold">{card.tests}</div>
              </div>
              <div>
                <div className="text-ink-400">Score</div>
                <div className="text-xl font-semibold">{card.score}%</div>
              </div>
              <div>
                <div className="text-ink-400">Passed</div>
                <div className="text-status-pass">{card.passed}</div>
              </div>
              <div>
                <div className="text-ink-400">Failed</div>
                <div className="text-status-block">{card.failed}</div>
              </div>
              <div>
                <div className="text-ink-400">Median latency</div>
                <div className="font-mono">{card.medianLatencyMs}ms</div>
              </div>
            </div>
            {card.worstFailure ? <p className="mt-4 text-sm text-status-block">Worst: {card.worstFailure}</p> : null}
            <p className="mt-4 text-[11px] text-ink-400">Built with PyAI · shareable card</p>
          </div>
          <div className="panel max-h-[520px] overflow-auto">
            <ul className="divide-y divide-ink-100">
              {card.calls.map((c) => (
                <li key={c.callId} className="px-4 py-3 text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <div className="font-mono text-xs text-ink-500">
                      {c.callId} · {c.persona}
                    </div>
                    <StatusBadge status={c.passed ? "SUCCEEDED" : "FAILED"} />
                  </div>
                  <div className="mt-1 text-ink-700">
                    score {c.score} · {c.latencyMs}ms
                  </div>
                  {c.failures.length ? (
                    <div className="mt-1 font-mono text-[11px] text-status-block">{c.failures.join(", ")}</div>
                  ) : null}
                </li>
              ))}
            </ul>
          </div>
        </div>
      ) : null}
    </div>
  );
}
