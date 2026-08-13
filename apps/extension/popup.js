const rawEl = document.getElementById("raw");
const statusEl = document.getElementById("status");
const micBtn = document.getElementById("mic");
const goBtn = document.getElementById("go");
const calliqBtn = document.getElementById("calliq");
const startWithBotBtn = document.getElementById("start-with-bot");
const briefOpenBtn = document.getElementById("brief-open");
const briefCaptureBtn = document.getElementById("brief-capture");
const meetUrlEl = document.getElementById("meet-url");

let mediaRecorder = null;
let chunks = [];
let activeMeetUrl = null;
let activeMeetTabId = null;

function setStatus(t) {
  statusEl.textContent = t || "";
}

function extractMeetingUrl(text) {
  if (!text) return null;
  const meet = text.match(/https?:\/\/meet\.google\.com\/[a-z0-9]{3}-[a-z0-9]{4}-[a-z0-9]{3}\b/i);
  if (meet) return meet[0];
  const zoom = text.match(/https?:\/\/(?:[\w.-]+\.)?zoom\.us\/j\/\d+[^\s]*/i);
  if (zoom) return zoom[0].replace(/[),.;]+$/, "");
  const teams = text.match(/https?:\/\/teams\.microsoft\.com\/l\/meetup-join\/[^\s]+/i);
  if (teams) return teams[0].replace(/[),.;]+$/, "");
  return null;
}

async function getWebBase() {
  const stored = await chrome.storage.local.get(["webBase"]);
  return stored.webBase || "http://localhost:3000";
}

async function detectMeetTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  activeMeetTabId = tab?.id ?? null;
  const url = extractMeetingUrl(tab?.url || "");
  activeMeetUrl = url;
  if (url) {
    meetUrlEl.textContent = url;
    calliqBtn.disabled = false;
    briefCaptureBtn.disabled = false;
  } else if (tab?.url && /meet\.google\.com\/new/i.test(tab.url)) {
    meetUrlEl.textContent = "Waiting for Meet room code… use Start call or Open Meet + Brief.";
    calliqBtn.disabled = true;
    briefCaptureBtn.disabled = true;
  } else {
    meetUrlEl.textContent = "Tip: open Meet, or click Start call / Open Meet + Brief.";
    calliqBtn.disabled = true;
    briefCaptureBtn.disabled = true;
  }
}

startWithBotBtn.addEventListener("click", async () => {
  await detectMeetTab();
  const alreadyInMeet = Boolean(activeMeetUrl);
  setStatus(
    alreadyInMeet
      ? "Sending CallIQ Bot into this Meet…"
      : "Opening Meet — bot will join the same room…",
  );
  chrome.runtime.sendMessage(
    {
      type: "calliq.startWithBot",
      createNew: !alreadyInMeet,
      meetTabId: alreadyInMeet ? activeMeetTabId : undefined,
      webOrigin: await getWebBase(),
    },
    (res) => {
      if (!res?.ok) {
        setStatus(`Error: ${res?.reason ?? "unknown"}`);
        return;
      }
      if (res.joined) {
        setStatus("CallIQ opened — admit one CallIQ Bot. Only you get the transcript.");
        return;
      }
      setStatus("Join the Meet tab. Bot follows when the room is ready.");
    },
  );
});

briefOpenBtn.addEventListener("click", () => {
  setStatus("Opening Meet — Brief will pick up the room…");
  chrome.runtime.sendMessage(
    { type: "brief.startCapture", createNew: true },
    (res) => {
      if (!res?.ok) {
        setStatus(`Error: ${res?.reason ?? "unknown"}`);
        return;
      }
      if (res.joined) {
        setStatus("Brief opened with this Meet. Share the Meet tab with tab audio on.");
        return;
      }
      setStatus("Join the Meet tab. Brief updates when the room is ready.");
    },
  );
});

briefCaptureBtn.addEventListener("click", async () => {
  if (!activeMeetUrl) {
    setStatus("No Meet URL on this tab yet");
    return;
  }
  setStatus("Opening Brief for this Meet…");
  chrome.runtime.sendMessage(
    {
      type: "brief.startCapture",
      createNew: false,
      meetTabId: activeMeetTabId,
      webOrigin: await getWebBase(),
    },
    (res) => {
      if (!res?.ok) {
        setStatus(`Error: ${res?.reason ?? "unknown"}`);
        return;
      }
      setStatus("Brief opened. Click Capture Meet audio and share this Meet tab.");
    },
  );
});

calliqBtn.addEventListener("click", async () => {
  if (!activeMeetUrl) {
    setStatus("No Meet URL on this tab yet");
    return;
  }
  setStatus("Sending CallIQ Bot into this Meet…");
  chrome.runtime.sendMessage(
    {
      type: "calliq.startWithBot",
      createNew: false,
      meetTabId: activeMeetTabId,
      webOrigin: await getWebBase(),
    },
    (res) => {
      if (!res?.ok) {
        setStatus(`Error: ${res?.reason ?? "unknown"}`);
        return;
      }
      setStatus("CallIQ opened — admit one CallIQ Bot. Only you get the transcript.");
    },
  );
});

goBtn.addEventListener("click", () => {
  const rawText = rawEl.value.trim();
  if (!rawText) return;
  setStatus("Cleaning…");
  chrome.runtime.sendMessage({ type: "scrib.dictate", rawText, appName: "browser" }, (res) => {
    if (!res?.ok) {
      setStatus(`Error: ${res?.reason ?? "unknown"}`);
      return;
    }
    rawEl.value = res.out?.cleaned ?? rawText;
    setStatus("Inserted into active tab");
  });
});

async function startRec() {
  chunks = [];
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  mediaRecorder = new MediaRecorder(stream, { mimeType: MediaRecorder.isTypeSupported("audio/webm") ? "audio/webm" : undefined });
  mediaRecorder.ondataavailable = (e) => {
    if (e.data.size) chunks.push(e.data);
  };
  mediaRecorder.onstop = async () => {
    stream.getTracks().forEach((t) => t.stop());
    const blob = new Blob(chunks, { type: "audio/webm" });
    const buf = await blob.arrayBuffer();
    const bytes = new Uint8Array(buf);
    let binary = "";
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    const audioBase64 = btoa(binary);
    setStatus("Transcribing…");
    chrome.runtime.sendMessage(
      { type: "scrib.transcribe", audioBase64, format: "webm", appName: "browser" },
      (res) => {
        if (!res?.ok) {
          setStatus(`Error: ${res?.reason ?? "unknown"}`);
          return;
        }
        rawEl.value = res.out?.cleaned ?? res.out?.transcript ?? "";
        setStatus("Inserted into active tab");
      },
    );
  };
  mediaRecorder.start();
  micBtn.classList.add("rec");
  micBtn.textContent = "Recording… release to stop";
  setStatus("Recording");
}

function stopRec() {
  if (mediaRecorder && mediaRecorder.state !== "inactive") mediaRecorder.stop();
  micBtn.classList.remove("rec");
  micBtn.textContent = "Hold to record (mic)";
}

micBtn.addEventListener("mousedown", () => {
  startRec().catch((e) => setStatus(String(e)));
});
micBtn.addEventListener("mouseup", stopRec);
micBtn.addEventListener("mouseleave", stopRec);
micBtn.addEventListener("touchstart", (e) => {
  e.preventDefault();
  startRec().catch((err) => setStatus(String(err)));
});
micBtn.addEventListener("touchend", (e) => {
  e.preventDefault();
  stopRec();
});

detectMeetTab().catch(() => {});
