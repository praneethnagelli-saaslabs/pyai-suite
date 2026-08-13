import { cn } from "@/lib/cn";

const STATUS_STYLES: Record<string, string> = {
  SUCCEEDED: "bg-emerald-50 text-status-pass border-emerald-200",
  PARTIAL: "bg-amber-50 text-status-warn border-amber-200",
  FAILED: "bg-red-50 text-status-block border-red-200",
  RUNNING: "bg-sky-50 text-status-running border-sky-200",
  QUEUED: "bg-ink-50 text-ink-600 border-ink-200",
  BUDGET_EXCEEDED: "bg-red-50 text-status-block border-red-200",
  TIMEOUT: "bg-red-50 text-status-block border-red-200",
  CANCELLED: "bg-ink-50 text-ink-500 border-ink-200",
  PASS: "bg-emerald-50 text-status-pass border-emerald-200",
  WARN: "bg-amber-50 text-status-warn border-amber-200",
  BLOCK: "bg-red-50 text-status-block border-red-200",
  healthy: "bg-emerald-50 text-status-pass border-emerald-200",
  degraded: "bg-amber-50 text-status-warn border-amber-200",
  down: "bg-red-50 text-status-block border-red-200",
};

export function StatusBadge({ status, className }: { status: string; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md border px-2 py-0.5 font-mono text-[11px] font-medium uppercase tracking-wide",
        STATUS_STYLES[status] ?? "bg-ink-50 text-ink-600 border-ink-200",
        className,
      )}
    >
      {status}
    </span>
  );
}
