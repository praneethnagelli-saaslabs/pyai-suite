import { cn } from "@/lib/cn";

export type MeetPhase = "idle" | "joining" | "in_call" | "ended";
export type MeetSpeakerId = "rep" | "customer" | "bot";

export type MeetParticipant = {
  id: string;
  name: string;
  role: string;
  initials: string;
  accent: string;
};

const CALLIQ_PARTICIPANTS: MeetParticipant[] = [
  { id: "rep", name: "Alex (Rep)", role: "Seller", initials: "AR", accent: "from-sky-600 to-sky-800" },
  { id: "customer", name: "Dana", role: "Buyer", initials: "DA", accent: "from-amber-600 to-amber-800" },
  { id: "bot", name: "CallIQ Bot", role: "Notetaker", initials: "CQ", accent: "from-emerald-600 to-emerald-800" },
];

/** Visual Google-Meet-style stage for product demos (CallIQ bot join or Brief tab capture). */
export function SimulatedMeetStage({
  phase,
  present,
  waitingRoom,
  activeSpeaker,
  caption,
  statusLine,
  muted,
  participants = CALLIQ_PARTICIPANTS,
  title = "Enterprise plan review",
  meetUrl = "meet.google.com/demo-calliq",
}: {
  phase: MeetPhase;
  /** Who is currently in the call tiles */
  present: string[];
  /** Who is knocking in the waiting room (usually the bot) */
  waitingRoom?: string[];
  activeSpeaker: string | null;
  caption?: string;
  statusLine?: string;
  muted?: boolean;
  participants?: MeetParticipant[];
  title?: string;
  meetUrl?: string;
}) {
  if (phase === "idle") return null;

  const presentSet = new Set(present);
  const waitingSet = new Set(waitingRoom ?? []);

  return (
    <div className="panel overflow-hidden border-ink-200 bg-ink-950 text-white shadow-lg animate-fade-up">
      <div className="flex items-center justify-between border-b border-white/10 px-4 py-2.5">
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold tracking-tight">{title}</div>
          <div className="font-mono text-[10px] text-white/50">
            {meetUrl} ·{" "}
            {phase === "joining"
              ? "lobby"
              : phase === "ended"
                ? "call ended"
                : `${present.length} in call`}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {muted ? (
            <span className="rounded-full bg-white/10 px-2 py-0.5 font-mono text-[10px] text-white/70">muted</span>
          ) : phase !== "joining" || present.length > 0 ? (
            <span className="flex items-center gap-1 rounded-full bg-emerald-500/20 px-2 py-0.5 font-mono text-[10px] text-emerald-300">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />
              audio
            </span>
          ) : null}
          <span
            className={cn(
              "rounded-full px-2 py-0.5 font-mono text-[10px]",
              phase === "ended"
                ? "bg-white/10 text-white/60"
                : phase === "joining" && present.length === 0
                  ? "bg-white/10 text-white/50"
                  : "bg-red-500/90 text-white",
            )}
          >
            {phase === "ended" ? "ENDED" : present.length === 0 ? "WAITING" : "REC"}
          </span>
        </div>
      </div>

      <div className={cn("grid gap-2 p-3", participants.length > 2 ? "sm:grid-cols-3" : "sm:grid-cols-2")}>
        {participants.map((p) => {
          const joined = presentSet.has(p.id);
          const knocking = waitingSet.has(p.id);
          const speaking = joined && activeSpeaker === p.id && phase === "in_call";

          if (!joined && !knocking) {
            return (
              <div
                key={p.id}
                className="relative flex min-h-[120px] flex-col items-center justify-center overflow-hidden rounded-xl border border-dashed border-white/15 bg-white/5 p-3 text-white/35"
              >
                <div className="flex h-14 w-14 items-center justify-center rounded-full border border-dashed border-white/20 text-lg">
                  ?
                </div>
                <div className="mt-2 text-sm">Empty seat</div>
                <div className="text-[10px] uppercase tracking-wider">Waiting…</div>
              </div>
            );
          }

          if (knocking && !joined) {
            return (
              <div
                key={p.id}
                className={cn(
                  "relative flex min-h-[120px] flex-col items-center justify-center overflow-hidden rounded-xl border border-amber-400/40 bg-amber-500/10 p-3 animate-fade-up",
                )}
              >
                <div className="absolute right-2 top-2 rounded-full bg-amber-400 px-2 py-0.5 font-mono text-[9px] font-semibold text-ink-950">
                  WAITING ROOM
                </div>
                <div
                  className={cn(
                    "flex h-14 w-14 items-center justify-center rounded-full bg-gradient-to-br text-lg font-semibold tracking-wide",
                    p.accent,
                  )}
                >
                  {p.initials}
                </div>
                <div className="mt-2 text-sm font-medium">{p.name}</div>
                <div className="text-[10px] uppercase tracking-wider text-amber-200/80">Knocking…</div>
              </div>
            );
          }

          return (
            <div
              key={p.id}
              className={cn(
                "relative flex min-h-[120px] flex-col items-center justify-center overflow-hidden rounded-xl bg-gradient-to-br p-3 transition duration-300 animate-fade-up",
                p.accent,
                speaking && "ring-2 ring-white ring-offset-2 ring-offset-ink-950 scale-[1.02]",
                phase === "ended" && "opacity-55 grayscale",
              )}
            >
              <div className="absolute left-2 top-2 rounded-full bg-black/30 px-1.5 py-0.5 font-mono text-[9px] text-white/80">
                joined
              </div>
              <div
                className={cn(
                  "flex h-14 w-14 items-center justify-center rounded-full bg-black/25 text-lg font-semibold tracking-wide",
                  speaking && "animate-pulse",
                )}
              >
                {p.initials}
              </div>
              <div className="mt-2 text-sm font-medium">{p.name}</div>
              <div className="text-[10px] uppercase tracking-wider text-white/60">{p.role}</div>
              {speaking ? (
                <div className="absolute bottom-2 left-2 right-2 flex justify-center gap-0.5">
                  {[0, 1, 2, 3, 4].map((i) => (
                    <span
                      key={i}
                      className="w-1 rounded-full bg-white/90"
                      style={{
                        height: `${6 + ((i * 5) % 14)}px`,
                        animation: `pulse 0.6s ease-in-out ${i * 0.08}s infinite alternate`,
                      }}
                    />
                  ))}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>

      {caption ? (
        <div className="border-t border-white/10 bg-black/35 px-4 py-2.5">
          <div className="text-[10px] uppercase tracking-wider text-white/45">Live captions</div>
          <div className="mt-0.5 text-sm text-white/90">{caption}</div>
        </div>
      ) : (
        <div className="border-t border-white/10 px-4 py-3 text-center text-xs text-white/55">
          {statusLine ??
            (phase === "joining"
              ? "People are joining the simulated Meet…"
              : phase === "ended"
                ? "Call ended"
                : "In call")}
        </div>
      )}
    </div>
  );
}

export const CALLIQ_DEMO_LINES: Array<{
  speaker: MeetSpeakerId;
  label: string;
  text: string;
  line: string;
}> = [
  {
    speaker: "rep",
    label: "Rep",
    text: "Thanks for hopping on, Dana. I wanted to walk you through the enterprise plan.",
    line: "Rep: Thanks for hopping on, Dana. I wanted to walk you through the enterprise plan.",
  },
  {
    speaker: "customer",
    label: "Customer",
    text: "Honestly the main thing holding us back is the implementation cost. We got burned last year.",
    line: "Customer: Honestly the main thing holding us back is the implementation cost. We got burned last year.",
  },
  {
    speaker: "rep",
    label: "Rep",
    text: "We do white-glove onboarding in under four weeks, and a dedicated engineer for the first 90 days.",
    line: "Rep: We do white-glove onboarding in under four weeks, and a dedicated engineer for the first 90 days.",
  },
  {
    speaker: "customer",
    label: "Customer",
    text: "That helps. But we also need to know if your security review passes our procurement.",
    line: "Customer: That helps. But we also need to know if your security review passes our procurement.",
  },
  {
    speaker: "rep",
    label: "Rep",
    text: "We are SOC 2 Type II and have EU data residency. I can loop in our solutions architect next week.",
    line: "Rep: We are SOC 2 Type II and have EU data residency. I can loop in our solutions architect next week.",
  },
  {
    speaker: "customer",
    label: "Customer",
    text: "If you send the security pack and a timeline, we can get a decision maker in by end of month.",
    line: "Customer: If you send the security pack and a timeline, we can get a decision maker in by end of month.",
  },
];

export type BriefSpeakerId = "me" | "them";

export const BRIEF_PARTICIPANTS: MeetParticipant[] = [
  { id: "me", name: "You", role: "Me · mic", initials: "ME", accent: "from-sky-600 to-sky-800" },
  { id: "them", name: "Jordan", role: "Them · Meet tab", initials: "JO", accent: "from-amber-600 to-amber-800" },
];

/** Same Me/Them script as live Brief capture labels. */
export const BRIEF_DEMO_LINES: Array<{
  speaker: BriefSpeakerId;
  label: string;
  text: string;
  line: string;
}> = [
  {
    speaker: "me",
    label: "Me",
    text: "Thanks for joining. Goal today is the July launch plan.",
    line: "Me: Thanks for joining. Goal today is the July launch plan.",
  },
  {
    speaker: "them",
    label: "Them",
    text: "Security review is still open. I think we should move launch to August.",
    line: "Them: Security review is still open. I think we should move launch to August.",
  },
  {
    speaker: "me",
    label: "Me",
    text: "Agreed — decision: launch moves to August.",
    line: "Me: Agreed — decision: launch moves to August.",
  },
  {
    speaker: "them",
    label: "Them",
    text: "I'll own the security pack by Friday. Any questions on pricing?",
    line: "Them: I'll own the security pack by Friday. Any questions on pricing?",
  },
  {
    speaker: "me",
    label: "Me",
    text: "Can we keep EU data residency in scope?",
    line: "Me: Can we keep EU data residency in scope?",
  },
];
