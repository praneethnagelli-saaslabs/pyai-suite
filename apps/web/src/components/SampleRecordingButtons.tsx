import { useState } from "react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui";
import { base64ToBlob, mimeForAudio } from "@/lib/demoAudio";

const cache = new Map<string, File>();

async function loadSampleFile(
  product: "calliq" | "brief",
  ttsProvider?: string,
): Promise<File> {
  const key = `${product}:${ttsProvider ?? "auto"}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const out = await api.sampleRecording({ product, ttsProvider });
  if (!out.audioBase64) {
    throw new Error("Sample recording came back empty. Connect PyAI or OpenAI TTS.");
  }
  const blob = base64ToBlob(out.audioBase64, mimeForAudio(out.audioFormat));
  const file = new File([blob], out.fileName, { type: blob.type || "audio/mpeg" });
  cache.set(key, file);
  return file;
}

function triggerDownload(file: File) {
  const url = URL.createObjectURL(file);
  const a = document.createElement("a");
  a.href = url;
  a.download = file.name;
  a.rel = "noopener";
  a.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 2_000);
}

export function SampleRecordingButtons({
  product,
  disabled,
  ttsProvider,
  onFile,
  onError,
}: {
  product: "calliq" | "brief";
  disabled?: boolean;
  ttsProvider?: string;
  onFile: (file: File) => void | Promise<void>;
  onError?: (message: string) => void;
}) {
  const [busy, setBusy] = useState<"use" | "download" | null>(null);

  async function run(kind: "use" | "download") {
    setBusy(kind);
    try {
      const file = await loadSampleFile(product, ttsProvider);
      if (kind === "download") triggerDownload(file);
      else await onFile(file);
    } catch (e) {
      onError?.(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <Button variant="ghost" disabled={disabled || Boolean(busy)} onClick={() => void run("use")}>
        {busy === "use" ? "Generating sample…" : "Use sample recording"}
      </Button>
      <Button variant="ghost" disabled={disabled || Boolean(busy)} onClick={() => void run("download")}>
        {busy === "download" ? "Preparing…" : "Download sample"}
      </Button>
    </>
  );
}
