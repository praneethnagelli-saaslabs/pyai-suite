import { cn } from "@/lib/cn";

export type SharePhase = "idle" | "picker" | "mic" | "capturing" | "done";
export type CaptureSource = "tab" | "mic" | null;

/** Chrome-like tab share picker used by the Brief product demo. */
export function SimulatedSharePicker({
  phase,
  meetTitle = "Launch planning",
}: {
  phase: SharePhase;
  meetTitle?: string;
}) {
  if (phase !== "picker" && phase !== "mic") return null;

  return (
    <div className="mb-5 overflow-hidden rounded-xl border border-ink-200 bg-white shadow-lg animate-fade-up">
      <div className="border-b border-ink-100 px-4 py-2.5">
        <div className="text-sm font-semibold text-ink-900">
          {phase === "mic" ? "Allow microphone" : "Share your screen"}
        </div>
        <div className="text-[11px] text-ink-500">
          {phase === "mic"
            ? "Brief needs the mic to label your speech as Me:"
            : "Choose Chrome Tab and share tab audio — same as a real capture"}
        </div>
      </div>

      {phase === "picker" ? (
        <div className="space-y-3 p-4">
          <div className="flex gap-1 rounded-lg bg-ink-50 p-1 text-xs font-medium">
            <span className="rounded-md bg-white px-3 py-1.5 text-ink-900 shadow-sm">Chrome Tab</span>
            <span className="px-3 py-1.5 text-ink-400">Window</span>
            <span className="px-3 py-1.5 text-ink-400">Entire Screen</span>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-lg border-2 border-accent bg-ink-950 p-3 text-white ring-2 ring-accent/30">
              <div className="text-[10px] uppercase tracking-wider text-white/50">meet.google.com</div>
              <div className="mt-1 truncate text-sm font-medium">{meetTitle}</div>
              <div className="mt-3 h-12 rounded bg-gradient-to-br from-sky-700 to-amber-700 opacity-80" />
            </div>
            <div className="rounded-lg border border-dashed border-ink-200 bg-ink-50 p-3 text-ink-400">
              <div className="text-[10px] uppercase tracking-wider">localhost:3000</div>
              <div className="mt-1 truncate text-sm">Brief</div>
              <div className="mt-3 h-12 rounded bg-ink-100" />
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm text-ink-800">
            <span className="flex h-4 w-4 items-center justify-center rounded border border-accent bg-accent text-[10px] text-white">
              ✓
            </span>
            Also share tab audio
          </label>
          <div className="flex justify-end">
            <span className="rounded-lg bg-accent px-4 py-1.5 text-sm font-medium text-white">Share</span>
          </div>
        </div>
      ) : (
        <div className="flex items-center justify-between gap-3 p-4">
          <p className="text-sm text-ink-700">Allow Brief to use your microphone for Me: labels?</p>
          <span className="rounded-lg bg-accent px-4 py-1.5 text-sm font-medium text-white">Allow</span>
        </div>
      )}
    </div>
  );
}

/** Live tab + mic capture meters — mirrors real Brief capture sources. */
export function CaptureSourcesHud({
  active,
  transcribing,
  note,
}: {
  active: CaptureSource;
  transcribing?: boolean;
  note?: string | null;
}) {
  return (
    <div className="mb-5 space-y-2">
      <div className="grid gap-2 sm:grid-cols-2">
        <SourceCard
          title="Chrome tab audio"
          label="Them"
          hint="Meet tab · others on the call"
          active={active === "tab"}
          transcribing={transcribing && active === "tab"}
        />
        <SourceCard
          title="Microphone"
          label="Me"
          hint="Your mic · this browser"
          active={active === "mic"}
          transcribing={transcribing && active === "mic"}
        />
      </div>
      {note ? (
        <p className="font-mono text-[11px] text-ink-500">
          {note}
          {transcribing ? " · transcribing…" : ""}
        </p>
      ) : null}
    </div>
  );
}

function SourceCard({
  title,
  label,
  hint,
  active,
  transcribing,
}: {
  title: string;
  label: string;
  hint: string;
  active: boolean;
  transcribing?: boolean;
}) {
  return (
    <div
      className={cn(
        "rounded-xl border px-3 py-3 transition",
        active ? "border-accent/40 bg-accent/5" : "border-ink-100 bg-ink-50/60",
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <div>
          <div className="text-sm font-medium text-ink-900">{title}</div>
          <div className="text-[11px] text-ink-500">{hint}</div>
        </div>
        <span
          className={cn(
            "rounded-full px-2 py-0.5 font-mono text-[10px]",
            active ? "bg-red-500/90 text-white" : "bg-ink-200 text-ink-500",
          )}
        >
          {active ? "REC" : "idle"}
        </span>
      </div>
      <div className="mt-3 flex items-end gap-0.5">
        {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
          <span
            key={i}
            className={cn("w-1.5 rounded-full", active ? "bg-accent" : "bg-ink-200")}
            style={{
              height: active ? `${8 + ((i * 7 + (transcribing ? 4 : 0)) % 18)}px` : "6px",
              animation: active ? `pulse 0.55s ease-in-out ${i * 0.06}s infinite alternate` : undefined,
            }}
          />
        ))}
        <span className="ml-2 text-[11px] font-medium text-ink-600">{label}:</span>
      </div>
    </div>
  );
}
