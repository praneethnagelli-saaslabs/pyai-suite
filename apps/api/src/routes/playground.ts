import type { FastifyInstance } from "fastify";
import type { AppServices } from "../services.js";
import { Capability } from "@pyai/core";

/**
 * Universal playground + CallIQ routes (spec #13, #14, #30).
 * The playground runs a capability against the selected provider live and
 * returns latency/usage/cost so the user can compare providers.
 */
export async function playgroundRoutes(app: FastifyInstance, svc: AppServices): Promise<void> {
  // Universal capability runner (STT / LLM / TTS / Embeddings).
  app.post<{
    Body: {
      capability: string;
      provider?: string;
      input?: string;
      model?: string;
      audioBase64?: string;
      audioFormat?: string;
    };
  }>("/api/playground/run", async (req, reply) => {
      const { capability, provider, model } = req.body;
      const input = String(req.body.input ?? "");
      const audioBase64 = req.body.audioBase64;
      const audioFormat = req.body.audioFormat;
      const cap = capability as Capability;
      const adapter = svc.platform.registry.getAdapterFor(cap, provider);
      if (!adapter) return reply.code(400).send({ error: `no provider for capability ${capability}` });
      const t0 = Date.now();
      const trace = svc.platform.tracer.startRun(`playground_${capability}`, "playground");
      try {
        let output = "";
        let usage = { inputTokens: 0, outputTokens: 0, audioSeconds: 0, costUsd: 0, providerCalls: 1, cacheHits: 0 };
        let result: Record<string, unknown> = { kind: "text" };
        const stt = adapter.asSTT?.();
        const llm = adapter.asLLM?.();
        const tts = adapter.asTTS?.();
        const emb = adapter.asEmbeddings?.();
        if (cap === Capability.BATCH_STT || cap === Capability.STREAMING_STT) {
          if (!stt) return reply.code(400).send({ error: "provider has no STT" });

          let audio: Uint8Array;
          let format = audioFormat ?? "wav";
          let note = "";

          if (audioBase64?.trim()) {
            if (audioBase64.length > 10_000_000) {
              return reply.code(413).send({ error: "audioBase64 too large (max ~7MB)" });
            }
            try {
              audio = Uint8Array.from(Buffer.from(audioBase64, "base64"));
            } catch {
              return reply.code(400).send({ error: "invalid audioBase64" });
            }
            if (!audio.length) return reply.code(400).send({ error: "empty audio" });
          } else if (adapter.id === "mock") {
            audio = new TextEncoder().encode(input || "demo");
          } else if (input.trim() && tts) {
            // Official PyAI drop-in uses mp3 for Speak→Hear round-trips.
            const spoken = await tts.synthesize({ text: input.trim(), format: "mp3" });
            audio = spoken.audio;
            format = spoken.format || "mp3";
            usage = {
              inputTokens: usage.inputTokens + spoken.usage.inputTokens,
              outputTokens: usage.outputTokens + spoken.usage.outputTokens,
              audioSeconds: usage.audioSeconds + spoken.usage.audioSeconds,
              costUsd: usage.costUsd + spoken.usage.costUsd,
              providerCalls: usage.providerCalls + spoken.usage.providerCalls,
              cacheHits: usage.cacheHits + spoken.usage.cacheHits,
            };
            note = "Synthesized from text via TTS (mp3), then transcribed.";
          } else {
            return reply.code(400).send({
              error:
                "Batch STT needs audio. Upload a wav/mp3/webm file, or enter text (we'll synthesize then transcribe), or use Mock.",
            });
          }

          const res = await stt.transcribe({ audio, format, diarize: true });
          output = res.text;
          usage = {
            inputTokens: usage.inputTokens + res.usage.inputTokens,
            outputTokens: usage.outputTokens + res.usage.outputTokens,
            audioSeconds: usage.audioSeconds + res.usage.audioSeconds,
            costUsd: usage.costUsd + res.usage.costUsd,
            providerCalls: usage.providerCalls + res.usage.providerCalls,
            cacheHits: usage.cacheHits + res.usage.cacheHits,
          };
          result = {
            kind: "stt",
            text: res.text,
            note: note || undefined,
            segments: res.segments?.slice(0, 40) ?? [],
            language: res.language,
          };
        } else if (cap === Capability.LLM || cap === Capability.STRUCTURED_OUTPUT || cap === Capability.REASONING_LLM) {
          if (!llm) return reply.code(400).send({ error: "provider has no LLM" });
          const res = await llm.complete({ model, messages: [{ role: "user", content: input }] });
          output = res.text;
          usage = res.usage;
          let parsed: unknown;
          if (cap === Capability.STRUCTURED_OUTPUT) {
            try {
              parsed = res.parsed ?? JSON.parse(res.text);
            } catch {
              const start = res.text.indexOf("{");
              const end = res.text.lastIndexOf("}");
              if (start >= 0 && end > start) {
                try {
                  parsed = JSON.parse(res.text.slice(start, end + 1));
                } catch {
                  parsed = undefined;
                }
              }
            }
          }
          result = {
            kind: cap === Capability.STRUCTURED_OUTPUT ? "structured" : "llm",
            text: res.text,
            parsed,
            model: res.model,
          };
        } else if (cap === Capability.TTS || cap === Capability.STREAMING_TTS) {
          if (!tts) return reply.code(400).send({ error: "provider has no TTS" });
          const res = await tts.synthesize({ text: input });
          const b64 = Buffer.from(res.audio).toString("base64");
          // Cap response size so the UI stays responsive.
          if (b64.length > 6_000_000) {
            output = `audio too large to inline (${res.audio.length} bytes, ${res.format})`;
            result = { kind: "tts", audioBytes: res.audio.length, audioFormat: res.format, tooLarge: true };
          } else {
            output = `audio (${res.format}, ${res.audio.length} bytes)`;
            result = {
              kind: "tts",
              audioBase64: b64,
              audioFormat: res.format,
              audioBytes: res.audio.length,
              text: input,
            };
          }
          usage = res.usage;
        } else if (cap === Capability.EMBEDDINGS) {
          if (!emb) return reply.code(400).send({ error: "provider has no embeddings" });
          const res = await emb.embed({ input });
          const dims = res.embeddings[0]?.length ?? 0;
          const preview = (res.embeddings[0] ?? []).slice(0, 24);
          output = `dimensions: ${dims}, vectors: ${res.embeddings.length}`;
          usage = res.usage;
          result = {
            kind: "embeddings",
            dimensions: dims,
            vectors: res.embeddings.length,
            preview,
            input,
          };
        } else {
          return reply.code(400).send({ error: `capability ${capability} not runnable in playground` });
        }
        const latency = Date.now() - t0;
        svc.platform.tracer.completeRun(trace, "SUCCEEDED");
        return {
          provider: adapter.id,
          capability: cap,
          output,
          result,
          usage,
          latencyMs: latency,
          runId: trace,
        };
      } catch (e: unknown) {
        svc.platform.tracer.completeRun(trace, "FAILED", String(e));
        // Never echo raw vendor payloads that might include request fragments.
        const raw = String(e);
        const safe = raw.replace(/(sk-|pyai_|AIza)[A-Za-z0-9._-]{8,}/g, "$1[REDACTED]").slice(0, 400);
        return reply.code(502).send({ error: safe });
      }
    },
  );

  // CallIQ analysis endpoint (Hear → Recap loop).
  app.post<{
    Body: {
      transcriptText?: string;
      audioBase64?: string;
      audioFormat?: string;
      sttProvider?: string;
      llmProvider?: string;
      verifyProvider?: string;
    };
  }>("/api/calliq/analyze", async (req, reply) => {
      const { pickProvider } = await import("../providerPick.js");
      const { Capability } = await import("@pyai/core");
      const llmProvider = pickProvider(svc.platform, Capability.LLM, req.body.llmProvider);
      const sttProvider = pickProvider(svc.platform, Capability.BATCH_STT, req.body.sttProvider);
      const verifyProvider = pickProvider(
        svc.platform,
        Capability.REASONING_LLM,
        req.body.verifyProvider ?? llmProvider,
      );

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

      const { def, getArtifact } = await import("@pyai/calliq").then((m) =>
        m.buildCallIQWorkflow(svc.platform, {
          transcriptText,
          audio,
          fileName: req.body.audioFormat ? `call.${req.body.audioFormat.replace(/[^a-z0-9]/gi, "")}` : undefined,
          sttProvider,
          llmProvider,
          verifyProvider,
        }),
      );
      const out = await svc.platform.engine.execute(def);
      const artifact = getArtifact();
      const run = svc.platform.tracer.getRun(out.runId);
      const gates = out.gates ?? [];
      const gatePass = gates.filter((g) => g.verdict === "PASS").length;
      const gateWarn = gates.filter((g) => g.verdict === "WARN").length;
      const gateBlock = gates.filter((g) => g.verdict === "BLOCK").length;
      const gateDetail = gates.length
        ? gateBlock
          ? `${gateBlock} blocked · ${gatePass} passed`
          : gateWarn
            ? `${gatePass} passed · ${gateWarn} warn`
            : `${gatePass} passed`
        : "no checks recorded";
      const v = artifact.verification;
      const verifySkipped = /skipped|no verifier/i.test(v?.reason ?? "");
      const verifyDetail = !v
        ? "not run"
        : verifySkipped
          ? `skipped · ${v.reason || "no reasoning LLM"}`
          : v.passed
            ? `${v.checkedClaims} claims confirmed (${verifyProvider})`
            : `flagged · ${v.reason || verifyProvider}`;
      const hearDetail = audio
        ? `${sttProvider} · diarized batch`
        : artifact.transcript.provider === "inline"
          ? "inline transcript"
          : sttProvider;
      const recapDetail = [
        llmProvider,
        artifact.recap.talkRatio.length ? `${artifact.recap.talkRatio.length} speakers` : null,
        artifact.recap.keywords.length ? `${artifact.recap.keywords.length} keywords` : null,
      ]
        .filter(Boolean)
        .join(" · ");
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
          { id: "recap", label: "Recap (talk-ratio + deal notes)", detail: recapDetail },
          { id: "gates", label: "Evidence gates", detail: gateDetail },
          { id: "verify", label: "Multi-model verify", detail: verifyDetail },
        ],
        transcript: artifact.transcript,
        recap: artifact.recap,
        analysis: artifact.analysis,
        verification: artifact.verification,
        trace: run,
      };
    },
  );

  // Sample data for the demo (spec #59, #161).
  app.get("/api/sample/calliq", async () => {
    return {
      transcriptText: [
        "Sales Rep: Thanks for hopping on, Dana. I wanted to walk you through the enterprise plan and how rollout would work for your team.",
        "Customer: Sure. Honestly the main thing holding us back is the implementation cost. We got burned last year with a six month onboarding.",
        "Sales Rep: Totally hear that. We do white-glove onboarding in under four weeks, and a dedicated engineer for the first 90 days.",
        "Customer: That helps. But we also need to know if your security review passes our procurement. We use a competitor for the EU region today.",
        "Sales Rep: We are SOC 2 Type II and have a EU data residency option. I can loop in our solutions architect next week.",
        "Customer: Okay. If you send the security pack and a timeline, I think we can get a decision maker in the loop by end of month.",
      ].join("\n"),
    };
  });
}
