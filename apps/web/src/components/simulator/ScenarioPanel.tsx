import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Input, Label, Select, Textarea } from "@/components/ui";
import { ErrorBanner } from "@/components/ErrorBanner";
import { api, type SimulatorScenario } from "@/lib/api";

function asLines(values: string[] | undefined): string {
  return (values ?? []).join("\n");
}

export function ScenarioPanel({
  onRunPersona,
}: {
  onRunPersona: (scenario: SimulatorScenario) => void;
}) {
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ["simulator-scenarios"], queryFn: api.simulatorScenarios });
  const [selectedId, setSelectedId] = useState("angry_customer");
  const [draft, setDraft] = useState<Partial<SimulatorScenario> | null>(null);
  const [error, setError] = useState<string | null>(null);

  const scenarios = list.data?.scenarios ?? [];
  const selected = scenarios.find((s) => s.id === selectedId) ?? scenarios[0];
  const form = draft ?? selected;

  const save = useMutation({
    mutationFn: async () => {
      if (!selected || !form) throw new Error("Pick a scenario first.");
      if (selected.builtIn) {
        return api.simulatorCreateScenario({ ...form, name: `${form.name ?? selected.name} (copy)` });
      }
      return api.simulatorUpdateScenario(selected.id, form);
    },
    onSuccess: (out) => {
      setError(null);
      setDraft(null);
      setSelectedId(out.scenario.id);
      void qc.invalidateQueries({ queryKey: ["simulator-scenarios"] });
    },
    onError: (e) => setError(e instanceof Error ? e.message : "Save failed"),
  });

  if (!form) {
    return (
      <div className="panel p-6">
        <p className="text-sm text-ink-500">Loading scenarios…</p>
      </div>
    );
  }

  function set<K extends keyof SimulatorScenario>(key: K, value: SimulatorScenario[K]) {
    setDraft({ ...(form as SimulatorScenario), [key]: value });
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)]">
      <section className="panel p-4">
        <h3 className="text-sm font-semibold text-ink-900">Scenarios</h3>
        <ul className="mt-3 space-y-1">
          {scenarios.map((s) => (
            <li key={s.id}>
              <button
                type="button"
                onClick={() => {
                  setSelectedId(s.id);
                  setDraft(null);
                }}
                className={`w-full rounded px-3 py-2 text-left text-sm ${
                  s.id === selected?.id ? "bg-interactive text-ink-950" : "text-ink-600 hover:bg-interactive"
                }`}
              >
                <div className="font-medium">{s.name}</div>
                <div className="text-[11px] text-ink-400">{s.builtIn ? "Built-in" : "Custom"}</div>
              </button>
            </li>
          ))}
        </ul>
      </section>
      <section className="panel space-y-3 p-4">
        {error ? <ErrorBanner title="Scenario save failed" message={error} onRetry={() => save.mutate()} /> : null}
        {selected?.builtIn ? (
          <p className="text-xs text-ink-500">Built-in scenarios are read-only. Save creates a copy you can edit.</p>
        ) : null}
        <div className="grid gap-3 md:grid-cols-2">
          <div>
            <Label>Name</Label>
            <Input value={form.name ?? ""} onChange={(e) => set("name", e.target.value)} maxLength={80} />
          </div>
          <div>
            <Label>Patience</Label>
            <Select
              value={form.patience ?? "medium"}
              onChange={(e) => set("patience", e.target.value as SimulatorScenario["patience"])}
            >
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
            </Select>
          </div>
        </div>
        <div>
          <Label>Goal</Label>
          <Input value={form.goal ?? ""} onChange={(e) => set("goal", e.target.value)} maxLength={400} />
        </div>
        <div>
          <Label>Customer persona</Label>
          <Textarea
            value={form.customerPersona ?? ""}
            onChange={(e) => set("customerPersona", e.target.value)}
            rows={3}
            maxLength={500}
          />
        </div>
        <div>
          <Label>Opening line</Label>
          <Input value={form.openingLine ?? ""} onChange={(e) => set("openingLine", e.target.value)} maxLength={280} />
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          <div>
            <Label>Expected (one per line)</Label>
            <Textarea
              value={asLines(form.expected)}
              onChange={(e) => set("expected", e.target.value.split("\n"))}
              rows={4}
            />
          </div>
          <div>
            <Label>Failure conditions</Label>
            <Textarea
              value={asLines(form.failures)}
              onChange={(e) => set("failures", e.target.value.split("\n"))}
              rows={4}
            />
          </div>
        </div>
        <div>
          <Label>Objections</Label>
          <Textarea
            value={asLines(form.objections)}
            onChange={(e) => set("objections", e.target.value.split("\n"))}
            rows={3}
          />
        </div>
        <div className="flex justify-end gap-2">
          {selected ? (
            <Button variant="secondary" onClick={() => onRunPersona(selected)}>
              Run persona
            </Button>
          ) : null}
          <Button onClick={() => save.mutate()} disabled={save.isPending}>
            {selected?.builtIn ? "Duplicate" : save.isPending ? "Saving…" : "Save"}
          </Button>
        </div>
      </section>
    </div>
  );
}
