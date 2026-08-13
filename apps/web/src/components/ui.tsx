import type {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  PropsWithChildren,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from "react";
import { cn } from "@/lib/cn";

export function Button({
  className,
  variant = "primary",
  size = "md",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md";
}) {
  return (
    <button
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded font-semibold tracking-tight transition duration-150 ease-spring active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] disabled:pointer-events-none disabled:opacity-50",
        size === "sm" ? "h-8 px-3 text-xs" : "h-10 px-4 text-sm",
        variant === "primary" && "bg-accent text-accent-ink hover:bg-accent-strong",
        variant === "secondary" &&
          "border border-[var(--hairline)] bg-transparent text-ink-800 hover:bg-interactive",
        variant === "ghost" && "text-ink-500 hover:bg-interactive hover:text-ink-900",
        variant === "danger" && "bg-status-block text-white hover:opacity-90",
        className,
      )}
      {...props}
    />
  );
}

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        "h-10 w-full rounded border border-[var(--hairline)] bg-interactive px-3 text-sm text-ink-900 placeholder:text-ink-400 focus:border-accent focus:outline-none focus:ring-2 focus:ring-[var(--ring)]",
        className,
      )}
      {...props}
    />
  );
}

export function Textarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={cn(
        "min-h-[120px] w-full rounded border border-[var(--hairline)] bg-interactive px-3 py-2 text-sm text-ink-900 placeholder:text-ink-400 focus:border-accent focus:outline-none focus:ring-2 focus:ring-[var(--ring)]",
        className,
      )}
      {...props}
    />
  );
}

export function Select({ className, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={cn(
        "h-10 w-full rounded border border-[var(--hairline)] bg-interactive px-3 text-sm text-ink-900 focus:border-accent focus:outline-none focus:ring-2 focus:ring-[var(--ring)]",
        className,
      )}
      {...props}
    />
  );
}

export function Label({ children, className }: PropsWithChildren<{ className?: string }>) {
  return (
    <label className={cn("mb-1.5 block text-caption uppercase text-ink-400", className)}>
      {children}
    </label>
  );
}

export function Kbd({ children }: PropsWithChildren) {
  return (
    <kbd className="rounded border border-[var(--hairline)] bg-interactive px-1.5 py-0.5 font-mono text-[10px] font-medium text-ink-500">
      {children}
    </kbd>
  );
}

export function MetricCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="animate-fade-up border-t border-[var(--hairline)] py-4">
      <div className="text-caption uppercase text-ink-400">{label}</div>
      <div className="mt-1 font-display text-2xl tracking-tight text-ink-950">{value}</div>
      {hint ? <div className="mt-1 text-xs text-ink-500">{hint}</div> : null}
    </div>
  );
}

export function AiWorking({ label = "Analyzing" }: { label?: string }) {
  return (
    <div className="inline-flex items-center gap-2 text-sm text-ink-600">
      <span>{label}</span>
      <span className="ai-dots inline-flex gap-0.5" aria-hidden>
        <span className="h-1 w-1 rounded-full bg-accent" />
        <span className="h-1 w-1 rounded-full bg-accent" />
        <span className="h-1 w-1 rounded-full bg-accent" />
      </span>
    </div>
  );
}

export function RecDot({ label = "Recording" }: { label?: string }) {
  return (
    <span className="inline-flex items-center gap-2 text-xs font-medium text-status-block">
      <span className="h-2 w-2 rounded-full bg-status-block" style={{ animation: "rec-pulse 1.4s ease-in-out infinite" }} />
      {label}
    </span>
  );
}
