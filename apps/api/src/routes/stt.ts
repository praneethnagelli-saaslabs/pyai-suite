import type { FastifyInstance } from "fastify";
import type { AppServices } from "../services.js";
import { sttFallbackMessage, transcribeWithFallback } from "../providerPick.js";

/**
 * Lightweight STT for live Meet / mic chunks. Tries preferred → pyai → openai → gemini.
 * Empty Hear output counts as failure so OpenAI still runs.
 */
export async function sttRoutes(app: FastifyInstance, svc: AppServices): Promise<void> {
  app.post<{
    Body: {
      audioBase64?: string;
      format?: string;
      provider?: string;
      language?: string;
      prompt?: string;
      diarize?: boolean;
      speakerLabel?: string;
    };
  }>("/api/stt/transcribe", async (req, reply) => {
    const b64 = req.body.audioBase64 ?? "";
    if (!b64) return reply.code(400).send({ error: "audioBase64 required" });
    if (b64.length > 20_000_000) {
      return reply.code(413).send({ error: "audioBase64 too large (max ~15MB)" });
    }
    let audio: Uint8Array;
    try {
      audio = Uint8Array.from(Buffer.from(b64, "base64"));
    } catch {
      return reply.code(400).send({ error: "invalid base64" });
    }
    if (!audio.length) return reply.code(400).send({ error: "empty audio" });

    const preferred = req.body.provider;
    const wantDiarize = Boolean(req.body.diarize);
    const t0 = Date.now();
    const prompt =
      req.body.prompt?.trim() ||
      "Live Google Meet conversation with multiple speakers discussing work. Transcribe speech only; if there is no speech, return an empty string.";
    const fallbackLabel = req.body.speakerLabel?.trim();

    try {
      const heard = await transcribeWithFallback(
        svc.platform,
        {
          audio,
          format: req.body.format ?? "wav",
          prompt,
          diarize: wantDiarize,
        },
        preferred,
        { includeMock: false },
      );
      let text = heard.text;
      const hasSpeakerLines = /(?:^|\n)\s*(?:\[[^\]]+\]|[A-Za-z][^:\n]{0,48}:)\s+\S/.test(text);
      if (fallbackLabel && !hasSpeakerLines) {
        text = text
          .split("\n")
          .map((line) => line.trim())
          .filter(Boolean)
          .map((line) => `${fallbackLabel}: ${line}`)
          .join("\n");
      }
      return {
        text,
        provider: heard.provider,
        diarized: wantDiarize && (heard.provider === "openai" || heard.provider === "pyai") && hasSpeakerLines,
        latencyMs: Date.now() - t0,
        usage: heard.result.usage,
        fallback: heard.fallback,
        errors: heard.errors.length ? heard.errors : undefined,
      };
    } catch (e) {
      const errors =
        e && typeof e === "object" && "errors" in e ? (e as { errors: string[] }).errors : [];
      return reply.code(502).send({
        error: sttFallbackMessage(errors.length ? errors : [e instanceof Error ? e.message : "no STT provider available"]),
        errors,
      });
    }
  });
}
