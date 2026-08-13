import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Command } from "cmdk";
import { Kbd } from "@/components/ui";
import { useTheme } from "@/lib/theme";
import { loadCalls } from "@/lib/calliqStore";

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
  const { setTheme, resolved } = useTheme();

  useEffect(() => {
    if (!open) setQuery("");
  }, [open]);

  const commands = useMemo<PaletteCommand[]>(() => {
    const calls = loadCalls().slice(0, 8);
    return [
      { id: "dashboard", label: "Go to Home", group: "Navigate", run: () => navigate("/") },
      { id: "calliq", label: "Open CallIQ", hint: "Conversation workspace", group: "Navigate", run: () => navigate("/calliq") },
      { id: "scrib", label: "Open Scrib", hint: "Voice dictation", group: "Navigate", run: () => navigate("/scrib") },
      { id: "brief", label: "Open Brief", hint: "Meeting brain", group: "Navigate", run: () => navigate("/brief") },
      { id: "simulator", label: "Open Simulator", hint: "Live call, persona, agents", group: "Navigate", run: () => navigate("/simulator") },
      { id: "playground", label: "Open model arena", hint: "Compare providers", group: "Navigate", run: () => navigate("/playground") },
      { id: "runs", label: "Open last runs", group: "Navigate", run: () => navigate("/runs") },
      { id: "providers", label: "Manage providers", group: "Navigate", run: () => navigate("/providers") },
      {
        id: "demo",
        label: "Play sample sales call",
        hint: "Audio in CallIQ — not a live Meet",
        group: "Actions",
        run: () => navigate("/calliq?demo=1"),
      },
      {
        id: "join",
        label: "Join Meet as bot",
        group: "Actions",
        run: () => navigate("/calliq"),
      },
      {
        id: "theme",
        label: resolved === "dark" ? "Switch to light mode" : "Switch to dark mode",
        group: "Actions",
        run: () => setTheme(resolved === "dark" ? "light" : "dark"),
      },
      ...calls.map((c) => ({
        id: `call-${c.id}`,
        label: c.title,
        hint: c.status,
        group: "Conversations",
        run: () => {
          localStorage.setItem("calliq.selected.v1", c.id);
          navigate("/calliq");
        },
      })),
      {
        id: "docs",
        label: "Open API health",
        group: "Developer",
        run: () => window.open("/api/health", "_blank"),
      },
    ];
  }, [navigate, resolved, setTheme, open]);

  if (!open) return null;

  const groups = ["Navigate", "Actions", "Conversations", "Developer"];

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-overlay px-4 pt-[12vh] backdrop-blur-sm"
      onClick={() => onOpenChange(false)}
    >
      <Command
        className="raise w-full max-w-xl overflow-hidden rounded-lg animate-scale-in"
        onClick={(e) => e.stopPropagation()}
        label="Command palette"
      >
        <div className="flex items-center gap-2 border-b border-ink-100 px-3">
          <Command.Input
            value={query}
            onValueChange={setQuery}
            placeholder="Search conversations, arena, lab…"
            className="h-12 w-full bg-transparent text-sm outline-none placeholder:text-ink-400"
            autoFocus
          />
          <Kbd>esc</Kbd>
        </div>
        <Command.List className="max-h-80 overflow-auto p-2">
          <Command.Empty className="px-3 py-6 text-center text-sm text-ink-400">No matching commands.</Command.Empty>
          {groups.map((group) => {
            const items = commands.filter((c) => c.group === group);
            if (!items.length) return null;
            return (
              <Command.Group
                key={group}
                heading={group}
                className="mb-2 [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:text-ink-400"
              >
                {items.map((c) => (
                  <Command.Item
                    key={c.id}
                    value={`${c.label} ${c.hint ?? ""}`}
                    onSelect={() => {
                      onOpenChange(false);
                      c.run();
                    }}
                    className="flex cursor-pointer items-center justify-between rounded-lg px-3 py-2 text-sm text-ink-800 aria-selected:bg-accent-soft aria-selected:text-accent-strong"
                  >
                    <span className="truncate">{c.label}</span>
                    {c.hint ? <span className="ml-2 shrink-0 text-xs text-ink-400">{c.hint}</span> : null}
                  </Command.Item>
                ))}
              </Command.Group>
            );
          })}
        </Command.List>
      </Command>
    </div>
  );
}
