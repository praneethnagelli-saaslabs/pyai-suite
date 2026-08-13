import { api } from "@/lib/api";
import { audioFileToSttChunks, displayFileName } from "@/lib/audio";
import { normalizeDiarizedTranscript } from "@/lib/transcript";

const UPLOAD_CONCURRENCY = 2;

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
  const parts = new Array<string>(chunks.length).fill("");
  let provider = opts.provider ?? "unknown";
  let done = 0;
  let cursor = 0;

  const emit = () => {
    const contiguous: string[] = [];
    for (const p of parts) {
      if (!p) break;
      contiguous.push(p);
    }
    opts.onPartial?.({
      text: contiguous.join("\n"),
      part: done,
      total: chunks.length,
      provider,
    });
  };

  const runOne = async (i: number) => {
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
    if (t) parts[i] = normalizeDiarizedTranscript(t);
    done += 1;
    emit();
  };

  const worker = async () => {
    while (cursor < chunks.length) {
      const i = cursor;
      cursor += 1;
      await runOne(i);
    }
  };

  const n = Math.min(UPLOAD_CONCURRENCY, chunks.length);
  await Promise.all(Array.from({ length: n }, () => worker()));

  const text = parts.filter(Boolean).join("\n");
  if (!text) throw new Error("No speech detected in that recording.");
  return { text, provider, parts: chunks.length };
}
