/** Upload a local File to the suite recording store (after notes/analysis exist). */
export async function uploadEntityRecording(
  product: "brief" | "calliq",
  entityId: string,
  file: File,
): Promise<{ playPath: string; byteLength: number }> {
  const buf = await file.arrayBuffer();
  if (!buf.byteLength) throw new Error("Recording file is empty.");
  if (buf.byteLength > 15 * 1024 * 1024) {
    throw new Error("Recording is over 15MB — export a shorter audio-only clip.");
  }
  const bytes = new Uint8Array(buf);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  const audioBase64 = btoa(binary);
  const ext = (file.name.split(".").pop() ?? "").toLowerCase();
  const format =
    ext === "mp3" || ext === "mpeg" || ext === "mpga"
      ? "mp3"
      : ext === "wav"
        ? "wav"
        : ext === "webm"
          ? "webm"
          : ext === "ogg"
            ? "ogg"
            : ext === "m4a" || ext === "mp4"
              ? "m4a"
              : ext === "flac"
                ? "flac"
                : undefined;

  const path =
    product === "brief"
      ? `/api/brief/meetings/${encodeURIComponent(entityId)}/recording`
      : `/api/calliq/calls/${encodeURIComponent(entityId)}/recording`;

  const res = await fetch(path, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      audioBase64,
      contentType: file.type || undefined,
      format,
    }),
  });
  const data = (await res.json().catch(() => ({}))) as {
    error?: string;
    playPath?: string;
    byteLength?: number;
  };
  if (!res.ok) throw new Error(data.error ?? `Could not save recording (${res.status})`);
  return {
    playPath: data.playPath ?? path,
    byteLength: data.byteLength ?? buf.byteLength,
  };
}
