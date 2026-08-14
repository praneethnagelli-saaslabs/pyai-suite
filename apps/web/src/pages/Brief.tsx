import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { PageHeader, EmptyState } from "@/components/EmptyState";
import { DemoStages, type DemoStage } from "@/components/DemoStages";
import { MeetingBrief } from "@/components/MeetingBrief";
import { Button, Input, Label, Select, Textarea, RecDot } from "@/components/ui";
import { ErrorBanner } from "@/components/ErrorBanner";
import { FallbackNotice } from "@/components/FallbackNotice";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import { formatFallbackNote } from "@/lib/fallback";
import { pickPreferred, sortProviders } from "@/lib/providers";
import {
  prepareForStt,
  isLikelySttHallucination,
  displayFileName,
} from "@/lib/audio";
import { transcribeUploadedRecording } from "@/lib/transcribeUpload";
import { uploadEntityRecording } from "@/lib/uploadRecording";
import { recordingPlayUrl } from "@/components/RecordingPlayer";
import { RecordingUploadButton } from "@/components/RecordingUpload";
import { SampleRecordingButtons } from "@/components/SampleRecordingButtons";
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
  const queryClient = useQueryClient();
  const providers = useQuery({ queryKey: ["providers"], queryFn: api.providers });
  const meetingsQ = useQuery({ queryKey: ["brief-meetings"], queryFn: api.briefMeetings });
  const [transcript, setTranscript] = useState("");
  const [meetUrl, setMeetUrl] = useState("https://meet.google.com/new");
  const [mode, setMode] = useState("Planning");
  const [query, setQuery] = useState("");
  const [llmProvider, setLlmProvider] = useState("mock");
  const [sttProvider, setSttProvider] = useState("mock");
  const [busy, setBusy] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [chunkBusy, setChunkBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [captureNote, setCaptureNote] = useState<string | null>(null);
  const [fallbackNote, setFallbackNote] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [selectedMeetingId, setSelectedMeetingId] = useState<string | null>(null);
  const [recordingUrl, setRecordingUrl] = useState<string | null>(null);
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
  /** Real Meet capture — tab (Them) and mic (Me) can run together. */
  const [liveSources, setLiveSources] = useState({ tab: false, mic: false });

  type LiveLane = "tab" | "mic";
  type LaneHandles = {
    stream: MediaStream | null;
    media: MediaRecorder | null;
    timer: number | null;
    audioCtx: AudioContext | null;
  };
  const emptyLane = (): LaneHandles => ({
    stream: null,
    media: null,
    timer: null,
    audioCtx: null,
  });
  const lanesRef = useRef<Record<LiveLane, LaneHandles>>({
    tab: emptyLane(),
    mic: emptyLane(),
  });
  const demoAbort = useRef(false);
  const chunkQueue = useRef<Promise<void>>(Promise.resolve());
  const stoppingRef = useRef(false);
  const transcriptRef = useRef("");
  const pendingChunksRef = useRef(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const objectUrlRef = useRef<string | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const [pendingChunks, setPendingChunks] = useState(0);

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

  function writeTranscript(next: string | ((prev: string) => string)) {
    setTranscript((prev) => {
      const value = typeof next === "function" ? next(prev) : next;
      transcriptRef.current = value;
      return value;
    });
  }

  function bumpPending(delta: number) {
    pendingChunksRef.current = Math.max(0, pendingChunksRef.current + delta);
    setPendingChunks(pendingChunksRef.current);
  }

  async function refreshMeetings(selectId?: string) {
    await queryClient.invalidateQueries({ queryKey: ["brief-meetings"] });
    if (selectId) setSelectedMeetingId(selectId);
  }

  async function openPastMeeting(id: string) {
    setBusy(true);
    setError(null);
    setStages([]);
    setActiveStageId(null);
    setFallbackNote(null);
    try {
      const m = await api.briefMeeting(id);
      setSelectedMeetingId(m.id);
      writeTranscript(m.transcript || "");
      if (m.mode) setMode(m.mode);
      setRecordingUrl(
        m.hasRecording ? m.recordingUrl || recordingPlayUrl("brief", m.id) : null,
      );
      setResult({
        status: "SUCCEEDED",
        runId: m.id,
        notes: m.notes,
        transcript: m.transcript,
        privacy: { microphone: "local", uploadedTo: "stored", storage: "local" },
      });
      setCaptureNote(`Opened past meeting · ${m.title || m.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

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
      for (const lane of ["tab", "mic"] as const) {
        const h = lanesRef.current[lane];
        if (h.timer != null) window.clearInterval(h.timer);
        try {
          h.media?.stop();
        } catch {
          /* ignore */
        }
        h.stream?.getTracks().forEach((t) => t.stop());
        void h.audioCtx?.close().catch(() => undefined);
        lanesRef.current[lane] = emptyLane();
      }
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
    writeTranscript("");
    setCaptureNote(null);
    setFallbackNote(null);
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
      setMeetStatus("Them joined");
      setStages((prev) => prev.map((s) => (s.id === "join" ? { ...s, detail: "Them joined" } : s)));

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
        if (audio.fallbackNote) setFallbackNote(audio.fallbackNote);

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
        writeTranscript(lines.join("\n"));
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
      setSelectedMeetingId(out.runId);
      await refreshMeetings(out.runId);
      setSearch(null);
      setQuery("");
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
    writeTranscript("");
    setRecordingUrl(null);
    setFallbackNote(null);
    setCaptureNote(`Hear batch + diarize · ${displayFileName(file.name)}`);
    setStages([
      { id: "hear", label: "Hear — diarizing recording…", detail: displayFileName(file.name) },
      { id: "summary", label: "Summary — meeting notes…", detail: "waiting" },
      { id: "memory", label: "Store in meeting memory…", detail: "waiting" },
    ]);
    setActiveStageId("hear");
    setCompletedStageIds([]);
    try {
      const heard = await transcribeUploadedRecording(file, {
        provider: sttProvider,
        diarize: true,
        prompt:
          "Meeting conversation with multiple speakers. Transcribe speech only. Label each speaker (e.g. Speaker 1, Speaker 2).",
        onProgress: ({ label }) => {
          setCaptureNote(label);
          setStages((prev) => prev.map((s) => (s.id === "hear" ? { ...s, detail: label } : s)));
        },
        onPartial: ({ text, part, total, provider, fallback }) => {
          writeTranscript(text);
          setCaptureNote(
            total > 1
              ? `Transcript live · part ${part} of ${total} done`
              : "Transcript ready — writing summary…",
          );
          if (fallback) {
            setStages((prev) =>
              prev.map((s) =>
                s.id === "hear"
                  ? { ...s, label: "Hear (fallback)", detail: `${provider} · part ${part}/${total}` }
                  : s,
              ),
            );
          }
        },
      });
      if (heard.fallbackNote) setFallbackNote(heard.fallbackNote);
      const out = await api.briefAnalyze({
        transcriptText: heard.text,
        mode,
        llmProvider,
        sttProvider: heard.provider,
        title: displayFileName(file.name).replace(/\.[^.]+$/, "") || "Uploaded recording",
      });
      const text = ((typeof out.transcript === "string" ? out.transcript : "") || heard.text).trim();
      if (!text) throw new Error("No speech detected in that recording.");
      writeTranscript(text);
      setCaptureNote(
        heard.fallback
          ? `Fell back to ${heard.provider}. Summary ready.`
          : `Hear via ${heard.provider}. Summary ready.`,
      );
      setStages(
        (out.stages ?? []).map((s) =>
          s.id === "hear" && heard.fallback
            ? {
                ...s,
                label: "Hear (fallback)",
                detail: heard.fallbackNote ?? `${heard.provider} · diarized batch`,
              }
            : s.id === "hear"
              ? { ...s, detail: `${heard.provider} · diarized batch` }
              : s,
        ),
      );
      setResult(out);
      setCompletedStageIds((out.stages ?? []).map((s) => s.id));
      setActiveStageId(null);
      setSelectedMeetingId(out.runId);
      await refreshMeetings(out.runId);
      try {
        await uploadEntityRecording("brief", out.runId, file);
        setRecordingUrl(recordingPlayUrl("brief", out.runId));
        await refreshMeetings(out.runId);
        setCaptureNote(
          heard.fallback
            ? `Fell back to ${heard.provider}. Summary + recording saved.`
            : `Hear via ${heard.provider}. Summary + recording saved.`,
        );
      } catch (recErr) {
        setCaptureNote(
          `Hear via ${heard.provider}. Notes saved; recording not stored (${
            recErr instanceof Error ? recErr.message.slice(0, 80) : "error"
          }).`,
        );
      }
      setSearch(null);
      setQuery("");
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
      { id: "memory", label: "Store in meeting memory…", detail: "waiting" },
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
      setSelectedMeetingId(out.runId);
      await refreshMeetings(out.runId);
      setSearch(null);
      setQuery("");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function doSearch() {
    const q = query.trim();
    if (!q) {
      setSearch(null);
      return;
    }
    setSearch(await api.briefSearch(q));
  }

  function openMeet() {
    writeTranscript("");
    setResult(null);
    setStages([]);
    setError(null);
    setSearch(null);
    window.open(meetUrl.trim() || "https://meet.google.com/new", "_blank", "noopener,noreferrer");
    setCaptureNote("Meet opened. Join, then Capture Meet audio — share that Chrome tab with “Share tab audio” on. No bot joins the call.");
  }

  async function processChunk(blob: Blob, speakerLabel: string) {
    if (stoppingRef.current && blob.size < 500) return;
    if (blob.size < 800) return;
    bumpPending(1);
    setChunkBusy(true);
    try {
      // Always send live chunks to STT. Meet tab levels are often “quiet” by mic
      // standards; a local silence gate was blocking real speech. Empty / filler
      // transcripts are dropped after Hear returns.
      const file = new File([blob], "meet-chunk.webm", { type: blob.type || "audio/webm" });
      // Complete webm segments → wav for PyAI Hear (same as Playground mic).
      const { audioBase64, audioFormat } = await prepareForStt(file);
      if (audioBase64.length > 8_000_000) return;
      setCaptureNote(`Hearing ${speakerLabel} via STT…`);
      const out = await api.sttTranscribe({
        audioBase64,
        format: audioFormat,
        provider: sttProvider,
        diarize: false,
        speakerLabel,
        mode: "live",
        // Vocabulary hint only — instructional prompts get echoed on quiet Them/tab audio.
        prompt: "Meeting: roadmap, launch, security review, action items, follow-up, payment, access.",
      });
      const line = out.text.trim();
      if (!line || isLikelySttHallucination(line)) {
        setCaptureNote(
          out.hearCooldown
            ? `Listening (${out.provider}; Hear cooling down) — waiting for clear speech…`
            : `Listening (${out.provider}) — waiting for clear speech…`,
        );
        return;
      }
      writeTranscript((prev) => {
        const content = line.replace(/^(me|them|you)\s*:\s*/i, "").trim().toLowerCase();
        const recent = prev
          .trim()
          .split("\n")
          .slice(-8)
          .map((l) => l.replace(/^(me|them|you)\s*:\s*/i, "").trim().toLowerCase());
        if (content && recent.includes(content)) return prev;
        const last = prev.trim().split("\n").pop()?.trim().toLowerCase() ?? "";
        if (last && last === line.toLowerCase()) return prev;
        return prev.trim() ? `${prev.trim()}\n${line}` : line;
      });
      setLiveCaption(line.slice(0, 160));
      if (out.fallback) {
        // Real provider failure (timeout/empty), not Hear cooldown.
        setFallbackNote(
          formatFallbackNote(out.provider, out.errors, out.fallbackNote) ??
            `Fell back to ${out.provider}`,
        );
        setCaptureNote(
          formatFallbackNote(out.provider, out.errors, out.fallbackNote) ??
            `Fell back to ${out.provider} · line added · ${speakerLabel}`,
        );
      } else if (out.hearCooldown) {
        setCaptureNote(`Live STT via ${out.provider} (Hear cooling down) · line added · ${speakerLabel}`);
      } else {
        setCaptureNote(`Live STT via ${out.provider} · line added · ${speakerLabel}`);
        setFallbackNote(null);
      }
      setError(null);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setCaptureNote(`Skipped a segment (${msg.slice(0, 80)}). Still listening…`);
    } finally {
      bumpPending(-1);
      setChunkBusy(pendingChunksRef.current > 0);
    }
  }

  function markLiveSources(patch: Partial<{ tab: boolean; mic: boolean }>) {
    setLiveSources((prev) => {
      const next = { ...prev, ...patch };
      setCapturing(next.tab || next.mic);
      return next;
    });
  }

  async function stopLane(lane: LiveLane) {
    const h = lanesRef.current[lane];
    if (h.timer != null) {
      window.clearInterval(h.timer);
      h.timer = null;
    }
    const rec = h.media;
    h.media = null;
    if (rec && rec.state !== "inactive") {
      await new Promise<void>((resolve) => {
        rec.addEventListener("stop", () => resolve(), { once: true });
        try {
          rec.stop();
        } catch {
          resolve();
        }
        window.setTimeout(resolve, 800);
      });
    }
    h.stream?.getTracks().forEach((t) => t.stop());
    h.stream = null;
    void h.audioCtx?.close().catch(() => undefined);
    h.audioCtx = null;
    lanesRef.current[lane] = emptyLane();
    markLiveSources({ [lane]: false });
  }

  async function beginRecording(
    lane: LiveLane,
    stream: MediaStream,
    note: string,
    opts: { speakerLabel: string; segmentMs?: number },
  ) {
    const audioTracks = stream.getAudioTracks();
    if (!audioTracks.length) {
      stream.getTracks().forEach((t) => t.stop());
      throw new Error("NO_AUDIO_TRACK");
    }

    // Replace this lane only — leave the other source running.
    await stopLane(lane);

    stoppingRef.current = false;
    const audioOnly = new MediaStream(audioTracks);
    const handles = emptyLane();
    handles.stream = stream;

    // Chrome tab capture sometimes stays silent unless an AudioContext taps the stream.
    try {
      const Ctx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new Ctx();
      handles.audioCtx = ctx;
      const src = ctx.createMediaStreamSource(audioOnly);
      const mute = ctx.createGain();
      mute.gain.value = 0;
      src.connect(mute);
      mute.connect(ctx.destination);
      void ctx.resume();
    } catch {
      /* recorder still works without the tap */
    }

    const liveTrack = audioTracks[0];
    if (lane === "tab" && liveTrack?.muted) {
      setCaptureNote(
        "Browser reports the share track as muted — re-share Meet with “Also share tab audio” on.",
      );
    }
    const mime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
      ? "audio/webm;codecs=opus"
      : MediaRecorder.isTypeSupported("audio/webm")
        ? "audio/webm"
        : undefined;
    // Complete webm per slice (stop → flush → restart). Timeslice fragments are not
    // valid standalone files and fail decode / often fail Whisper.
    const segmentMs = opts.segmentMs ?? 4_000;
    const speakerLabel = opts.speakerLabel;

    const startSegment = () => {
      if (stoppingRef.current || !handles.stream) return;
      const rec = new MediaRecorder(audioOnly, mime ? { mimeType: mime } : undefined);
      handles.media = rec;
      const parts: Blob[] = [];
      rec.ondataavailable = (e) => {
        if (e.data.size) parts.push(e.data);
      };
      rec.onerror = () => {
        setCaptureNote("Recorder hiccup — keep speaking; still listening…");
      };
      rec.onstop = () => {
        const blob = new Blob(parts, { type: mime || "audio/webm" });
        if (blob.size >= 800 && !stoppingRef.current) {
          chunkQueue.current = chunkQueue.current
            .then(() => processChunk(blob, speakerLabel))
            .catch(() => undefined);
        }
        if (!stoppingRef.current && handles.stream) {
          window.setTimeout(startSegment, 40);
        }
      };
      try {
        rec.start();
      } catch {
        setCaptureNote("Could not start audio recorder — try Capture again.");
      }
    };

    startSegment();
    handles.timer = window.setInterval(() => {
      const rec = handles.media;
      if (stoppingRef.current) return;
      if (!rec || rec.state !== "recording") {
        startSegment();
        return;
      }
      try {
        rec.stop(); // onstop queues STT and starts the next segment
      } catch {
        startSegment();
      }
    }, segmentMs);

    lanesRef.current[lane] = handles;
    for (const track of stream.getTracks()) {
      track.addEventListener("ended", () => {
        void (async () => {
          await stopLane(lane);
          const other: LiveLane = lane === "tab" ? "mic" : "tab";
          if (!lanesRef.current[other].stream) {
            setCaptureNote(
              transcriptRef.current.trim()
                ? "Capture stopped. Review transcript, then End meeting → notes."
                : "Capture stopped — no speech transcribed yet.",
            );
          } else {
            setCaptureNote(
              lane === "tab"
                ? "Meet tab share ended — mic still capturing you as Me:."
                : "Mic stopped — Meet tab still capturing Them:.",
            );
          }
        })();
      });
    }
    markLiveSources({ [lane]: true });
    setError(null);
    setCaptureNote(note);
  }

  async function startMeetCapture() {
    setError(null);
    setResult(null);
    setStages([]);
    setFallbackNote(null);
    setSharePhase("idle");
    setMeetPhase("idle");
    setCaptureSource(null);
    const micAlready = Boolean(lanesRef.current.mic.stream);
    if (!micAlready) {
      writeTranscript("");
      setPendingChunks(0);
      pendingChunksRef.current = 0;
    }
    setCaptureNote(null);
    try {
      const display = await navigator.mediaDevices.getDisplayMedia({
        video: {
          displaySurface: "browser",
        } as MediaTrackConstraints,
        audio: {
          // Chrome: keep tab audio flowing into the captured stream.
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        } as MediaTrackConstraints,
        ...({
          preferCurrentTab: false,
          selfBrowserSurface: "exclude",
          surfaceSwitching: "include",
          systemAudio: "include",
          // Chromium: do not mute the shared tab in the user's speakers.
          suppressLocalAudioPlayback: false,
        } as Record<string, unknown>),
      });

      try {
        await beginRecording(
          "tab",
          display,
          micAlready
            ? "Meet tab = Them: · mic already on for Me:. Switch to Brief and let the call run."
            : "Meet tab = Them:. Asking for microphone so your speech is Me:…",
          { speakerLabel: "Them", segmentMs: 4_000 },
        );
      } catch (e) {
        display.getTracks().forEach((t) => t.stop());
        if (e instanceof Error && e.message === "NO_AUDIO_TRACK") {
          setError(
            "That share had no audio. In Chrome’s picker: choose “Chrome Tab” → select the Meet tab → turn ON “Also share tab audio”. Window/Entire Screen usually won’t capture Meet sound on Mac.",
          );
          setCaptureNote("Tip: use Also capture my mic for your voice (Me:), or paste/type that part.");
          return;
        }
        throw e;
      }

      // Same user-gesture chain as tab share — start mic so Me: is captured too.
      if (!micAlready && !lanesRef.current.mic.stream) {
        try {
          await startMicCapture({ preserveSession: true });
        } catch {
          setCaptureNote(
            "Meet tab is capturing Them:. Click the Microphone card (or Also capture my mic) to add Me:.",
          );
        }
      }
    } catch (e) {
      if (e instanceof DOMException && e.name === "NotAllowedError") {
        setError("Screen share was blocked or cancelled.");
        return;
      }
      setError(e instanceof Error ? e.message : "Could not start tab capture. Use Chrome on desktop.");
    }
  }

  async function startMicCapture(opts?: { preserveSession?: boolean }) {
    setError(null);
    setSharePhase("idle");
    setMeetPhase("idle");
    setCaptureSource(null);
    if (!opts?.preserveSession) {
      setResult(null);
      setStages([]);
      setFallbackNote(null);
    }
    const tabAlready = Boolean(lanesRef.current.tab.stream);
    if (!tabAlready && !opts?.preserveSession) {
      writeTranscript("");
      setPendingChunks(0);
      pendingChunksRef.current = 0;
    }
    try {
      const mic = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      await beginRecording(
        "mic",
        mic,
        tabAlready || opts?.preserveSession
          ? "Mic = Me: · Meet tab = Them:. Both sources are live — speak normally."
          : "Mic = Me:. For others on the call, also Capture Meet audio (tab share).",
        { speakerLabel: "Me", segmentMs: 4_000 },
      );
    } catch (e) {
      const msg =
        e instanceof DOMException && e.name === "NotAllowedError"
          ? "Microphone permission denied. Allow mic for this site, then click the Microphone card."
          : e instanceof Error
            ? e.message
            : "Microphone permission denied.";
      setError(msg);
      if (opts?.preserveSession) throw e instanceof Error ? e : new Error(msg);
    }
  }

  async function stopMeetCapture() {
    stoppingRef.current = true;
    await Promise.all([stopLane("tab"), stopLane("mic")]);
    setCapturing(false);
    setLiveSources({ tab: false, mic: false });
    setCaptureNote("Finishing last audio chunks…");
    await chunkQueue.current;
    setChunkBusy(false);
    setPendingChunks(0);
    pendingChunksRef.current = 0;
    setCaptureNote(
      transcriptRef.current.trim()
        ? "Capture stopped. Review transcript, then End meeting → notes."
        : "Capture stopped — no speech transcribed. Share Meet tab audio and try again, or paste a transcript.",
    );
  }

  async function endMeetingNotes() {
    if (sharePhase !== "idle") stopDemoCapture();
    else if (capturing || liveSources.tab || liveSources.mic) await stopMeetCapture();
    const text = transcriptRef.current.trim();
    if (!text) {
      setError("No transcript yet. Keep Meet tab audio shared until lines appear, then try again.");
      return;
    }
    await analyze(text);
  }

  return (
    <div>
      <PageHeader
        kicker="Product"
        title="Brief"
        description="Hear transcribes. Summary writes decisions and actions. Meeting memory answers from stored meetings."
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
            <SampleRecordingButtons
              product="brief"
              disabled={busy || capturing}
              ttsProvider={ttsProvider === "mock" ? undefined : ttsProvider}
              onFile={(file) => void uploadRecording(file)}
              onError={setError}
            />
            <Button
              variant="ghost"
              disabled={busy || (!capturing && !transcript.trim())}
              onClick={() => void endMeetingNotes()}
            >
              {busy
                ? "Summarizing…"
                : capturing
                  ? pendingChunks > 0
                    ? `End meeting (${pendingChunks}…)`
                    : "End meeting → notes"
                  : "End meeting → notes"}
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
      {sharePhase === "capturing" || sharePhase === "done" || liveSources.tab || liveSources.mic ? (
        <CaptureSourcesHud
          sources={{
            tab: liveSources.tab || captureSource === "tab",
            mic: liveSources.mic || captureSource === "mic",
          }}
          transcribing={chunkBusy && (sharePhase === "capturing" || liveSources.tab || liveSources.mic)}
          note={captureNote}
          onStartMic={
            !liveSources.mic && sharePhase === "idle"
              ? () => void startMicCapture()
              : undefined
          }
          onStartTab={
            !liveSources.tab && sharePhase === "idle"
              ? () => void startMeetCapture()
              : undefined
          }
        />
      ) : null}

      <section className="panel mb-5 space-y-3 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <h2 className="flex items-center gap-2 text-sm font-semibold">
              Live Google Meet (no bot)
              {capturing ? <RecDot label="Listening" /> : null}
              {capturing && (chunkBusy || pendingChunks > 0) ? (
                <span className="font-mono text-[10px] font-normal text-ink-400">
                  transcribing{pendingChunks > 1 ? ` · ${pendingChunks} queued` : "…"}
                </span>
              ) : null}
            </h2>
            <p className="mt-1 max-w-xl text-xs text-ink-500">
              Capture Meet tab for <span className="font-medium text-ink-700">Them:</span> — Brief then
              asks for your mic as <span className="font-medium text-ink-700">Me:</span>. Both can run
              together; click an idle card to start a missing source.
            </p>
            <button
              type="button"
              className="mt-2 text-[11px] text-ink-500 underline-offset-2 hover:text-ink-800 hover:underline"
              onClick={() => setShowCaptureHelp((v) => !v)}
            >
              {showCaptureHelp ? "Hide how to share tab audio" : "How to share tab audio"}
            </button>
          </div>
          <div className="flex flex-wrap gap-2">
            {liveSources.tab && !liveSources.mic ? (
              <Button type="button" size="sm" variant="secondary" disabled={busy} onClick={() => void startMicCapture()}>
                Also capture my mic
              </Button>
            ) : null}
            {liveSources.mic && !liveSources.tab ? (
              <Button type="button" size="sm" variant="secondary" disabled={busy} onClick={() => void startMeetCapture()}>
                Also capture Meet tab
              </Button>
            ) : null}
            {capturing ? (
              <Button type="button" size="sm" disabled={busy} onClick={() => void endMeetingNotes()}>
                {pendingChunks > 0 ? `End meeting (${pendingChunks} processing…)` : "End meeting → notes"}
              </Button>
            ) : null}
          </div>
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
                Switch back to Brief — others’ speech lands as Them:. Add mic for your words (Me:), or
                paste/type that part.
              </li>
              <li>
                On Mac, Window / Entire Screen often has no Meet sound — tab share is required.
              </li>
            </ol>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={busy || liveSources.mic}
              onClick={() => void startMicCapture()}
            >
              {liveSources.tab ? "Also capture my mic" : "Capture microphone only"}
            </Button>
          </div>
        ) : null}

        <div>
          <Label>Meet link (optional)</Label>
          <div className="flex gap-2">
            <Input
              value={meetUrl}
              onChange={(e) => setMeetUrl(e.target.value)}
              placeholder="https://meet.google.com/xxx-xxxx-xxx"
            />
            <Button type="button" variant="secondary" size="sm" onClick={openMeet}>
              Open
            </Button>
          </div>
        </div>
        {captureNote ? (
          <p className="font-mono text-[11px] text-ink-500">
            {captureNote}
            {capturing && pendingChunks > 1 ? ` · ${pendingChunks} chunks queued` : ""}
          </p>
        ) : null}
        <FallbackNotice note={fallbackNote} />
        {error ? (
          <div className="space-y-2">
            <ErrorBanner title="Couldn’t capture that meeting" message={error} />
            <div className="flex flex-wrap gap-2">
              <Button type="button" size="sm" onClick={() => void startMeetCapture()}>
                Try tab share again
              </Button>
              <Button type="button" variant="secondary" size="sm" onClick={() => void startMicCapture()}>
                {liveSources.tab ? "Also capture my mic" : "Use microphone instead"}
              </Button>
            </div>
          </div>
        ) : null}
      </section>

      <div className="grid gap-5 lg:grid-cols-[240px_minmax(0,1fr)]">
        <aside className="panel overflow-hidden p-0">
          <div className="flex items-center justify-between border-b border-ink-100 px-3 py-2.5">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-ink-500">Past meetings</h2>
            <button
              type="button"
              className="text-[11px] text-ink-500 underline-offset-2 hover:text-ink-800 hover:underline"
              disabled={meetingsQ.isFetching}
              onClick={() => void meetingsQ.refetch()}
            >
              {meetingsQ.isFetching ? "…" : "Refresh"}
            </button>
          </div>
          {meetingsQ.isError ? (
            <div className="p-4 text-sm text-ink-500">Could not load meetings.</div>
          ) : (meetingsQ.data?.meetings.length ?? 0) === 0 ? (
            <div className="p-4 text-sm text-ink-500">
              Nothing stored yet. Run a demo or end a meeting — notes stay in the database.
            </div>
          ) : (
            <ul className="max-h-[560px] divide-y divide-ink-100 overflow-y-auto">
              {(meetingsQ.data?.meetings ?? []).map((m) => (
                <li key={m.id}>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void openPastMeeting(m.id)}
                    className={cn(
                      "flex w-full flex-col gap-0.5 px-3 py-2.5 text-left transition hover:bg-ink-50",
                      selectedMeetingId === m.id && "bg-accent/5 hover:bg-accent/10",
                    )}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-sm font-medium text-ink-900">
                        {m.title || "Untitled meeting"}
                      </span>
                      <span className="flex shrink-0 items-center gap-1">
                        {m.hasRecording ? (
                          <span className="rounded bg-accent/10 px-1.5 py-0.5 text-[10px] font-medium text-accent">
                            Audio
                          </span>
                        ) : null}
                        {m.mode ? (
                          <span className="rounded bg-ink-100 px-1.5 py-0.5 text-[10px] font-medium uppercase text-ink-500">
                            {m.mode}
                          </span>
                        ) : null}
                      </span>
                    </div>
                    <span className="font-mono text-[10px] text-ink-400">
                      {m.date ? new Date(m.date).toLocaleString() : m.id}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </aside>

        <div className="grid min-w-0 gap-5 lg:grid-cols-2">
        <section className="panel space-y-3 p-4">
          <div>
            <Label>Live / imported transcript</Label>
            <Textarea
              value={transcript}
              onChange={(e) => writeTranscript(e.target.value)}
              className="min-h-[260px] font-mono text-sm"
              placeholder="Capture a Meet, upload a recording, paste a transcript, or try the sample demo."
            />
          </div>
          <div className="border-t border-ink-100 pt-3">
            <h3 className="text-sm font-semibold">Meeting memory</h3>
            <p className="mt-1 text-[11px] text-ink-400">
              Ask in plain language. Answers are retrieved from stored meetings, then written by
              Summary — not a keyword dump
              {search?.backend === "postgres"
                ? " · saved in the database."
                : search?.backend === "memory"
                  ? " · this process has no database (clears on restart)."
                  : "."}
            </p>
            <form
              className="mt-2 flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                void doSearch();
              }}
            >
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="What did we decide about launch?"
                aria-label="Search meeting memory"
              />
              <Button type="submit" variant="secondary" disabled={busy}>
                Search
              </Button>
            </form>
            {search ? (
              <div className="mt-3 space-y-2 text-sm">
                {search.meetings.length === 0 ? (
                  <p className="text-ink-400">Nothing stored yet. Run a demo or end a meeting first.</p>
                ) : search.answer && !search.grounded ? (
                  <p className="text-ink-400">{search.answer}</p>
                ) : !search.answer && search.results.length === 0 ? (
                  <p className="text-ink-400">
                    No answer for “{search.query}” across {search.meetings.length} meeting
                    {search.meetings.length === 1 ? "" : "s"}.
                  </p>
                ) : (
                  <>
                    {search.answer ? (
                      <div className="rounded-lg border border-ink-100 bg-ink-50 px-3 py-2">
                        <div className="text-[10px] uppercase tracking-wide text-ink-400">Answer</div>
                        <p className="mt-1 font-medium text-ink-900">{search.answer}</p>
                      </div>
                    ) : null}
                    {search.results.length > 0 ? (
                      <ul className="space-y-2">
                        {search.results.map((r, i) => (
                          <li key={`${r.meetingId}-${i}`} className="rounded-lg border border-ink-100 px-3 py-2">
                            <div className="flex items-baseline justify-between gap-2">
                              <div className="text-[13px] text-ink-800">{r.answer}</div>
                              {r.kind ? (
                                <span className="shrink-0 text-[10px] uppercase tracking-wide text-ink-400">
                                  {r.kind}
                                </span>
                              ) : null}
                            </div>
                            {r.evidence && r.evidence !== r.answer ? (
                              <p className="mt-1 text-[12px] leading-snug text-ink-500">“{r.evidence}”</p>
                            ) : null}
                            <div className="mt-1 font-mono text-[10px] text-ink-400">
                              {r.title || r.meetingId}
                              {r.date ? ` · ${new Date(r.date).toLocaleString()}` : ""}
                            </div>
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </>
                )}
              </div>
            ) : null}
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
            <div className="panel space-y-3 p-4">
              <h3 className="text-sm font-semibold">Pipeline</h3>
              <FallbackNotice note={fallbackNote} />
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
              title="No notes open"
              body="Pick a past meeting on the left, or capture / upload / run the demo to create one."
              actionLabel="Capture Meet audio"
              onAction={() => void startMeetCapture()}
              secondaryLabel="Try sample demo"
              onSecondary={() => void runDemo()}
            />
          ) : result ? (
            <MeetingBrief
              notes={result.notes}
              status={result.status}
              runId={result.runId}
              recordingUrl={recordingUrl}
            />
          ) : null}
        </section>
        </div>
      </div>
    </div>
  );
}
