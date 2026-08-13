import { NavLink, Outlet } from "react-router-dom";
import { useEffect, useState } from "react";
import {
  Activity,
  AudioLines,
  Brain,
  LayoutDashboard,
  Mic2,
  Server,
  Sparkles,
  Bot,
} from "lucide-react";
import { CommandPalette } from "@/components/CommandPalette";
import { Kbd } from "@/components/ui";
import { cn } from "@/lib/cn";

const NAV = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard, end: true },
  { to: "/calliq", label: "CallIQ", icon: AudioLines },
  { to: "/scrib", label: "Scrib", icon: Mic2 },
  { to: "/brief", label: "Brief", icon: Brain },
  { to: "/simulator", label: "Simulator", icon: Bot },
  { to: "/playground", label: "Playground", icon: Sparkles },
  { to: "/runs", label: "Runs", icon: Activity },
  { to: "/providers", label: "Providers", icon: Server },
];

export function Shell() {
  const [paletteOpen, setPaletteOpen] = useState(false);
  const embedded = typeof window !== "undefined" && window.parent !== window;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div
      className={cn(
        "mx-auto flex min-h-screen max-w-7xl gap-6 px-4 py-5 md:px-6",
        embedded && "max-w-none gap-0 px-2 py-2",
      )}
    >
      {embedded ? null : (
      <aside className="hidden w-56 shrink-0 flex-col md:flex">
        <div className="mb-8 px-2">
          <div className="flex items-center gap-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-ink-900 text-white">
              <Mic2 className="h-4 w-4" />
            </div>
            <div>
              <div className="text-sm font-semibold tracking-tight">PyAI Suite</div>
              <div className="text-[11px] text-ink-400">Runs on PyAI</div>
            </div>
          </div>
        </div>
        <nav className="flex flex-1 flex-col gap-1">
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                cn(
                  "flex items-center gap-2 rounded-lg px-3 py-2 text-sm transition",
                  isActive ? "bg-ink-900 text-white" : "text-ink-600 hover:bg-white/80 hover:text-ink-900",
                )
              }
            >
              <item.icon className="h-4 w-4" />
              {item.label}
            </NavLink>
          ))}
        </nav>
        <button
          type="button"
          onClick={() => setPaletteOpen(true)}
          className="mt-4 flex items-center justify-between rounded-lg border border-ink-200 bg-white/80 px-3 py-2 text-xs text-ink-500 hover:text-ink-800"
        >
          <span>Command palette</span>
          <span className="flex items-center gap-1">
            <Kbd>⌘</Kbd>
            <Kbd>K</Kbd>
          </span>
        </button>
      </aside>
      )}

      <main className={cn("min-w-0 flex-1 pb-10", embedded && "pb-2")}>
        {embedded ? null : (
        <div className="mb-4 flex items-center justify-between md:hidden">
          <div className="text-sm font-semibold">PyAI Suite</div>
          <button type="button" className="text-xs text-ink-500" onClick={() => setPaletteOpen(true)}>
            ⌘K
          </button>
        </div>
        )}
        <Outlet />
      </main>

      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
    </div>
  );
}
