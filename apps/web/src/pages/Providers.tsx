import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { sortProviders } from "@/lib/providers";
import { PageHeader, EmptyState } from "@/components/EmptyState";
import { StatusBadge } from "@/components/StatusBadge";
import { Button } from "@/components/ui";
import { CardSkeleton } from "@/components/Skeleton";
import { ErrorBanner } from "@/components/ErrorBanner";

const ROUTING = [
  { role: "Speech-to-text", primary: "PyAI Hear", fallback: "OpenAI → Mock" },
  { role: "Speech synthesis", primary: "PyAI Speak", fallback: "OpenAI → Mock" },
  { role: "LLM / recap", primary: "PyAI if available", fallback: "OpenAI → Gemini → Mock" },
];

export function ProvidersPage() {
  const providers = useQuery({ queryKey: ["providers"], queryFn: api.providers });
  const health = useQuery({
    queryKey: ["provider-health"],
    queryFn: api.providerHealth,
    refetchInterval: (q) => (q.state.data?.hear?.pyai?.active ? 5_000 : false),
  });
  const [sandboxMsg, setSandboxMsg] = useState<string | null>(null);
  const [sandboxErr, setSandboxErr] = useState<string | null>(null);
  const [sandboxBusy, setSandboxBusy] = useState(false);

  const healthById = new Map((health.data?.health ?? []).map((h) => [h.id, h]));
  const pyai = providers.data?.providers.find((p) => p.id === "pyai");
  const hearCooldown = health.data?.hear?.pyai;
  const hearCooldownSecs = hearCooldown?.active
    ? Math.max(1, Math.ceil((hearCooldown.remainingMs ?? 0) / 1000))
    : 0;

  async function connectSandbox() {
    setSandboxBusy(true);
    setSandboxMsg(null);
    setSandboxErr(null);
    try {
      const out = await api.connectPyAISandbox();
      setSandboxMsg(
        out.status === "connected"
          ? `Connected ${out.keyPrefix} — key stays on the API (never sent to the browser).`
          : "PyAI already configured for this API process.",
      );
      await providers.refetch();
      await health.refetch();
    } catch (e) {
      setSandboxErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSandboxBusy(false);
    }
  }

  return (
    <div>
      <PageHeader
        kicker="Platform"
        title="Providers"
        description="Connect once. Switch anytime. PyAI is first-class; OpenAI, Gemini, and Mock stay interchangeable without redesigning the UI."
        actions={
          <div className="flex gap-2">
            {pyai && !pyai.configured ? (
              <Button disabled={sandboxBusy} onClick={() => void connectSandbox()}>
                {sandboxBusy ? "Connecting…" : "Connect PyAI sandbox"}
              </Button>
            ) : null}
            <Button
              variant="secondary"
              onClick={() => {
                void providers.refetch();
                void health.refetch();
              }}
            >
              Re-check health
            </Button>
          </div>
        }
      />

      {sandboxMsg ? (
        <div className="mb-4 rounded-lg border border-ink-200 bg-surface px-3 py-2 text-sm text-ink-700">
          {sandboxMsg}{" "}
          <a className="text-accent hover:underline" href="https://docs.pyai.com/quickstart" target="_blank" rel="noreferrer">
            docs.pyai.com/quickstart
          </a>
        </div>
      ) : null}
      {sandboxErr ? (
        <div className="mb-4">
          <ErrorBanner title="Couldn’t connect PyAI" message={sandboxErr} onRetry={() => void connectSandbox()} />
        </div>
      ) : null}

      <section className="panel mb-5 p-4">
        <h2 className="text-sm font-semibold text-ink-900">Living router</h2>
        <p className="mt-1 text-xs text-ink-500">
          Every request hits this order. The first configured provider that supports the capability wins — you can still
          override per run. Live Meet Hear uses an 8s budget; uploads get 90s. After a Hear miss, all STT skips Hear for
          ~3 min (OpenAI fallback) even if Providers still shows healthy.
        </p>
        {hearCooldown?.active ? (
          <div
            role="status"
            className="mt-3 rounded-lg border border-amber-300/80 bg-amber-50 px-3 py-2 text-sm text-amber-950 dark:border-amber-700/60 dark:bg-amber-950/40 dark:text-amber-100"
          >
            <span className="font-semibold">PyAI Hear cooldown</span>
            <span className="mt-0.5 block font-mono text-[11px] leading-snug opacity-90">
              Healthy key, but Hear is skipped for ~{hearCooldownSecs}s
              {hearCooldown.reason ? ` — ${hearCooldown.reason}` : ""}. Live and uploads both fall back until it clears.
            </span>
          </div>
        ) : null}
        <div className="mt-4 flex flex-wrap items-center justify-center gap-2 text-xs">
          <span className="rounded-full border border-ink-200 px-3 py-1.5 text-ink-600">Request</span>
          <span className="text-ink-300">→</span>
          <span className="rounded-full border border-accent/40 bg-accent-soft px-3 py-1.5 font-medium text-accent-strong">
            Router
          </span>
          <span className="text-ink-300">→</span>
          {sortProviders(providers.data?.providers ?? []).map((p) => {
            const h = healthById.get(p.id);
            const on = p.configured || p.id === "mock";
            return (
              <span
                key={p.id}
                className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 ${
                  on ? "border-ink-200 bg-surface text-ink-800" : "border-ink-100 text-ink-400"
                }`}
              >
                <span
                  className={`h-1.5 w-1.5 rounded-full ${
                    h?.status === "healthy" || (on && !h) ? "bg-status-pass" : h?.status === "degraded" ? "bg-status-warn" : "bg-ink-300"
                  }`}
                />
                {p.name}
              </span>
            );
          })}
          <span className="text-ink-300">→</span>
          <span className="rounded-full border border-ink-200 px-3 py-1.5 text-ink-600">Result</span>
        </div>
        <ul className="mt-4 grid gap-2 md:grid-cols-3">
          {ROUTING.map((row) => (
            <li key={row.role} className="rounded-lg bg-ink-50 px-3 py-2.5">
              <div className="text-[11px] uppercase tracking-wide text-ink-400">{row.role}</div>
              <div className="mt-1 text-sm font-medium text-ink-900">{row.primary}</div>
              <div className="mt-0.5 text-xs text-ink-500">Fallback: {row.fallback}</div>
            </li>
          ))}
        </ul>
      </section>

      {providers.isLoading ? (
        <div className="grid gap-3 md:grid-cols-2">
          <CardSkeleton />
          <CardSkeleton />
        </div>
      ) : !providers.data?.providers.length ? (
        <EmptyState title="No providers registered" body="The API platform registry is empty. Restart the API container." />
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {sortProviders(providers.data.providers).map((p) => {
            const h = healthById.get(p.id);
            const ready = p.configured || p.id === "mock";
            return (
              <div key={p.id} className="panel p-4 animate-fade-up">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <span
                        className={`h-2 w-2 rounded-full ${ready ? "bg-status-pass" : "bg-ink-300"}`}
                        aria-hidden
                      />
                      <div className="text-base font-semibold text-ink-950">{p.name}</div>
                    </div>
                    <div className="mt-0.5 font-mono text-xs text-ink-400">{p.id}</div>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <StatusBadge status={ready ? "SUCCEEDED" : "QUEUED"} />
                    {h ? <StatusBadge status={h.status} /> : null}
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {p.capabilities.map((c) => (
                    <span key={c} className="rounded-md border border-ink-200 bg-ink-50 px-2 py-0.5 font-mono text-[10px] text-ink-600">
                      {c}
                    </span>
                  ))}
                </div>
                <div className="mt-3 text-xs text-ink-500">
                  {p.id === "pyai" && !p.configured
                    ? "Instant sandbox key — no signup. Or set PYAI_API_KEY in .env."
                    : ready
                      ? h
                        ? `Latency ${h.latencyMs}ms · checked ${new Date(h.checkedAt).toLocaleTimeString()}`
                        : "Configured"
                      : "Set the matching API key in .env to activate"}
                </div>
                {p.id === "pyai" && hearCooldown?.active ? (
                  <div className="mt-2 rounded-md border border-amber-300/70 bg-amber-50 px-2 py-1.5 font-mono text-[10px] text-amber-950 dark:border-amber-700/50 dark:bg-amber-950/40 dark:text-amber-100">
                    Hear skipped ~{hearCooldownSecs}s (all STT)
                    {hearCooldown.reason ? ` · ${hearCooldown.reason}` : ""}
                  </div>
                ) : p.id === "pyai" && ready ? (
                  <div className="mt-2 font-mono text-[10px] text-ink-400">
                    Hear · live {hearCooldown?.liveBudgetMs ?? 8000}ms · batch {hearCooldown?.batchBudgetMs ?? 90000}ms
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
