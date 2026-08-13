import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Command } from "cmdk";
import { Kbd } from "@/components/ui";

interface PaletteCommand {
  id: string;
  label: string;
  hint?: string;
  group: string;
  run: () => void;
}

export function CommandPalette({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (!open) setQuery("");
  }, [open]);

  const commands = useMemo<PaletteCommand[]>(
    () => [
      { id: "dashboard", label: "Go to Dashboard", group: "Navigate", run: () => navigate("/") },
      { id: "calliq", label: "Open CallIQ", hint: "Sales call intelligence", group: "Navigate", run: () => navigate("/calliq") },
      { id: "scrib", label: "Open Scrib", hint: "Voice dictation", group: "Navigate", run: () => navigate("/scrib") },
      { id: "brief", label: "Open Brief", hint: "Meeting brain", group: "Navigate", run: () => navigate("/brief") },
      { id: "simulator", label: "Open Simulator", hint: "Voice agent stress test", group: "Navigate", run: () => navigate("/simulator") },
      { id: "playground", label: "Open Playground", group: "Navigate", run: () => navigate("/playground") },
      { id: "runs", label: "Open last runs", group: "Navigate", run: () => navigate("/runs") },
      { id: "providers", label: "Change provider", group: "Navigate", run: () => navigate("/providers") },
      {
        id: "demo",
        label: "Try CallIQ demo",
        hint: "Simulated Meet",
        group: "Actions",
        run: () => navigate("/calliq?demo=1"),
      },
      {
        id: "docs",
        label: "Open API health",
        group: "Developer",
        run: () => window.open("/health", "_blank"),
      },
    ],
    [navigate],
  );

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-ink-950/35 px-4 pt-[12vh] backdrop-blur-sm" onClick={() => onOpenChange(false)}>
      <Command
        className="w-full max-w-xl overflow-hidden rounded-xl border border-ink-200 bg-white shadow-soft animate-fade-up"
        onClick={(e) => e.stopPropagation()}
        label="Command palette"
      >
        <div className="flex items-center gap-2 border-b border-ink-100 px-3">
          <Command.Input
            value={query}
            onValueChange={setQuery}
            placeholder="Search commands…"
            className="h-12 w-full bg-transparent text-sm outline-none placeholder:text-ink-400"
            autoFocus
          />
          <Kbd>esc</Kbd>
        </div>
        <Command.List className="max-h-80 overflow-auto p-2">
          <Command.Empty className="px-3 py-6 text-center text-sm text-ink-400">No matching commands.</Command.Empty>
          {["Navigate", "Actions", "Developer"].map((group) => (
            <Command.Group key={group} heading={group} className="mb-2 [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:text-ink-400">
              {commands
                .filter((c) => c.group === group)
                .map((c) => (
                  <Command.Item
                    key={c.id}
                    value={`${c.label} ${c.hint ?? ""}`}
                    onSelect={() => {
                      onOpenChange(false);
                      c.run();
                    }}
                    className="flex cursor-pointer items-center justify-between rounded-lg px-3 py-2 text-sm text-ink-800 aria-selected:bg-accent-soft aria-selected:text-accent-strong"
                  >
                    <span>{c.label}</span>
                    {c.hint ? <span className="text-xs text-ink-400">{c.hint}</span> : null}
                  </Command.Item>
                ))}
            </Command.Group>
          ))}
        </Command.List>
      </Command>
    </div>
  );
}
