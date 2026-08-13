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

const STT_RATE = 16_000;
/** ~2 min of 16 kHz mono WAV — short enough for sync Hear under the proxy wait. */
const STT_CHUNK_SECONDS = 120;
const DIRECT_SEND_MAX_BYTES = 10 * 1024 * 1024;

function resampleMono(buffer: AudioBuffer, targetRate: number): Float32Array {
  const ratio = buffer.sampleRate / targetRate;
  const numFrames = Math.max(1, Math.floor(buffer.length / ratio));
  const out = new Float32Array(numFrames);
  const left = buffer.getChannelData(0);
  const right = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : null;
  for (let i = 0; i < numFrames; i++) {
    const src = Math.min(buffer.length - 1, Math.floor(i * ratio));
    let sample = left[src] ?? 0;
    if (right) sample = (sample + (right[src] ?? 0)) / 2;
    out[i] = sample;
  }
  return out;
}

function pcmToWav16(pcm: Float32Array, sampleRate: number): ArrayBuffer {
  const dataSize = pcm.length * 2;
  const ab = new ArrayBuffer(44 + dataSize);
  const view = new DataView(ab);
  writeStr(view, 0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeStr(view, 8, "WAVE");
  writeStr(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeStr(view, 36, "data");
  view.setUint32(40, dataSize, true);
  let offset = 44;
  for (let i = 0; i < pcm.length; i++) {
    const sample = Math.max(-1, Math.min(1, pcm[i] ?? 0));
    view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
    offset += 2;
  }
  return ab;
}

/** 16-bit mono PCM @ 16 kHz — small enough for nginx/Fastify body limits. */
function encodeWavMono16k(buffer: AudioBuffer): ArrayBuffer {
  return pcmToWav16(resampleMono(buffer, STT_RATE), STT_RATE);
}

function writeStr(view: DataView, offset: number, str: string) {
  for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export async function fileToBase64(file: File): Promise<{ audioBase64: string; audioFormat: string }> {
  const buf = await file.arrayBuffer();
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "wav";
  let audioFormat = ext === "mpeg" || ext === "mpga" ? "mp3" : ext;
  if (file.type.includes("webm") || audioFormat === "webm") audioFormat = "webm";
  if (file.type.includes("ogg")) audioFormat = "ogg";
  if (file.type.includes("wav") || audioFormat === "wav") audioFormat = "wav";
  return { audioBase64: bytesToBase64(new Uint8Array(buf)), audioFormat };
}

function alreadyFitsOneRequest(file: File): boolean {
  return file.size > 0 && file.size <= DIRECT_SEND_MAX_BYTES;
}

async function decodeToMono16k(file: File): Promise<Float32Array> {
  const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const ctx = new Ctx();
  try {
    const buffer = await ctx.decodeAudioData((await file.arrayBuffer()).slice(0));
    return resampleMono(buffer, STT_RATE);
  } finally {
    await ctx.close().catch(() => undefined);
  }
}

/**
 * Split a recording into STT-sized pieces (16 kHz mono WAV).
 * Small compressed files are sent as-is; larger Meet exports are downsampled and chunked.
 */
export async function audioFileToSttChunks(
  file: File,
): Promise<Array<{ audioBase64: string; audioFormat: string }>> {
  if (alreadyFitsOneRequest(file)) {
    return [await prepareForStt(file)];
  }

  let pcm: Float32Array;
  try {
    pcm = await decodeToMono16k(file);
  } catch {
    throw new Error(
      "That recording is too large to send as-is, and the browser could not decode it to compress. Export audio-only (mp3 or m4a), not the full Meet video.",
    );
  }
  const framesPerChunk = STT_CHUNK_SECONDS * STT_RATE;
  const chunks: Array<{ audioBase64: string; audioFormat: string }> = [];
  for (let start = 0; start < pcm.length; start += framesPerChunk) {
    const slice = pcm.subarray(start, Math.min(pcm.length, start + framesPerChunk));
    const wav = pcmToWav16(slice, STT_RATE);
    chunks.push({ audioBase64: bytesToBase64(new Uint8Array(wav)), audioFormat: "wav" });
  }
  return chunks.length ? chunks : [{ audioBase64: bytesToBase64(new Uint8Array(pcmToWav16(pcm, STT_RATE))), audioFormat: "wav" }];
}

/** Picker limit — Meet video exports. We compress/split before the API. */
export const MAX_PICK_BYTES = 250 * 1024 * 1024;
export const MAX_RECORDING_BYTES = MAX_PICK_BYTES;

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
  if (file.size > MAX_PICK_BYTES) {
    return "Recording is over 250MB. Export audio-only (mp3 or m4a) instead of the full Meet video.";
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
