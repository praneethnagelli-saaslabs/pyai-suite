import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { pickPreferred, sortProviders } from "@/lib/providers";
import { ensureWavCompatible } from "@/lib/audio";
import { PageHeader } from "@/components/EmptyState";
import { ErrorBanner } from "@/components/ErrorBanner";
import { Button, Input, Label, Select, Textarea, AiWorking } from "@/components/ui";

type PlayResult = Awaited<ReturnType<typeof api.playgroundRun>>;

const CAPABILITIES = [
  {
    id: "llm",
    label: "LLM",
    inputKind: "prompt" as const,
    placeholder: "Ask a question or give instructions…",
    sample: "Summarize why a customer might object to implementation cost.",
    hint: "Text completion. PyAI is voice-only — pick OpenAI, Gemini, or Mock.",
  },
  {
    id: "structured_output",
    label: "Structured output",
    inputKind: "prompt" as const,
    placeholder: "Describe the JSON you want extracted…",
    sample: "Extract objections and next steps from: Customer says pricing is too high and wants a security pack by Friday.",
    hint: "JSON-oriented completion (OpenAI / Gemini / Mock).",
  },
  {
    id: "batch_stt",
    label: "Batch STT",
    inputKind: "audio" as const,
    placeholder: "Optional: type a line to Speak→Hear if you skip the file",
    sample: "Hello from the playground.",
    hint: "Mic webm is auto-converted to wav for PyAI Hear. You can also upload wav/mp3 or type text for Speak→Hear.",
  },
  {
    id: "tts",
    label: "TTS",
    inputKind: "speak" as const,
    placeholder: "Text to speak…",
    sample: "Hello from PyAI Suite.",
    hint: "Synthesize speech. PyAI Speak and OpenAI TTS are supported.",
  },
  {
    id: "embeddings",
    label: "Embeddings",
    inputKind: "embed" as const,
    placeholder: "Text to embed…",
    sample: "enterprise sales call intelligence",
    hint: "Vectorize text (OpenAI / Gemini / Mock).",
  },
];

function extFormat(name: string): string {
  const ext = name.split(".").pop()?.toLowerCase() ?? "wav";
  if (ext === "mpeg" || ext === "mpga") return "mp3";
  if (["wav", "mp3", "webm", "opus", "ogg", "m4a", "flac"].includes(ext)) return ext === "ogg" ? "opus" : ext;
  return "wav";
}

async function fileToBase64(file: File): Promise<{ audioBase64: string; audioFormat: string }> {
  const buf = await file.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return { audioBase64: btoa(binary), audioFormat: extFormat(file.name) };
}

export function PlaygroundPage() {
  const providers = useQuery({ queryKey: ["providers"], queryFn: api.providers });
  const [capability, setCapability] = useState("llm");
  const [provider, setProvider] = useState("pyai");
  const [providerB, setProviderB] = useState("openai");
  const [input, setInput] = useState(CAPABILITIES[0]!.sample);
  const [audioName, setAudioName] = useState<string | null>(null);
  const [audioBase64, setAudioBase64] = useState<string | undefined>();
  const [audioFormat, setAudioFormat] = useState<string | undefined>();
  const [recording, setRecording] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [a, setA] = useState<PlayResult | null>(null);
  const [b, setB] = useState<PlayResult | null>(null);
  const [c, setC] = useState<PlayResult | null>(null);
  const [providerC, setProviderC] = useState("gemini");
  const [dragging, setDragging] = useState(false);
  const mediaRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const capMeta = CAPABILITIES.find((c) => c.id === capability) ?? CAPABILITIES[0]!;
  const isStt = capMeta.inputKind === "audio";

  const matching = useMemo(() => {
    const list = providers.data?.providers.filter((p) => p.capabilities.includes(capability)) ?? [];
    return sortProviders(list).sort((x, y) => Number(y.configured) - Number(x.configured) || 0);
  }, [providers.data, capability]);

  // Swap sample text + clear audio when capability changes.
  useEffect(() => {
    setInput(capMeta.sample);
    setAudioName(null);
    setAudioBase64(undefined);
    setAudioFormat(undefined);
    setError(null);
    setA(null);
    setB(null);
    setC(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }, [capability, capMeta.sample]);

  useEffect(() => {
    if (!matching.length) return;
    const primary = pickPreferred(matching, capability);
    setProvider(primary);
    const rest = matching.filter((p) => p.id !== primary);
    setProviderB(rest[0]?.id ?? primary);
    setProviderC(rest[1]?.id ?? rest[0]?.id ?? primary);
  }, [capability, matching]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault();
        if (!busy && matching.length) void runOne("all");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // runOne is stable enough for this session; busy/matching gate the handler
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busy, matching.length, capability, provider, providerB, providerC, input, audioBase64, audioFormat, isStt]);

  async function onPickAudio(file: File | null) {
    if (!file) {
      setAudioName(null);
      setAudioBase64(undefined);
      setAudioFormat(undefined);
      return;
    }
    if (file.size > 7_000_000) {
      setError("Audio file too large (max ~7MB)");
      return;
    }
    try {
      const compatible = await ensureWavCompatible(file);
      if (compatible.size > 7_000_000) {
        setError("Converted audio too large (max ~7MB)");
        return;
      }
      const encoded = await fileToBase64(compatible);
      setAudioName(compatible.name);
      setAudioBase64(encoded.audioBase64);
      setAudioFormat(encoded.audioFormat);
      setError(null);
    } catch (e) {
      setError(
        e instanceof Error
          ? `Could not prepare audio: ${e.message}. Upload wav/mp3, or type text for Speak→Hear.`
          : "Could not prepare audio for transcription.",
      );
    }
  }

  async function startRecording() {
    setError(null);
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const mime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
      ? "audio/webm;codecs=opus"
      : MediaRecorder.isTypeSupported("audio/webm")
        ? "audio/webm"
        : undefined;
    const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
    chunksRef.current = [];
    rec.ondataavailable = (e) => {
      if (e.data.size) chunksRef.current.push(e.data);
    };
    rec.onstop = async () => {
      stream.getTracks().forEach((t) => t.stop());
      const blob = new Blob(chunksRef.current, { type: mime?.split(";")[0] ?? "audio/webm" });
      const file = new File([blob], "recording.webm", { type: blob.type || "audio/webm" });
      await onPickAudio(file);
      setRecording(false);
    };
    mediaRef.current = rec;
    rec.start();
    setRecording(true);
  }

  function stopRecording() {
    mediaRef.current?.stop();
    mediaRef.current = null;
  }

  async function runOne(which: "a" | "b" | "c" | "all") {
    if (isStt && !audioBase64 && !input.trim()) {
      setError("Add an audio file/recording, or type text for Speak→Hear.");
      return;
    }
    if (!isStt && !input.trim()) {
      setError("Enter some input text first.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const body = {
        capability,
        input,
        ...(isStt && audioBase64 ? { audioBase64, audioFormat } : {}),
      };
      if (which === "a" || which === "all") {
        setA(await api.playgroundRun({ ...body, provider }));
      }
      if (which === "b" || which === "all") {
        setB(await api.playgroundRun({ ...body, provider: providerB }));
      }
      if (which === "c" || which === "all") {
        setC(await api.playgroundRun({ ...body, provider: providerC }));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <PageHeader
        kicker="Arena"
        title="Model arena"
        description="Same input, three providers. Winner is the fastest successful run — no invented quality scores."
        actions={
          <div className="flex items-center gap-3">
            {busy ? <AiWorking label="Running arena" /> : null}
            <Button disabled={busy || !matching.length} onClick={() => void runOne("all")}>
              {busy ? "Running…" : "Run arena"}
            </Button>
          </div>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        {CAPABILITIES.map((cap, i) => (
          <div key={cap.id} className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setCapability(cap.id)}
              className={`rounded-full border px-3 py-1 text-xs font-medium transition ${
                capability === cap.id
                  ? "border-accent bg-accent text-white dark:text-ink-950"
                  : "border-ink-200 text-ink-600 hover:border-accent/40"
              }`}
            >
              {cap.label}
            </button>
            {i < CAPABILITIES.length - 1 ? <span className="text-ink-300">→</span> : null}
          </div>
        ))}
      </div>

      <div
        className={`grid gap-4 border border-[var(--hairline)] bg-surface p-4 md:grid-cols-3 ${dragging ? "border-accent ring-2 ring-accent/20" : ""}`}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          const file = e.dataTransfer.files?.[0];
          if (file) {
            setCapability("batch_stt");
            void onPickAudio(file);
          }
        }}
      >
        <div>
          <Label>A</Label>
          <Select value={provider} onChange={(e) => setProvider(e.target.value)}>
            {matching.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}{p.configured ? "" : " (not configured)"}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label>B</Label>
          <Select value={providerB} onChange={(e) => setProviderB(e.target.value)}>
            {matching.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}{p.configured ? "" : " (not configured)"}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label>C</Label>
          <Select value={providerC} onChange={(e) => setProviderC(e.target.value)}>
            {matching.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}{p.configured ? "" : " (not configured)"}
              </option>
            ))}
          </Select>
        </div>

        <div className="md:col-span-3">
          <p className="mb-2 text-xs text-ink-400">
            {dragging ? "Drop audio to transcribe…" : "Drop an audio file anywhere in this panel, or type below."}
          </p>
          <CapabilityInput
            kind={capMeta.inputKind}
            label={
              capMeta.inputKind === "audio"
                ? "Audio"
                : capMeta.inputKind === "speak"
                  ? "Text to speak"
                  : capMeta.inputKind === "embed"
                    ? "Text to embed"
                    : "Prompt"
            }
            placeholder={capMeta.placeholder}
            value={input}
            onChange={setInput}
            audioName={audioName}
            audioFormat={audioFormat}
            recording={recording}
            fileInputRef={fileInputRef}
            onPickAudio={(f) => void onPickAudio(f)}
            onStartRec={() => void startRecording().catch((e) => setError(String(e)))}
            onStopRec={stopRecording}
            onClearAudio={() => {
              void onPickAudio(null);
              if (fileInputRef.current) fileInputRef.current.value = "";
            }}
          />
          <p className="mt-2 text-xs text-ink-500">{capMeta.hint}</p>
        </div>
      </div>

      {error ? (
        <div className="mt-4">
          <ErrorBanner title="Run failed" message={error} onRetry={() => void runOne("all")} />
        </div>
      ) : null}

      {a || b || c ? (
        <ArenaScoreboard
          rows={[
            { name: provider, result: a },
            { name: providerB, result: b },
            { name: providerC, result: c },
          ]}
        />
      ) : null}

      <div className="mt-5 grid gap-4 lg:grid-cols-3">
        <ResultCard title={`A · ${provider}`} capability={capability} result={a} busy={busy && !a} />
        <ResultCard title={`B · ${providerB}`} capability={capability} result={b} busy={busy && !b} />
        <ResultCard title={`C · ${providerC}`} capability={capability} result={c} busy={busy && !c} />
      </div>
    </div>
  );
}

function CapabilityInput({
  kind,
  label,
  placeholder,
  value,
  onChange,
  audioName,
  audioFormat,
  recording,
  fileInputRef,
  onPickAudio,
  onStartRec,
  onStopRec,
  onClearAudio,
}: {
  kind: "prompt" | "audio" | "speak" | "embed";
  label: string;
  placeholder: string;
  value: string;
  onChange: (v: string) => void;
  audioName: string | null;
  audioFormat?: string;
  recording: boolean;
  fileInputRef: RefObject<HTMLInputElement>;
  onPickAudio: (file: File | null) => void;
  onStartRec: () => void;
  onStopRec: () => void;
  onClearAudio: () => void;
}) {
  if (kind === "audio") {
    return (
      <div className="space-y-3">
        <Label>{label}</Label>
        <div className="flex flex-wrap items-center gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept="audio/*,.wav,.mp3,.webm,.ogg,.m4a,.flac"
            className="block max-w-full text-sm text-ink-600 file:mr-3 file:rounded-md file:border-0 file:bg-accent file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-white dark:file:text-ink-950"
            onChange={(e) => onPickAudio(e.target.files?.[0] ?? null)}
          />
          {!recording ? (
            <Button type="button" variant="secondary" size="sm" onClick={onStartRec}>
              Record mic
            </Button>
          ) : (
            <Button type="button" variant="danger" size="sm" onClick={onStopRec}>
              Stop
            </Button>
          )}
          {audioName ? (
            <Button type="button" variant="ghost" size="sm" onClick={onClearAudio}>
              Clear file
            </Button>
          ) : null}
        </div>
        <p className="text-xs text-ink-500">
          {audioName
            ? `Ready: ${audioName} (${audioFormat})`
            : recording
              ? "Recording… (will convert to wav for PyAI Hear)"
              : "No audio yet — record mic, upload wav/mp3/webm, or type text for Speak→Hear."}
        </p>
        <div>
          <Label>Fallback text (Speak→Hear if no audio)</Label>
          <Input
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={placeholder}
          />
        </div>
      </div>
    );
  }

  if (kind === "speak" || kind === "embed") {
    return (
      <div>
        <Label>{label}</Label>
        <Input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
        />
      </div>
    );
  }

  // prompt
  return (
    <div>
      <Label>{label}</Label>
      <Textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="min-h-[120px]"
      />
    </div>
  );
}

function ArenaScoreboard({
  rows,
}: {
  rows: Array<{ name: string; result: PlayResult | null }>;
}) {
  const done = rows.filter((r) => r.result);
  const fastest = done.reduce<PlayResult | null>((best, row) => {
    if (!row.result) return best;
    if (!best || row.result.latencyMs < best.latencyMs) return row.result;
    return best;
  }, null);
  const winnerName = rows.find((r) => r.result && r.result.runId === fastest?.runId)?.name;
  return (
    <div className="mt-4 border-t border-[var(--hairline)] py-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold">Scoreboard</h3>
        {winnerName && fastest ? (
          <div className="text-sm text-accent">
            Fastest this run · <span className="font-semibold">{winnerName}</span> · {fastest.latencyMs}ms
          </div>
        ) : null}
      </div>
      <div className="grid gap-3 md:grid-cols-3">
        {rows.map((row) => (
          <div
            key={row.name}
            className={`rounded-lg border px-3 py-2 ${
              row.result && row.result.runId === fastest?.runId ? "border-accent bg-accent-soft" : "border-[var(--hairline)]"
            }`}
          >
            <div className="text-sm font-medium text-ink-900">{row.name}</div>
            <div className="mt-1 font-mono text-xs text-ink-500">
              {row.result ? `${row.result.latencyMs}ms · ${row.result.provider}` : "waiting"}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ResultCard({
  title,
  capability,
  result,
  busy,
}: {
  title: string;
  capability: string;
  result: PlayResult | null;
  busy?: boolean;
}) {
  return (
    <div className="panel p-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">{title}</h3>
        {result ? <span className="font-mono text-[11px] text-ink-400">{result.runId}</span> : null}
      </div>
      {!result ? (
        <p className="mt-6 text-sm text-ink-400">
          {busy ? "Waiting for this provider…" : "No result yet — run A, or compare A vs B."}
        </p>
      ) : (
        <>
          <div className="mt-3 flex flex-wrap gap-3 text-xs text-ink-500">
            <span>Provider: <strong className="text-ink-800">{result.provider}</strong></span>
            <span>Latency: <strong className="text-ink-800">{result.latencyMs}ms</strong></span>
          </div>
          <div className="mt-3">
            <CapabilityOutput capability={capability} result={result} />
          </div>
        </>
      )}
    </div>
  );
}

function mimeFor(format?: string): string {
  const f = (format ?? "wav").toLowerCase();
  if (f === "mp3" || f === "mpeg") return "audio/mpeg";
  if (f === "webm") return "audio/webm";
  if (f === "ogg" || f === "opus") return "audio/ogg";
  if (f === "pcm") return "audio/wav";
  return "audio/wav";
}

function CapabilityOutput({ capability, result }: { capability: string; result: PlayResult }) {
  const r = result.result;
  const kind = r?.kind ?? (capability === "tts" ? "tts" : capability === "batch_stt" ? "stt" : capability === "embeddings" ? "embeddings" : capability === "structured_output" ? "structured" : "llm");

  if (kind === "tts") {
    if (r?.tooLarge) {
      return <p className="text-sm text-ink-600">Audio generated ({r.audioBytes} bytes, {r.audioFormat}) but too large to preview inline.</p>;
    }
    if (r?.audioBase64) {
      const src = `data:${mimeFor(r.audioFormat)};base64,${r.audioBase64}`;
      return (
        <div className="space-y-3 rounded-lg border border-ink-200 bg-ink-50 p-3">
          <p className="text-xs text-ink-500">
            Spoken audio · {r.audioFormat} · {r.audioBytes?.toLocaleString()} bytes
          </p>
          <audio controls src={src} className="w-full" />
          {r.text ? <p className="text-sm text-ink-700">“{r.text}”</p> : null}
          <a
            href={src}
            download={`tts.${r.audioFormat ?? "wav"}`}
            className="inline-block text-xs font-medium text-accent hover:underline"
          >
            Download
          </a>
        </div>
      );
    }
    return <pre className="max-h-80 overflow-auto rounded-lg bg-ink-950 p-3 font-mono text-[12px] text-ink-100">{result.output}</pre>;
  }

  if (kind === "stt") {
    return (
      <div className="space-y-3">
        {r?.note ? <p className="text-xs text-ink-500">{r.note}</p> : null}
        <div className="rounded-lg border border-ink-200 bg-surface p-3">
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-ink-400">Transcript</p>
          <p className="whitespace-pre-wrap text-sm leading-relaxed text-ink-900">{r?.text ?? result.output}</p>
          {r?.language ? <p className="mt-2 text-xs text-ink-400">Language: {r.language}</p> : null}
        </div>
        {r?.segments && r.segments.length > 1 ? (
          <div className="max-h-48 overflow-auto rounded-lg border border-ink-200">
            <table className="w-full text-left text-xs">
              <thead className="bg-ink-50 text-ink-500">
                <tr>
                  <th className="px-2 py-1.5 font-medium">Speaker</th>
                  <th className="px-2 py-1.5 font-medium">Time</th>
                  <th className="px-2 py-1.5 font-medium">Text</th>
                </tr>
              </thead>
              <tbody>
                {r.segments.map((s, i) => (
                  <tr key={s.id ?? i} className="border-t border-ink-100">
                    <td className="px-2 py-1.5 text-ink-600">{s.speaker ?? "—"}</td>
                    <td className="px-2 py-1.5 font-mono text-ink-400">
                      {s.start != null ? `${Number(s.start).toFixed(1)}s` : "—"}
                    </td>
                    <td className="px-2 py-1.5 text-ink-800">{s.text}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </div>
    );
  }

  if (kind === "embeddings") {
    const preview = r?.preview ?? [];
    const max = Math.max(...preview.map((n) => Math.abs(n)), 0.0001);
    return (
      <div className="space-y-3">
        <div className="flex flex-wrap gap-3 text-sm text-ink-700">
          <span><strong>{r?.dimensions ?? "—"}</strong> dimensions</span>
          <span><strong>{r?.vectors ?? 1}</strong> vector{(r?.vectors ?? 1) === 1 ? "" : "s"}</span>
        </div>
        {preview.length ? (
          <div>
            <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-ink-400">First {preview.length} dims</p>
            <div className="flex h-16 items-end gap-0.5 rounded-lg border border-ink-200 bg-ink-50 px-2 py-2">
              {preview.map((n, i) => (
                <div
                  key={i}
                  title={String(n)}
                  className="min-w-[3px] flex-1 rounded-sm bg-accent/80"
                  style={{ height: `${Math.max(8, (Math.abs(n) / max) * 100)}%` }}
                />
              ))}
            </div>
            <p className="mt-2 break-all font-mono text-[10px] text-ink-400">
              [{preview.map((n) => n.toFixed(4)).join(", ")}…]
            </p>
          </div>
        ) : (
          <pre className="rounded-lg bg-ink-950 p-3 font-mono text-[12px] text-ink-100">{result.output}</pre>
        )}
      </div>
    );
  }

  if (kind === "structured") {
    const body = r?.parsed ?? r?.text ?? result.output;
    const pretty = typeof body === "string" ? body : JSON.stringify(body, null, 2);
    return (
      <pre className="max-h-80 overflow-auto rounded-lg bg-ink-950 p-3 font-mono text-[12px] leading-relaxed text-ink-100">
        {pretty}
      </pre>
    );
  }

  // llm / default
  return (
    <div className="rounded-lg border border-ink-200 bg-surface p-3">
      <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-ink-400">
        Completion{r?.model ? ` · ${r.model}` : ""}
      </p>
      <p className="whitespace-pre-wrap text-sm leading-relaxed text-ink-900">{r?.text ?? result.output}</p>
    </div>
  );
}
