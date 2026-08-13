import { useState } from "react";
import { Button } from "@/components/ui";

export function ErrorBanner({
  title = "Something went wrong",
  message,
  onRetry,
  retryLabel = "Retry",
}: {
  title?: string;
  message: string;
  onRetry?: () => void;
  retryLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const friendly = friendlyError(message);

  return (
    <div className="rounded-lg border border-status-block/30 bg-soft-block px-3 py-2.5 text-sm text-status-block">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="font-medium">{title}</div>
          <p className="mt-0.5 text-status-block/90">{friendly}</p>
        </div>
        <div className="flex gap-2">
          {onRetry ? (
            <Button size="sm" variant="secondary" onClick={onRetry}>
              {retryLabel}
            </Button>
          ) : null}
          <button
            type="button"
            className="text-[11px] text-ink-500 underline-offset-2 hover:underline"
            onClick={() => setOpen((v) => !v)}
          >
            {open ? "Hide details" : "View technical details"}
          </button>
        </div>
      </div>
      {open ? (
        <pre className="mt-2 max-h-32 overflow-auto rounded-md bg-ink-950 p-2 font-mono text-[11px] text-ink-100">
          {message}
        </pre>
      ) : null}
    </div>
  );
}

function friendlyError(raw: string): string {
  const t = raw.toLowerCase();
  if (t.includes("timed out") || t.includes("timeout")) return "The selected provider timed out.";
  if (t.includes("not configured") || t.includes("needs key") || t.includes("api key")) {
    return "That provider isn’t configured. Add a key in Providers, or switch to Mock.";
  }
  if (t.includes("network") || t.includes("fetch") || t.includes("failed to fetch")) {
    return "Couldn’t reach the API. Check that Docker / the local server is running.";
  }
  if (t.includes("transcri")) return "We couldn’t transcribe this recording.";
  if (t.includes("permission") || t.includes("notallowed")) return "Microphone or tab-share permission was denied.";
  if (raw.length > 140) return "The request failed. Open technical details if you need the exact error.";
  return raw;
}
