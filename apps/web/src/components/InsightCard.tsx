import type { PropsWithChildren, ReactNode } from "react";
import { cn } from "@/lib/cn";

const RULE = {
  moment: "bg-accent",
  opportunity: "bg-accent",
  risk: "bg-status-warn",
  action: "bg-accent",
} as const;

export function InsightCard({
  label,
  title,
  children,
  tone = "moment",
  icon,
}: PropsWithChildren<{
  label: string;
  title?: string;
  tone?: keyof typeof RULE;
  icon?: ReactNode;
}>) {
  return (
    <div className="relative py-4 pl-4">
      <span className={cn("absolute bottom-4 left-0 top-4 w-0.5", RULE[tone])} aria-hidden />
      <div className="flex items-center gap-2 text-caption uppercase text-ink-400">
        {icon}
        {label}
      </div>
      {title ? <div className="mt-1 font-display text-lg tracking-tight text-ink-950">{title}</div> : null}
      {children ? <div className="mt-2 text-sm leading-relaxed text-ink-600">{children}</div> : null}
    </div>
  );
}

export function ScoreOverview({
  score,
  label,
  rows,
}: {
  score?: number;
  label: string;
  rows: Array<{ label: string; value: string }>;
}) {
  return (
    <div className="border-t border-[var(--hairline)] py-5">
      <div className="flex items-end justify-between gap-3">
        <div>
          <div className="text-caption uppercase text-ink-400">{label}</div>
          {score != null ? (
            <div className="mt-1 font-display text-4xl tabular-nums tracking-tight text-ink-950">{score}</div>
          ) : null}
        </div>
      </div>
      <dl className="mt-5 grid gap-x-6 gap-y-3 sm:grid-cols-2">
        {rows.map((row) => (
          <div key={row.label}>
            <dt className="text-[11px] uppercase tracking-wide text-ink-400">{row.label}</dt>
            <dd className="mt-0.5 text-sm text-ink-800">{row.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
