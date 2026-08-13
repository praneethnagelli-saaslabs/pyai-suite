import type { PropsWithChildren, ReactNode } from "react";
import { Button } from "@/components/ui";

export function EmptyState({
  title,
  body,
  actionLabel,
  onAction,
  secondaryLabel,
  onSecondary,
  icon,
}: {
  title: string;
  body: string;
  actionLabel?: string;
  onAction?: () => void;
  secondaryLabel?: string;
  onSecondary?: () => void;
  icon?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-start gap-4 border-t border-[var(--hairline)] py-8">
      {icon}
      <div>
        <h3 className="font-display text-xl tracking-tight text-ink-950">{title}</h3>
        <p className="mt-2 max-w-lg text-sm leading-relaxed text-ink-500">{body}</p>
      </div>
      {actionLabel && onAction ? (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={onAction}>
            {actionLabel}
          </Button>
          {secondaryLabel && onSecondary ? (
            <Button size="sm" variant="secondary" onClick={onSecondary}>
              {secondaryLabel}
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export function PageHeader({
  title,
  description,
  actions,
  kicker,
}: PropsWithChildren<{ title: string; description?: string; actions?: ReactNode; kicker?: string }>) {
  return (
    <div className="mb-8 flex flex-wrap items-end justify-between gap-4 animate-fade-up">
      <div>
        {kicker ? <div className="mb-2 text-caption uppercase text-ink-400">{kicker}</div> : null}
        <h1 className="font-display text-3xl tracking-tight text-ink-950">{title}</h1>
        {description ? <p className="mt-2 max-w-2xl text-sm leading-relaxed text-ink-500">{description}</p> : null}
      </div>
      {actions}
    </div>
  );
}
