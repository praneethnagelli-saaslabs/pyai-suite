import { Kbd } from "@/components/ui";

const ROWS = [
  { keys: ["⌘", "K"], action: "Command palette" },
  { keys: ["?"], action: "Keyboard shortcuts" },
  { keys: ["Esc"], action: "Close overlay" },
  { keys: ["⌘", "Enter"], action: "Run (playground)" },
  { keys: ["Space"], action: "Play / pause audio when focused" },
];

export function ShortcutsHelp({ open, onClose }: { open: boolean; onClose: () => void }) {
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-overlay px-4 pt-[16vh] backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-xl border border-ink-200 bg-elevated p-5 shadow-soft animate-scale-in"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-labelledby="shortcuts-title"
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 id="shortcuts-title" className="text-sm font-semibold text-ink-900">
            Keyboard shortcuts
          </h2>
          <Kbd>esc</Kbd>
        </div>
        <ul className="space-y-2">
          {ROWS.map((row) => (
            <li key={row.action} className="flex items-center justify-between gap-3 text-sm">
              <span className="text-ink-600">{row.action}</span>
              <span className="flex items-center gap-1">
                {row.keys.map((k) => (
                  <Kbd key={k}>{k}</Kbd>
                ))}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
