import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Input, Label, Select, Textarea } from "@/components/ui";
import { ErrorBanner } from "@/components/ErrorBanner";
import { api, type SimulatorAgent } from "@/lib/api";

const PERSONALITIES = ["professional", "friendly", "concise", "empathetic", "confident", "persuasive", "casual"];

export function AgentPanel({
  onStartCall,
}: {
  onStartCall: (agent: SimulatorAgent) => void;
}) {
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ["simulator-agents"], queryFn: api.simulatorAgents });
  const live = useQuery({ queryKey: ["simulator-live"], queryFn: api.simulatorLive });
  const [selectedId, setSelectedId] = useState("agt_acme");
  const [draft, setDraft] = useState<Partial<SimulatorAgent> | null>(null);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);

  const agents = list.data?.agents ?? [];
  const selected = agents.find((a) => a.id === selectedId) ?? agents[0];
  const form = draft ?? selected;

  const save = useMutation({
    mutationFn: async () => {
      if (!selected || !form) throw new Error("Pick an agent first.");
      return api.simulatorUpdateAgent(selected.id, { ...form, note });
    },
    onSuccess: (out) => {
      setError(null);
      setNote("");
      setDraft(null);
      setSelectedId(out.agent.id);
      void qc.invalidateQueries({ queryKey: ["simulator-agents"] });
    },
    onError: (e) => setError(e instanceof Error ? e.message : "Save failed"),
  });

  const create = useMutation({
    mutationFn: () => api.simulatorCreateAgent({ name: "New agent", prompt: "You are a helpful voice agent. Be brief." }),
    onSuccess: (out) => {
      setSelectedId(out.agent.id);
      setDraft(null);
      void qc.invalidateQueries({ queryKey: ["simulator-agents"] });
    },
    onError: (e) => setError(e instanceof Error ? e.message : "Create failed"),
  });

  const activate = useMutation({
    mutationFn: (version: number) => api.simulatorActivateVersion(selected!.id, version),
    onSuccess: (out) => {
      setDraft(null);
      setSelectedId(out.agent.id);
      void qc.invalidateQueries({ queryKey: ["simulator-agents"] });
    },
    onError: (e) => setError(e instanceof Error ? e.message : "Rollback failed"),
  });

  if (!form) {
    return (
      <div className="panel p-6">
        <p className="text-sm text-ink-500">Loading agents…</p>
      </div>
    );
  }

  function set<K extends keyof SimulatorAgent>(key: K, value: SimulatorAgent[K]) {
    setDraft({ ...(form as SimulatorAgent), [key]: value });
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)]">
      <section className="panel p-4">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-ink-900">Agents</h3>
          <Button size="sm" variant="secondary" onClick={() => create.mutate()} disabled={create.isPending}>
            New
          </Button>
        </div>
        <ul className="mt-3 space-y-1">
          {agents.map((a) => (
            <li key={a.id}>
              <button
                type="button"
                onClick={() => {
                  setSelectedId(a.id);
                  setDraft(null);
                }}
                className={`w-full rounded px-3 py-2 text-left text-sm ${
                  a.id === selected?.id ? "bg-interactive text-ink-950" : "text-ink-600 hover:bg-interactive"
                }`}
              >
                <div className="font-medium">{a.name}</div>
                <div className="text-[11px] text-ink-400">
                  v{a.activeVersion} · {a.role || "agent"}
                </div>
              </button>
            </li>
          ))}
        </ul>
      </section>

      <section className="panel space-y-3 p-4">
        {error ? <ErrorBanner title="Agent save failed" message={error} onRetry={() => save.mutate()} /> : null}
        <div className="grid gap-3 md:grid-cols-2">
          <div>
            <Label>Name</Label>
            <Input value={form.name ?? ""} onChange={(e) => set("name", e.target.value)} maxLength={80} />
          </div>
          <div>
            <Label>Role</Label>
            <Input value={form.role ?? ""} onChange={(e) => set("role", e.target.value)} maxLength={80} />
          </div>
          <div>
            <Label>Industry</Label>
            <Input value={form.industry ?? ""} onChange={(e) => set("industry", e.target.value)} maxLength={80} />
          </div>
          <div>
            <Label>Personality</Label>
            <Select value={form.personality ?? "professional"} onChange={(e) => set("personality", e.target.value)}>
              {PERSONALITIES.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label>Voice</Label>
            <Select value={form.voice ?? "ava"} onChange={(e) => set("voice", e.target.value)}>
              {(live.data?.voices ?? [{ id: "ava", label: "Ava" }]).map((v) => (
                <option key={v.id} value={v.id}>
                  {v.label}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label>Greeting</Label>
            <Input value={form.greeting ?? ""} onChange={(e) => set("greeting", e.target.value)} maxLength={500} />
          </div>
        </div>
        <div>
          <Label>Description</Label>
          <Input value={form.description ?? ""} onChange={(e) => set("description", e.target.value)} maxLength={240} />
        </div>
        <div>
          <Label>Personality notes</Label>
          <Input
            value={form.personalityNotes ?? ""}
            onChange={(e) => set("personalityNotes", e.target.value)}
            maxLength={500}
          />
        </div>
        <div>
          <Label>System instructions</Label>
          <Textarea value={form.prompt ?? ""} onChange={(e) => set("prompt", e.target.value)} rows={7} maxLength={8000} />
        </div>
        <div>
          <Label>Version note</Label>
          <Input value={note} onChange={(e) => setNote(e.target.value)} maxLength={120} placeholder="What changed?" />
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          {selected ? (
            <Button variant="secondary" onClick={() => onStartCall(selected)}>
              Start with v{selected.activeVersion}
            </Button>
          ) : null}
          <Button onClick={() => save.mutate()} disabled={save.isPending}>
            {save.isPending ? "Saving…" : "Save version"}
          </Button>
        </div>
        {selected?.versions.length ? (
          <div className="border-t border-[var(--hairline)] pt-3">
            <h4 className="text-[11px] font-semibold uppercase tracking-wide text-ink-400">Versions</h4>
            <ul className="mt-2 max-h-40 space-y-1 overflow-auto">
              {[...selected.versions].reverse().map((v) => (
                <li key={v.version} className="flex items-center justify-between gap-2 text-sm">
                  <span className="text-ink-700">
                    v{v.version}
                    {v.version === selected.activeVersion ? " · current" : ""}
                    {v.note ? ` — ${v.note}` : ""}
                  </span>
                  {v.version !== selected.activeVersion ? (
                    <Button size="sm" variant="ghost" onClick={() => activate.mutate(v.version)}>
                      Activate
                    </Button>
                  ) : null}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </section>
    </div>
  );
}
