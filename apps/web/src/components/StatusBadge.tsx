import { cn } from "@/lib/cn";

const STATUS_STYLES: Record<string, string> = {
  SUCCEEDED: "bg-soft-pass text-status-pass border-status-pass/20",
  PARTIAL: "bg-soft-warn text-status-warn border-status-warn/20",
  FAILED: "bg-soft-block text-status-block border-status-block/20",
  RUNNING: "bg-soft-info text-status-running border-status-running/20",
  RECORDING: "bg-soft-info text-status-running border-status-running/20",
  ANALYZING: "bg-soft-info text-status-running border-status-running/20",
  QUEUED: "bg-ink-50 text-ink-600 border-ink-200",
  BUDGET_EXCEEDED: "bg-soft-block text-status-block border-status-block/20",
  TIMEOUT: "bg-soft-block text-status-block border-status-block/20",
  CANCELLED: "bg-ink-50 text-ink-500 border-ink-200",
  PASS: "bg-soft-pass text-status-pass border-status-pass/20",
  WARN: "bg-soft-warn text-status-warn border-status-warn/20",
  BLOCK: "bg-soft-block text-status-block border-status-block/20",
  healthy: "bg-soft-pass text-status-pass border-status-pass/20",
  degraded: "bg-soft-warn text-status-warn border-status-warn/20",
  down: "bg-soft-block text-status-block border-status-block/20",
};

export function StatusBadge({ status, className }: { status: string; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded border px-2 py-0.5 font-mono text-[10px] font-medium uppercase tracking-wide",
        STATUS_STYLES[status] ?? "bg-ink-50 text-ink-600 border-ink-200",
        className,
      )}
    >
      {status}
    </span>
  );
}
