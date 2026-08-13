/** Prefer original compressed formats for STT; convert webm→wav only when needed. */

export async function ensureWavCompatible(file: File): Promise<File> {
  const name = file.name.toLowerCase();
  const type = (file.type || "").toLowerCase();
  const needsConvert =
    type.includes("webm") ||
    type.includes("ogg") ||
    name.endsWith(".webm") ||
    name.endsWith(".ogg") ||
    (type === "" && !/\.(wav|mp3|m4a|flac|mpeg)$/i.test(name) && name.includes("recording"));

  if (!needsConvert) return file;

  try {
    const wav = await blobToWav(file);
    const base = file.name.replace(/\.[^.]+$/, "") || "recording";
    return new File([wav], `${base}.wav`, { type: "audio/wav" });
  } catch {
    throw new Error(
      "Unable to decode audio data. Use a complete recording (not a partial live chunk), or send webm to OpenAI Whisper.",
    );
  }
}

/**
 * Prepare audio for /api/stt/transcribe.
 * Live Meet chunks should be complete webm blobs — we upload them as webm (OpenAI accepts it)
 * and avoid decodeAudioData, which fails on MediaRecorder timeslice fragments.
 */
export async function prepareForStt(
  file: File,
  opts?: { preferWav?: boolean },
): Promise<{ audioBase64: string; audioFormat: string }> {
  const type = (file.type || "").toLowerCase();
  const name = file.name.toLowerCase();
  const isWebm =
    type.includes("webm") || name.endsWith(".webm") || type.includes("ogg") || name.endsWith(".ogg");

  if (isWebm && !opts?.preferWav) {
    return fileToBase64(file);
  }

  if (isWebm && opts?.preferWav) {
    const wav = await ensureWavCompatible(file);
    return fileToBase64(wav);
  }

  return fileToBase64(file);
}

/**
 * True when the blob is near-silence (common when the wrong tab is shared or tab audio is off).
 * Whisper often hallucinates “you” / “thank you” on those chunks.
 */
export async function blobLooksSilent(blob: Blob, minMeanAbs = 0.012): Promise<boolean> {
  const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const ctx = new Ctx();
  try {
    const decoded = await ctx.decodeAudioData((await blob.arrayBuffer()).slice(0));
    const ch = decoded.getChannelData(0);
    if (!ch.length) return true;
    const step = Math.max(1, Math.floor(ch.length / 12_000));
    let sum = 0;
    let n = 0;
    for (let i = 0; i < ch.length; i += step) {
      sum += Math.abs(ch[i] ?? 0);
      n++;
    }
    return n === 0 || sum / n < minMeanAbs;
  } catch {
    return false; // undecodable — still send to STT
  } finally {
    await ctx.close().catch(() => undefined);
  }
}

/** Whisper silence / YouTube-trailer style hallucinations. */
export function isLikelySttHallucination(text: string): boolean {
  const t = text
    .trim()
    .toLowerCase()
    .replace(/[“”"']/g, "")
    .replace(/\s+/g, " ");
  if (!t) return true;
  const exact = new Set([
    "you",
    "you.",
    "you!",
    "thank you",
    "thank you.",
    "thanks",
    "thanks.",
    "thanks for watching",
    "thanks for watching.",
    "thank you for watching",
    "thank you for watching.",
    "bye",
    "bye.",
    "goodbye",
    "goodbye.",
    "please subscribe",
    "the end",
    "uh",
    "um",
    "hmm",
  ]);
  if (exact.has(t)) return true;
  if (/^(you[.!]?\s*)+$/i.test(t)) return true;
  if (/^(thank you[.!]?\s*)+$/i.test(t)) return true;
  if (/^(thanks for watching[.!]?\s*)+$/i.test(t)) return true;
  return false;
}

async function blobToWav(blob: Blob): Promise<ArrayBuffer> {
  const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const ctx = new Ctx();
  try {
    const raw = await blob.arrayBuffer();
    const decoded = await ctx.decodeAudioData(raw.slice(0));
    return encodeWavMono16k(decoded);
  } finally {
    await ctx.close().catch(() => undefined);
  }
}

/** 16-bit mono PCM @ 16 kHz — small enough for nginx/Fastify body limits. */
function encodeWavMono16k(buffer: AudioBuffer): ArrayBuffer {
  const targetRate = 16_000;
  const ratio = buffer.sampleRate / targetRate;
  const numFrames = Math.max(1, Math.floor(buffer.length / ratio));
  const dataSize = numFrames * 2;
  const ab = new ArrayBuffer(44 + dataSize);
  const view = new DataView(ab);

  writeStr(view, 0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeStr(view, 8, "WAVE");
  writeStr(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, targetRate, true);
  view.setUint32(28, targetRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeStr(view, 36, "data");
  view.setUint32(40, dataSize, true);

  const left = buffer.getChannelData(0);
  const right = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : null;

  let offset = 44;
  for (let i = 0; i < numFrames; i++) {
    const src = Math.min(buffer.length - 1, Math.floor(i * ratio));
    let sample = left[src] ?? 0;
    if (right) sample = (sample + (right[src] ?? 0)) / 2;
    sample = Math.max(-1, Math.min(1, sample));
    view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
    offset += 2;
  }
  return ab;
}

function writeStr(view: DataView, offset: number, str: string) {
  for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
}

export async function fileToBase64(file: File): Promise<{ audioBase64: string; audioFormat: string }> {
  const buf = await file.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "wav";
  let audioFormat = ext === "mpeg" || ext === "mpga" ? "mp3" : ext;
  if (file.type.includes("webm") || audioFormat === "webm") audioFormat = "webm";
  if (file.type.includes("ogg")) audioFormat = "ogg";
  if (file.type.includes("wav") || audioFormat === "wav") audioFormat = "wav";
  return { audioBase64: btoa(binary), audioFormat };
}

/** ~12MB file ≈ 16MB base64; API rejects above ~15MB decoded / 20M chars. */
export const MAX_RECORDING_BYTES = 12 * 1024 * 1024;

const ALLOWED_RECORDING_EXT = new Set([
  "wav",
  "mp3",
  "m4a",
  "aac",
  "webm",
  "ogg",
  "flac",
  "mp4",
  "mpeg",
  "mpga",
]);

export const RECORDING_ACCEPT =
  "audio/*,video/mp4,video/webm,.wav,.mp3,.m4a,.aac,.webm,.ogg,.flac,.mp4,.mpeg";

/** Display-only filename — no paths or control characters. */
export function displayFileName(name: string): string {
  const base = name.replace(/^.*[/\\]/, "").replace(/[\u0000-\u001f<>:"|?*]/g, "").trim();
  return (base || "recording").slice(0, 80);
}

export function validateRecordingFile(file: File): string | null {
  if (!file || file.size <= 0) return "That file is empty.";
  if (file.size > MAX_RECORDING_BYTES) {
    return "Recording is too large (max 12MB). Export a shorter clip or compress to mp3.";
  }
  const ext = (file.name.split(".").pop() ?? "").toLowerCase();
  const mime = (file.type || "").toLowerCase();
  const mimeOk = !mime || /^(audio\/|video\/(mp4|webm|quicktime))/.test(mime);
  const extOk = ALLOWED_RECORDING_EXT.has(ext);
  if (!mimeOk && !extOk) {
    return "Use an audio or Meet recording (mp3, wav, m4a, webm, mp4).";
  }
  if (ext && !extOk && !mimeOk) {
    return "Unsupported recording type. Try mp3, wav, m4a, webm, or mp4.";
  }
  return null;
}
