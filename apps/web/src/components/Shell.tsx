import { NavLink, Outlet } from "react-router-dom";
import { useEffect, useState, type ReactNode } from "react";
import {
  Activity,
  AudioLines,
  Brain,
  LayoutDashboard,
  Mic2,
  Moon,
  PanelLeft,
  Server,
  Sparkles,
  Sun,
  Bot,
} from "lucide-react";
import { CommandPalette } from "@/components/CommandPalette";
import { ShortcutsHelp } from "@/components/ShortcutsHelp";
import { Kbd } from "@/components/ui";
import { cn } from "@/lib/cn";
import { useTheme } from "@/lib/theme";

const PRODUCT_NAV = [
  { to: "/calliq", label: "CallIQ", hint: "Call intelligence", icon: AudioLines },
  { to: "/scrib", label: "Scrib", hint: "Dictation", icon: Mic2 },
  { to: "/brief", label: "Brief", hint: "Meeting notes", icon: Brain },
  { to: "/simulator", label: "Simulator", hint: "Live call + persona tests", icon: Bot },
];

const PLATFORM_NAV = [
  { to: "/", label: "Home", icon: LayoutDashboard, end: true },
  { to: "/playground", label: "Playground", icon: Sparkles },
  { to: "/runs", label: "Runs", icon: Activity },
  { to: "/providers", label: "Providers", icon: Server },
];

export function Shell() {
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [mobileNav, setMobileNav] = useState(false);
  const { resolved, setTheme } = useTheme();
  const embedded = typeof window !== "undefined" && window.parent !== window;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const typing =
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable);
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((v) => !v);
        return;
      }
      if (e.key === "?" && !typing && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        setShortcutsOpen((v) => !v);
        return;
      }
      if (e.key === "Escape") {
        setPaletteOpen(false);
        setShortcutsOpen(false);
        setMobileNav(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className={cn("flex min-h-screen bg-canvas", embedded && "min-h-0")}>
      {embedded ? null : (
        <aside
          className={cn(
            "sticky top-0 hidden h-screen shrink-0 flex-col border-r border-[var(--hairline)] bg-canvas md:flex",
            collapsed ? "w-[68px]" : "w-56",
          )}
        >
          <div className={cn("flex items-center gap-2 px-3 py-5", collapsed && "justify-center px-2")}>
            <div className="flex h-8 w-8 items-center justify-center rounded-md bg-ink-900 text-white dark:bg-accent dark:text-accent-ink">
              <Mic2 className="h-4 w-4" />
            </div>
            {collapsed ? null : (
              <div className="min-w-0">
                <div className="text-sm font-semibold tracking-tight text-ink-950">PyAI Suite</div>
                <div className="text-[11px] text-ink-400">Voice intelligence</div>
              </div>
            )}
          </div>

          <nav className="flex flex-1 flex-col gap-4 overflow-y-auto px-2 pb-3">
            <NavGroup label="Platform" collapsed={collapsed}>
              {PLATFORM_NAV.map((item) => (
                <NavItem key={item.to} {...item} collapsed={collapsed} />
              ))}
            </NavGroup>
            <NavGroup label="Products" collapsed={collapsed}>
              {PRODUCT_NAV.map((item) => (
                <NavItem key={item.to} {...item} collapsed={collapsed} />
              ))}
            </NavGroup>
          </nav>

          <div className="space-y-2 border-t border-[var(--hairline)] p-2">
            <button
              type="button"
              onClick={() => setPaletteOpen(true)}
              className={cn(
                "flex w-full items-center rounded px-2.5 py-2 text-xs text-ink-500 hover:bg-interactive hover:text-ink-800",
                collapsed ? "justify-center" : "justify-between",
              )}
              title="Command palette"
            >
              {collapsed ? (
                <Kbd>⌘K</Kbd>
              ) : (
                <>
                  <span>Search</span>
                  <span className="flex items-center gap-1">
                    <Kbd>⌘</Kbd>
                    <Kbd>K</Kbd>
                  </span>
                </>
              )}
            </button>
            <div className={cn("flex gap-1", collapsed && "flex-col")}>
              <button
                type="button"
                onClick={() => setTheme(resolved === "dark" ? "light" : "dark")}
                className="flex flex-1 items-center justify-center rounded px-2 py-2 text-ink-500 hover:bg-interactive hover:text-ink-900"
                title={resolved === "dark" ? "Light mode" : "Dark mode"}
              >
                {resolved === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
              </button>
              <button
                type="button"
                onClick={() => setCollapsed((v) => !v)}
                className="flex flex-1 items-center justify-center rounded px-2 py-2 text-ink-500 hover:bg-interactive hover:text-ink-900"
                title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
              >
                <PanelLeft className="h-4 w-4" />
              </button>
            </div>
          </div>
        </aside>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        {embedded ? null : (
          <header className="flex items-center justify-between gap-3 border-b border-ink-200 bg-surface px-4 py-3 md:hidden">
            <button type="button" className="text-sm font-semibold" onClick={() => setMobileNav((v) => !v)}>
              PyAI Suite
            </button>
            <div className="flex items-center gap-2">
              <button type="button" className="text-xs text-ink-500" onClick={() => setPaletteOpen(true)}>
                ⌘K
              </button>
              <button
                type="button"
                onClick={() => setTheme(resolved === "dark" ? "light" : "dark")}
                className="text-ink-500"
              >
                {resolved === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
              </button>
            </div>
          </header>
        )}
        {mobileNav && !embedded ? (
          <nav className="border-b border-ink-200 bg-surface px-3 py-2 md:hidden">
            {[...PLATFORM_NAV, ...PRODUCT_NAV].map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={"end" in item ? item.end : undefined}
                onClick={() => setMobileNav(false)}
                className={({ isActive }) =>
                  cn(
                    "block rounded-lg px-3 py-2 text-sm",
                    isActive ? "text-accent" : "text-ink-600",
                  )
                }
              >
                {item.label}
              </NavLink>
            ))}
          </nav>
        ) : null}

        <main className={cn("mx-auto w-full max-w-6xl flex-1 px-5 py-6 md:px-10 md:py-9", embedded && "max-w-none px-2 py-2")}>
          <Outlet />
        </main>
      </div>

      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
      <ShortcutsHelp open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
    </div>
  );
}

function NavGroup({
  label,
  collapsed,
  children,
}: {
  label: string;
  collapsed: boolean;
  children: ReactNode;
}) {
  return (
    <div>
      {collapsed ? null : (
        <div className="mb-1 px-2 text-[10px] font-semibold uppercase tracking-wider text-ink-400">{label}</div>
      )}
      <div className="flex flex-col gap-0.5">{children}</div>
    </div>
  );
}

function NavItem({
  to,
  label,
  hint,
  icon: Icon,
  end,
  collapsed,
}: {
  to: string;
  label: string;
  hint?: string;
  icon: typeof Mic2;
  end?: boolean;
  collapsed: boolean;
}) {
  return (
    <NavLink
      to={to}
      end={end}
      title={collapsed ? label : hint}
      className={({ isActive }) =>
        cn(
          "relative flex items-center gap-2 rounded px-2.5 py-2 text-sm transition duration-150 ease-out",
          collapsed && "justify-center px-2",
          isActive ? "text-accent" : "text-ink-500 hover:bg-interactive hover:text-ink-900",
        )
      }
    >
      <Icon className="h-4 w-4 shrink-0" />
      {collapsed ? null : <span className="truncate">{label}</span>}
    </NavLink>
  );
}
