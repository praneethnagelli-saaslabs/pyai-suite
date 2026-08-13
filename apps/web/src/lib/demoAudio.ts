/** Shared helpers for product demos that play TTS then STT. */

export function mimeForAudio(format?: string): string {
  const f = (format ?? "mp3").toLowerCase();
  if (f === "mp3" || f === "mpeg") return "audio/mpeg";
  if (f === "wav") return "audio/wav";
  if (f === "ogg") return "audio/ogg";
  if (f === "m4a") return "audio/mp4";
  return `audio/${f}`;
}

export function base64ToBlob(b64: string, mime: string): Blob {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

/** Must run inside the click handler (before long awaits) so browsers allow later play(). */
export async function unlockAudioPlayback(ctxRef: { current: AudioContext | null }): Promise<void> {
  const AC =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  if (!ctxRef.current || ctxRef.current.state === "closed") {
    ctxRef.current = new AC();
  }
  if (ctxRef.current.state === "suspended") {
    await ctxRef.current.resume();
  }
  const ctx = ctxRef.current;
  const buf = ctx.createBuffer(1, 1, 22050);
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.connect(ctx.destination);
  src.start(0);
}

async function speakWithBrowser(text: string): Promise<void> {
  if (!("speechSynthesis" in window)) return;
  await new Promise<void>((resolve) => {
    const u = new SpeechSynthesisUtterance(text);
    u.onend = () => resolve();
    u.onerror = () => resolve();
    window.setTimeout(resolve, Math.min(30_000, 800 + text.length * 60));
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(u);
  });
}

/** Speak one demo line (browser TTS). Pitch/rate distinguish speakers. */
export async function speakDemoLine(
  text: string,
  opts?: { pitch?: number; rate?: number; voiceHint?: "male" | "female" | "neutral" },
): Promise<void> {
  if (!("speechSynthesis" in window)) {
    await sleep(Math.min(4000, 600 + text.length * 35));
    return;
  }
  await new Promise<void>((resolve) => {
    const u = new SpeechSynthesisUtterance(text);
    u.pitch = opts?.pitch ?? 1;
    u.rate = opts?.rate ?? 1.02;
    const voices = window.speechSynthesis.getVoices();
    if (voices.length && opts?.voiceHint) {
      const prefer =
        opts.voiceHint === "female"
          ? voices.find((v) => /female|samantha|victoria|karen|zira|google us english/i.test(v.name))
          : opts.voiceHint === "male"
            ? voices.find((v) => /male|daniel|alex|david|google uk english male/i.test(v.name))
            : undefined;
      if (prefer) u.voice = prefer;
    }
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      resolve();
    };
    u.onend = done;
    u.onerror = done;
    window.setTimeout(done, Math.min(30_000, 900 + text.length * 55));
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(u);
  });
}

export function stopDemoSpeech(): void {
  window.speechSynthesis?.cancel();
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => window.setTimeout(r, ms));
}

export async function playAndWait(
  b64: string | undefined,
  format: string | undefined,
  audioRef: { current: HTMLAudioElement | null },
  objectUrlRef: { current: string | null },
  opts?: { spokenPhrase?: string; useBrowserSpeech?: boolean },
): Promise<void> {
  if (audioRef.current) {
    try {
      audioRef.current.pause();
      audioRef.current.removeAttribute("src");
      audioRef.current.load();
    } catch {
      /* ignore */
    }
    audioRef.current = null;
  }
  if (objectUrlRef.current) {
    URL.revokeObjectURL(objectUrlRef.current);
    objectUrlRef.current = null;
  }
  window.speechSynthesis?.cancel();

  if (b64 && format) {
    const mime = mimeForAudio(format);
    const blob = base64ToBlob(b64, mime);
    const url = URL.createObjectURL(blob);
    objectUrlRef.current = url;

    const audio = new Audio();
    audio.preload = "auto";
    audio.volume = 1;
    audio.src = url;
    audioRef.current = audio;

    await new Promise<void>((resolve) => {
      let settled = false;
      let playStarted = false;
      const done = () => {
        if (settled) return;
        settled = true;
        resolve();
      };

      audio.addEventListener("ended", done, { once: true });
      audio.addEventListener("error", () => window.setTimeout(done, 400), { once: true });
      window.setTimeout(done, 45_000);

      const tryPlay = () => {
        if (playStarted || settled) return;
        playStarted = true;
        void audio.play().then(undefined, () => {
          if (opts?.spokenPhrase && "speechSynthesis" in window) {
            void speakWithBrowser(opts.spokenPhrase).then(done);
            return;
          }
          done();
        });
      };

      if (audio.readyState >= 2) tryPlay();
      else audio.addEventListener("canplay", tryPlay, { once: true });
      window.setTimeout(tryPlay, 250);
    });
    return;
  }

  if (opts?.useBrowserSpeech && opts.spokenPhrase) {
    await speakWithBrowser(opts.spokenPhrase);
  }
}
