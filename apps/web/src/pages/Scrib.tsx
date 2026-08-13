import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { PageHeader, EmptyState } from "@/components/EmptyState";
import { StatusBadge } from "@/components/StatusBadge";
import { DemoStages, type DemoStage } from "@/components/DemoStages";
import { Button, Label, Select } from "@/components/ui";
import { api } from "@/lib/api";
import { ensureWavCompatible, fileToBase64 } from "@/lib/audio";
import { pickPreferred } from "@/lib/providers";

type FinishResult = Awaited<ReturnType<typeof api.scribDemoFinish>>;
type DictateResult = Awaited<ReturnType<typeof api.scribDictate>>;

const DEMO_APP = "Slack";

const DEMO_PIPELINE: DemoStage[] = [
  { id: "speak", label: "Push-to-talk (Speak)", detail: "Synthesizing sample speech…" },
  { id: "hear", label: "Transcribe (Hear)", detail: "Waiting for audio…" },
  { id: "cleanup", label: "App-aware cleanup", detail: "Waiting…" },
  { id: "insert", label: "Ready to insert", detail: "Waiting…" },
];

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function formatMs(ms: number | undefined): string {
  if (ms == null || Number.isNaN(ms)) return "—";
  if (ms < 1) return "<1ms";
  return `${Math.round(ms)}ms`;
}

function mimeForAudio(format?: string): string {
  const f = (format ?? "mp3").toLowerCase();
  if (f === "mp3" || f === "mpeg") return "audio/mpeg";
  if (f === "wav") return "audio/wav";
  if (f === "ogg") return "audio/ogg";
  if (f === "m4a") return "audio/mp4";
  return `audio/${f}`;
}

function base64ToBlob(b64: string, mime: string): Blob {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

/** Must run inside the click handler (before long awaits) so browsers allow later play(). */
async function unlockAudioPlayback(ctxRef: { current: AudioContext | null }): Promise<void> {
  const AC =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  if (!ctxRef.current || ctxRef.current.state === "closed") {
    ctxRef.current = new AC();
  }
  if (ctxRef.current.state === "suspended") {
    await ctxRef.current.resume();
  }
  // Prime a silent buffer so subsequent Audio.play() calls are allowed.
  const ctx = ctxRef.current;
  const buf = ctx.createBuffer(1, 1, 22050);
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.connect(ctx.destination);
  src.start(0);
}

async function playAndWait(
  b64: string | undefined,
  format: string | undefined,
  audioRef: { current: HTMLAudioElement | null },
  objectUrlRef: { current: string | null },
  opts?: { spokenPhrase?: string; useBrowserSpeech?: boolean },
): Promise<void> {
  // Stop any previous demo playback (important on "Run demo" again).
  if (audioRef.current) {
    try {
      audioRef.current.pause();
      audioRef.current.removeAttribute("src");
      audioRef.current.load();
    } catch {
      /* ignore */
    }
    audioRef.current = null;
  }
  if (objectUrlRef.current) {
    URL.revokeObjectURL(objectUrlRef.current);
    objectUrlRef.current = null;
  }
  window.speechSynthesis?.cancel();

  if (b64 && format) {
    const mime = mimeForAudio(format);
    const blob = base64ToBlob(b64, mime);
    const url = URL.createObjectURL(blob);
    objectUrlRef.current = url;

    const audio = new Audio();
    audio.preload = "auto";
    audio.volume = 1;
    audio.src = url;
    audioRef.current = audio;

    await new Promise<void>((resolve) => {
      let settled = false;
      let playStarted = false;
      const done = () => {
        if (settled) return;
        settled = true;
        resolve();
      };

      audio.addEventListener("ended", done, { once: true });
      audio.addEventListener("error", () => window.setTimeout(done, 400), { once: true });
      window.setTimeout(done, 20_000);

      const tryPlay = () => {
        if (playStarted || settled) return;
        playStarted = true;
        void audio.play().then(undefined, () => {
          // HTMLAudio blocked — fall through to browser speech if we have text.
          if (opts?.spokenPhrase && "speechSynthesis" in window) {
            void speakWithBrowser(opts.spokenPhrase).then(done);
            return;
          }
          window.setTimeout(() => {
            void audio.play().then(undefined, () => window.setTimeout(done, 1200));
          }, 50);
        });
      };

      if (audio.readyState >= 2) tryPlay();
      else {
        audio.addEventListener("canplaythrough", tryPlay, { once: true });
        window.setTimeout(tryPlay, 400);
      }
    });
    return;
  }

  // No remote TTS audio — speak the sample with the browser voice.
  if (opts?.spokenPhrase && (opts.useBrowserSpeech || true) && "speechSynthesis" in window) {
    await speakWithBrowser(opts.spokenPhrase);
    return;
  }
  await sleep(1600);
}

function speakWithBrowser(text: string): Promise<void> {
  return new Promise((resolve) => {
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      resolve();
    };
    try {
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.rate = 1;
      u.pitch = 1;
      u.volume = 1;
      u.onend = done;
      u.onerror = done;
      // Chrome sometimes needs a tick after cancel before speak works again.
      window.setTimeout(() => {
        window.speechSynthesis.speak(u);
      }, 40);
      window.setTimeout(done, Math.min(20_000, 800 + text.length * 70));
    } catch {
      done();
    }
  });
}

export function ScribPage() {
  const providers = useQuery({ queryKey: ["providers"], queryFn: api.providers });
  const [mode, setMode] = useState("concise");
  const [busy, setBusy] = useState(false);
  const [recording, setRecording] = useState(false);
  const [phase, setPhase] = useState<"idle" | "demo" | "ptt">("idle");
  const [error, setError] = useState<string | null>(null);
  const [stages, setStages] = useState<DemoStage[]>([]);
  const [activeStageId, setActiveStageId] = useState<string | null>(null);
  const [completedStageIds, setCompletedStageIds] = useState<string[]>([]);
  const [result, setResult] = useState<(FinishResult | DictateResult) | null>(null);
  const [spokenPhrase, setSpokenPhrase] = useState<string | null>(null);
  const [demoMode, setDemoMode] = useState<"live" | "simulated" | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const mediaRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const objectUrlRef = useRef<string | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);

  const sttProvider = useMemo(
    () => pickPreferred(providers.data?.providers, "batch_stt"),
    [providers.data],
  );
  const cleanupProvider = useMemo(() => {
    const id = pickPreferred(providers.data?.providers, "llm");
    // PyAI has no chat LLM; mock used to dump "Mock analysis for: <prompt>" into the field.
    return id === "mock" ? "local" : id;
  }, [providers.data]);
  const ttsProvider = useMemo(
    () => pickPreferred(providers.data?.providers, "tts"),
    [providers.data],
  );

  useEffect(() => {
    return () => {
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
      void audioCtxRef.current?.close().catch(() => undefined);
    };
  }, []);

  async function runDemo() {
    // Unlock audio in the same turn as the click — before any network wait.
    await unlockAudioPlayback(audioCtxRef);

    setBusy(true);
    setPhase("demo");
    setError(null);
    setResult(null);
    setSpokenPhrase(null);
    setDemoMode(null);
    setStages(DEMO_PIPELINE.map((s) => ({ ...s })));
    setCompletedStageIds([]);
    setActiveStageId("speak");

    try {
      // 1) Speak first
      setStages((prev) =>
        prev.map((s) =>
          s.id === "speak" ? { ...s, detail: `${ttsProvider} · synthesizing…` } : s,
        ),
      );
      const speak = await api.scribDemoSpeak({ ttsProvider });
      setSpokenPhrase(speak.spokenPhrase);
      setDemoMode(speak.demoMode);
      setStages((prev) =>
        prev.map((s) => (s.id === "speak" ? { ...speak.stage, detail: speak.stage.detail ?? "Playing…" } : s)),
      );

      // 2) Play audio while Speak is active — only then advance the pipeline
      setStages((prev) =>
        prev.map((s) =>
          s.id === "speak"
            ? {
                ...s,
                detail:
                  speak.demoMode === "live"
                    ? "Playing sample utterance…"
                    : (speak.stage.detail ?? "Simulated speech…"),
              }
            : s,
        ),
      );
      await playAndWait(speak.audioBase64, speak.audioFormat, audioRef, objectUrlRef, {
        spokenPhrase: speak.spokenPhrase,
        useBrowserSpeech: speak.useBrowserSpeech || !speak.audioBase64,
      });
      setCompletedStageIds(["speak"]);

      // 3) Hear + cleanup
      setActiveStageId("hear");
      setStages((prev) =>
        prev.map((s) =>
          s.id === "hear" ? { ...s, detail: `${sttProvider} · transcribing…` } : s,
        ),
      );
      const out = await api.scribDemoFinish({
        appName: DEMO_APP,
        mode,
        sttProvider,
        cleanupProvider,
        audioBase64: speak.audioBase64,
        audioFormat: speak.audioFormat,
        demoMode: speak.demoMode,
      });

      const hear = out.stages.find((s) => s.id === "hear");
      const cleanup = out.stages.find((s) => s.id === "cleanup");
      const insert = out.stages.find((s) => s.id === "insert");
      setStages((prev) =>
        prev.map((s) => {
          if (s.id === "hear" && hear) return hear;
          if (s.id === "cleanup" && cleanup) return cleanup;
          if (s.id === "insert" && insert) return insert;
          return s;
        }),
      );
      setCompletedStageIds(["speak", "hear"]);
      setActiveStageId("cleanup");
      await sleep(350);
      setCompletedStageIds(["speak", "hear", "cleanup"]);
      setActiveStageId("insert");
      await sleep(250);
      setCompletedStageIds(["speak", "hear", "cleanup", "insert"]);
      setActiveStageId(null);

      setDemoMode(out.demoMode);
      setResult(out);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setActiveStageId(null);
    } finally {
      setBusy(false);
      setPhase("idle");
    }
  }

  async function startPtt() {
    setError(null);
    setPhase("ptt");
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
    const finish = () => {
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", finish);
      if (mediaRef.current) {
        mediaRef.current.stop();
        mediaRef.current = null;
      }
    };
    rec.onstop = async () => {
      stream.getTracks().forEach((t) => t.stop());
      setRecording(false);
      setBusy(true);
      setStages([
        { id: "hear", label: "Transcribe mic…", detail: sttProvider },
        { id: "cleanup", label: "Cleanup…", detail: cleanupProvider },
      ]);
      setActiveStageId("hear");
      setCompletedStageIds([]);
      try {
        const blob = new Blob(chunksRef.current, { type: mime?.split(";")[0] ?? "audio/webm" });
        const file = await ensureWavCompatible(new File([blob], "recording.webm", { type: blob.type || "audio/webm" }));
        const { audioBase64, audioFormat } = await fileToBase64(file);
        if (audioBase64.length > 8_000_000) {
          throw new Error("Recording too long/large after encode. Hold for a shorter clip (under ~30s).");
        }
        const out = await api.scribTranscribe({
          audioBase64,
          format: audioFormat,
          appName: DEMO_APP,
          mode,
          sttProvider,
          cleanupProvider,
        });
        setStages(out.stages ?? []);
        setCompletedStageIds(["hear", "cleanup", "insert"]);
        setActiveStageId(null);
        setDemoMode(null);
        setSpokenPhrase(null);
        setResult(out);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        setStages([]);
      } finally {
        setBusy(false);
        setPhase("idle");
      }
    };
    mediaRef.current = rec;
    rec.start();
    setRecording(true);
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", finish);
  }

  return (
    <div>
      <PageHeader
        title="Scrib"
        description="Hold to talk for live dictation — or Try demo for the guided walkthrough."
        actions={
          <div className="flex flex-wrap gap-2">
            <Button
              variant={recording ? "danger" : "primary"}
              disabled={busy && !recording}
              onPointerDown={(e) => {
                if (recording || busy) return;
                e.preventDefault();
                void startPtt();
              }}
            >
              {recording ? "Release to send…" : "Hold to talk"}
            </Button>
            <Button
              variant="secondary"
              disabled={busy || recording}
              onClick={() => void runDemo()}
            >
              {busy && phase === "demo" ? "Running demo…" : "Try demo"}
            </Button>
          </div>
        }
      />

      <div className="grid gap-5 lg:grid-cols-2">
        <section className="panel space-y-3 p-4">
          <p className="text-sm text-ink-600">
            {recording
              ? "Listening… release when done."
              : "Hold the button and speak. Scrib transcribes, cleans for Slack, and shows before → after."}
          </p>
          <ol className="list-decimal space-y-1 pl-4 text-xs text-ink-500">
            <li>Hold to talk with your mic (or Try demo for a sample).</li>
            <li>Watch Speak → Hear → cleanup in the pipeline.</li>
            <li>Copy the cleaned text into wherever you were typing.</li>
          </ol>
          <button
            type="button"
            className="text-[11px] text-ink-500 underline-offset-2 hover:text-ink-800 hover:underline"
            onClick={() => setShowSettings((v) => !v)}
          >
            {showSettings ? "Hide settings" : "Settings"}
          </button>
          {showSettings ? (
            <div className="space-y-3 border-t border-ink-100 pt-3">
              <div>
                <Label>Cleanup mode</Label>
                <Select value={mode} onChange={(e) => setMode(e.target.value)}>
                  {["raw", "light", "professional", "concise", "custom"].map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="rounded-lg border border-ink-100 bg-ink-50 px-3 py-2 font-mono text-[11px] text-ink-600">
                TTS={ttsProvider} · STT={sttProvider} · cleanup={cleanupProvider}
                {demoMode ? ` · demo=${demoMode}` : ""}
              </div>
            </div>
          ) : null}
          {spokenPhrase ? (
            <div className="text-xs text-ink-500">
              Demo said: <span className="font-medium text-ink-700">“{spokenPhrase}”</span>
            </div>
          ) : null}
          {error ? <div className="text-sm text-status-block">{error}</div> : null}
        </section>

        <section className="space-y-4">
          {(busy || stages.length > 0) && (
            <div className="panel p-4">
              <h3 className="mb-3 text-sm font-semibold">Pipeline</h3>
              <DemoStages
                stages={stages}
                running={busy && phase !== "demo"}
                activeId={phase === "demo" || completedStageIds.length ? activeStageId : undefined}
                completedIds={phase === "demo" || completedStageIds.length ? completedStageIds : undefined}
              />
            </div>
          )}
          {!result && !busy ? (
            <EmptyState
              title="No dictation yet"
              body="Hold to talk with your mic, or Try demo to hear a sample and see cleaned Slack-ready text."
              actionLabel="Try demo"
              onAction={() => void runDemo()}
            />
          ) : result ? (
            <>
              <div className="panel p-4 animate-fade-up">
                <div className="flex flex-wrap gap-2">
                  <StatusBadge status={result.status} />
                  <span className="font-mono text-[11px] text-ink-400">{result.runId}</span>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2 font-mono text-[11px] text-ink-500">
                  <div>STT {result.latency?.sttMs ? formatMs(result.latency.sttMs) : "n/a"}</div>
                  <div>Cleanup {formatMs(result.latency?.cleanupMs)}</div>
                  <div>Dictionary {formatMs(result.latency?.dictionaryMs)}</div>
                  <div>Total {formatMs(result.latency?.totalMs)}</div>
                </div>
              </div>
              <div className="panel p-4">
                <h3 className="text-sm font-semibold">Before → After (insert target)</h3>
                <pre className="mt-2 whitespace-pre-wrap rounded-lg bg-ink-50 p-3 text-sm text-ink-600">{result.raw}</pre>
                <pre className="mt-2 whitespace-pre-wrap rounded-lg bg-ink-950 p-3 text-sm text-ink-100">{result.cleaned}</pre>
                <div className="mt-2 text-xs text-ink-400">mode={result.mode}</div>
              </div>
            </>
          ) : null}
        </section>
      </div>
    </div>
  );
}
