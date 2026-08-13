import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api } from "@/lib/api";
import { PageHeader } from "@/components/EmptyState";
import { StatusBadge } from "@/components/StatusBadge";
import { Button } from "@/components/ui";

export function DashboardPage() {
  const health = useQuery({ queryKey: ["health"], queryFn: api.health });
  const providers = useQuery({ queryKey: ["providers"], queryFn: api.providers });
  const runs = useQuery({ queryKey: ["runs"], queryFn: () => api.runs(8) });

  const configured = providers.data?.providers.filter((p) => p.configured).length ?? 0;
  const totalProviders = providers.data?.providers.length ?? 0;
  const recent = runs.data?.runs ?? [];

  return (
    <div>
      <PageHeader
        title="Dashboard"
        description="One provider-agnostic AI platform. Four products — CallIQ, Scrib, Brief, and Simulator."
        actions={
          <div className="flex gap-2">
            <Link to="/calliq">
              <Button>Open CallIQ</Button>
            </Link>
            <Link to="/playground">
              <Button variant="secondary">Open playground</Button>
            </Link>
          </div>
        }
      />

      <div className="grid gap-4 md:grid-cols-3">
        <StatCard
          label="API"
          value={health.isLoading ? "…" : health.data?.status === "ok" ? "Healthy" : "Down"}
          hint={health.data ? `${health.data.providers.length} providers registered` : "Connecting…"}
        />
        <StatCard
          label="Providers"
          value={`${configured}/${totalProviders}`}
          hint="Configured with credentials (mock always on)"
        />
        <StatCard
          label="Recent runs"
          value={String(recent.length)}
          hint="Every AI operation appears in Runs"
        />
      </div>

      <section className="mt-8 panel p-5">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-ink-900">Products</h2>
          <span className="font-mono text-[11px] text-ink-400">DEMO MODE READY</span>
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          <ProductCard
            name="CallIQ"
            pitch="Paste a Meet link to send the bot — or try the product demo."
            to="/calliq"
            ready
          />
          <ProductCard
            name="Scrib"
            pitch="Hold to talk for live dictation with app-aware cleanup."
            to="/scrib"
            ready
          />
          <ProductCard
            name="Brief"
            pitch="Hear transcribes Meet/uploads. Summary writes decisions, actions, and memory."
            to="/brief"
            ready
          />
          <ProductCard
            name="Simulator"
            pitch="Stress-test voice agents with adversarial callers and a benchmark card."
            to="/simulator"
            ready
          />
        </div>
      </section>

      <section className="mt-6 panel p-5">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold">Recent runs</h2>
          <Link to="/runs" className="text-xs text-accent hover:underline">
            View all
          </Link>
        </div>
        {recent.length === 0 ? (
          <p className="text-sm text-ink-500">No runs yet. Analyze a sample call to create the first one.</p>
        ) : (
          <ul className="divide-y divide-ink-100">
            {recent.map((r) => (
              <li key={r.runId} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                <div className="min-w-0">
                  <div className="truncate font-mono text-xs text-ink-500">{r.runId}</div>
                  <div className="truncate text-ink-800">
                    {r.product} · {r.workflowId}
                  </div>
                </div>
                <StatusBadge status={r.status} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function StatCard({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="panel p-4 animate-fade-up">
      <div className="text-[11px] font-medium uppercase tracking-wide text-ink-400">{label}</div>
      <div className="mt-2 text-2xl font-semibold tracking-tight text-ink-950">{value}</div>
      <div className="mt-1 text-xs text-ink-500">{hint}</div>
    </div>
  );
}

function ProductCard({
  name,
  pitch,
  to,
  ready,
}: {
  name: string;
  pitch: string;
  to: string;
  ready: boolean;
}) {
  return (
    <Link
      to={to}
      className="block rounded-lg border border-ink-100 bg-ink-50/50 px-4 py-3 transition hover:border-accent/40 hover:bg-white"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="font-medium text-ink-900">{name}</div>
        <StatusBadge status={ready ? "SUCCEEDED" : "QUEUED"} />
      </div>
      <p className="mt-1 text-sm text-ink-500">{pitch}</p>
    </Link>
  );
}
