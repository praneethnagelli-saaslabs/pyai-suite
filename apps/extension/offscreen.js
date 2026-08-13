/** Hidden recorder — popup cannot keep getUserMedia after Chrome’s mic prompt. */

let mediaRecorder = null;
let stream = null;
let chunks = [];

function reset() {
  stream?.getTracks().forEach((t) => t.stop());
  stream = null;
  mediaRecorder = null;
  chunks = [];
}

async function start() {
  if (mediaRecorder && mediaRecorder.state !== "inactive") return;
  reset();
  stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const mime = MediaRecorder.isTypeSupported("audio/webm") ? "audio/webm" : undefined;
  mediaRecorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
  mediaRecorder.ondataavailable = (e) => {
    if (e.data.size) chunks.push(e.data);
  };
  mediaRecorder.start();
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const dataUrl = String(reader.result || "");
      const comma = dataUrl.indexOf(",");
      resolve(comma >= 0 ? dataUrl.slice(comma + 1) : "");
    };
    reader.onerror = () => reject(new Error("encode failed"));
    reader.readAsDataURL(blob);
  });
}

async function stop() {
  const rec = mediaRecorder;
  if (!rec || rec.state === "inactive") {
    reset();
    return { audioBase64: "", format: "webm" };
  }
  const blob = await new Promise((resolve) => {
    rec.onstop = () => {
      resolve(new Blob(chunks, { type: rec.mimeType || "audio/webm" }));
    };
    rec.stop();
  });
  reset();
  if (!blob.size) return { audioBase64: "", format: "webm" };
  return { audioBase64: await blobToBase64(blob), format: "webm" };
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === "scrib.offscreen.ping") {
    sendResponse({ ok: true });
    return false;
  }
  if (msg?.type === "scrib.offscreen.start") {
    start()
      .then(() => sendResponse({ ok: true }))
      .catch((e) =>
        sendResponse({
          ok: false,
          reason:
            e?.name === "NotAllowedError"
              ? "Microphone blocked. Allow PyAI Suite in chrome://settings/content/microphone."
              : e instanceof Error
                ? e.message
                : String(e),
        }),
      );
    return true;
  }
  if (msg?.type === "scrib.offscreen.stop") {
    stop()
      .then((out) => sendResponse({ ok: true, ...out }))
      .catch((e) => sendResponse({ ok: false, reason: e instanceof Error ? e.message : String(e) }));
    return true;
  }
  if (msg?.type === "scrib.offscreen.clipboard") {
    navigator.clipboard
      .writeText(String(msg.text || ""))
      .then(() => sendResponse({ ok: true }))
      .catch((e) => sendResponse({ ok: false, reason: e instanceof Error ? e.message : String(e) }));
    return true;
  }
  return false;
});
