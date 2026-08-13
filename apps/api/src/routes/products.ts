import type { FastifyInstance } from "fastify";
import { Capability } from "@pyai/core";
import type { AppServices } from "../services.js";
import { liveCandidates, pickProvider } from "../providerPick.js";

const WF_SAMPLE = {
  spokenPhrase: "Hey can you like uh send this to the team tomorrow about the NestJS migration",
  rawText: "hey can you like uh send this to the team tomorrow about the nestjs migration",
  appName: "Slack",
  dictionary: [{ term: "nestjs", replacement: "NestJS" }],
};

/** Product routes for Scrib, Brief, Simulator. */
export async function productsRoutes(app: FastifyInstance, svc: AppServices): Promise<void> {
  // ---- Scrib ----
  app.post<{
    Body: {
      rawText?: string;
      mode?: string;
      appName?: string;
      sttProvider?: string;
      cleanupProvider?: string;
      dictionary?: Array<{ term: string; replacement: string }>;
    };
  }>("/api/scrib/dictate", async (req) => {
    const { buildScribWorkflow } = await import("@pyai/scrib");
    const cleanupProvider = pickProvider(svc.platform, Capability.LLM, req.body.cleanupProvider);
    const { def, getArtifact } = buildScribWorkflow(svc.platform, {
      rawText: req.body.rawText,
      mode: req.body.mode as never,
      appName: req.body.appName,
      sttProvider: req.body.sttProvider,
      cleanupProvider,
      dictionary: req.body.dictionary,
    });
    const out = await svc.platform.engine.execute(def);
    const art = getArtifact();
    return {
      status: out.status,
      runId: out.runId,
      durationMs: out.durationMs,
      usage: out.usage,
      ...art,
    };
  });

  app.get("/api/sample/scrib", async () => ({
    rawText: WF_SAMPLE.rawText,
    spokenPhrase: WF_SAMPLE.spokenPhrase,
    appName: WF_SAMPLE.appName,
    dictionary: WF_SAMPLE.dictionary,
  }));

  /**
   * Demo step 1: synthesize sample speech only (client plays it before hear/cleanup).
   * Tries preferred → pyai → openai so a single provider outage/cap doesn't mute the demo.
   */
  app.post<{
    Body: { ttsProvider?: string };
  }>("/api/scrib/demo/speak", async (req) => {
    const preferred = req.body.ttsProvider;
    const candidates = liveCandidates(preferred);

    const t0 = Date.now();
    const errors: string[] = [];

    for (const id of candidates) {
      const adapter = svc.platform.registry.getAdapterFor(Capability.TTS, id);
      if (!adapter?.isConfigured?.() || !adapter.asTTS) continue;
      try {
        const spoken = await adapter.asTTS().synthesize({ text: WF_SAMPLE.spokenPhrase, format: "mp3" });
        const speakMs = Date.now() - t0;
        if (spoken.audio.length > 0 && spoken.audio.length < 2_000_000) {
          return {
            demoMode: "live" as const,
            spokenPhrase: WF_SAMPLE.spokenPhrase,
            audioBase64: Buffer.from(spoken.audio).toString("base64"),
            audioFormat: spoken.format || "mp3",
            ttsProvider: id,
            speakMs,
            fallbackNote: errors.length ? `fallback after: ${errors.join("; ")}` : undefined,
            stage: {
              id: "speak",
              label: "Push-to-talk (Speak)",
              detail: `${id} · playing sample utterance`,
              ms: speakMs,
            },
          };
        }
        errors.push(`${id}: empty audio`);
      } catch (e) {
        errors.push(`${id}: ${e instanceof Error ? e.message.slice(0, 120) : "failed"}`);
      }
    }

    return {
      demoMode: "simulated" as const,
      spokenPhrase: WF_SAMPLE.spokenPhrase,
      ttsProvider: "browser",
      speakMs: Date.now() - t0,
      useBrowserSpeech: true,
      stage: {
        id: "speak",
        label: "Push-to-talk (browser speech)",
        detail: errors.length
          ? `Live TTS unavailable (${errors[0]}); using browser voice`
          : "Using browser speech synthesis",
      },
    };
  });

  /**
   * Demo step 2: after audio plays — Hear (optional) → cleanup → insert-ready.
   */
  app.post<{
    Body: {
      mode?: string;
      appName?: string;
      sttProvider?: string;
      cleanupProvider?: string;
      audioBase64?: string;
      audioFormat?: string;
      demoMode?: "live" | "simulated";
    };
  }>("/api/scrib/demo/finish", async (req, reply) => {
    const { buildScribWorkflow } = await import("@pyai/scrib");
    const sttProvider = pickProvider(svc.platform, Capability.BATCH_STT, req.body.sttProvider);
    const cleanupProvider = pickProvider(svc.platform, Capability.LLM, req.body.cleanupProvider);
    const appName = req.body.appName ?? WF_SAMPLE.appName;
    const mode = (req.body.mode as never) ?? "concise";
    const stages: Array<{ id: string; label: string; detail?: string; ms?: number }> = [];
    let raw = WF_SAMPLE.rawText;
    let hearMs = 0;
    let demoMode: "live" | "simulated" = req.body.demoMode ?? "simulated";

    const b64 = req.body.audioBase64?.trim();
    if (b64 && b64.length < 10_000_000) {
      try {
        const audio = Uint8Array.from(Buffer.from(b64, "base64"));
        const sttAdapter = svc.platform.registry.getAdapterFor(Capability.BATCH_STT, sttProvider);
        const stt = sttAdapter?.asSTT?.();
        if (stt && sttProvider !== "mock" && audio.length > 0) {
          const tHear = Date.now();
          const heard = await stt.transcribe({
            audio,
            format: req.body.audioFormat ?? "mp3",
          });
          hearMs = Date.now() - tHear;
          raw = heard.text?.trim() || WF_SAMPLE.rawText;
          demoMode = "live";
          stages.push({
            id: "hear",
            label: "Transcribe (Hear)",
            detail: `${sttProvider} → “${raw.slice(0, 80)}${raw.length > 80 ? "…" : ""}”`,
            ms: hearMs,
          });
        }
      } catch (e) {
        stages.push({
          id: "hear",
          label: "Transcribe (fallback)",
          detail: e instanceof Error ? e.message : "STT failed; using sample raw text",
        });
        raw = WF_SAMPLE.rawText;
        demoMode = "simulated";
      }
    }

    if (!stages.some((s) => s.id === "hear")) {
      stages.push({
        id: "hear",
        label: "Transcribe",
        detail: `Using sample utterance · STT=${sttProvider}`,
      });
    }

    const { def, getArtifact } = buildScribWorkflow(svc.platform, {
      rawText: raw,
      mode,
      appName,
      sttProvider,
      sttMs: hearMs,
      cleanupProvider,
      dictionary: WF_SAMPLE.dictionary,
    });
    const out = await svc.platform.engine.execute(def);
    const art = getArtifact();
    stages.push({
      id: "cleanup",
      label: "App-aware cleanup",
      detail: `${art.cleanupProvider} · mode=${art.mode} · app=${appName}`,
      ms: art.latency.cleanupMs,
    });
    stages.push({
      id: "insert",
      label: "Ready to insert",
      detail: "Cleaned text would land in the focused Slack / Gmail / Notion field",
    });

    if (out.status === "FAILED") {
      const firstErr = Object.values(out.errors ?? {})[0] ?? "scrib demo failed";
      return reply.code(502).send({ error: firstErr, stages });
    }

    return {
      status: out.status,
      runId: out.runId,
      durationMs: out.durationMs,
      usage: out.usage,
      demoMode,
      spokenPhrase: WF_SAMPLE.spokenPhrase,
      stages,
      hearMs,
      ...art,
    };
  });

  /**
   * Legacy one-shot demo (still used by tests/scripts). Prefer speak → finish from the UI.
   */
  app.post<{
    Body: {
      mode?: string;
      appName?: string;
      sttProvider?: string;
      ttsProvider?: string;
      cleanupProvider?: string;
    };
  }>("/api/scrib/demo", async (req, reply) => {
    const speakRes = await app.inject({
      method: "POST",
      url: "/api/scrib/demo/speak",
      payload: { ttsProvider: req.body.ttsProvider },
    });
    const speak = speakRes.json() as {
      demoMode: "live" | "simulated";
      spokenPhrase: string;
      audioBase64?: string;
      audioFormat?: string;
      speakMs?: number;
      stage: { id: string; label: string; detail?: string; ms?: number };
    };
    const finishRes = await app.inject({
      method: "POST",
      url: "/api/scrib/demo/finish",
      payload: {
        mode: req.body.mode,
        appName: req.body.appName,
        sttProvider: req.body.sttProvider,
        cleanupProvider: req.body.cleanupProvider,
        audioBase64: speak.audioBase64,
        audioFormat: speak.audioFormat,
        demoMode: speak.demoMode,
      },
    });
    if (finishRes.statusCode >= 400) {
      return reply.code(finishRes.statusCode).send(finishRes.json());
    }
    const finish = finishRes.json() as Record<string, unknown> & {
      stages?: Array<{ id: string; label: string; detail?: string; ms?: number }>;
    };
    return {
      ...finish,
      audioBase64: speak.audioBase64,
      audioFormat: speak.audioFormat,
      speakMs: speak.speakMs,
      spokenPhrase: speak.spokenPhrase,
      stages: [speak.stage, ...(finish.stages ?? [])],
    };
  });

  /** Mic / extension audio → STT → cleanup. Keys stay server-side. */
  app.post<{
    Body: {
      audioBase64?: string;
      format?: string;
      appName?: string;
      mode?: string;
      sttProvider?: string;
      cleanupProvider?: string;
    };
  }>("/api/scrib/transcribe", async (req, reply) => {
    const b64 = req.body.audioBase64 ?? "";
    if (!b64 || b64.length > 20_000_000) {
      return reply.code(413).send({ error: "audioBase64 too large (max ~15MB). Hold a shorter clip." });
    }
    let audio: Uint8Array;
    try {
      audio = Uint8Array.from(Buffer.from(b64, "base64"));
    } catch {
      return reply.code(400).send({ error: "invalid base64" });
    }
    if (!audio.length) return reply.code(400).send({ error: "empty audio" });

    const { buildScribWorkflow } = await import("@pyai/scrib");
    const cleanupProvider = pickProvider(svc.platform, Capability.LLM, req.body.cleanupProvider);
    const preferred = req.body.sttProvider;
    const sttCandidates = [...liveCandidates(preferred), "mock"].filter(
      (id, i, arr) => arr.indexOf(id) === i,
    );

    let transcriptText = "";
    let sttProvider = "mock";
    let sttMs = 0;
    const sttErrors: string[] = [];

    for (const id of sttCandidates) {
      const adapter = svc.platform.registry.getAdapterFor(Capability.BATCH_STT, id);
      if (!adapter?.isConfigured?.() || !adapter.asSTT) continue;
      const tHear = Date.now();
      try {
        const res = await adapter.asSTT().transcribe({
          audio,
          format: req.body.format ?? "wav",
        });
        sttMs = Date.now() - tHear;
        transcriptText = res.text?.trim() ?? "";
        sttProvider = id;
        break;
      } catch (e) {
        sttErrors.push(`${id}: ${e instanceof Error ? e.message.slice(0, 160) : "failed"}`);
      }
    }

    if (!transcriptText && sttErrors.length) {
      return reply.code(502).send({
        error: `transcription failed — ${sttErrors[0]}${sttErrors.length > 1 ? ` (also tried ${sttErrors.length - 1} more)` : ""}`,
      });
    }
    if (!transcriptText) {
      return reply.code(502).send({ error: "transcription returned empty text" });
    }

    try {
      const { def, getArtifact } = buildScribWorkflow(svc.platform, {
        rawText: transcriptText,
        mode: (req.body.mode as never) ?? "light",
        appName: req.body.appName ?? "browser",
        sttProvider,
        sttMs,
        cleanupProvider,
      });
      const out = await svc.platform.engine.execute(def);
      const art = getArtifact();
      if (out.status === "FAILED") {
        const firstErr = Object.values(out.errors ?? {})[0] ?? "cleanup failed";
        return reply.code(502).send({ error: firstErr });
      }
      return {
        status: out.status,
        runId: out.runId,
        durationMs: out.durationMs,
        usage: out.usage,
        transcript: transcriptText,
        stages: [
          {
            id: "hear",
            label: "Transcribe",
            detail: sttErrors.length ? `${sttProvider} (fallback)` : sttProvider,
            ms: art.latency.sttMs,
          },
          { id: "cleanup", label: "Cleanup", detail: art.cleanupProvider, ms: art.latency.cleanupMs },
          { id: "insert", label: "Ready to insert", detail: art.cleaned.slice(0, 60) },
        ],
        ...art,
      };
    } catch (e) {
      return reply.code(502).send({
        error: e instanceof Error ? e.message : "scrib transcribe failed",
      });
    }
  });

  // ---- Brief ----
  const memory = svc.meetingMemory;

  const OG_SAMPLE = {
    // Me (you) vs Them (others on the call) — not named speakers.
    spokenPhrase: [
      "Me: Thanks for joining. Goal today is the July launch plan.",
      "Them: Security review is still open. I think we should move launch to August.",
      "Me: Agreed — decision: launch moves to August.",
      "Them: I'll own the security pack by Friday. Any questions on pricing?",
      "Me: Can we keep EU data residency in scope?",
    ].join(" "),
    transcriptText: [
      "Me: Thanks for joining. Goal today is the July launch plan.",
      "Them: Security review is still open. I think we should move launch to August.",
      "Me: Agreed — decision: launch moves to August.",
      "Them: I'll own the security pack by Friday. Any questions on pricing?",
      "Me: Can we keep EU data residency in scope?",
    ].join("\n"),
    mode: "Planning",
    title: "Launch planning",
  };

  /** Demo step 1: synthesize sample meeting audio for the client to play. */
  app.post<{
    Body: { ttsProvider?: string };
  }>("/api/brief/demo/speak", async (req) => {
    const preferred = req.body.ttsProvider;
    const candidates = liveCandidates(preferred);
    const t0 = Date.now();
    const errors: string[] = [];

    for (const id of candidates) {
      const adapter = svc.platform.registry.getAdapterFor(Capability.TTS, id);
      if (!adapter?.isConfigured?.() || !adapter.asTTS) continue;
      try {
        const spoken = await adapter.asTTS().synthesize({ text: OG_SAMPLE.spokenPhrase, format: "mp3" });
        const speakMs = Date.now() - t0;
        if (spoken.audio.length > 0 && spoken.audio.length < 2_000_000) {
          return {
            demoMode: "live" as const,
            spokenPhrase: OG_SAMPLE.spokenPhrase,
            sampleTranscript: OG_SAMPLE.transcriptText,
            mode: OG_SAMPLE.mode,
            audioBase64: Buffer.from(spoken.audio).toString("base64"),
            audioFormat: spoken.format || "mp3",
            ttsProvider: id,
            speakMs,
            fallbackNote: errors.length ? `fallback after: ${errors.join("; ")}` : undefined,
            stage: {
              id: "play",
              label: "Play meeting audio",
              detail: `${id} · sample planning call`,
              ms: speakMs,
            },
          };
        }
        errors.push(`${id}: empty audio`);
      } catch (e) {
        errors.push(`${id}: ${e instanceof Error ? e.message.slice(0, 120) : "failed"}`);
      }
    }

    return {
      demoMode: "simulated" as const,
      spokenPhrase: OG_SAMPLE.spokenPhrase,
      sampleTranscript: OG_SAMPLE.transcriptText,
      mode: OG_SAMPLE.mode,
      ttsProvider: "browser",
      speakMs: Date.now() - t0,
      useBrowserSpeech: true,
      stage: {
        id: "play",
        label: "Play meeting audio (browser)",
        detail: errors.length
          ? `Live TTS unavailable (${errors[0]}); using browser voice`
          : "Using browser speech synthesis",
      },
    };
  });

  /**
   * Demo step 2: after audio plays — Hear → summary → meeting memory.
   */
  app.post<{
    Body: {
      mode?: string;
      llmProvider?: string;
      sttProvider?: string;
      audioBase64?: string;
      audioFormat?: string;
      demoMode?: "live" | "simulated";
      title?: string;
    };
  }>("/api/brief/demo/finish", async (req, reply) => {
    const { buildBriefWorkflow } = await import("@pyai/brief");
    const llmProvider = pickProvider(svc.platform, Capability.LLM, req.body.llmProvider);
    const sttProvider = pickProvider(svc.platform, Capability.BATCH_STT, req.body.sttProvider);
    const mode = req.body.mode ?? OG_SAMPLE.mode;
    const title = req.body.title ?? OG_SAMPLE.title;
    const stages: Array<{ id: string; label: string; detail?: string; ms?: number }> = [];
    let transcriptText = OG_SAMPLE.transcriptText;
    let demoMode: "live" | "simulated" = req.body.demoMode ?? "simulated";
    let hearMs = 0;

    const b64 = req.body.audioBase64?.trim();
    if (b64 && b64.length < 10_000_000) {
      try {
        const audio = Uint8Array.from(Buffer.from(b64, "base64"));
        const sttAdapter = svc.platform.registry.getAdapterFor(Capability.BATCH_STT, sttProvider);
        const stt = sttAdapter?.asSTT?.();
        if (stt && sttProvider !== "mock" && audio.length > 0) {
          const tHear = Date.now();
          const heard = await stt.transcribe({
            audio,
            format: req.body.audioFormat ?? "mp3",
            diarize: true,
            prompt:
              "Me: Thanks for joining. Goal today is the July launch plan.\nThem: Security review is still open.\nTranscribe with Me: and Them: labels when possible.",
          });
          hearMs = Date.now() - tHear;
          const text = heard.text?.trim() ?? "";
          const weak =
            !text ||
            text.length < 40 ||
            /^(you[.!]?\s*)+$/i.test(text) ||
            /^thank you/i.test(text);
          // Keep Me/Them labels for the meeting brain.
          if (!weak) {
            demoMode = "live";
            const hasSpeakers = /\b(me|them)\s*:/i.test(text);
            transcriptText = hasSpeakers ? text : OG_SAMPLE.transcriptText;
            stages.push({
              id: "hear",
              label: "Hear (diarized STT)",
              detail: hasSpeakers
                ? `${sttProvider} · Me/Them labels preserved`
                : `${sttProvider} heard speech · applied Me/Them labels`,
              ms: hearMs,
            });
          } else {
            stages.push({
              id: "hear",
              label: "Hear (diarized STT)",
              detail: `${sttProvider} returned weak text; using Me/Them sample transcript`,
              ms: hearMs,
            });
            demoMode = "simulated";
          }
        }
      } catch (e) {
        stages.push({
          id: "hear",
          label: "Hear (fallback)",
          detail: e instanceof Error ? e.message.slice(0, 120) : "STT failed; using sample transcript",
        });
        demoMode = "simulated";
      }
    }

    if (!stages.some((s) => s.id === "hear")) {
      stages.push({
        id: "hear",
        label: "Hear (inline transcript)",
        detail: `Using sample meeting transcript · STT=${sttProvider}`,
      });
    }

    const { def, getArtifact } = buildBriefWorkflow(svc.platform, {
      transcriptText,
      mode: mode as never,
      title,
      llmProvider,
    });
    const out = await svc.platform.engine.execute(def);
    const art = getArtifact();
    memory.add(out.runId, art.notes, art.transcript);

    stages.push({
      id: "summary",
      label: "Summary (meeting notes)",
      detail: llmProvider,
      ms: out.durationMs,
    });
    stages.push({
      id: "memory",
      label: "Store in meeting memory",
      detail: out.runId,
    });

    if (out.status === "FAILED") {
      const firstErr = Object.values(out.errors ?? {})[0] ?? "brief demo failed";
      return reply.code(502).send({ error: firstErr, stages, transcriptText });
    }

    return {
      status: out.status,
      runId: out.runId,
      durationMs: out.durationMs,
      usage: out.usage,
      gates: out.gates,
      llmProvider,
      demoMode,
      spokenPhrase: OG_SAMPLE.spokenPhrase,
      transcriptText,
      hearMs,
      stages,
      ...art,
    };
  });

  app.post<{
    Body: {
      transcriptText?: string;
      audioBase64?: string;
      audioFormat?: string;
      mode?: string;
      title?: string;
      sttProvider?: string;
      llmProvider?: string;
      persist?: boolean;
    };
  }>("/api/brief/analyze", async (req, reply) => {
    const { buildBriefWorkflow } = await import("@pyai/brief");
    const llmProvider = pickProvider(svc.platform, Capability.LLM, req.body.llmProvider);
    const sttProvider = pickProvider(svc.platform, Capability.BATCH_STT, req.body.sttProvider);

    const b64 = req.body.audioBase64?.trim();
    let audio: Uint8Array | undefined;
    if (b64) {
      if (b64.length > 20_000_000) {
        return reply.code(413).send({ error: "audioBase64 too large (max ~15MB)" });
      }
      try {
        audio = Uint8Array.from(Buffer.from(b64, "base64"));
      } catch {
        return reply.code(400).send({ error: "invalid audioBase64" });
      }
      if (!audio.length) return reply.code(400).send({ error: "empty audio" });
    }
    const transcriptText = audio ? undefined : req.body.transcriptText;
    if (!audio && !transcriptText?.trim()) {
      return reply.code(400).send({ error: "audioBase64 or transcriptText required" });
    }

    const { def, getArtifact } = buildBriefWorkflow(svc.platform, {
      transcriptText,
      audio,
      mode: req.body.mode as never,
      title: req.body.title,
      sttProvider,
      llmProvider,
    });
    const out = await svc.platform.engine.execute(def);
    const art = getArtifact();
    if (req.body.persist !== false) {
      memory.add(out.runId, art.notes, art.transcript);
    }
    const hearDetail = audio
      ? `${sttProvider} · diarized batch`
      : art.privacy.uploadedTo === "inline"
        ? "inline transcript"
        : sttProvider;
    return {
      status: out.status,
      runId: out.runId,
      durationMs: out.durationMs,
      usage: out.usage,
      gates: out.gates,
      llmProvider,
      sttProvider,
      stages: [
        { id: "hear", label: "Hear (diarized STT)", detail: hearDetail },
        { id: "summary", label: "Summary (meeting notes)", detail: llmProvider },
        { id: "memory", label: "Store in meeting memory", detail: out.runId },
      ],
      ...art,
    };
  });

  app.get("/api/sample/brief", async () => ({
    transcriptText: OG_SAMPLE.transcriptText,
    mode: OG_SAMPLE.mode,
  }));

  app.get<{ Querystring: { q?: string } }>("/api/brief/search", async (req) => {
    const q = req.query.q ?? "";
    return { query: q, results: memory.search(q), meetings: memory.list() };
  });

  // ---- Simulator ----
  app.post<{
    Body: {
      agentName?: string;
      agentPrompt?: string;
      personaId?: string;
      scenarioId?: string;
      count?: number;
      concurrency?: number;
      llmProvider?: string;
    };
  }>("/api/simulator/run", async (req) => {
    const { buildSimulatorWorkflow } = await import("@pyai/simulator");
    const llmProvider = pickProvider(svc.platform, Capability.LLM, req.body.llmProvider);
    const { def, getArtifact } = buildSimulatorWorkflow(svc.platform, {
      agentName: req.body.agentName,
      agentPrompt: req.body.agentPrompt,
      personaId: req.body.personaId,
      scenarioId: req.body.scenarioId,
      count: req.body.count ?? 10,
      concurrency: req.body.concurrency ?? 5,
      llmProvider,
    });
    const out = await svc.platform.engine.execute(def);
    const card = getArtifact();
    return {
      status: out.status,
      runId: out.runId,
      durationMs: out.durationMs,
      usage: out.usage,
      llmProvider,
      stages: [
        { id: "spawn", label: "Spawn adversarial callers", detail: `${req.body.count ?? 10} personas` },
        { id: "score", label: "Score conversations", detail: llmProvider },
        { id: "card", label: "Build benchmark card", detail: `${card.passed}/${card.tests} passed` },
      ],
      card,
    };
  });

  app.get("/api/simulator/personas", async () => {
    const { PERSONAS, SCENARIOS } = await import("@pyai/simulator");
    return { personas: PERSONAS, scenarios: SCENARIOS };
  });

  // ---- CallIQ product demo (natural TTS Meet script) ----
  const CALLIQ_DEMO_TURNS: Array<{
    speaker: "rep" | "customer";
    label: string;
    text: string;
    line: string;
    voice: string;
  }> = [
    {
      speaker: "rep",
      label: "Rep",
      text: "Thanks for hopping on, Dana. I wanted to walk you through the enterprise plan.",
      line: "Rep: Thanks for hopping on, Dana. I wanted to walk you through the enterprise plan.",
      voice: "onyx",
    },
    {
      speaker: "customer",
      label: "Customer",
      text: "Honestly the main thing holding us back is the implementation cost. We got burned last year.",
      line: "Customer: Honestly the main thing holding us back is the implementation cost. We got burned last year.",
      voice: "nova",
    },
    {
      speaker: "rep",
      label: "Rep",
      text: "We do white-glove onboarding in under four weeks, and a dedicated engineer for the first 90 days.",
      line: "Rep: We do white-glove onboarding in under four weeks, and a dedicated engineer for the first 90 days.",
      voice: "onyx",
    },
    {
      speaker: "customer",
      label: "Customer",
      text: "That helps. But we also need to know if your security review passes our procurement.",
      line: "Customer: That helps. But we also need to know if your security review passes our procurement.",
      voice: "nova",
    },
    {
      speaker: "rep",
      label: "Rep",
      text: "We are SOC 2 Type II and have EU data residency. I can loop in our solutions architect next week.",
      line: "Rep: We are SOC 2 Type II and have EU data residency. I can loop in our solutions architect next week.",
      voice: "onyx",
    },
    {
      speaker: "customer",
      label: "Customer",
      text: "If you send the security pack and a timeline, we can get a decision maker in by end of month.",
      line: "Customer: If you send the security pack and a timeline, we can get a decision maker in by end of month.",
      voice: "nova",
    },
  ];

  /** Synthesize one Meet line with natural TTS (used so join isn't blocked on the full script). */
  app.post<{
    Body: { speaker?: "rep" | "customer"; text?: string; ttsProvider?: string };
  }>("/api/calliq/demo/speak-turn", async (req, reply) => {
    const speaker = req.body.speaker === "customer" ? "customer" : "rep";
    const text = (req.body.text ?? "").trim();
    if (!text || text.length > 500) {
      return reply.code(400).send({ error: "text required (max 500 chars)" });
    }
    const voice = speaker === "customer" ? "nova" : "onyx";
    const preferred = req.body.ttsProvider;
    const candidates = liveCandidates(preferred);
    const t0 = Date.now();
    const errors: string[] = [];

    for (const id of candidates) {
      const adapter = svc.platform.registry.getAdapterFor(Capability.TTS, id);
      if (!adapter?.isConfigured?.() || !adapter.asTTS) continue;
      try {
        const spoken = await adapter.asTTS().synthesize({
          text,
          format: "mp3",
          voice,
          model: id === "openai" ? "tts-1-hd" : undefined,
          speed: 1.0,
        });
        if (!spoken.audio.length || spoken.audio.length > 2_000_000) {
          errors.push(`${id}: bad audio size`);
          continue;
        }
        return {
          demoMode: "live" as const,
          ttsProvider: id,
          speakMs: Date.now() - t0,
          speaker,
          text,
          audioBase64: Buffer.from(spoken.audio).toString("base64"),
          audioFormat: spoken.format || "mp3",
        };
      } catch (e) {
        errors.push(`${id}: ${e instanceof Error ? e.message.slice(0, 140) : "failed"}`);
      }
    }

    return {
      demoMode: "simulated" as const,
      ttsProvider: "browser",
      speakMs: Date.now() - t0,
      speaker,
      text,
      useBrowserSpeech: true,
      fallbackNote: errors[0],
    };
  });

  /** Optional: pre-synthesize the full script (slower to start; kept for tooling). */
  app.post<{
    Body: { ttsProvider?: string };
  }>("/api/calliq/demo/speak-script", async (req) => {
    const preferred = req.body.ttsProvider;
    const candidates = liveCandidates(preferred);
    const t0 = Date.now();
    const errors: string[] = [];

    for (const id of candidates) {
      const adapter = svc.platform.registry.getAdapterFor(Capability.TTS, id);
      if (!adapter?.isConfigured?.() || !adapter.asTTS) continue;
      try {
        const tts = adapter.asTTS();
        const clips = await Promise.all(
          CALLIQ_DEMO_TURNS.map(async (turn) => {
            const spoken = await tts.synthesize({
              text: turn.text,
              format: "mp3",
              voice: turn.voice,
              model: id === "openai" ? "tts-1-hd" : undefined,
              speed: 1.0,
            });
            if (!spoken.audio.length || spoken.audio.length > 2_000_000) {
              throw new Error(`${turn.speaker}: bad audio size ${spoken.audio.length}`);
            }
            return {
              speaker: turn.speaker,
              label: turn.label,
              text: turn.text,
              line: turn.line,
              audioBase64: Buffer.from(spoken.audio).toString("base64"),
              audioFormat: spoken.format || "mp3",
            };
          }),
        );
        return {
          demoMode: "live" as const,
          ttsProvider: id,
          speakMs: Date.now() - t0,
          turns: clips,
          fallbackNote: errors.length ? `fallback after: ${errors.join("; ")}` : undefined,
        };
      } catch (e) {
        errors.push(`${id}: ${e instanceof Error ? e.message.slice(0, 140) : "failed"}`);
      }
    }

    return {
      demoMode: "simulated" as const,
      ttsProvider: "browser",
      speakMs: Date.now() - t0,
      useBrowserSpeech: true,
      turns: CALLIQ_DEMO_TURNS.map((t) => ({
        speaker: t.speaker,
        label: t.label,
        text: t.text,
        line: t.line,
      })),
      fallbackNote: errors.length
        ? `Live TTS unavailable (${errors[0]}); using browser voices`
        : "Using browser speech synthesis",
    };
  });
}
