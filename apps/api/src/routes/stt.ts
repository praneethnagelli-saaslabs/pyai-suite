import type { FastifyInstance } from "fastify";
import type { AppServices } from "../services.js";
import { sttFallbackMessage, transcribeWithFallback, type SttMode } from "../providerPick.js";

/**
 * Lightweight STT for live Meet / mic chunks and batch uploads.
 * Tries preferred → pyai → openai → gemini.
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
      /** live = Meet chunks (8s Hear); batch = uploads (90s Hear). Default live. */
      mode?: SttMode;
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
    const mode: SttMode = req.body.mode === "batch" ? "batch" : "live";
    const t0 = Date.now();
    const prompt =
      req.body.prompt?.trim() ||
      // Vocabulary hint only — Whisper may echo instructional prompts on quiet audio.
      "Meeting discussion: roadmap, launch, security review, action items, follow-up.";
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
        { includeMock: false, mode },
      );
      let text = heard.text.trim();
      // Drop prompt-echo lines before labeling.
      if (isPromptEcho(text)) {
        text = "";
      }
      const hasSpeakerLines = /(?:^|\n)\s*(?:\[[^\]]+\]|[A-Za-z][^:\n]{0,48}:)\s+\S/.test(text);
      if (fallbackLabel && text && !hasSpeakerLines) {
        text = text
          .split("\n")
          .map((line) => line.trim())
          .filter(Boolean)
          .filter((line) => !isPromptEcho(line))
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
        fallbackNote: heard.fallbackNote,
        errors: heard.errors.length ? heard.errors : undefined,
        mode,
        hearCooldown: heard.hearCooldown,
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

/** Quiet-audio models often echo STT prompt instructions verbatim. */
function isPromptEcho(text: string): boolean {
  const t = text
    .replace(/^(me|them|you|speaker\s*\d+)\s*:\s*/i, "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
  if (!t) return true;
  return (
    /transcribe\s+(clear\s+)?speech/i.test(t) ||
    /if\s+(there\s+is\s+)?no\s+speech/i.test(t) ||
    /return\s+(an\s+)?empty/i.test(t) ||
    /label\s+only\s+(me|them)/i.test(t) ||
    /live\s+google\s+meet/i.test(t) ||
    t === "transcribe clear speech only" ||
    t === "transcribe clear speech only."
  );
}
