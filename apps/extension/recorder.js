const statusEl = document.getElementById("status");
const toggleBtn = document.getElementById("toggle");
const insertBtn = document.getElementById("insert");

let mediaRecorder = null;
let chunks = [];
let stream = null;
let lastText = "";

function setStatus(text, err = false) {
  statusEl.textContent = text || "";
  statusEl.classList.toggle("err", Boolean(err));
}

function micDeniedMessage(err) {
  const msg = err instanceof Error ? err.message : String(err);
  if (/dismissed|NotAllowedError|Permission/i.test(msg) || err?.name === "NotAllowedError") {
    return "Microphone blocked. Allow PyAI Suite in chrome://settings/content/microphone, then click Start again.";
  }
  return msg;
}

async function startRec() {
  chunks = [];
  stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const mime = MediaRecorder.isTypeSupported("audio/webm") ? "audio/webm" : undefined;
  mediaRecorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
  mediaRecorder.ondataavailable = (e) => {
    if (e.data.size) chunks.push(e.data);
  };
  mediaRecorder.onstop = () => {
    void finishRec();
  };
  mediaRecorder.start();
  toggleBtn.classList.add("rec");
  toggleBtn.textContent = "Stop recording";
  setStatus("Recording… click Stop when you are done.");
}

async function finishRec() {
  stream?.getTracks().forEach((t) => t.stop());
  stream = null;
  toggleBtn.classList.remove("rec");
  toggleBtn.textContent = "Start recording";
  if (!chunks.length) {
    setStatus("No audio captured. Try again and speak after Start.", true);
    return;
  }
  setStatus("Transcribing…");
  const blob = new Blob(chunks, { type: "audio/webm" });
  const buf = await blob.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  const audioBase64 = btoa(binary);
  chrome.runtime.sendMessage(
    { type: "scrib.transcribe", audioBase64, format: "webm", appName: "browser" },
    (res) => {
      if (!res?.ok) {
        setStatus(`Error: ${res?.reason ?? "unknown"}`, true);
        return;
      }
      lastText = res.out?.cleaned ?? res.out?.transcript ?? "";
      insertBtn.disabled = !lastText;
      setStatus(lastText ? "Ready. Insert into the page, or record again." : "No transcript returned.");
    },
  );
}

function stopRec() {
  if (mediaRecorder && mediaRecorder.state !== "inactive") mediaRecorder.stop();
}

toggleBtn.addEventListener("click", async () => {
  try {
    if (mediaRecorder && mediaRecorder.state !== "inactive") {
      stopRec();
      return;
    }
    await startRec();
  } catch (e) {
    setStatus(micDeniedMessage(e), true);
  }
});

insertBtn.addEventListener("click", () => {
  if (!lastText) return;
  chrome.runtime.sendMessage({ type: "scrib.dictate", rawText: lastText, appName: "browser" }, (res) => {
    if (!res?.ok) {
      setStatus(`Insert failed: ${res?.reason ?? "unknown"}`, true);
      return;
    }
    setStatus("Inserted into the active tab.");
  });
});
