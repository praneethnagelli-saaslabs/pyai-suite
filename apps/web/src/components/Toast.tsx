import { createContext, useCallback, useContext, useMemo, useState, type PropsWithChildren } from "react";

type Toast = { id: number; message: string };

const ToastContext = createContext<{ push: (message: string) => void } | null>(null);

export function ToastProvider({ children }: PropsWithChildren) {
  const [items, setItems] = useState<Toast[]>([]);

  const push = useCallback((message: string) => {
    const id = Date.now() + Math.random();
    setItems((prev) => [...prev.slice(-3), { id, message }]);
    window.setTimeout(() => {
      setItems((prev) => prev.filter((t) => t.id !== id));
    }, 2400);
  }, []);

  const value = useMemo(() => ({ push }), [push]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed bottom-4 right-4 z-[60] flex flex-col gap-2">
        {items.map((t) => (
          <div
            key={t.id}
            className="pointer-events-auto rounded-lg border border-ink-200 bg-elevated px-3 py-2 text-sm text-ink-800 shadow-soft animate-scale-in"
          >
            {t.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within ToastProvider");
  return ctx;
}
