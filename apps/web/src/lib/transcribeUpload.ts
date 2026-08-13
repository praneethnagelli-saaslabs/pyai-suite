import { api } from "@/lib/api";
import { audioFileToSttChunks, displayFileName } from "@/lib/audio";
import { normalizeDiarizedTranscript } from "@/lib/transcript";

export async function transcribeUploadedRecording(
  file: File,
  opts: {
    provider?: string;
    diarize?: boolean;
    prompt?: string;
    onProgress?: (info: { part: number; total: number; label: string }) => void;
    /** Called after each finished part so the UI can show transcript immediately. */
    onPartial?: (info: { text: string; part: number; total: number; provider: string }) => void;
  } = {},
): Promise<{ text: string; provider: string; parts: number }> {
  opts.onProgress?.({
    part: 0,
    total: 0,
    label: `Preparing ${displayFileName(file.name)}…`,
  });
  const chunks = await audioFileToSttChunks(file);
  const texts: string[] = [];
  let provider = opts.provider ?? "unknown";

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i]!;
    opts.onProgress?.({
      part: i + 1,
      total: chunks.length,
      label:
        chunks.length > 1
          ? `Hear — part ${i + 1} of ${chunks.length}`
          : "Hear — transcribing recording…",
    });
    const out = await api.sttTranscribe({
      audioBase64: chunk.audioBase64,
      format: chunk.audioFormat,
      provider: opts.provider,
      diarize: opts.diarize,
      prompt: opts.prompt,
    });
    provider = out.provider;
    const t = out.text?.trim();
    if (t) texts.push(normalizeDiarizedTranscript(t));
    opts.onPartial?.({
      text: texts.join("\n"),
      part: i + 1,
      total: chunks.length,
      provider,
    });
  }

  const text = texts.join("\n");
  if (!text) throw new Error("No speech detected in that recording.");
  return { text, provider, parts: chunks.length };
}
