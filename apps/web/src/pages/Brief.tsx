import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { PageHeader, EmptyState } from "@/components/EmptyState";
import { DemoStages, type DemoStage } from "@/components/DemoStages";
import { MeetingBrief } from "@/components/MeetingBrief";
import { Button, Input, Label, Select, Textarea } from "@/components/ui";
import { api } from "@/lib/api";
import { pickPreferred, sortProviders } from "@/lib/providers";
import {
  prepareForStt,
  blobLooksSilent,
  isLikelySttHallucination,
  displayFileName,
} from "@/lib/audio";
import { RecordingUploadButton } from "@/components/RecordingUpload";
import { extractMeetingUrl } from "@/lib/meetingUrl";
import {
  unlockAudioPlayback,
  playAndWait,
  sleep,
  speakDemoLine,
  stopDemoSpeech,
} from "@/lib/demoAudio";
import {
  SimulatedMeetStage,
  BRIEF_DEMO_LINES,
  BRIEF_PARTICIPANTS,
  type MeetPhase,
} from "@/components/SimulatedMeet";
import {
  SimulatedSharePicker,
  CaptureSourcesHud,
  type CaptureSource,
  type SharePhase,
} from "@/components/SimulatedCapture";

type Result = Awaited<ReturnType<typeof api.briefAnalyze>>;

const DEMO_PIPELINE: DemoStage[] = [
  { id: "join", label: "People joining Meet…", detail: "lobby" },
  { id: "share", label: "Share tab + mic…", detail: "waiting" },
  { id: "capture", label: "Capturing tab + mic…", detail: "waiting" },
  { id: "summary", label: "Summary (meeting notes)", detail: "Waiting…" },
  { id: "memory", label: "Store in meeting memory", detail: "Waiting…" },
];

export function BriefPage() {
  const [params, setSearchParams] = useSearchParams();
  const providers = useQuery({ queryKey: ["providers"], queryFn: api.providers });
  const [transcript, setTranscript] = useState("");
  const [meetUrl, setMeetUrl] = useState("https://meet.google.com/new");
  const [mode, setMode] = useState("Planning");
  const [query, setQuery] = useState("launch");
  const [llmProvider, setLlmProvider] = useState("mock");
  const [sttProvider, setSttProvider] = useState("mock");
  const [busy, setBusy] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [chunkBusy, setChunkBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [captureNote, setCaptureNote] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [search, setSearch] = useState<Awaited<ReturnType<typeof api.briefSearch>> | null>(null);
  const [stages, setStages] = useState<DemoStage[]>([]);
  const [showCaptureHelp, setShowCaptureHelp] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [activeStageId, setActiveStageId] = useState<string | null>(null);
  const [completedStageIds, setCompletedStageIds] = useState<string[]>([]);
  const [demoMode, setDemoMode] = useState<"live" | "simulated" | null>(null);
  const [uploading, setUploading] = useState(false);
  const [meetPhase, setMeetPhase] = useState<MeetPhase>("idle");
  const [meetPresent, setMeetPresent] = useState<string[]>([]);
  const [activeSpeaker, setActiveSpeaker] = useState<string | null>(null);
  const [liveCaption, setLiveCaption] = useState("");
  const [meetStatus, setMeetStatus] = useState("");
  const [sharePhase, setSharePhase] = useState<SharePhase>("idle");
  const [captureSource, setCaptureSource] = useState<CaptureSource>(null);

  const mediaRef = useRef<MediaRecorder | null>(null);
  const demoAbort = useRef(false);
  const streamRef = useRef<MediaStream | null>(null);
  const chunkQueue = useRef<Promise<void>>(Promise.resolve());
  const segmentTimerRef = useRef<number | null>(null);
  const stoppingRef = useRef(false);
  const captureOptsRef = useRef<{ speakerLabel: string; diarize: boolean }>({
    speakerLabel: "Them",
    diarize: false,
  });
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const objectUrlRef = useRef<string | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);

  const llmOptions = useMemo(
    () =>
      sortProviders(
        providers.data?.providers.filter(
          (p) => p.capabilities.includes("llm") || p.capabilities.includes("structured_output"),
        ) ?? [],
      ),
    [providers.data],
  );
  const sttOptions = useMemo(
    () =>
      sortProviders(providers.data?.providers.filter((p) => p.capabilities.includes("batch_stt")) ?? []),
    [providers.data],
  );
  const ttsProvider = useMemo(
    () => pickPreferred(providers.data?.providers ?? [], "tts"),
    [providers.data],
  );

  useEffect(() => {
    if (!providers.data) return;
    setLlmProvider(pickPreferred(providers.data.providers, "llm"));
    setSttProvider(pickPreferred(providers.data.providers, "batch_stt"));
  }, [providers.data]);

  useEffect(() => {
    const raw = params.get("capture");
    if (raw == null) return;
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete("capture");
        return next;
      },
      { replace: true },
    );
    if (raw === "1" || raw === "") {
      setCaptureNote(
        "Chrome extension opened Meet. Join the room, then Capture Meet audio and share that Meet tab (tab audio on). No bot joins.",
      );
      setShowCaptureHelp(true);
      return;
    }
    let decoded = raw;
    try {
      decoded = decodeURIComponent(raw);
    } catch {
      /* keep raw */
    }
    const url = extractMeetingUrl(decoded) ?? decoded;
    setMeetUrl(url);
    setCaptureNote(
      "Meet from the Chrome extension. Click Capture Meet audio and share that Meet tab with “Also share tab audio” on.",
    );
    setShowCaptureHelp(true);
  }, [params, setSearchParams]);

  useEffect(() => {
    if ("speechSynthesis" in window) {
      window.speechSynthesis.getVoices();
      window.speechSynthesis.onvoiceschanged = () => window.speechSynthesis.getVoices();
    }
    return () => {
      demoAbort.current = true;
      stoppingRef.current = true;
      stopDemoSpeech();
      if (segmentTimerRef.current != null) window.clearInterval(segmentTimerRef.current);
      mediaRef.current?.stop();
      streamRef.current?.getTracks().forEach((t) => t.stop());
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
      void audioCtxRef.current?.close().catch(() => undefined);
    };
  }, []);

  async function runDemo() {
    demoAbort.current = false;
    await unlockAudioPlayback(audioCtxRef);
    setBusy(true);
    setError(null);
    setResult(null);
    setSearch(null);
    setTranscript("");
    setCaptureNote(null);
    setDemoMode(null);
    setMode("Planning");
    setLiveCaption("");
    setActiveSpeaker(null);
    setMeetPresent([]);
    setMeetStatus("Opening Meet…");
    setMeetPhase("joining");
    setSharePhase("idle");
    setCaptureSource(null);
    setChunkBusy(false);
    setCapturing(false);
    setStages(DEMO_PIPELINE.map((s) => ({ ...s })));
    setCompletedStageIds([]);
    setActiveStageId("join");

    try {
      const ttsId = ttsProvider === "mock" ? undefined : ttsProvider;
      const fetchTurn = (turn: (typeof BRIEF_DEMO_LINES)[number]) =>
        api.calliqDemoSpeakTurn({
          speaker: turn.speaker === "them" ? "customer" : "rep",
          text: turn.text,
          ttsProvider: ttsId,
        });

      let pending = fetchTurn(BRIEF_DEMO_LINES[0]!);

      await sleep(400);
      if (demoAbort.current) return;
      setMeetPresent(["me"]);
      setMeetStatus("You joined");
      setStages((prev) => prev.map((s) => (s.id === "join" ? { ...s, detail: "You joined" } : s)));

      await sleep(650);
      if (demoAbort.current) return;
      setMeetPresent(["me", "them"]);
      setMeetStatus("Jordan joined");
      setStages((prev) => prev.map((s) => (s.id === "join" ? { ...s, detail: "Jordan joined" } : s)));

      await sleep(400);
      if (demoAbort.current) return;
      setActiveStageId("share");
      setCompletedStageIds(["join"]);
      setSharePhase("picker");
      setCapturing(true);
      setMeetStatus("Choose Chrome Tab + share tab audio");
      setStages((prev) => prev.map((s) => (s.id === "share" ? { ...s, detail: "Chrome Tab picker" } : s)));

      await sleep(1600);
      if (demoAbort.current) return;
      setSharePhase("mic");
      setMeetStatus("Allow microphone for Me: labels");
      setStages((prev) => prev.map((s) => (s.id === "share" ? { ...s, detail: "mic permission" } : s)));

      await sleep(900);
      if (demoAbort.current) return;
      setSharePhase("capturing");
      setCapturing(true);
      setMeetPhase("in_call");
      setMeetStatus("Capturing tab audio + mic");
      setCaptureNote("Live STT · Them: (Meet tab) · Me: (mic)");
      setActiveStageId("capture");
      setCompletedStageIds(["join", "share"]);
      setStages((prev) =>
        prev.map((s) =>
          s.id === "share"
            ? { ...s, detail: "tab + mic shared" }
            : s.id === "capture"
              ? { ...s, detail: "live · tab + mic" }
              : s,
        ),
      );

      const lines: string[] = [];
      let liveTts = false;
      for (let i = 0; i < BRIEF_DEMO_LINES.length; i++) {
        if (demoAbort.current) return;
        const turn = BRIEF_DEMO_LINES[i]!;
        const source: CaptureSource = turn.speaker === "them" ? "tab" : "mic";
        const nextPending =
          i + 1 < BRIEF_DEMO_LINES.length ? fetchTurn(BRIEF_DEMO_LINES[i + 1]!) : null;
        const audio = await pending;
        if (nextPending) pending = nextPending;
        if (audio.demoMode === "live" && audio.audioBase64) liveTts = true;

        setCaptureSource(source);
        setChunkBusy(true);
        setActiveSpeaker(turn.speaker);
        setLiveCaption(`${turn.label}: ${turn.text}`);
        setCaptureNote(
          source === "tab"
            ? `Live STT via tab audio · Them: (Meet tab)`
            : `Live STT via microphone · Me: (this browser)`,
        );
        setStages((prev) =>
          prev.map((s) =>
            s.id === "capture"
              ? { ...s, detail: `${source} · ${i + 1}/${BRIEF_DEMO_LINES.length}` }
              : s,
          ),
        );

        if (audio.audioBase64 && audio.audioFormat) {
          await playAndWait(audio.audioBase64, audio.audioFormat, audioRef, objectUrlRef, {
            spokenPhrase: turn.text,
            useBrowserSpeech: Boolean(audio.useBrowserSpeech),
          });
        } else {
          await speakDemoLine(turn.text, {
            pitch: turn.speaker === "them" ? 1.15 : 0.92,
            rate: 1.02,
            voiceHint: turn.speaker === "them" ? "female" : "male",
          });
        }

        await sleep(280);
        lines.push(turn.line);
        setTranscript(lines.join("\n"));
        setChunkBusy(false);
        setActiveSpeaker(null);
        setCaptureSource(null);
        await sleep(140);
      }

      if (demoAbort.current) return;
      setMeetPhase("ended");
      setSharePhase("done");
      setCapturing(false);
      setChunkBusy(false);
      setCaptureSource(null);
      setMeetStatus("Capture stopped — writing summary");
      setLiveCaption("");
      setDemoMode(liveTts ? "live" : "simulated");
      setCaptureNote("Tab + mic capture complete · transcript labeled Me / Them");
      const text = lines.join("\n");
      setCompletedStageIds(["join", "share", "capture"]);
      setActiveStageId("summary");
      setStages((prev) =>
        prev.map((s) =>
          s.id === "capture"
            ? { ...s, detail: `${lines.length} lines` }
            : s.id === "summary"
              ? { ...s, detail: "running…" }
              : s,
        ),
      );

      const out = await api.briefAnalyze({
        transcriptText: text,
        mode: "Planning",
        llmProvider,
        sttProvider,
        title: "Launch planning",
      });
      if (demoAbort.current) return;
      setResult(out);
      setStages((prev) =>
        prev.map((s) => {
          const summary = out.stages?.find((st) => st.id === "summary");
          const mem = out.stages?.find((st) => st.id === "memory");
          if (s.id === "summary" && summary) return summary;
          if (s.id === "memory" && mem) return mem;
          return s;
        }),
      );
      setCompletedStageIds(["join", "share", "capture", "summary"]);
      setActiveStageId("memory");
      await sleep(250);
      setCompletedStageIds(["join", "share", "capture", "summary", "memory"]);
      setActiveStageId(null);
      setSearch(await api.briefSearch(query || "launch"));
    } catch (e) {
      stopDemoSpeech();
      setError(e instanceof Error ? e.message : String(e));
      setActiveStageId(null);
      setStages([]);
      setMeetPhase("idle");
      setMeetPresent([]);
      setSharePhase("idle");
      setCapturing(false);
      setChunkBusy(false);
      setCaptureSource(null);
    } finally {
      setBusy(false);
      setActiveSpeaker(null);
      setChunkBusy(false);
      window.setTimeout(() => {
        setMeetPhase((p) => (p === "ended" ? "idle" : p));
        setMeetPresent([]);
        setSharePhase((p) => (p === "done" ? "idle" : p));
      }, 1400);
    }
  }

  function stopDemoCapture() {
    demoAbort.current = true;
    stopDemoSpeech();
    setCapturing(false);
    setChunkBusy(false);
    setCaptureSource(null);
    setSharePhase("done");
    setMeetPhase("ended");
    setBusy(false);
    setCaptureNote("Demo capture stopped. Review transcript, then End meeting → notes.");
  }

  async function uploadRecording(file: File) {
    demoAbort.current = true;
    stopDemoSpeech();
    setMeetPhase("idle");
    setSharePhase("idle");
    setCapturing(false);
    setResult(null);
    setSearch(null);
    setError(null);
    setBusy(true);
    setUploading(true);
    setTranscript("");
    setCaptureNote(`Hear + summary · ${displayFileName(file.name)}`);
    setStages([
      { id: "hear", label: "Hear — transcribing recording…", detail: displayFileName(file.name) },
      { id: "summary", label: "Summary — meeting notes…", detail: "waiting" },
      { id: "memory", label: "Store in meeting memory…", detail: "waiting" },
    ]);
    setActiveStageId("hear");
    setCompletedStageIds([]);
    try {
      const prepared = await prepareForStt(file);
      if (prepared.audioBase64.length > 18_000_000) {
        throw new Error("Recording too large after encode (max ~12MB).");
      }
      const out = await api.briefAnalyze({
        audioBase64: prepared.audioBase64,
        audioFormat: prepared.audioFormat,
        mode,
        llmProvider,
        sttProvider,
        title: displayFileName(file.name).replace(/\.[^.]+$/, "") || "Uploaded recording",
      });
      const text = (typeof out.transcript === "string" ? out.transcript : "").trim();
      if (!text) throw new Error("No speech detected in that recording.");
      setTranscript(text);
      setCaptureNote(`Hear via ${out.sttProvider ?? sttProvider}. Summary ready.`);
      setStages(out.stages ?? []);
      setResult(out);
      setCompletedStageIds((out.stages ?? []).map((s) => s.id));
      setActiveStageId(null);
      setSearch(await api.briefSearch(query || "launch"));
      setBusy(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStages([]);
      setActiveStageId(null);
      setCaptureNote(null);
      setBusy(false);
    } finally {
      setUploading(false);
    }
  }

  async function analyze(text = transcript) {
    if (!text.trim()) {
      setError("Capture a Meet, upload a recording, or paste a transcript first.");
      return;
    }
    setBusy(true);
    setError(null);
    setStages([
      { id: "hear", label: "Hear (transcript ready)", detail: "inline" },
      { id: "summary", label: "Summary — meeting notes…", detail: llmProvider },
      { id: "memory", label: "Store in meeting memory…", detail: "local" },
    ]);
    try {
      const out = await api.briefAnalyze({
        transcriptText: text,
        mode,
        llmProvider,
        sttProvider,
      });
      setStages(out.stages ?? []);
      setResult(out);
      setSearch(await api.briefSearch(query || "launch"));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function doSearch() {
    setSearch(await api.briefSearch(query));
  }

  function openMeet() {
    setTranscript("");
    setResult(null);
    setStages([]);
    setError(null);
    setSearch(null);
    window.open(meetUrl.trim() || "https://meet.google.com/new", "_blank", "noopener,noreferrer");
    setCaptureNote("Meet opened. Join, then Capture Meet audio — share that Chrome tab with “Share tab audio” on. No bot joins the call.");
  }

  async function processChunk(blob: Blob) {
    if (blob.size < 1500) return;
    const { speakerLabel } = captureOptsRef.current;
    setChunkBusy(true);
    try {
      // Near-silence → STT invents “you” / “thank you”. Skip before STT.
      if (await blobLooksSilent(blob)) {
        setCaptureNote(
          "Quiet segment skipped — share the Meet Chrome Tab (not this PyAI tab) and turn on “Also share tab audio”.",
        );
        return;
      }
      const file = new File([blob], "meet-chunk.webm", { type: blob.type || "audio/webm" });
      const { audioBase64, audioFormat } = await prepareForStt(file);
      if (audioBase64.length > 8_000_000) return;
      const out = await api.sttTranscribe({
        audioBase64,
        format: audioFormat,
        provider: sttProvider,
        diarize: false,
        speakerLabel,
        prompt:
          "Live Google Meet discussion. Label only Me or Them style turns. Transcribe clear speech only. If silent, return empty.",
      });
      const line = out.text.trim();
      if (!line || isLikelySttHallucination(line)) {
        setCaptureNote(
          `Skipped filler STT (${out.provider}) — waiting for real speech. Keep Meet tab audio shared.`,
        );
        return;
      }
      setTranscript((prev) => {
        const last = prev.trim().split("\n").pop()?.trim().toLowerCase() ?? "";
        if (last && last === line.toLowerCase()) return prev;
        return prev.trim() ? `${prev.trim()}\n${line}` : line;
      });
      setCaptureNote(`Live STT via ${out.provider} · ${speakerLabel}: (Me/Them)…`);
      setError(null);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setCaptureNote(`Skipped a segment (${msg.slice(0, 80)}). Still listening…`);
    } finally {
      setChunkBusy(false);
    }
  }

  async function beginRecording(
    stream: MediaStream,
    note: string,
    opts: { speakerLabel: string; diarize: boolean; segmentMs?: number },
  ) {
    const audioTracks = stream.getAudioTracks();
    if (!audioTracks.length) {
      stream.getTracks().forEach((t) => t.stop());
      throw new Error("NO_AUDIO_TRACK");
    }
    captureOptsRef.current = { speakerLabel: opts.speakerLabel, diarize: opts.diarize };
    streamRef.current = stream;
    stoppingRef.current = false;
    const audioOnly = new MediaStream(audioTracks);
    const mime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
      ? "audio/webm;codecs=opus"
      : MediaRecorder.isTypeSupported("audio/webm")
        ? "audio/webm"
        : undefined;
    // Longer chunks help diarization; shorter for mic-only.
    const segmentMs = opts.segmentMs ?? (opts.diarize ? 15_000 : 5_000);

    const startSegment = () => {
      if (stoppingRef.current || !streamRef.current) return;
      const rec = new MediaRecorder(audioOnly, mime ? { mimeType: mime } : undefined);
      mediaRef.current = rec;
      rec.ondataavailable = (e) => {
        if (!e.data.size) return;
        chunkQueue.current = chunkQueue.current.then(() => processChunk(e.data)).catch(() => undefined);
      };
      rec.onerror = () => {
        setCaptureNote("Recorder hiccup — restarting segment…");
      };
      try {
        rec.start();
      } catch {
        return;
      }
    };

    startSegment();
    segmentTimerRef.current = window.setInterval(() => {
      const rec = mediaRef.current;
      if (!rec || rec.state !== "recording") {
        startSegment();
        return;
      }
      try {
        rec.stop();
      } catch {
        /* ignore */
      }
      window.setTimeout(() => startSegment(), 40);
    }, segmentMs);

    for (const track of stream.getTracks()) {
      track.addEventListener("ended", () => {
        void stopMeetCapture();
      });
    }
    setCapturing(true);
    setError(null);
    setCaptureNote(note);
  }

  async function startMeetCapture() {
    setError(null);
    setResult(null);
    setStages([]);
    setTranscript("");
    setCaptureNote(null);
    try {
      const display = await navigator.mediaDevices.getDisplayMedia({
        video: {
          displaySurface: "browser",
        } as MediaTrackConstraints,
        audio: true,
        ...({
          preferCurrentTab: false,
          selfBrowserSurface: "include",
          surfaceSwitching: "include",
          systemAudio: "include",
        } as Record<string, unknown>),
      });

      try {
        await beginRecording(
          display,
          "Capturing Meet tab audio as Them: (others). Mic capture uses Me:.",
          { speakerLabel: "Them", diarize: false, segmentMs: 5_000 },
        );
      } catch (e) {
        display.getTracks().forEach((t) => t.stop());
        if (e instanceof Error && e.message === "NO_AUDIO_TRACK") {
          setError(
            "That share had no audio. In Chrome’s picker: choose “Chrome Tab” → select the Meet tab → turn ON “Also share tab audio”. Window/Entire Screen usually won’t capture Meet sound on Mac.",
          );
          setCaptureNote("Tip: use Having trouble? → Capture microphone for your voice only (labeled You).");
          return;
        }
        throw e;
      }
    } catch (e) {
      if (e instanceof DOMException && e.name === "NotAllowedError") {
        setError("Screen share was blocked or cancelled.");
        return;
      }
      setError(e instanceof Error ? e.message : "Could not start tab capture. Use Chrome on desktop.");
    }
  }

  async function startMicCapture() {
    setError(null);
    setResult(null);
    setStages([]);
    setTranscript("");
    try {
      const mic = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
        },
      });
      await beginRecording(
        mic,
        "Capturing microphone as Me:. Others need Meet tab capture (Them:).",
        { speakerLabel: "Me", diarize: false, segmentMs: 5_000 },
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Microphone permission denied.");
    }
  }

  async function stopMeetCapture() {
    stoppingRef.current = true;
    if (segmentTimerRef.current != null) {
      window.clearInterval(segmentTimerRef.current);
      segmentTimerRef.current = null;
    }
    const rec = mediaRef.current;
    mediaRef.current = null;
    if (rec && rec.state !== "inactive") {
      await new Promise<void>((resolve) => {
        rec.addEventListener("stop", () => resolve(), { once: true });
        try {
          rec.stop();
        } catch {
          resolve();
        }
        window.setTimeout(resolve, 500);
      });
    }
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setCapturing(false);
    await chunkQueue.current;
    setCaptureNote((n) => n?.includes("Still listening") ? "Capture stopped. Review transcript, then End meeting → notes." : (n ?? "Capture stopped. Review transcript, then End meeting → notes."));
  }

  async function endMeetingNotes() {
    if (sharePhase !== "idle") stopDemoCapture();
    else await stopMeetCapture();
    await analyze(transcript);
  }

  return (
    <div>
      <PageHeader
        title="Brief"
        description="Hear transcribes. Summary writes decisions, actions, and a keepable brief."
        actions={
          <div className="flex flex-wrap gap-2">
            {!capturing ? (
              <Button disabled={busy || meetPhase !== "idle"} onClick={() => void startMeetCapture()}>
                Capture Meet audio
              </Button>
            ) : (
              <Button
                variant="danger"
                onClick={() => {
                  if (sharePhase !== "idle") stopDemoCapture();
                  else void stopMeetCapture();
                }}
              >
                Stop capture
              </Button>
            )}
            <Button
              variant="secondary"
              disabled={busy || capturing}
              onClick={() => void runDemo()}
            >
              {busy && meetPhase !== "idle" ? "Demo running…" : "Try sample demo"}
            </Button>
            <RecordingUploadButton
              variant="ghost"
              disabled={busy || capturing}
              busy={uploading}
              onInvalid={(msg) => setError(msg)}
              onFile={(file) => void uploadRecording(file)}
            />
            <Button
              variant="ghost"
              disabled={busy || capturing || !transcript.trim()}
              onClick={() => void (capturing ? endMeetingNotes() : analyze())}
            >
              {busy ? "Summarizing…" : "End meeting → notes"}
            </Button>
          </div>
        }
      />

      {meetPhase !== "idle" ? (
        <div className="mb-5">
          <SimulatedMeetStage
            phase={meetPhase}
            present={meetPresent}
            activeSpeaker={activeSpeaker}
            caption={liveCaption}
            statusLine={meetStatus}
            participants={BRIEF_PARTICIPANTS}
            title="Launch planning"
            meetUrl="meet.google.com/demo-brief"
          />
        </div>
      ) : null}

      <SimulatedSharePicker phase={sharePhase} meetTitle="Launch planning" />
      {sharePhase === "capturing" || sharePhase === "done" ? (
        <CaptureSourcesHud
          active={captureSource}
          transcribing={chunkBusy && sharePhase === "capturing"}
          note={captureNote}
        />
      ) : null}

      <section className="panel mb-5 space-y-3 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <h2 className="text-sm font-semibold">Live Google Meet (no bot)</h2>
            <p className="mt-1 max-w-xl text-xs text-ink-500">
              Join Meet in Chrome
              {meetUrl.trim() ? (
                <>
                  {" "}
                  (
                  <button
                    type="button"
                    className="font-medium text-ink-700 underline underline-offset-2"
                    onClick={openMeet}
                  >
                    open link
                  </button>
                  )
                </>
              ) : null}
              , then capture the Meet tab with audio — or use the Chrome extension
              popup (<span className="font-medium text-ink-700">Capture this Meet in Brief</span>
              ). Transcript labels{" "}
              <span className="font-medium text-ink-700">Me:</span> (mic) and{" "}
              <span className="font-medium text-ink-700">Them:</span> (tab).
            </p>
            <button
              type="button"
              className="mt-2 text-[11px] text-ink-500 underline-offset-2 hover:text-ink-800 hover:underline"
              onClick={() => setShowCaptureHelp((v) => !v)}
            >
              {showCaptureHelp ? "Hide how to share tab audio" : "How to share tab audio"}
            </button>
          </div>
          {capturing ? (
            <Button type="button" size="sm" disabled={busy || chunkBusy} onClick={() => void endMeetingNotes()}>
              End meeting → notes
            </Button>
          ) : null}
        </div>

        {showCaptureHelp ? (
          <div className="space-y-2 rounded-lg border border-ink-100 bg-ink-50 px-3 py-2 text-xs text-ink-600">
            <ol className="list-decimal space-y-1 pl-4">
              <li>
                In the picker choose <span className="font-medium text-ink-700">Chrome Tab</span> (not Window /
                Entire Screen).
              </li>
              <li>
                Select the Meet tab and enable{" "}
                <span className="font-medium text-ink-700">Also share tab audio</span>.
              </li>
              <li>
                On Mac, Window / Entire Screen often has no Meet sound — tab share is required.
              </li>
            </ol>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={busy || capturing}
              onClick={() => void startMicCapture()}
            >
              Capture microphone only
            </Button>
          </div>
        ) : null}

        <div>
          <Label>Meet link (optional)</Label>
          <Input
            value={meetUrl}
            onChange={(e) => setMeetUrl(e.target.value)}
            placeholder="https://meet.google.com/xxx-xxxx-xxx"
          />
        </div>
        {captureNote && sharePhase === "idle" ? (
          <p className="font-mono text-[11px] text-ink-500">
            {captureNote}
            {chunkBusy ? " · transcribing…" : ""}
          </p>
        ) : null}
        {error ? (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-ink-800">
            <div className="font-medium text-status-block">{error}</div>
            <div className="mt-2 flex flex-wrap gap-2">
              <Button type="button" size="sm" onClick={() => void startMeetCapture()}>
                Try tab share again
              </Button>
              <Button type="button" variant="secondary" size="sm" onClick={() => void startMicCapture()}>
                Use microphone instead
              </Button>
            </div>
          </div>
        ) : null}
      </section>

      <div className="grid gap-5 lg:grid-cols-2">
        <section className="panel space-y-3 p-4">
          <div>
            <Label>Live / imported transcript</Label>
            <Textarea
              value={transcript}
              onChange={(e) => setTranscript(e.target.value)}
              className="min-h-[260px] font-mono text-sm"
              placeholder="Capture a Meet, upload a recording, paste a transcript, or try the sample demo."
            />
          </div>
          <button
            type="button"
            className="text-[11px] text-ink-500 underline-offset-2 hover:text-ink-800 hover:underline"
            onClick={() => setShowSettings((v) => !v)}
          >
            {showSettings ? "Hide settings" : "Settings"}
          </button>
          {showSettings ? (
            <div className="space-y-3 border-t border-ink-100 pt-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Meeting mode</Label>
                  <Select value={mode} onChange={(e) => setMode(e.target.value)}>
                    {[
                      "1:1",
                      "Sales",
                      "Customer discovery",
                      "Investor",
                      "Standup",
                      "Interview",
                      "Planning",
                      "Brainstorm",
                      "Performance review",
                      "Custom",
                    ].map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </Select>
                </div>
                <div>
                  <Label>Summary (notes)</Label>
                  <Select value={llmProvider} onChange={(e) => setLlmProvider(e.target.value)}>
                    {llmOptions.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                        {p.configured ? "" : " (needs key)"}
                      </option>
                    ))}
                  </Select>
                </div>
              </div>
              <div>
                <Label>Hear (speech-to-text)</Label>
                <Select value={sttProvider} onChange={(e) => setSttProvider(e.target.value)}>
                  {sttOptions.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                      {p.configured ? "" : " (needs key)"}
                    </option>
                  ))}
                </Select>
                <p className="mt-1 text-[11px] text-ink-400">
                  Live capture uses Hear sync. Uploads use Hear batch + diarize, then Summary.
                </p>
              </div>
              <div>
                <h3 className="text-sm font-semibold">Meeting memory</h3>
                <div className="mt-2 flex gap-2">
                  <Input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="What did we decide about pricing?"
                  />
                  <Button variant="secondary" onClick={() => void doSearch()}>
                    Search
                  </Button>
                </div>
                {search ? (
                  <ul className="mt-3 space-y-2 text-sm">
                    {search.results.length === 0 ? <li className="text-ink-400">No hits</li> : null}
                    {search.results.map((r, i) => (
                      <li key={i} className="rounded-lg border border-ink-100 px-3 py-2">
                        <div className="font-medium">{r.answer}</div>
                        <div className="font-mono text-[10px] text-ink-400">
                          {r.meetingId} · {r.date}
                        </div>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
              {result?.privacy ? (
                <div className="rounded-lg border border-ink-100 bg-ink-50 px-3 py-2 font-mono text-[11px] text-ink-600">
                  mic=local · uploaded={result.privacy.uploadedTo} · storage={result.privacy.storage}
                </div>
              ) : null}
            </div>
          ) : null}
        </section>
        <section className="space-y-4">
          {(busy || stages.length > 0) && (
            <div className="panel p-4">
              <h3 className="mb-3 text-sm font-semibold">Pipeline</h3>
              <DemoStages
                stages={stages}
                running={busy}
                activeId={activeStageId}
                completedIds={completedStageIds}
              />
            </div>
          )}
          {!result && !busy ? (
            <EmptyState
              title="No meetings yet"
              body="Capture Meet tab audio, upload a recording for Hear + summary, or Try sample demo."
              actionLabel="Capture Meet audio"
              onAction={() => void startMeetCapture()}
            />
          ) : result ? (
            <MeetingBrief notes={result.notes} status={result.status} runId={result.runId} />
          ) : null}
        </section>
      </div>
    </div>
  );
}
