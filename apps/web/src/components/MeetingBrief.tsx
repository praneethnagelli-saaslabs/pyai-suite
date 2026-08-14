import type { ReactNode } from "react";
import type { MeetingNotes } from "@/lib/api";

function Section({
  title,
  children,
  empty,
}: {
  title: string;
  children: ReactNode;
  empty?: boolean;
}) {
  if (empty) return null;
  return (
    <div>
      <h3 className="text-[11px] font-semibold uppercase tracking-wide text-ink-400">{title}</h3>
      <div className="mt-2">{children}</div>
    </div>
  );
}

/** Meeting brief — one document, not a dump of transcript lines. */
export function MeetingBrief({
  notes,
  status,
  runId,
  recordingUrl,
}: {
  notes: MeetingNotes;
  status?: string;
  runId?: string;
  recordingUrl?: string | null;
}) {
  return (
    <article className="panel space-y-5 p-5 animate-fade-up">
      <header>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <h2 className="text-xl font-semibold tracking-tight text-ink-950">{notes.title}</h2>
          {notes.mode ? (
            <span className="rounded-full bg-ink-100 px-2 py-0.5 text-[11px] font-medium text-ink-600">
              {notes.mode}
            </span>
          ) : null}
        </div>
        {status || runId ? (
          <p className="mt-1 font-mono text-[10px] text-ink-400">
            {status}
            {status && runId ? " · " : ""}
            {runId}
          </p>
        ) : null}
      </header>

      {recordingUrl ? (
        <div className="rounded-lg border border-ink-100 bg-ink-50/80 px-3 py-2">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-ink-400">Recording</div>
          <audio className="mt-1.5 w-full" controls preload="metadata" src={recordingUrl}>
            <track kind="captions" />
          </audio>
        </div>
      ) : null}

      {notes.summary ? (
        <p className="text-sm leading-relaxed text-ink-700">{notes.summary}</p>
      ) : null}

      <Section title="Decisions" empty={!notes.decisions?.length}>
        <ul className="space-y-2">
          {notes.decisions.map((d, i) => (
            <li key={i} className="rounded-lg border border-ink-100 bg-ink-50/80 px-3 py-2.5">
              <div className="text-sm font-medium text-ink-900">{d.decision}</div>
              {d.evidence?.excerpt ? (
                <p className="mt-1 text-[11px] leading-snug text-ink-400">“{d.evidence.excerpt}”</p>
              ) : null}
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Action items" empty={!notes.actionItems?.length}>
        <ul className="divide-y divide-ink-100 rounded-lg border border-ink-100">
          {notes.actionItems.map((a, i) => (
            <li key={i} className="flex items-start justify-between gap-3 px-3 py-2.5">
              <div>
                <div className="text-sm text-ink-900">{a.task}</div>
                <div className="mt-0.5 text-[11px] text-ink-500">
                  {a.owner}
                  {a.deadline ? ` · due ${a.deadline}` : ""}
                </div>
              </div>
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Open questions" empty={!notes.questions?.length}>
        <ul className="space-y-1.5 text-sm text-ink-800">
          {(notes.questions ?? []).map((q, i) => (
            <li key={i}>? {q.question}</li>
          ))}
        </ul>
      </Section>

      <Section title="Key moments" empty={!notes.importantMoments?.length}>
        <ul className="space-y-1.5 text-sm text-ink-700">
          {(notes.importantMoments ?? []).map((m, i) => (
            <li key={i} className="flex gap-2">
              <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
              <span>{m.moment}</span>
            </li>
          ))}
        </ul>
      </Section>
    </article>
  );
}
