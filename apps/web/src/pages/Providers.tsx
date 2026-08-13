import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { sortProviders } from "@/lib/providers";
import { PageHeader, EmptyState } from "@/components/EmptyState";
import { StatusBadge } from "@/components/StatusBadge";
import { Button } from "@/components/ui";

export function ProvidersPage() {
  const providers = useQuery({ queryKey: ["providers"], queryFn: api.providers });
  const health = useQuery({ queryKey: ["provider-health"], queryFn: api.providerHealth });
  const [sandboxMsg, setSandboxMsg] = useState<string | null>(null);
  const [sandboxBusy, setSandboxBusy] = useState(false);

  const healthById = new Map((health.data?.health ?? []).map((h) => [h.id, h]));
  const pyai = providers.data?.providers.find((p) => p.id === "pyai");

  async function connectSandbox() {
    setSandboxBusy(true);
    setSandboxMsg(null);
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
      setSandboxMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setSandboxBusy(false);
    }
  }

  return (
    <div>
      <PageHeader
        title="Providers"
        description="Connect once. Switch anytime without redeploying. PyAI is the default; MockProvider powers offline Demo Mode."
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
        <div className="mb-4 rounded-lg border border-ink-200 bg-white px-3 py-2 text-sm text-ink-700">
          {sandboxMsg}{" "}
          <a className="text-accent hover:underline" href="https://docs.pyai.com/quickstart" target="_blank" rel="noreferrer">
            docs.pyai.com/quickstart
          </a>
        </div>
      ) : null}

      {!providers.data?.providers.length ? (
        <EmptyState title="No providers registered" body="The API platform registry is empty." />
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {sortProviders(providers.data.providers).map((p) => {
            const h = healthById.get(p.id);
            return (
              <div key={p.id} className="panel p-4 animate-fade-up">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-base font-semibold text-ink-950">{p.name}</div>
                    <div className="font-mono text-xs text-ink-400">{p.id}</div>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <StatusBadge status={p.configured || p.id === "mock" ? "SUCCEEDED" : "QUEUED"} />
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
                    : p.configured || p.id === "mock"
                      ? h
                        ? `Latency ${h.latencyMs}ms · checked ${new Date(h.checkedAt).toLocaleTimeString()}`
                        : "Configured"
                      : "Set the matching API key in .env to activate"}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
