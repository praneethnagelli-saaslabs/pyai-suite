import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { AudioLines, Brain, Mic2, Bot } from "lucide-react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui";
import { StatusBadge } from "@/components/StatusBadge";

const PRODUCTS = [
  {
    to: "/calliq",
    name: "CallIQ",
    icon: AudioLines,
    what: "Sales-call intelligence",
    how: "Send a bot into Google Meet, or play a sample call with audio. Recap writes objections and next steps.",
    action: "Open CallIQ",
  },
  {
    to: "/scrib",
    name: "Scrib",
    icon: Mic2,
    what: "Voice typing",
    how: "Hold to talk. Hear transcribes; cleanup turns it into Slack-ready text.",
    action: "Open Scrib",
  },
  {
    to: "/brief",
    name: "Brief",
    icon: Brain,
    what: "Meeting notes (no bot)",
    how: "Share your Meet tab with audio. You stay in the call; Brief writes decisions and actions.",
    action: "Open Brief",
  },
  {
    to: "/simulator",
    name: "Simulator",
    icon: Bot,
    what: "Voice-agent lab",
    how: "Talk live, save agent versions, or let an AI customer run a scenario. Then stress-test for a benchmark card.",
    action: "Open Simulator",
  },
] as const;

export function DashboardPage() {
  const health = useQuery({ queryKey: ["health"], queryFn: api.health });
  const runs = useQuery({ queryKey: ["runs"], queryFn: () => api.runs(6) });
  const recent = runs.data?.runs ?? [];

  return (
    <div className="space-y-10">
      <header>
        <p className="text-caption uppercase text-ink-400">PyAI Suite</p>
        <h1 className="mt-2 font-display text-display text-ink-950">Four products. One voice platform.</h1>
        <p className="mt-3 max-w-xl text-sm leading-relaxed text-ink-500">
          Pick a product below. To see CallIQ with sound, play the sample sales call — you’ll hear a short conversation,
          then Recap fills in deal notes. That is not a live Google Meet.
        </p>
        <div className="mt-5 flex flex-wrap gap-2">
          <Link to="/calliq?demo=1">
            <Button>Play sample sales call</Button>
          </Link>
          <Link to="/calliq">
            <Button variant="secondary">Join a real Meet</Button>
          </Link>
        </div>
        {health.data && health.data.status !== "ok" ? (
          <p className="mt-3 text-sm text-status-block">API is down — start Docker / the local server first.</p>
        ) : null}
      </header>

      <section className="space-y-0">
        {PRODUCTS.map((p) => (
          <Link
            key={p.to}
            to={p.to}
            className="group flex gap-4 border-t border-[var(--hairline)] py-5 transition hover:text-ink-950"
          >
            <p.icon className="mt-0.5 h-4 w-4 shrink-0 text-ink-400 group-hover:text-accent" />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-baseline gap-2">
                <span className="font-semibold text-ink-900">{p.name}</span>
                <span className="text-xs text-ink-400">{p.what}</span>
              </div>
              <p className="mt-1 text-sm leading-relaxed text-ink-500">{p.how}</p>
            </div>
            <span className="shrink-0 self-center text-xs text-ink-400 group-hover:text-accent">{p.action} →</span>
          </Link>
        ))}
      </section>

      {recent.length ? (
        <section>
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-sm font-semibold">Recent runs</h2>
            <Link to="/runs" className="text-xs text-accent hover:underline">
              All runs
            </Link>
          </div>
          <ul className="divide-y divide-[var(--hairline)] border-t border-[var(--hairline)]">
            {recent.map((r) => (
              <li key={r.runId} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                <span className="truncate text-ink-800">
                  {r.product} · {r.workflowId}
                </span>
                <StatusBadge status={r.status} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
