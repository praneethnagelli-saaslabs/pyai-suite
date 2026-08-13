import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { Button, AiWorking } from "@/components/ui";

const ACTIONS = [
  { id: "explain", label: "Explain", prompt: "Explain what this means in a sales conversation, in 2 sentences:\n\n" },
  { id: "objection", label: "Identify objection", prompt: "Is this an objection? If yes, name the type and why, in 2 sentences:\n\n" },
  { id: "summarize", label: "Summarize", prompt: "Summarize this excerpt in one sentence:\n\n" },
  { id: "reply", label: "Suggest response", prompt: "Suggest a concise, professional reply the seller could say next:\n\n" },
] as const;

export function AskAiMenu({
  text,
  provider,
  onClose,
  anchor,
}: {
  text: string;
  provider: string;
  onClose: () => void;
  anchor: { x: number; y: number };
}) {
  const [busy, setBusy] = useState(false);
  const [out, setOut] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [onClose]);

  async function run(prompt: string) {
    setBusy(true);
    setErr(null);
    setOut(null);
    try {
      const res = await api.playgroundRun({
        capability: "llm",
        provider,
        input: `${prompt}${text}`,
      });
      setOut(res.result?.text ?? res.output);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      ref={box}
      className="raise fixed z-40 w-72 rounded-lg p-2 animate-scale-in"
      style={{ left: Math.min(anchor.x, window.innerWidth - 300), top: Math.min(anchor.y, window.innerHeight - 280) }}
      role="dialog"
      aria-label="Ask AI about selection"
    >
      <div className="px-2 py-1 text-[11px] font-medium uppercase tracking-wide text-ink-400">Ask AI</div>
      <p className="mb-2 line-clamp-3 px-2 text-xs text-ink-500">“{text.slice(0, 160)}”</p>
      <div className="grid grid-cols-2 gap-1">
        {ACTIONS.map((a) => (
          <button
            key={a.id}
            type="button"
            disabled={busy}
            onClick={() => void run(a.prompt)}
            className="rounded-lg px-2 py-1.5 text-left text-xs text-ink-700 hover:bg-accent-soft hover:text-accent-strong disabled:opacity-50"
          >
            {a.label}
          </button>
        ))}
      </div>
      {busy ? (
        <div className="px-2 py-2">
          <AiWorking label="Reading selection" />
        </div>
      ) : null}
      {err ? <p className="px-2 py-1 text-xs text-status-block">{err}</p> : null}
      {out ? <p className="mt-1 max-h-36 overflow-auto px-2 py-1 text-xs leading-relaxed text-ink-700">{out}</p> : null}
      <div className="mt-1 flex justify-end">
        <Button size="sm" variant="ghost" onClick={onClose}>
          Close
        </Button>
      </div>
    </div>
  );
}
