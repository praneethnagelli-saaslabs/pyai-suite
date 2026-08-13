import { Capability, type Platform } from "@pyai/core";
import { tonePcm, PCM_RATE } from "@pyai/core";

const TTS_ORDER = ["pyai", "openai", "mock"] as const;

/** Speak text to PCM16 24 kHz for injecting into a realtime session. */
export async function speakCustomerPcm(
  platform: Platform,
  text: string,
  voice?: string,
): Promise<{ audio: Uint8Array; provider: string }> {
  const say = text.replace(/[\u0000-\u001f]/g, " ").trim().slice(0, 400);
  if (!say) return { audio: tonePcm(180, 0.2), provider: "mock" };

  for (const id of TTS_ORDER) {
    const adapter = platform.registry.getAdapterFor(Capability.TTS, id);
    if (!adapter?.asTTS || (id !== "mock" && !adapter.isConfigured())) continue;
    try {
      const format = id === "openai" ? "pcm" : "wav";
      const mapped = mapTtsVoice(id, voice);
      const result = await adapter.asTTS().synthesize({ text: say, voice: mapped, format });
      const pcm = toPcm16(result.audio, result.format);
      if (pcm.length >= 2) return { audio: pcm, provider: id };
    } catch {
      /* try next */
    }
  }
  return { audio: chatterPcm(say), provider: "mock" };
}

function mapTtsVoice(provider: string, voice?: string): string {
  const v = (voice ?? "ava").toLowerCase();
  if (provider === "openai") {
    if (v === "emma") return "nova";
    if (v === "dorit") return "alloy";
    return "shimmer";
  }
  if (v === "emma") return "echo";
  if (v === "dorit") return "alloy";
  return "alloy";
}

function toPcm16(buf: Uint8Array, format: string): Uint8Array {
  const fmt = format.toLowerCase();
  if (fmt === "pcm" || fmt === "pcm16" || fmt === "raw") return buf;
  if (fmt === "wav" || looksWav(buf)) return wavToPcm16(buf) ?? chatterPcm(".");
  return new Uint8Array(0);
}

function looksWav(buf: Uint8Array): boolean {
  return buf.length > 44 && buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46;
}

function wavToPcm16(buf: Uint8Array): Uint8Array | null {
  if (!looksWav(buf)) return null;
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let offset = 12;
  let sampleRate = 0;
  let bits = 16;
  let channels = 1;
  let dataStart = -1;
  let dataLen = 0;
  while (offset + 8 <= buf.length) {
    const id = String.fromCharCode(buf[offset]!, buf[offset + 1]!, buf[offset + 2]!, buf[offset + 3]!);
    const size = view.getUint32(offset + 4, true);
    if (id === "fmt ") {
      channels = view.getUint16(offset + 10, true);
      sampleRate = view.getUint32(offset + 12, true);
      bits = view.getUint16(offset + 22, true);
    } else if (id === "data") {
      dataStart = offset + 8;
      dataLen = size;
      break;
    }
    offset += 8 + size + (size % 2);
  }
  if (dataStart < 0 || bits !== 16) return null;
  const pcm = buf.subarray(dataStart, Math.min(buf.length, dataStart + dataLen));
  if (channels === 2) {
    const stereo = new Int16Array(pcm.buffer, pcm.byteOffset, Math.floor(pcm.byteLength / 2));
    const mono = new Int16Array(Math.floor(stereo.length / 2));
    for (let i = 0; i < mono.length; i++) {
      mono[i] = Math.round(((stereo[i * 2] ?? 0) + (stereo[i * 2 + 1] ?? 0)) / 2);
    }
    return resample(new Uint8Array(mono.buffer), sampleRate || PCM_RATE);
  }
  return resample(pcm, sampleRate || PCM_RATE);
}

function resample(pcm: Uint8Array, srcRate: number): Uint8Array {
  if (!srcRate || srcRate === PCM_RATE) return pcm.byteLength % 2 === 0 ? pcm : pcm.subarray(0, pcm.byteLength - 1);
  const src = new Int16Array(pcm.buffer, pcm.byteOffset, Math.floor(pcm.byteLength / 2));
  const outLen = Math.max(1, Math.round((src.length * PCM_RATE) / srcRate));
  const out = new Int16Array(outLen);
  const step = src.length / outLen;
  for (let i = 0; i < outLen; i++) {
    const x = i * step;
    const i0 = Math.min(src.length - 1, Math.floor(x));
    const i1 = Math.min(src.length - 1, i0 + 1);
    const t = x - i0;
    out[i] = Math.round((src[i0] ?? 0) * (1 - t) + (src[i1] ?? 0) * t);
  }
  return new Uint8Array(out.buffer);
}

/** Deterministic voiced chatter so Demo Mode is never silent. */
function chatterPcm(text: string): Uint8Array {
  const seconds = Math.min(2.4, Math.max(0.35, text.length / 18));
  return tonePcm(210 + (text.length % 7) * 18, seconds, PCM_RATE, 0.16);
}
