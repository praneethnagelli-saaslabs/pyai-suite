/**
 * Convert MediaRecorder webm/ogg blobs to 16 kHz mono WAV for PyAI Hear.
 * Loaded as a classic script before offscreen.js / recorder.js.
 */
(function (global) {
  const STT_RATE = 16_000;

  function writeStr(view, offset, str) {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
  }

  function resampleMono(buffer, targetRate) {
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

  function pcmToWav16(pcm, sampleRate) {
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

  function bytesToBase64(bytes) {
    let binary = "";
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
    }
    return btoa(binary);
  }

  /**
   * @param {Blob} blob
   * @returns {Promise<{ audioBase64: string, format: string }>}
   */
  async function blobToSttPayload(blob) {
    const type = (blob.type || "").toLowerCase();
    const needsConvert = type.includes("webm") || type.includes("ogg") || !type;
    if (!needsConvert && type.includes("wav")) {
      const buf = await blob.arrayBuffer();
      return { audioBase64: bytesToBase64(new Uint8Array(buf)), format: "wav" };
    }
    if (!needsConvert && (type.includes("mpeg") || type.includes("mp3"))) {
      const buf = await blob.arrayBuffer();
      return { audioBase64: bytesToBase64(new Uint8Array(buf)), format: "mp3" };
    }

    const Ctx = global.AudioContext || global.webkitAudioContext;
    if (!Ctx) {
      const buf = await blob.arrayBuffer();
      return {
        audioBase64: bytesToBase64(new Uint8Array(buf)),
        format: type.includes("webm") ? "webm" : "wav",
      };
    }
    const ctx = new Ctx();
    try {
      const decoded = await ctx.decodeAudioData((await blob.arrayBuffer()).slice(0));
      const wav = pcmToWav16(resampleMono(decoded, STT_RATE), STT_RATE);
      return { audioBase64: bytesToBase64(new Uint8Array(wav)), format: "wav" };
    } catch {
      // OpenAI Whisper still accepts raw webm if decode fails.
      const buf = await blob.arrayBuffer();
      return { audioBase64: bytesToBase64(new Uint8Array(buf)), format: "webm" };
    } finally {
      await ctx.close().catch(() => undefined);
    }
  }

  global.PyaiWav = { blobToSttPayload };
})(typeof globalThis !== "undefined" ? globalThis : window);
