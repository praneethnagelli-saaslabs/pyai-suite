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
  toggleBtn.textContent = "Stop";
  statusEl.innerHTML = '<span class="pulse"></span>Recording… click Stop when you are done.';
  statusEl.classList.remove("err");
}

async function finishRec() {
  stream?.getTracks().forEach((t) => t.stop());
  stream = null;
  toggleBtn.classList.remove("rec");
  toggleBtn.textContent = "Start";
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
      if (chrome.runtime.lastError) {
        setStatus(`Error: ${chrome.runtime.lastError.message}`, true);
        return;
      }
      if (!res?.ok) {
        setStatus(`Error: ${res?.reason ?? "unknown"}`, true);
        return;
      }
      lastText = res.out?.cleaned ?? res.out?.transcript ?? "";
      insertBtn.disabled = !lastText;
      setStatus(lastText ? "Ready. Click a text box, then Insert." : "No transcript returned.");
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
  chrome.runtime.sendMessage({ type: "scrib.insert", text: lastText }, (res) => {
    if (chrome.runtime.lastError) {
      setStatus(`Insert failed: ${chrome.runtime.lastError.message}`, true);
      return;
    }
    if (!res?.ok || res.insert?.ok === false) {
      const reason = res?.reason ?? res?.insert?.reason;
      setStatus(
        reason === "no_editable_target"
          ? "Click in a text box on the page, then Insert."
          : reason ?? "Insert failed. Refresh the page, click a text box, try again.",
        true,
      );
      return;
    }
    setStatus("Inserted into the page.");
  });
});
