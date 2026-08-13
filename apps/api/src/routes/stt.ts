import type { FastifyInstance } from "fastify";
import { Capability } from "@pyai/core";
import type { AppServices } from "../services.js";
import { liveCandidates } from "../providerPick.js";

/**
 * Lightweight STT for live Meet / mic chunks. Tries preferred → pyai → openai → mock.
 * When `diarize` is true, PyAI Hear uses batch jobs; OpenAI uses gpt-4o-transcribe-diarize.
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
    const candidates = [...liveCandidates(preferred), "mock"].filter(
      (id, i, arr) => arr.indexOf(id) === i,
    );
    const errors: string[] = [];
    const t0 = Date.now();
    const prompt =
      req.body.prompt?.trim() ||
      "Live Google Meet conversation with multiple speakers discussing work. Transcribe speech only; if there is no speech, return an empty string.";
    const fallbackLabel = req.body.speakerLabel?.trim();

    for (const id of candidates) {
      const adapter = svc.platform.registry.getAdapterFor(Capability.BATCH_STT, id);
      if (!adapter?.isConfigured?.() || !adapter.asSTT) continue;
      try {
        const res = await adapter.asSTT().transcribe({
          audio,
          format: req.body.format ?? "wav",
          prompt,
          diarize: wantDiarize && (id === "openai" || id === "pyai"),
        });
        let text = res.text?.trim() ?? "";
        const hasSpeakerLines = /^.+:\s+\S+/m.test(text);
        if (text && fallbackLabel && !hasSpeakerLines) {
          text = text
            .split("\n")
            .map((line) => line.trim())
            .filter(Boolean)
            .map((line) => `${fallbackLabel}: ${line}`)
            .join("\n");
        }
        return {
          text,
          provider: id,
          diarized: wantDiarize && (id === "openai" || id === "pyai") && hasSpeakerLines,
          latencyMs: Date.now() - t0,
          usage: res.usage,
          fallback: errors.length > 0,
          errors: errors.length ? errors : undefined,
        };
      } catch (e) {
        errors.push(`${id}: ${e instanceof Error ? e.message.slice(0, 160) : "failed"}`);
      }
    }

    return reply.code(502).send({
      error: errors[0] ?? "no STT provider available",
      errors,
    });
  });
}
