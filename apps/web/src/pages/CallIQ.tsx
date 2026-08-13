import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { api } from "@/lib/api";
import { PageHeader, EmptyState } from "@/components/EmptyState";
import { StatusBadge } from "@/components/StatusBadge";
import { DemoStages, type DemoStage } from "@/components/DemoStages";
import {
  SimulatedMeetStage,
  CALLIQ_DEMO_LINES,
  type MeetPhase,
  type MeetSpeakerId,
} from "@/components/SimulatedMeet";
import { Button, Input, Label, Select, Textarea } from "@/components/ui";
import { RecordingUploadButton } from "@/components/RecordingUpload";
import { pickPreferred, sortProviders } from "@/lib/providers";
import {
  unlockAudioPlayback,
  speakDemoLine,
  stopDemoSpeech,
  playAndWait,
  sleep,
} from "@/lib/demoAudio";
import {
  type CallAnalysis,
  type CalliqCall,
  type CallSource,
  CALLIQ_CALLS_KEY,
  CALLIQ_LIVE_KEY,
  CALLIQ_SELECTED_KEY,
  deleteCall,
  findLiveCall,
  loadCalls,
  loadLiveBot,
  loadSelectedCallId,
  newCallId,
  saveCalls,
  saveLiveBot,
  saveSelectedCallId,
  sourceLabel,
  titleFromTranscript,
  upsertCall,
} from "@/lib/calliqStore";
import {
  extractMeetingUrl,
  isUsableMeetingUrl,
  meetingHostLabel,
} from "@/lib/meetingUrl";
import { cn } from "@/lib/cn";
import { displayFileName, prepareForStt } from "@/lib/audio";

type DetailTab = "notes" | "transcript" | "activity";

export function CallIQPage() {
  const [params, setSearchParams] = useSearchParams();
  const providers = useQuery({ queryKey: ["providers"], queryFn: api.providers });
  const botProviders = useQuery({ queryKey: ["calliq-bot-providers"], queryFn: api.calliqBotProviders });
  const google = useQuery({ queryKey: ["google-status"], queryFn: api.googleStatus });

  const [calls, setCalls] = useState<CalliqCall[]>(() => loadCalls());
  const [selectedId, setSelectedId] = useState<string | null>(() => loadSelectedCallId());
  const [showJoin, setShowJoin] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showManualLink, setShowManualLink] = useState(false);
  const [showOtherWays, setShowOtherWays] = useState(false);
  const [detailTab, setDetailTab] = useState<DetailTab>(() => {
    const id = loadSelectedCallId();
    const call = id ? loadCalls().find((c) => c.id === id) : undefined;
    if (call?.status === "recording" || (call?.transcript && !call.analysis)) return "transcript";
    return "notes";
  });
  const [clipboardUrl, setClipboardUrl] = useState<string | null>(null);
  const [extensionOk, setExtensionOk] = useState<boolean | null>(null);
  const [awaitingFollowMe, setAwaitingFollowMe] = useState(false);

  const [transcript, setTranscript] = useState(() => {
    const id = loadSelectedCallId();
    if (!id) return "";
    return loadCalls().find((c) => c.id === id)?.transcript ?? "";
  });
  const [meetUrl, setMeetUrl] = useState("");
  const [llmProvider, setLlmProvider] = useState("mock");
  const [sttProvider, setSttProvider] = useState("mock");
  const [busy, setBusy] = useState(false);
  const [botBusy, setBotBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [botNote, setBotNote] = useState<string | null>(null);
  const [stages, setStages] = useState<DemoStage[]>([]);
  const [botSessionId, setBotSessionId] = useState<string | null>(null);
  const [leavingBot, setLeavingBot] = useState(false);
  const [pipelineActive, setPipelineActive] = useState<string | null>(null);
  const [pipelineDone, setPipelineDone] = useState<string[]>([]);
  const [meetPhase, setMeetPhase] = useState<MeetPhase>("idle");
  const [meetPresent, setMeetPresent] = useState<MeetSpeakerId[]>([]);
  const [meetWaiting, setMeetWaiting] = useState<MeetSpeakerId[]>([]);
  const [meetStatus, setMeetStatus] = useState("");
  const [activeSpeaker, setActiveSpeaker] = useState<MeetSpeakerId | null>(null);
  const [liveCaption, setLiveCaption] = useState("");
  const [workingCallId, setWorkingCallId] = useState<string | null>(null);

  const pollAbort = useRef(false);
  const joinInFlight = useRef(false);
  const resumeStarted = useRef(false);
  const queuedJoin = useRef<string | null>(null);
  const audioCtx = useRef<AudioContext | null>(null);
  const demoAudio = useRef<HTMLAudioElement | null>(null);
  const demoObjectUrl = useRef<string | null>(null);

  const selected = useMemo(
    () => (selectedId ? calls.find((c) => c.id === selectedId) ?? null : null),
    [calls, selectedId],
  );

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

  const botHint = useMemo(() => {
    if (!botProviders.data?.attendee.configured) {
      return "Attendee not configured — set ATTENDEE_API_KEY for real Meet joins, or use Try demo.";
    }
    return "One CallIQ Bot per Meet — only the person who sends it gets the transcript. Admit that one guest; deny extras.";
  }, [botProviders.data]);

  function pingExtension(): Promise<boolean> {
    return new Promise((resolve) => {
      const t = window.setTimeout(() => resolve(false), 600);
      const onMsg = (event: MessageEvent) => {
        if (event.source !== window) return;
        if (event.data?.type === "calliq.pong") {
          window.clearTimeout(t);
          window.removeEventListener("message", onMsg);
          resolve(Boolean(event.data.ok));
        }
      };
      window.addEventListener("message", onMsg);
      window.postMessage({ type: "calliq.ping" }, "*");
    });
  }

  async function openStartCallPanel() {
    setShowJoin(true);
    selectCall(null);
    setShowManualLink(true);
    setShowOtherWays(false);
    setError(null);
    setAwaitingFollowMe(false);
    const fromClip = await readClipboardMeeting();
    setClipboardUrl(fromClip);
    if (fromClip) setMeetUrl(fromClip);
    void google.refetch();
    void pingExtension().then(setExtensionOk);
  }

  /** Simulated Meet in CallIQ (product demo). */
  async function startInAppCall() {
    setShowJoin(false);
    setError(null);
    setAwaitingFollowMe(false);
    setBotNote("In-app call — you and CallIQ Bot join the same room.");
    await runProductDemo();
  }

  /** Real Google Meet — only when OAuth is connected. */
  async function startRealGoogleMeetCall() {
    setShowJoin(true);
    setShowManualLink(false);
    setShowOtherWays(false);
    setError(null);
    selectCall(null);

    let st = google.data;
    try {
      st = await api.googleStatus();
      void google.refetch();
    } catch {
      /* use cached */
    }

    if (!st?.configured) {
      setError("Google OAuth is not set up. Use Start in-app call, or Try demo.");
      return;
    }
    if (!st.connected) {
      window.location.href = `${api.apiBase}/api/google/oauth/start`;
      return;
    }

    setAwaitingFollowMe(true);
    setBotBusy(true);
    setBotNote("Creating Google Meet and sending CallIQ Bot into the same room…");
    setDetailTab("activity");
    setPipelineActive("bot");
    setPipelineDone([]);
    setStages([
      { id: "bot", label: "Creating Meet + bot…", detail: "Google Calendar" },
      { id: "hear", label: "Hear — capturing conversation…", detail: "waiting" },
      { id: "recap", label: "Recap — deal notes…", detail: "waiting" },
    ]);

    try {
      const out = await api.calliqStartCall();
      setMeetUrl(out.meetingUrl);
      setAwaitingFollowMe(false);
      setBotNote(`Meet ready · admit CallIQ Bot · ${out.bot.detail ?? out.bot.status}`);
      window.open(out.meetingUrl, "_blank", "noopener,noreferrer");
      await runLiveBotSession(out.bot.id, out.meetingUrl);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      setAwaitingFollowMe(false);
      setStages([]);
      setPipelineActive(null);
      setPipelineDone([]);
    } finally {
      setBotBusy(false);
      setBotSessionId(null);
      setLeavingBot(false);
    }
  }

  async function bringBotIntoCurrentMeet() {
    setShowJoin(true);
    setError(null);
    const ok = await pingExtension();
    setExtensionOk(ok);
    if (!ok) {
      setError("Extension fallback only — prefer Connect Google + Start call (no extension).");
      setShowOtherWays(true);
      return;
    }
    setAwaitingFollowMe(true);
    setBotNote("Looking for your Meet tab…");
    window.postMessage({ type: "calliq.startWithBot", webOrigin: window.location.origin, createNew: false }, "*");
  }

  useEffect(() => {
    void pingExtension().then(setExtensionOk);
    const onMsg = (event: MessageEvent) => {
      const fromSelf = event.source === window;
      const fromParent = window.parent !== window && event.source === window.parent;
      if (!fromSelf && !fromParent) return;
      if (fromSelf && event.data?.type === "calliq.extension.ready") setExtensionOk(true);
      if (event.data?.type === "calliq.handoff.join") {
        const url = extractMeetingUrl(String(event.data.meetingUrl || ""));
        if (!url || !isUsableMeetingUrl(url)) return;
        setAwaitingFollowMe(false);
        setShowJoin(true);
        if (joinInFlight.current) {
          queuedJoin.current = url;
          pollAbort.current = true;
          return;
        }
        void joinBot(url);
        return;
      }
      if (fromSelf && event.data?.type === "calliq.startWithBot.result") {
        if (!event.data.ok) {
          setAwaitingFollowMe(false);
          setError(event.data.reason || "Could not start Meet with bot");
          return;
        }
        if (event.data.joined) {
          setAwaitingFollowMe(false);
          void joinBot(String(event.data.joined));
        }
      }
    };
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function readClipboardMeeting(): Promise<string | null> {
    try {
      const text = await navigator.clipboard.readText();
      return extractMeetingUrl(text);
    } catch {
      return null;
    }
  }

  function selectCall(id: string | null, list?: CalliqCall[]) {
    const pool = list ?? calls;
    setSelectedId(id);
    saveSelectedCallId(id);
    if (id) {
      const c = pool.find((x) => x.id === id);
      if (c) {
        setTranscript(c.transcript);
        setDetailTab(c.analysis ? "notes" : "transcript");
      }
    }
  }

  function patchCall(id: string, patch: Partial<CalliqCall>) {
    setCalls((prev) => {
      const cur = prev.find((c) => c.id === id);
      if (!cur) return prev;
      const next = upsertCall(prev, { ...cur, ...patch, updatedAt: Date.now() });
      saveCalls(next);
      return next;
    });
  }

  function createDraft(source: CallSource, extras?: Partial<CalliqCall>): CalliqCall {
    const id = newCallId();
    const call: CalliqCall = {
      id,
      title:
        extras?.title ??
        (source === "demo"
          ? "Demo sales call"
          : source === "meet"
            ? "Live Meet call"
            : source === "upload"
              ? "Uploaded recording"
              : "New call"),
      source,
      transcript: extras?.transcript ?? "",
      createdAt: Date.now(),
      updatedAt: Date.now(),
      status: extras?.status ?? "draft",
      meetingUrl: extras?.meetingUrl,
      analysis: extras?.analysis,
      runId: extras?.runId,
      error: extras?.error,
    };
    setCalls((prev) => {
      const next = upsertCall(prev, call);
      saveCalls(next);
      return next;
    });
    setSelectedId(id);
    saveSelectedCallId(id);
    setWorkingCallId(id);
    setTranscript(call.transcript);
    setError(null);
    setDetailTab(call.analysis ? "notes" : "transcript");
    return call;
  }

  useEffect(() => {
    if (!providers.data) return;
    setLlmProvider(pickPreferred(providers.data.providers, "llm"));
    setSttProvider(pickPreferred(providers.data.providers, "batch_stt"));
  }, [providers.data]);

  useEffect(() => {
    const demo = params.get("demo") === "1";
    const joinRaw = params.get("join");
    const googleFlag = params.get("google");
    if (googleFlag) {
      setShowJoin(true);
      void google.refetch();
      if (googleFlag === "connected") setBotNote("Google connected — click Start call with CallIQ Bot.");
      if (googleFlag === "error" || googleFlag === "state") {
        setError("Google sign-in failed. Try Connect Google again.");
      }
      setSearchParams({}, { replace: true });
      return;
    }
    if (demo) {
      void runProductDemo();
      setSearchParams({}, { replace: true });
      return;
    }
    if (joinRaw) {
      const decoded = (() => {
        try {
          return decodeURIComponent(joinRaw);
        } catch {
          return joinRaw;
        }
      })();
      const url = extractMeetingUrl(decoded);
      if (url && isUsableMeetingUrl(url)) {
        setMeetUrl(url);
        setShowJoin(true);
        setClipboardUrl(url);
        setAwaitingFollowMe(false);
        setSearchParams({}, { replace: true });
        void joinBot(url);
      } else {
        setError("That join link wasn’t a usable Meet/Zoom/Teams URL.");
        setShowJoin(true);
        setShowManualLink(true);
        setSearchParams({}, { replace: true });
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params]);

  useEffect(() => {
    if (resumeStarted.current) return;
    resumeStarted.current = true;
    const timer = window.setTimeout(() => {
    void (async () => {
      let live = loadLiveBot();
      if (!live) {
        try {
          const cur = await api.calliqBotCurrent();
          if (!cur?.id) return;
          const liveStatuses = new Set(["joining", "in_call", "waiting_transcript"]);
          const calls = loadCalls();
          const match =
            findLiveCall(calls, cur.meetingUrl) ??
            calls.find((c) => c.meetingUrl === cur.meetingUrl) ??
            createDraft("meet", {
              status: liveStatuses.has(cur.status) ? "recording" : cur.transcriptText ? "ready" : "draft",
              meetingUrl: cur.meetingUrl,
              transcript: cur.transcriptText?.trim() ?? "",
              title: `${meetingHostLabel(cur.meetingUrl)} call`,
            });
          if (cur.transcriptText?.trim() && match.id) {
            patchCall(match.id, { transcript: cur.transcriptText.trim() });
            setTranscript(cur.transcriptText.trim());
            selectCall(match.id);
            setDetailTab("transcript");
          }
          if (!liveStatuses.has(cur.status)) return;
          live = {
            botId: cur.id,
            callId: match.id,
            meetingUrl: cur.meetingUrl,
            startedAt: Date.now(),
          };
          saveLiveBot(live);
        } catch {
          return;
        }
      }
      if (live && !joinInFlight.current) await resumeLiveBot(live);
    })();
    }, 1000);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const syncFromStorage = () => {
      const next = loadCalls();
      setCalls(next);
      const id = loadSelectedCallId();
      if (!id) return;
      const call = next.find((c) => c.id === id);
      if (!call) return;
      setSelectedId(id);
      if (call.transcript) setTranscript(call.transcript);
      if (call.analysis) setDetailTab("notes");
    };
    const onStorage = (event: StorageEvent) => {
      if (!event.key || event.key === CALLIQ_CALLS_KEY || event.key === CALLIQ_SELECTED_KEY || event.key === CALLIQ_LIVE_KEY) {
        syncFromStorage();
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  useEffect(() => {
    if ("speechSynthesis" in window) {
      window.speechSynthesis.getVoices();
      window.speechSynthesis.onvoiceschanged = () => window.speechSynthesis.getVoices();
    }
    return () => {
      stopDemoSpeech();
    };
  }, []);

  async function runProductDemo() {
    pollAbort.current = false;
    await unlockAudioPlayback(audioCtx);
    const draft = createDraft("demo", { status: "recording", title: "Demo sales call" });
    setShowJoin(false);
    setBotBusy(true);
    setError(null);
    setLiveCaption("");
    setActiveSpeaker(null);
    setMeetPresent([]);
    setMeetWaiting([]);
    setMeetStatus("Opening Meet lobby…");
    setMeetPhase("joining");
    setBotNote("People joining simulated Meet…");
    setDetailTab("activity");
    setPipelineActive("bot");
    setPipelineDone([]);
    setStages([
      { id: "bot", label: "People joining…", detail: "lobby" },
      { id: "hear", label: "Hear — capturing conversation…", detail: "waiting" },
      { id: "recap", label: "Recap — deal notes…", detail: "waiting" },
    ]);

    try {
      const ttsProvider = pickPreferred(providers.data?.providers, "tts");
      const ttsId = ttsProvider === "mock" ? undefined : ttsProvider;

      const fetchTurn = (turn: (typeof CALLIQ_DEMO_LINES)[number]) =>
        api.calliqDemoSpeakTurn({
          speaker: turn.speaker === "customer" ? "customer" : "rep",
          text: turn.text,
          ttsProvider: ttsId,
        });

      let pending = fetchTurn(CALLIQ_DEMO_LINES[0]!);

      await sleep(400);
      if (pollAbort.current) return;
      setMeetPresent(["rep"]);
      setMeetStatus("Alex (Rep) joined");
      setStages((prev) => prev.map((s) => (s.id === "bot" ? { ...s, detail: "Alex joined" } : s)));

      await sleep(650);
      if (pollAbort.current) return;
      setMeetPresent(["rep", "customer"]);
      setMeetStatus("Dana joined");
      setStages((prev) => prev.map((s) => (s.id === "bot" ? { ...s, detail: "Dana joined" } : s)));

      await sleep(700);
      if (pollAbort.current) return;
      setMeetWaiting(["bot"]);
      setMeetStatus("CallIQ Bot is in the waiting room…");
      setStages((prev) => prev.map((s) => (s.id === "bot" ? { ...s, detail: "bot waiting" } : s)));

      await sleep(800);
      if (pollAbort.current) return;
      setMeetWaiting([]);
      setMeetPresent(["rep", "customer", "bot"]);
      setMeetStatus("You admitted CallIQ Bot");
      setStages((prev) => prev.map((s) => (s.id === "bot" ? { ...s, detail: "bot admitted" } : s)));

      await sleep(500);
      if (pollAbort.current) return;
      setMeetPhase("in_call");
      setMeetStatus("Recording + captions on");
      setPipelineActive("hear");
      setPipelineDone(["bot"]);

      const lines: string[] = [];
      for (let i = 0; i < CALLIQ_DEMO_LINES.length; i++) {
        if (pollAbort.current) return;
        const turn = CALLIQ_DEMO_LINES[i]!;
        const speaker: MeetSpeakerId = turn.speaker;
        const nextPending =
          i + 1 < CALLIQ_DEMO_LINES.length ? fetchTurn(CALLIQ_DEMO_LINES[i + 1]!) : null;
        const audio = await pending;
        if (nextPending) pending = nextPending;

        setActiveSpeaker(speaker);
        setLiveCaption(`${turn.label}: ${turn.text}`);
        setStages((prev) =>
          prev.map((s) =>
            s.id === "hear"
              ? { ...s, detail: `live · ${i + 1}/${CALLIQ_DEMO_LINES.length}` }
              : s,
          ),
        );

        if (audio.audioBase64 && audio.audioFormat) {
          await playAndWait(audio.audioBase64, audio.audioFormat, demoAudio, demoObjectUrl, {
            spokenPhrase: turn.text,
            useBrowserSpeech: true,
          });
        } else {
          await speakDemoLine(turn.text, {
            pitch: speaker === "customer" ? 1.15 : 0.92,
            rate: 1.02,
            voiceHint: speaker === "customer" ? "female" : "male",
          });
        }

        lines.push(turn.line);
        const text = lines.join("\n");
        setTranscript(text);
        patchCall(draft.id, { transcript: text, status: "recording" });
        setActiveSpeaker(null);
        await sleep(100);
      }

      if (pollAbort.current) return;
      setMeetPhase("ended");
      setMeetStatus("Everyone left the Meet");
      setLiveCaption("");
      setBotNote("Call ended. Running Recap…");
      const text = lines.join("\n");
      setPipelineActive("recap");
      setPipelineDone(["bot", "hear"]);
      setStages((prev) =>
        prev.map((s) =>
          s.id === "hear"
            ? { ...s, detail: `${lines.length} lines` }
            : s.id === "recap"
              ? { ...s, detail: "running…" }
              : s,
        ),
      );
      await analyze(text, { callId: draft.id, keepPipeline: true, source: "demo" });
      setDetailTab("notes");
    } catch (e) {
      stopDemoSpeech();
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      patchCall(draft.id, { status: "failed", error: msg });
      setStages([]);
      setPipelineActive(null);
      setPipelineDone([]);
      setMeetPhase("idle");
      setMeetPresent([]);
      setMeetWaiting([]);
    } finally {
      setBotBusy(false);
      setActiveSpeaker(null);
      window.setTimeout(() => {
        setMeetPhase((p) => (p === "ended" ? "idle" : p));
        setMeetPresent([]);
        setMeetWaiting([]);
      }, 1200);
    }
  }

  async function analyze(
    text = transcript,
    opts?: { callId?: string; keepPipeline?: boolean; source?: CallSource },
  ) {
    if (!text.trim()) {
      setError("Join a Meet, upload a recording, or try the demo first.");
      return;
    }
    const callId = opts?.callId ?? workingCallId ?? selectedId ?? createDraft(opts?.source ?? "paste").id;
    setWorkingCallId(callId);
    setBusy(true);
    setError(null);
    patchCall(callId, {
      transcript: text,
      status: "analyzing",
      title: titleFromTranscript(text, opts?.source ?? selected?.source ?? "paste"),
    });
    if (!opts?.keepPipeline) {
      setPipelineActive("recap");
      setPipelineDone(["hear"]);
      setStages([
        { id: "hear", label: "Hear (transcript ready)", detail: "inline" },
        { id: "recap", label: "Recap — deal notes…", detail: "running" },
      ]);
      setDetailTab("activity");
    }
    try {
      const out = await api.analyzeCallIQ({
        transcriptText: text,
        llmProvider,
        sttProvider,
        verifyProvider: llmProvider,
      });
      setStages(out.stages ?? []);
      setPipelineActive(null);
      setPipelineDone((out.stages ?? []).map((s) => s.id));
      const analysis = {
        ...(out.analysis as CallAnalysis),
        talkRatio: out.recap?.talkRatio,
        keywords: out.recap?.keywords,
      };
      const title =
        (typeof analysis.summary === "string" && analysis.summary.trim()
          ? analysis.summary.trim().slice(0, 72)
          : null) ?? titleFromTranscript(text, opts?.source ?? "paste");
      patchCall(callId, {
        transcript: text,
        status: "ready",
        runId: out.runId,
        analysis,
        title,
        error: undefined,
      });
      selectCall(callId);
      setDetailTab("notes");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      patchCall(callId, { status: "failed", error: msg });
    } finally {
      setBusy(false);
    }
  }

  async function pollUntilTranscript(botId: string, callId: string): Promise<string> {
    const joinedAt = Date.now();
    let leftAt: number | null = null;
    let lastText = "";
    let openedTranscript = false;
    while (!pollAbort.current) {
      const st = await api.calliqBotStatus(botId);
      const hasLines = Boolean(st.transcriptText?.trim());
      const inMeeting = st.status === "joining" || st.status === "in_call";
      setBotNote(`${st.status}${st.detail ? ` · ${st.detail}` : ""}`);
      const botLeft =
        st.status === "waiting_transcript" || st.status === "done" || st.status === "failed";
      if (inMeeting) leftAt = null;
      else leftAt ??= Date.now();
      if (botLeft) setLeavingBot(true);
      if (st.status === "waiting_transcript" || st.status === "done" || hasLines) {
        setPipelineActive("hear");
        setPipelineDone(["bot"]);
      } else {
        setPipelineActive("bot");
        setPipelineDone([]);
      }
      setStages((prev) =>
        prev.map((s) =>
          s.id === "bot"
            ? {
                ...s,
                label: botLeft ? "Bot left Meet" : "Bot in Meet",
                detail: st.detail ? `${st.status} · ${st.detail}` : st.status,
              }
            : s.id === "hear" && !hasLines
              ? {
                  ...s,
                  detail: inMeeting ? "listening for live captions…" : "finalizing transcript…",
                }
              : s,
        ),
      );
      if (hasLines) {
        const text = st.transcriptText!.trim();
        lastText = text;
        setTranscript(text);
        if (!openedTranscript) {
          openedTranscript = true;
          setDetailTab("transcript");
        }
        patchCall(callId, {
          transcript: text,
          status: botLeft ? "analyzing" : "recording",
        });
        setStages((prev) =>
          prev.map((s) =>
            s.id === "hear"
              ? {
                  ...s,
                  detail:
                    st.status === "done" || st.status === "waiting_transcript"
                      ? `${text.split("\n").length} lines`
                      : `live · ${text.split("\n").length} lines`,
                }
              : s,
          ),
        );
      } else if (botLeft) {
        patchCall(callId, { status: "analyzing" });
      }
      if (st.status === "failed") throw new Error(st.error || st.detail || "Bot failed");
      if (st.status === "done" && st.transcriptText?.trim()) return st.transcriptText.trim();
      if (inMeeting && Date.now() - joinedAt > 3 * 60 * 60 * 1000) {
        throw new Error("Bot was in the Meet too long. Click Finish & analyze.");
      }
      if (leftAt && Date.now() - leftAt > 180_000) {
        if (lastText) return lastText;
        throw new Error(
          "Timed out waiting for the transcript after the bot left. Stay on the call a bit longer next time, or upload the recording.",
        );
      }
      await sleep(800);
    }
    if (lastText) return lastText;
    throw new Error("Bot session cancelled.");
  }

  async function runLiveBotSession(botId: string, meetingUrl: string, draftId?: string) {
    pollAbort.current = false;
    const draft =
      draftId != null
        ? { id: draftId }
        : createDraft("meet", {
            status: "recording",
            meetingUrl,
            title: `${meetingHostLabel(meetingUrl)} call`,
          });
    setBotSessionId(botId);
    saveLiveBot({ botId, callId: draft.id, meetingUrl, startedAt: Date.now() });
    setStages((prev) =>
      prev.map((s) => (s.id === "bot" ? { ...s, label: "Bot in Meet", detail: "waiting for call to end" } : s)),
    );

    const text = await pollUntilTranscript(botId, draft.id);
    setTranscript(text);
    const already = loadCalls().find((c) => c.id === draft.id);
    if (already?.analysis) {
      setShowJoin(false);
      saveLiveBot(null);
      return;
    }
    setPipelineActive("recap");
    setPipelineDone(["bot", "hear"]);
    setStages((prev) =>
      prev.map((s) =>
        s.id === "hear"
          ? { ...s, detail: `${text.split("\n").length} lines` }
          : s.id === "recap"
            ? { ...s, detail: "running…" }
            : s,
      ),
    );
    setBotNote("Hear ready. Running Recap…");
    await analyze(text, { callId: draft.id, keepPipeline: true, source: "meet" });
    saveLiveBot(null);
    setShowJoin(false);
  }

  async function resumeLiveBot(live: { botId: string; callId: string; meetingUrl: string }) {
    if (joinInFlight.current) return;
    joinInFlight.current = true;
    setMeetUrl(live.meetingUrl);
    setWorkingCallId(live.callId);
    setSelectedId(live.callId);
    saveSelectedCallId(live.callId);
    setShowJoin(true);
    setBotBusy(true);
    setError(null);
    setDetailTab("transcript");
    setPipelineActive("bot");
    setPipelineDone([]);
    setStages([
      { id: "bot", label: "Bot in Meet", detail: "resumed in this tab" },
      { id: "hear", label: "Hear — live captions…", detail: "syncing" },
      { id: "recap", label: "Recap — deal notes…", detail: "waiting" },
    ]);
    const existing = loadCalls().find((c) => c.id === live.callId);
    if (existing?.transcript) setTranscript(existing.transcript);
    try {
      await runLiveBotSession(live.botId, live.meetingUrl, live.callId);
    } catch (e) {
      if (pollAbort.current) return;
      const msg = e instanceof Error ? e.message : String(e);
      if (!/not found/i.test(msg)) setError(msg);
    } finally {
      joinInFlight.current = false;
      setBotBusy(false);
      setBotSessionId(null);
      setLeavingBot(false);
      pollAbort.current = false;
      const next = queuedJoin.current;
      queuedJoin.current = null;
      if (next) void joinBot(next);
    }
  }

  async function joinBot(urlOverride?: string) {
    if (joinInFlight.current) {
      const rawQueued = (urlOverride ?? meetUrl).trim();
      const next = extractMeetingUrl(rawQueued) ?? rawQueued;
      if (isUsableMeetingUrl(next)) queuedJoin.current = next;
      return;
    }
    const raw = (urlOverride ?? meetUrl).trim();
    const url = extractMeetingUrl(raw) ?? raw;
    if (botBusy && (extractMeetingUrl(meetUrl) ?? meetUrl) === url) {
      setShowJoin(true);
      return;
    }
    const existingLive = loadLiveBot();
    if (existingLive && extractMeetingUrl(existingLive.meetingUrl) === extractMeetingUrl(url)) {
      try {
        const st = await api.calliqBotStatus(existingLive.botId);
        if (st.status === "joining" || st.status === "in_call" || st.status === "waiting_transcript") {
          void resumeLiveBot(existingLive);
          return;
        }
      } catch {
        /* stale — send a new bot */
      }
      saveLiveBot(null);
    }
    if (!isUsableMeetingUrl(url)) {
      setError("Need a real Meet/Zoom/Teams link (not meet.google.com/new).");
      setShowJoin(true);
      setShowManualLink(true);
      return;
    }
    joinInFlight.current = true;
    setMeetUrl(url);
    const draft = createDraft("meet", {
      status: "recording",
      meetingUrl: url,
      title: `${meetingHostLabel(url)} call`,
    });
    setBotBusy(true);
    setError(null);
    setDetailTab("transcript");
    setPipelineActive("bot");
    setPipelineDone([]);
    setStages([
      { id: "bot", label: "Bot joining Meet…", detail: "Attendee" },
      { id: "hear", label: "Hear — live captions…", detail: "waiting for speech" },
      { id: "recap", label: "Recap — deal notes…", detail: "waiting" },
    ]);
    try {
      const join = await api.calliqBotJoin({
        meetingUrl: url,
        botName: "CallIQ Bot",
        prefer: "auto",
        demo: false,
      });
      setBotNote(`Joined · ${join.detail ?? join.status}`);
      setStages((prev) =>
        prev.map((s) =>
          s.id === "bot" ? { ...s, label: `Bot (${join.provider})`, detail: join.detail ?? join.status } : s,
        ),
      );
      saveLiveBot({ botId: join.id, callId: draft.id, meetingUrl: url, startedAt: Date.now() });
      await runLiveBotSession(join.id, url, draft.id);
    } catch (e) {
      if (pollAbort.current) return;
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      patchCall(draft.id, { status: "failed", error: msg });
      setStages([]);
      setPipelineActive(null);
      setPipelineDone([]);
      saveLiveBot(null);
    } finally {
      joinInFlight.current = false;
      setBotBusy(false);
      setBotSessionId(null);
      setLeavingBot(false);
      pollAbort.current = false;
      const next = queuedJoin.current;
      queuedJoin.current = null;
      if (next && next !== url) void joinBot(next);
    }
  }

  async function finishBotNow() {
    if (!botSessionId || leavingBot) return;
    setLeavingBot(true);
    if (workingCallId) patchCall(workingCallId, { status: "analyzing" });
    setStages((prev) =>
      prev.map((s) =>
        s.id === "bot" ? { ...s, label: "Bot leaving Meet", detail: "stop recording" } : s,
      ),
    );
    try {
      const st = await api.calliqBotLeave(botSessionId);
      setBotNote(`Leave requested · ${st.detail ?? st.status}`);
    } catch (e) {
      setLeavingBot(false);
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function uploadRecording(file: File) {
    setShowJoin(false);
    setError(null);
    setBusy(true);
    const draft = createDraft("upload", {
      title: displayFileName(file.name).replace(/\.[^.]+$/, "") || "Uploaded recording",
      status: "recording",
    });
    setDetailTab("activity");
    setPipelineActive("hear");
    setPipelineDone([]);
    setStages([
      { id: "hear", label: "Hear — transcribing recording…", detail: displayFileName(file.name) },
      { id: "recap", label: "Recap — deal notes…", detail: "waiting" },
    ]);
    try {
      const prepared = await prepareForStt(file);
      if (prepared.audioBase64.length > 18_000_000) {
        throw new Error("Recording too large after encode (max ~12MB).");
      }
      setBusy(true);
      setError(null);
      patchCall(draft.id, { status: "analyzing" });
      const out = await api.analyzeCallIQ({
        audioBase64: prepared.audioBase64,
        audioFormat: prepared.audioFormat,
        sttProvider,
        llmProvider,
        verifyProvider: llmProvider,
      });
      const text = out.transcript?.text?.trim() ?? "";
      if (!text) throw new Error("No speech detected in that recording.");
      setTranscript(text);
      setStages(out.stages ?? []);
      setPipelineActive(null);
      setPipelineDone((out.stages ?? []).map((s) => s.id));
      const analysis = {
        ...(out.analysis as CallAnalysis),
        talkRatio: out.recap?.talkRatio,
        keywords: out.recap?.keywords,
      };
      const title =
        (typeof analysis.summary === "string" && analysis.summary.trim()
          ? analysis.summary.trim().slice(0, 72)
          : null) ?? titleFromTranscript(text, "upload");
      patchCall(draft.id, {
        transcript: text,
        status: "ready",
        runId: out.runId,
        analysis,
        title,
        error: undefined,
      });
      selectCall(draft.id);
      setDetailTab("notes");
      setBusy(false);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      patchCall(draft.id, { status: "failed", error: msg });
      setStages([]);
      setPipelineActive(null);
      setPipelineDone([]);
      setBusy(false);
    }
  }

  function removeSelected() {
    if (!selectedId) return;
    setCalls((prev) => {
      const next = deleteCall(prev, selectedId);
      saveCalls(next);
      const fallback = next[0]?.id ?? null;
      setSelectedId(fallback);
      saveSelectedCallId(fallback);
      if (fallback) {
        const c = next.find((x) => x.id === fallback);
        if (c) {
          setTranscript(c.transcript);
          setDetailTab(c.analysis ? "notes" : "transcript");
        }
      } else {
        setTranscript("");
      }
      return next;
    });
  }

  const analysis = selected?.analysis;
  const inLiveSession = botBusy || meetPhase !== "idle";
  const embedded = typeof window !== "undefined" && window.parent !== window;

  return (
    <div>
      <PageHeader
        title="CallIQ"
        description="Hear transcribes. Recap writes talk-ratio, keywords, and deal notes."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button disabled={busy || botBusy || awaitingFollowMe} onClick={() => void openStartCallPanel()}>
              Join Meet as bot
            </Button>
            <Button
              variant="secondary"
              disabled={busy || botBusy}
              onClick={() => void runProductDemo()}
            >
              {botBusy && meetPhase !== "idle" ? "Demo running…" : "Try demo"}
            </Button>
            <RecordingUploadButton
              variant="ghost"
              disabled={busy || botBusy}
              busy={busy && selected?.source === "upload" && selected.status === "recording"}
              onInvalid={(msg) => setError(msg)}
              onFile={(file) => void uploadRecording(file)}
            />
          </div>
        }
      />

      {embedded ? (
        <p className="mb-3 text-[11px] text-ink-500">
          Stay in Meet. Live transcript and recap stay in this panel — no extra CallIQ tab.
        </p>
      ) : null}

      {error ? (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-status-block">
          {error}
        </div>
      ) : null}

      {meetPhase !== "idle" ? (
        <div className="mb-5">
          <SimulatedMeetStage
            phase={meetPhase}
            present={meetPresent}
            waitingRoom={meetWaiting}
            activeSpeaker={activeSpeaker}
            caption={liveCaption}
            statusLine={meetStatus}
          />
        </div>
      ) : null}

      {showJoin ? (
        <section className="panel mb-5 space-y-4 p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold">Send CallIQ Bot to your Meet</h2>
              <p className="mt-1 max-w-xl text-xs text-ink-500">{botHint}</p>
            </div>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => {
                setShowJoin(false);
                setAwaitingFollowMe(false);
                window.postMessage({ type: "calliq.cancelFollowMe" }, "*");
              }}
            >
              Close
            </Button>
          </div>

          <div className="space-y-3">
            <div>
              <Label>Meet / Zoom / Teams link</Label>
              <Input
                value={meetUrl}
                onChange={(e) => setMeetUrl(e.target.value)}
                placeholder="https://meet.google.com/abc-defg-hij"
                disabled={botBusy}
                autoFocus
              />
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                size="sm"
                disabled={busy || botBusy || !meetUrl.trim()}
                onClick={() => void joinBot()}
              >
                {botBusy ? (leavingBot ? "Finalizing…" : "Bot in call…") : "Send CallIQ Bot"}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                disabled={busy || botBusy}
                onClick={async () => {
                  const url = (await readClipboardMeeting()) ?? clipboardUrl;
                  setClipboardUrl(url);
                  if (!url) {
                    setError(
                      "No Meet/Zoom/Teams link found on the clipboard. Copy the invite link in Meet first.",
                    );
                    return;
                  }
                  setMeetUrl(url);
                  setError(null);
                  await joinBot(url);
                }}
              >
                Use link from clipboard
              </Button>
              {botBusy && botSessionId ? (
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  disabled={leavingBot}
                  onClick={() => void finishBotNow()}
                >
                  {leavingBot ? "Leaving…" : "Finish & analyze"}
                </Button>
              ) : null}
            </div>
            {clipboardUrl && clipboardUrl !== meetUrl ? (
              <p className="truncate font-mono text-[10px] text-ink-400">Clipboard: {clipboardUrl}</p>
            ) : null}
            {botNote ? <p className="text-xs text-ink-500">{botNote}</p> : null}
            <p className="text-[11px] text-ink-400">
              Watch Meet → People. Admit <span className="font-medium text-ink-600">one</span> CallIQ Bot (deny extras).
              Teammates should not Send Bot — they will not get the transcript. “Joining” while Chrome knocks is not a
              Google block.
            </p>
          </div>

          <button
            type="button"
            className="text-[11px] text-ink-500 underline-offset-2 hover:text-ink-800 hover:underline"
            onClick={() => setShowOtherWays((v) => !v)}
          >
            {showOtherWays ? "Hide alternatives" : "Alternatives (demo / Google / extension)"}
          </button>

          {showOtherWays ? (
            <div className="flex flex-wrap gap-2 border-t border-ink-100 pt-3">
              <Button
                type="button"
                size="sm"
                variant="secondary"
                disabled={busy || botBusy}
                onClick={() => void startInAppCall()}
              >
                Start in-app call
              </Button>
              {google.data?.connected ? (
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  disabled={busy || botBusy || awaitingFollowMe}
                  onClick={() => void startRealGoogleMeetCall()}
                >
                  Start real Google Meet
                </Button>
              ) : google.data?.configured ? (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  disabled={busy || botBusy}
                  onClick={() => {
                    window.location.href = `${api.apiBase}/api/google/oauth/start`;
                  }}
                >
                  Connect Google
                </Button>
              ) : null}
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={busy || botBusy}
                onClick={() => void bringBotIntoCurrentMeet()}
              >
                Extension: bring bot
              </Button>
              <RecordingUploadButton
                size="sm"
                variant="secondary"
                disabled={busy || botBusy}
                onInvalid={(msg) => setError(msg)}
                onFile={(file) => void uploadRecording(file)}
              />
            </div>
          ) : null}
        </section>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-[280px_minmax(0,1fr)]">
        {/* Call library */}
        <aside className="panel overflow-hidden p-0">
          <div className="flex items-center justify-between border-b border-ink-100 px-3 py-2.5">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-ink-500">Calls</h2>
            <button
              type="button"
              className="text-[11px] text-ink-500 underline-offset-2 hover:text-ink-800 hover:underline"
              onClick={() => setShowSettings((v) => !v)}
            >
              {showSettings ? "Hide settings" : "Settings"}
            </button>
          </div>
          {showSettings ? (
            <div className="space-y-3 border-b border-ink-100 bg-ink-50/80 p-3">
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
                <p className="mt-1 text-[11px] text-ink-400">PyAI Hear batch + diarize when a recording is uploaded.</p>
              </div>
              <div>
                <Label>Recap (deal notes)</Label>
                <Select value={llmProvider} onChange={(e) => setLlmProvider(e.target.value)}>
                  {llmOptions.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                      {p.configured ? "" : " (needs key)"}
                    </option>
                  ))}
                </Select>
                <p className="mt-1 text-[11px] text-ink-400">Talk-ratio + keywords from Hear, then this model writes the deal record.</p>
              </div>
            </div>
          ) : null}
          {calls.length === 0 ? (
            <div className="p-4 text-sm text-ink-500">No calls yet.</div>
          ) : (
            <ul className="max-h-[560px] divide-y divide-ink-100 overflow-y-auto">
              {calls.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => {
                      selectCall(c.id);
                      setShowJoin(false);
                    }}
                    className={cn(
                      "flex w-full flex-col gap-0.5 px-3 py-2.5 text-left transition hover:bg-ink-50",
                      selectedId === c.id && "bg-accent/5 hover:bg-accent/10",
                    )}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-sm font-medium text-ink-900">{c.title}</span>
                      <span className="shrink-0 rounded bg-ink-100 px-1.5 py-0.5 text-[10px] font-medium uppercase text-ink-500">
                        {sourceLabel(c.source)}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 text-[11px] text-ink-400">
                      <span>{new Date(c.updatedAt).toLocaleString()}</span>
                      <span>·</span>
                      <span className="capitalize">{c.status}</span>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </aside>

        {/* Call detail / empty */}
        <section className="min-w-0 space-y-4">
          {!selected && !inLiveSession ? (
            <EmptyState
              title="No call selected"
              body="Join Meet as bot, upload a recording to transcribe, or Try demo."
              actionLabel="Join Meet as bot"
              onAction={() => void openStartCallPanel()}
            />
          ) : selected ? (
            <>
              <div className="panel flex flex-wrap items-start justify-between gap-3 p-4">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="truncate text-lg font-semibold text-ink-950">{selected.title}</h2>
                    <span className="rounded bg-ink-100 px-1.5 py-0.5 text-[10px] font-medium uppercase text-ink-500">
                      {sourceLabel(selected.source)}
                    </span>
                    {selected.status === "ready" ? <StatusBadge status="SUCCEEDED" /> : null}
                    {selected.status === "recording" ? <StatusBadge status="RECORDING" /> : null}
                    {selected.status === "analyzing" ? <StatusBadge status="ANALYZING" /> : null}
                    {selected.status === "failed" ? <StatusBadge status="FAILED" /> : null}
                  </div>
                  <p className="mt-1 text-xs text-ink-400">
                    Updated {new Date(selected.updatedAt).toLocaleString()}
                    {selected.runId ? ` · ${selected.runId}` : ""}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {selected.status === "draft" || selected.status === "failed" ? (
                    <Button
                      size="sm"
                      disabled={busy || botBusy || !transcript.trim()}
                      onClick={() => void analyze(transcript, { callId: selected.id, source: selected.source })}
                    >
                      {busy ? "Analyzing…" : "Analyze call"}
                    </Button>
                  ) : null}
                  {selected.status === "ready" ? (
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={busy || botBusy || !transcript.trim()}
                      onClick={() => void analyze(transcript, { callId: selected.id, source: selected.source })}
                    >
                      Re-analyze
                    </Button>
                  ) : null}
                  <Button size="sm" variant="ghost" disabled={busy || botBusy} onClick={removeSelected}>
                    Delete
                  </Button>
                </div>
              </div>

              <div className="flex gap-1 border-b border-ink-100">
                {(
                  [
                    ["notes", "Deal notes"],
                    ["transcript", "Transcript"],
                    ["activity", "Activity"],
                  ] as const
                ).map(([id, label]) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setDetailTab(id)}
                    className={cn(
                      "px-3 py-2 text-sm font-medium transition",
                      detailTab === id
                        ? "border-b-2 border-accent text-ink-900"
                        : "text-ink-500 hover:text-ink-800",
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>

              {detailTab === "notes" ? (
                !analysis ? (
                  <EmptyState
                    title="Deal notes not ready"
                    body={
                      selected.status === "draft"
                        ? "Add or edit the transcript, then Analyze call."
                        : selected.status === "analyzing" || selected.status === "recording"
                          ? "Still working — check Activity for progress."
                          : "Analyze this call to extract objections, next steps, and a follow-up email."
                    }
                    actionLabel={selected.status === "draft" || selected.status === "failed" ? "Analyze call" : undefined}
                    onAction={
                      selected.status === "draft" || selected.status === "failed"
                        ? () => void analyze(transcript, { callId: selected.id, source: selected.source })
                        : undefined
                    }
                  />
                ) : (
                  <div className="space-y-4 animate-fade-up">
                    <div className="panel p-4">
                      {typeof analysis.dealHealthScore === "number" ? (
                        <div className="text-2xl font-semibold tabular-nums">
                          Deal health {analysis.dealHealthScore}
                        </div>
                      ) : null}
                      {analysis.dealHealthRationale ? (
                        <p className="mt-2 text-sm text-ink-700">{analysis.dealHealthRationale}</p>
                      ) : null}
                      {analysis.summary ? (
                        <p className="mt-2 text-sm text-ink-600">{analysis.summary}</p>
                      ) : null}
                    </div>
                    {analysis.talkRatio?.length ? (
                      <div className="panel p-4">
                        <h3 className="text-sm font-semibold">Talk ratio</h3>
                        <ul className="mt-2 space-y-2">
                          {analysis.talkRatio.map((row) => (
                            <li key={row.speaker} className="text-sm">
                              <div className="flex items-center justify-between gap-2">
                                <span className="font-medium">{row.speaker}</span>
                                <span className="tabular-nums text-ink-500">{row.pct}%</span>
                              </div>
                              <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-ink-100">
                                <div
                                  className="h-full rounded-full bg-accent"
                                  style={{ width: `${Math.max(2, Math.min(100, row.pct))}%` }}
                                />
                              </div>
                            </li>
                          ))}
                        </ul>
                      </div>
                    ) : null}
                    {analysis.keywords?.length ? (
                      <div className="panel p-4">
                        <h3 className="text-sm font-semibold">Keywords</h3>
                        <p className="mt-2 flex flex-wrap gap-1.5 text-sm">
                          {analysis.keywords.map((k) => (
                            <span key={k.term} className="rounded-full bg-ink-50 px-2 py-0.5 text-ink-700">
                              {k.term}
                              <span className="ml-1 tabular-nums text-ink-400">{k.count}</span>
                            </span>
                          ))}
                        </p>
                      </div>
                    ) : null}
                    {analysis.objections?.length ? (
                      <div className="panel p-4">
                        <h3 className="text-sm font-semibold">Objections</h3>
                        <ul className="mt-2 space-y-2 text-sm">
                          {analysis.objections.map((o, i) => (
                            <li key={i} className="rounded-lg bg-ink-50 px-3 py-2">
                              <span className="font-medium">{o.type}</span> — {o.detail}
                            </li>
                          ))}
                        </ul>
                      </div>
                    ) : null}
                    {analysis.nextSteps?.length ? (
                      <div className="panel p-4">
                        <h3 className="text-sm font-semibold">Next steps</h3>
                        <ul className="mt-2 space-y-1 text-sm">
                          {analysis.nextSteps.map((n, i) => (
                            <li key={i}>
                              • {n.owner ? `${n.owner}: ` : ""}
                              {n.task}
                            </li>
                          ))}
                        </ul>
                      </div>
                    ) : null}
                    {analysis.followUpEmail ? (
                      <div className="panel p-4">
                        <h3 className="text-sm font-semibold">Follow-up email</h3>
                        <pre className="mt-2 whitespace-pre-wrap font-mono text-[12px] text-ink-700">
                          {analysis.followUpEmail}
                        </pre>
                      </div>
                    ) : null}
                  </div>
                )
              ) : null}

              {detailTab === "transcript" ? (
                <div className="panel p-4">
                  <Label>Transcript</Label>
                  <Textarea
                    value={transcript}
                    onChange={(e) => {
                      setTranscript(e.target.value);
                      patchCall(selected.id, { transcript: e.target.value, status: selected.analysis ? selected.status : "draft" });
                    }}
                    placeholder={
                      botBusy
                        ? "Live captions appear here as people speak. Turn on captions in Meet if nothing shows after a few seconds."
                        : "Transcript from Meet, upload, or demo…"
                    }
                    className="min-h-[360px] font-mono text-[13px] leading-relaxed"
                    disabled={busy || botBusy}
                  />
                  <div className="mt-3 flex justify-end">
                    <Button
                      size="sm"
                      disabled={busy || botBusy || !transcript.trim()}
                      onClick={() => void analyze(transcript, { callId: selected.id, source: selected.source })}
                    >
                      {busy ? "Analyzing…" : selected.analysis ? "Re-analyze" : "Analyze call"}
                    </Button>
                  </div>
                </div>
              ) : null}

              {detailTab === "activity" ? (
                <div className="panel p-4">
                  {(busy || botBusy || stages.length > 0) && (
                    <>
                      <h3 className="mb-3 text-sm font-semibold">Progress</h3>
                      <DemoStages
                        stages={stages}
                        running={busy || botBusy}
                        activeId={pipelineActive}
                        completedIds={pipelineDone}
                      />
                      {botNote ? <p className="mt-3 text-xs text-ink-500">{botNote}</p> : null}
                    </>
                  )}
                  {!busy && !botBusy && stages.length === 0 ? (
                    <p className="text-sm text-ink-500">No active pipeline. Join a call or analyze to see progress here.</p>
                  ) : null}
                  {selected.error ? (
                    <p className="mt-3 text-sm text-status-block">{selected.error}</p>
                  ) : null}
                </div>
              ) : null}
            </>
          ) : (
            <div className="panel p-4">
              <h3 className="mb-3 text-sm font-semibold">In progress</h3>
              <DemoStages
                stages={stages}
                running={busy || botBusy}
                activeId={pipelineActive}
                completedIds={pipelineDone}
              />
              {botNote ? <p className="mt-3 text-xs text-ink-500">{botNote}</p> : null}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
