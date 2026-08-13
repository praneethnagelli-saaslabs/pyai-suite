import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { PageHeader, EmptyState } from "@/components/EmptyState";
import { StatusBadge } from "@/components/StatusBadge";
import { DemoStages, type DemoStage } from "@/components/DemoStages";
import { Button, Input, Label, Select, Textarea, AiWorking } from "@/components/ui";
import { ErrorBanner } from "@/components/ErrorBanner";
import { CallConsole } from "@/components/simulator/CallConsole";
import { AgentPanel } from "@/components/simulator/AgentPanel";
import { ScenarioPanel } from "@/components/simulator/ScenarioPanel";
import { api } from "@/lib/api";
import { pickPreferred, sortProviders } from "@/lib/providers";
import {
  startLiveCall,
  type CallState,
  type CallTraceEvent,
  type CallTurn,
} from "@/lib/simulatorCall";
import { upsertTurn } from "@/lib/liveCaption";
import { cn } from "@/lib/cn";

type Result = Awaited<ReturnType<typeof api.simulatorRun>>;
type Mode = "call" | "persona" | "agents" | "scenarios" | "regression";

const DEFAULT_PROMPT = [
  "You are Acme's front-desk voice agent.",
  "Be brief, warm, and professional.",
  "Never invent account details or promise refunds you cannot verify.",
  "If you do not know, say so and offer to transfer to a human.",
].join(" ");

function isCallScreen(state: CallState): boolean {
  return state !== "idle" && state !== "ended" && state !== "error";
}

export function SimulatorPage() {
  const [mode, setMode] = useState<Mode>("call");
  return (
    <div>
      <PageHeader
        kicker="Product"
        title="Simulator"
        description="Configure an agent, talk to it, or let an AI customer run a scenario."
      />
      <div className="mb-6 flex gap-1 overflow-x-auto border-b border-[var(--hairline)]">
        {(
          [
            ["call", "Live call"],
            ["persona", "Persona"],
            ["agents", "Agents"],
            ["scenarios", "Scenarios"],
            ["regression", "Regression"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setMode(id)}
            className={cn(
              "border-b-2 px-3 py-2 text-sm transition",
              mode === id
                ? "border-accent text-ink-950"
                : "border-transparent text-ink-500 hover:text-ink-800",
            )}
          >
            {label}
          </button>
        ))}
      </div>
      {mode === "call" ? <LiveCallPanel /> : null}
      {mode === "persona" ? <PersonaCallPanel /> : null}
      {mode === "agents" ? (
        <AgentPanel
          onStartCall={(agent) => {
            sessionStorage.setItem("sim.agentId", agent.id);
            setMode("call");
          }}
        />
      ) : null}
      {mode === "scenarios" ? (
        <ScenarioPanel
          onRunPersona={(scenario) => {
            sessionStorage.setItem("sim.scenarioId", scenario.id);
            setMode("persona");
          }}
        />
      ) : null}
      {mode === "regression" ? <RegressionPanel /> : null}
    </div>
  );
}

function LiveCallPanel() {
  const live = useQuery({ queryKey: ["simulator-live"], queryFn: api.simulatorLive });
  const agents = useQuery({ queryKey: ["simulator-agents"], queryFn: api.simulatorAgents });
  const [agentId, setAgentId] = useState(() => sessionStorage.getItem("sim.agentId") ?? "agt_acme");
  const [name, setName] = useState("Acme Receptionist");
  const [voice, setVoice] = useState("ava");
  const [prompt, setPrompt] = useState(DEFAULT_PROMPT);
  const [greeting, setGreeting] = useState("Hi, you've reached Acme. How can I help you today?");
  const [forceProvider, setForceProvider] = useState("auto");
  const [showPrompt, setShowPrompt] = useState(false);
  const [state, setState] = useState<CallState>("idle");
  const [level, setLevel] = useState(0);
  const [muted, setMuted] = useState(false);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [provider, setProvider] = useState<string>();
  const [fallbackUsed, setFallbackUsed] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [turns, setTurns] = useState<CallTurn[]>([]);
  const [trace, setTrace] = useState<CallTraceEvent[] | null>(null);
  const ctl = useRef<{ interrupt: () => void; mute: (on: boolean) => void; end: () => void } | null>(null);
  const [onCall, setOnCall] = useState(false);
  const inCall = onCall && isCallScreen(state);

  async function start() {
    setError(null);
    setNotice(null);
    setTrace(null);
    setTurns([]);
    setMuted(false);
    setStartedAt(Date.now());
    setOnCall(true);
    setState("connecting");
    try {
      ctl.current = await startLiveCall(
        { name, prompt, voice, greeting },
        {
          onState: (next) => {
            if (next === "ended" || next === "error") setOnCall(false);
            setState(next);
          },
          onSession: (info) => {
            setProvider(info.provider);
            setFallbackUsed(info.fallbackUsed);
            setNotice(info.message ?? null);
          },
          onTurn: (turn) => {
            setTurns((prev) => upsertTurn(prev, turn));
          },
          onLevel: setLevel,
          onError: (message) => {
            setError(message);
            setOnCall(false);
            setState("error");
          },
          onEnded: (info) => {
            setOnCall(false);
            setTrace(info.trace);
            setProvider(info.provider || provider);
            setFallbackUsed(info.fallbackUsed);
            ctl.current = null;
          },
        },
        { forceProvider: forceProvider === "auto" ? undefined : forceProvider, agentId },
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Microphone permission is required.");
      setOnCall(false);
      setState("error");
      setStartedAt(null);
    }
  }

  function endCall() {
    ctl.current?.end();
    ctl.current = null;
    setOnCall(false);
    setState("ended");
  }

  return (
    <div className="space-y-5">
      {inCall ? (
        <CallConsole
          agentName={name}
          state={state}
          level={level}
          muted={muted}
          startedAt={startedAt}
          provider={provider}
          fallbackUsed={fallbackUsed}
          notice={notice}
          turns={turns}
          onMute={() => {
            const next = !muted;
            setMuted(next);
            ctl.current?.mute(next);
          }}
          onEnd={endCall}
        />
      ) : (
        <>
          <section className="panel space-y-3 p-4">
            {agents.data?.agents.length ? (
              <div>
                <Label>Saved agent</Label>
                <Select
                  value={agentId}
                  onChange={(e) => {
                    const id = e.target.value;
                    setAgentId(id);
                    const picked = agents.data?.agents.find((a) => a.id === id);
                    if (!picked) return;
                    setName(picked.name);
                    setVoice(picked.voice);
                    setPrompt(picked.prompt);
                    setGreeting(picked.greeting);
                  }}
                >
                  {agents.data.agents.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name} · v{a.activeVersion}
                    </option>
                  ))}
                </Select>
              </div>
            ) : null}
            <div className="grid gap-3 md:grid-cols-2">
              <div>
                <Label>Agent name</Label>
                <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
              </div>
              <div>
                <Label>Voice</Label>
                <Select value={voice} onChange={(e) => setVoice(e.target.value)}>
                  {(live.data?.voices ?? [{ id: "ava", label: "Ava" }]).map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.label}
                    </option>
                  ))}
                </Select>
              </div>
            </div>
            <div>
              <Label>Greeting</Label>
              <Input value={greeting} onChange={(e) => setGreeting(e.target.value)} maxLength={500} />
            </div>
            <button
              type="button"
              className="text-[11px] text-ink-500 underline-offset-2 hover:text-ink-800 hover:underline"
              onClick={() => setShowPrompt((v) => !v)}
            >
              {showPrompt ? "Hide instructions" : "System instructions"}
            </button>
            {showPrompt ? (
              <div>
                <Label>System prompt</Label>
                <Textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={6} maxLength={8000} />
              </div>
            ) : null}
            <div className="grid gap-3 md:grid-cols-2">
              <div>
                <Label>Provider</Label>
                <Select value={forceProvider} onChange={(e) => setForceProvider(e.target.value)}>
                  <option value="auto">Auto (PyAI Omni → OpenAI → mock)</option>
                  {(live.data?.providers ?? []).map((p) => (
                    <option key={p.id} value={p.id} disabled={!p.configured && p.id !== "mock"}>
                      {p.name}
                      {p.configured || p.id === "mock" ? "" : " (needs key)"}
                    </option>
                  ))}
                </Select>
                <p className="mt-1 text-xs text-ink-500">
                  Keys stay on the API. Fallback is recorded in the call trace — never silent.
                </p>
              </div>
            </div>
            <div className="flex justify-end">
              <Button onClick={() => void start()}>Start simulation</Button>
            </div>
          </section>
          {error ? <ErrorBanner title="Call failed" message={error} onRetry={() => void start()} /> : null}
          {state === "ended" && !trace?.length ? (
            <EmptyState title="Call ended" body="Start again to talk to the agent." actionLabel="Start simulation" onAction={() => void start()} />
          ) : null}
          {trace?.length ? (
            <section className="panel p-4">
              <h3 className="text-sm font-semibold text-ink-900">Trace</h3>
              <p className="mt-1 text-xs text-ink-500">
                {provider}
                {fallbackUsed ? " · fallback used" : ""} · {trace.length} events
              </p>
              <ol className="mt-3 max-h-64 space-y-1 overflow-auto font-mono text-[11px] text-ink-600">
                {trace.map((ev, i) => (
                  <li key={`${ev.t}-${i}`}>
                    {formatMs(ev.t)} {ev.type}
                    {ev.speaker ? ` · ${ev.speaker}` : ""}
                  </li>
                ))}
              </ol>
            </section>
          ) : null}
        </>
      )}
    </div>
  );
}

function PersonaCallPanel() {
  const live = useQuery({ queryKey: ["simulator-live"], queryFn: api.simulatorLive });
  const agents = useQuery({ queryKey: ["simulator-agents"], queryFn: api.simulatorAgents });
  const scenarios = useQuery({ queryKey: ["simulator-scenarios"], queryFn: api.simulatorScenarios });
  const [agentId, setAgentId] = useState(() => sessionStorage.getItem("sim.agentId") ?? "agt_acme");
  const [scenarioId, setScenarioId] = useState(() => sessionStorage.getItem("sim.scenarioId") ?? "angry_customer");
  const [forceProvider, setForceProvider] = useState("auto");
  const [state, setState] = useState<CallState>("idle");
  const [level, setLevel] = useState(0);
  const [muted, setMuted] = useState(false);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [provider, setProvider] = useState<string>();
  const [fallbackUsed, setFallbackUsed] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [turns, setTurns] = useState<CallTurn[]>([]);
  const [trace, setTrace] = useState<CallTraceEvent[] | null>(null);
  const ctl = useRef<{ interrupt: () => void; mute: (on: boolean) => void; end: () => void } | null>(null);
  const [onCall, setOnCall] = useState(false);
  const agent = agents.data?.agents.find((a) => a.id === agentId) ?? agents.data?.agents[0];
  const scenario = scenarios.data?.scenarios.find((s) => s.id === scenarioId) ?? scenarios.data?.scenarios[0];
  const inCall = onCall && isCallScreen(state);

  async function start() {
    if (!agent || !scenario) {
      setError("Pick an agent and a scenario first.");
      return;
    }
    setError(null);
    setNotice(null);
    setTrace(null);
    setTurns([]);
    setMuted(false);
    setStartedAt(Date.now());
    setOnCall(true);
    setState("connecting");
    try {
      ctl.current = await startLiveCall(
        {
          name: agent.name,
          prompt: agent.prompt,
          voice: agent.voice,
          greeting: agent.greeting,
        },
        {
          onState: (next) => {
            if (next === "ended" || next === "error") setOnCall(false);
            setState(next);
          },
          onSession: (info) => {
            setProvider(info.provider);
            setFallbackUsed(info.fallbackUsed);
            setNotice(info.message ?? null);
          },
          onTurn: (turn) => {
            setTurns((prev) => upsertTurn(prev, turn));
          },
          onLevel: setLevel,
          onError: (message) => {
            setError(message);
            setOnCall(false);
            setState("error");
          },
          onEnded: (info) => {
            setOnCall(false);
            setTrace(info.trace);
            setProvider(info.provider || provider);
            setFallbackUsed(info.fallbackUsed);
            ctl.current = null;
          },
        },
        {
          forceProvider: forceProvider === "auto" ? undefined : forceProvider,
          mode: "persona",
          agentId: agent.id,
          version: agent.activeVersion,
          scenarioId: scenario.id,
        },
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not start the persona simulation.");
      setOnCall(false);
      setState("error");
      setStartedAt(null);
    }
  }

  function endCall() {
    ctl.current?.end();
    ctl.current = null;
    setOnCall(false);
    setState("ended");
  }

  return (
    <div className="space-y-5">
      {inCall ? (
        <CallConsole
          agentName={agent?.name ?? "Agent"}
          state={state}
          level={level}
          muted={muted}
          startedAt={startedAt}
          provider={provider}
          fallbackUsed={fallbackUsed}
          notice={notice}
          turns={turns}
          userLabel="AI customer"
          onMute={() => {
            const next = !muted;
            setMuted(next);
            ctl.current?.mute(next);
          }}
          onEnd={endCall}
        />
      ) : (
        <>
          <section className="panel space-y-3 p-4">
            <p className="text-sm text-ink-600">
              The simulator plays the customer. No microphone — watch the agent handle the scenario.
            </p>
            <div className="grid gap-3 md:grid-cols-2">
              <div>
                <Label>Agent</Label>
                <Select value={agent?.id ?? agentId} onChange={(e) => setAgentId(e.target.value)}>
                  {(agents.data?.agents ?? []).map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name} · v{a.activeVersion}
                    </option>
                  ))}
                </Select>
              </div>
              <div>
                <Label>Scenario</Label>
                <Select value={scenario?.id ?? scenarioId} onChange={(e) => setScenarioId(e.target.value)}>
                  {(scenarios.data?.scenarios ?? []).map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </Select>
              </div>
            </div>
            {scenario ? (
              <p className="text-xs text-ink-500">
                {scenario.emotionalState} · {scenario.goal}
              </p>
            ) : null}
            <div>
              <Label>Provider</Label>
              <Select value={forceProvider} onChange={(e) => setForceProvider(e.target.value)}>
                <option value="auto">Auto (PyAI Omni → OpenAI → mock)</option>
                {(live.data?.providers ?? []).map((p) => (
                  <option key={p.id} value={p.id} disabled={!p.configured && p.id !== "mock"}>
                    {p.name}
                    {p.configured || p.id === "mock" ? "" : " (needs key)"}
                  </option>
                ))}
              </Select>
            </div>
            <div className="flex justify-end">
              <Button onClick={() => void start()}>Run persona simulation</Button>
            </div>
          </section>
          {error ? <ErrorBanner title="Persona run failed" message={error} onRetry={() => void start()} /> : null}
          {trace?.length ? (
            <section className="panel p-4">
              <h3 className="text-sm font-semibold text-ink-900">Trace</h3>
              <p className="mt-1 text-xs text-ink-500">
                {provider}
                {fallbackUsed ? " · fallback used" : ""} · {trace.length} events
              </p>
              <ol className="mt-3 max-h-64 space-y-1 overflow-auto font-mono text-[11px] text-ink-600">
                {trace.map((ev, i) => (
                  <li key={`${ev.t}-${i}`}>
                    {formatMs(ev.t)} {ev.type}
                    {ev.speaker ? ` · ${ev.speaker}` : ""}
                  </li>
                ))}
              </ol>
            </section>
          ) : null}
        </>
      )}
    </div>
  );
}

function formatMs(t: number): string {
  const s = Math.floor(t / 1000);
  const ms = t % 1000;
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}.${String(ms).padStart(3, "0")}`;
}

function RegressionPanel() {
  const providers = useQuery({ queryKey: ["providers"], queryFn: api.providers });
  const [agentName, setAgentName] = useState("Acme Receptionist");
  const [count, setCount] = useState(10);
  const [llmProvider, setLlmProvider] = useState("mock");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [stages, setStages] = useState<DemoStage[]>([]);
  const [showSettings, setShowSettings] = useState(false);

  const llmOptions = useMemo(
    () => sortProviders(providers.data?.providers.filter((p) => p.capabilities.includes("llm")) ?? []),
    [providers.data],
  );

  useEffect(() => {
    if (!providers.data) return;
    setLlmProvider(pickPreferred(providers.data.providers, "llm"));
  }, [providers.data]);

  async function runDemo() {
    setBusy(true);
    setError(null);
    setResult(null);
    setStages([
      { id: "spawn", label: "Spawn adversarial callers…", detail: `${count} personas` },
      { id: "score", label: "Score conversations…", detail: llmProvider },
      { id: "card", label: "Build benchmark card…", detail: agentName },
    ]);
    try {
      const out = await api.simulatorRun({
        agentName,
        count,
        concurrency: Math.min(count, 5),
        llmProvider,
      });
      setStages(out.stages ?? []);
      setResult(out);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStages([]);
    } finally {
      setBusy(false);
    }
  }

  const card = result?.card;

  return (
    <div>
      <section className="panel mb-5 space-y-3 p-4">
        <div>
          <Label>Agent name</Label>
          <Input
            value={agentName}
            onChange={(e) => setAgentName(e.target.value)}
            placeholder="Acme Receptionist"
            disabled={busy}
          />
          <p className="mt-1 text-xs text-ink-500">
            Batch text callers. Use Live call for a real voice conversation.
          </p>
        </div>
        <button
          type="button"
          className="text-[11px] text-ink-500 underline-offset-2 hover:text-ink-800 hover:underline"
          onClick={() => setShowSettings((v) => !v)}
        >
          {showSettings ? "Hide settings" : "Settings"}
        </button>
        {showSettings ? (
          <div className="grid gap-3 border-t border-ink-100 pt-3 md:grid-cols-2">
            <div>
              <Label>Callers</Label>
              <Select value={String(count)} onChange={(e) => setCount(Number(e.target.value))} disabled={busy}>
                {[1, 5, 10, 20, 50].map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label>LLM provider</Label>
              <Select value={llmProvider} onChange={(e) => setLlmProvider(e.target.value)} disabled={busy}>
                {llmOptions.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                    {p.configured ? "" : " (needs key)"}
                  </option>
                ))}
              </Select>
            </div>
          </div>
        ) : null}
        <div className="flex items-center justify-end gap-3">
          {busy ? <AiWorking label="Scoring conversations" /> : null}
          <Button disabled={busy} onClick={() => void runDemo()}>
            {busy ? "Running stress test…" : "Run stress test"}
          </Button>
        </div>
      </section>

      {error ? (
        <div className="mb-4">
          <ErrorBanner title="Stress test failed" message={error} onRetry={() => void runDemo()} />
        </div>
      ) : null}
      {(busy || stages.length > 0) && (
        <div className="panel mb-5 p-4">
          <h3 className="mb-3 text-sm font-semibold">Pipeline</h3>
          <DemoStages stages={stages} running={busy} />
        </div>
      )}
      {!card && !busy ? (
        <EmptyState
          title="No benchmark yet"
          body="Run stress test to spawn callers and build a benchmark card."
          actionLabel="Run stress test"
          onAction={() => void runDemo()}
        />
      ) : card ? (
        <div className="grid gap-4 lg:grid-cols-[0.9fr_1.1fr]">
          <div className="panel p-5 animate-fade-up">
            <div className="text-[11px] uppercase tracking-wide text-ink-400">Benchmark card</div>
            <h2 className="mt-1 text-2xl font-semibold">{card.agent}</h2>
            <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
              <div>
                <div className="text-ink-400">Tests</div>
                <div className="text-xl font-semibold">{card.tests}</div>
              </div>
              <div>
                <div className="text-ink-400">Score</div>
                <div className="text-xl font-semibold">{card.score}%</div>
              </div>
              <div>
                <div className="text-ink-400">Passed</div>
                <div className="text-status-pass">{card.passed}</div>
              </div>
              <div>
                <div className="text-ink-400">Failed</div>
                <div className="text-status-block">{card.failed}</div>
              </div>
              <div>
                <div className="text-ink-400">Median latency</div>
                <div className="font-mono">{card.medianLatencyMs}ms</div>
              </div>
            </div>
            {card.worstFailure ? <p className="mt-4 text-sm text-status-block">Worst: {card.worstFailure}</p> : null}
            <p className="mt-4 text-[11px] text-ink-400">Built with PyAI · shareable card</p>
          </div>
          <div className="panel max-h-[520px] overflow-auto">
            <ul className="divide-y divide-ink-100">
              {card.calls.map((c) => (
                <li key={c.callId} className="px-4 py-3 text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <div className="font-mono text-xs text-ink-500">
                      {c.callId} · {c.persona}
                    </div>
                    <StatusBadge status={c.passed ? "SUCCEEDED" : "FAILED"} />
                  </div>
                  <div className="mt-1 text-ink-700">
                    score {c.score} · {c.latencyMs}ms
                  </div>
                  {c.failures.length ? (
                    <div className="mt-1 font-mono text-[11px] text-status-block">{c.failures.join(", ")}</div>
                  ) : null}
                </li>
              ))}
            </ul>
          </div>
        </div>
      ) : null}
    </div>
  );
}
