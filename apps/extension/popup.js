const rawEl = document.getElementById("raw");
const statusEl = document.getElementById("status");
const micBtn = document.getElementById("mic");
const goBtn = document.getElementById("go");
const calliqBtn = document.getElementById("calliq");
const startWithBotBtn = document.getElementById("start-with-bot");
const briefOpenBtn = document.getElementById("brief-open");
const briefCaptureBtn = document.getElementById("brief-capture");
const meetUrlEl = document.getElementById("meet-url");
const meetChipEl = document.getElementById("meet-chip");

let activeMeetUrl = null;
let activeMeetTabId = null;

function setStatus(t, kind) {
  statusEl.textContent = t || "";
  statusEl.classList.toggle("err", kind === "err");
  statusEl.classList.toggle("ok", kind === "ok");
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
    meetChipEl.textContent = "In Meet";
    meetChipEl.classList.add("on");
    calliqBtn.disabled = false;
    briefCaptureBtn.disabled = false;
  } else if (tab?.url && /meet\.google\.com\/new/i.test(tab.url)) {
    meetUrlEl.textContent = "Waiting for a Meet room code…";
    meetChipEl.textContent = "Lobby";
    meetChipEl.classList.remove("on");
    calliqBtn.disabled = true;
    briefCaptureBtn.disabled = true;
  } else {
    meetUrlEl.textContent = "Open a Meet tab, or start a new one below.";
    meetChipEl.textContent = "Not in Meet";
    meetChipEl.classList.remove("on");
    calliqBtn.disabled = true;
    briefCaptureBtn.disabled = true;
  }

  if (tab?.id && !/^(chrome|chrome-extension|edge|about):/i.test(tab.url || "")) {
    chrome.tabs.sendMessage(tab.id, { type: "scrib.ping" }, () => {
      void chrome.runtime.lastError;
    });
  }
}

async function openCalliqPanel() {
  try {
    const win = await chrome.windows.getCurrent();
    if (win?.id != null) await chrome.sidePanel.open({ windowId: win.id });
  } catch {
    /* older Chrome / no gesture */
  }
}

startWithBotBtn.addEventListener("click", async () => {
  await detectMeetTab();
  const alreadyInMeet = Boolean(activeMeetUrl);
  setStatus(
    alreadyInMeet
      ? "Sending CallIQ Bot — stay in Meet, transcript is in the side panel…"
      : "Opening Meet — stay in that tab; transcript is in the side panel…",
  );
  await openCalliqPanel();
  chrome.runtime.sendMessage(
    {
      type: "calliq.startWithBot",
      createNew: !alreadyInMeet,
      meetTabId: alreadyInMeet ? activeMeetTabId : undefined,
      webOrigin: await getWebBase(),
    },
    (res) => {
      if (!res?.ok) {
        setStatus(`Error: ${res?.reason ?? "unknown"}`, "err");
        return;
      }
      if (res.joined) {
        setStatus("Bot launching — first knock can take 20–45s. Stay in Meet and admit CallIQ Bot.", "ok");
        return;
      }
      setStatus("Join the Meet tab. Transcript will appear in the side panel.");
    },
  );
});

briefOpenBtn.addEventListener("click", () => {
  setStatus("Opening Meet — Brief will pick up the room…");
  chrome.runtime.sendMessage(
    { type: "brief.startCapture", createNew: true },
    (res) => {
      if (!res?.ok) {
        setStatus(`Error: ${res?.reason ?? "unknown"}`, "err");
        return;
      }
      if (res.joined) {
        setStatus("Brief opened. Share the Meet tab and turn on “Also share tab audio”.", "ok");
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
        setStatus(`Error: ${res?.reason ?? "unknown"}`, "err");
        return;
      }
      setStatus("Brief opened. Click Capture Meet audio and share this Meet tab.", "ok");
    },
  );
});

calliqBtn.addEventListener("click", async () => {
  if (!activeMeetUrl) {
    setStatus("No Meet URL on this tab yet");
    return;
  }
  setStatus("Sending CallIQ Bot — stay in Meet, transcript is in the side panel…");
  await openCalliqPanel();
  chrome.runtime.sendMessage(
    {
      type: "calliq.startWithBot",
      createNew: false,
      meetTabId: activeMeetTabId,
      webOrigin: await getWebBase(),
    },
    (res) => {
      if (!res?.ok) {
        setStatus(`Error: ${res?.reason ?? "unknown"}`, "err");
        return;
      }
      setStatus("Bot launching — first knock can take 20–45s. Stay in Meet and admit CallIQ Bot.", "ok");
    },
  );
});

goBtn.addEventListener("click", () => {
  const rawText = rawEl.value.trim();
  if (!rawText) return;
  setStatus("Cleaning…");
  chrome.runtime.sendMessage({ type: "scrib.dictate", rawText, appName: "browser" }, (res) => {
    if (chrome.runtime.lastError) {
      setStatus(`Error: ${chrome.runtime.lastError.message}`, "err");
      return;
    }
    if (!res?.ok) {
      setStatus(`Error: ${res?.reason ?? "unknown"}`, "err");
      return;
    }
    rawEl.value = res.out?.cleaned ?? rawText;
    if (res.insert?.ok) {
      setStatus("Cleaned and inserted into the page.", "ok");
      return;
    }
    setStatus(
      res.insert?.reason === "no_editable_target"
        ? "Cleaned. Click in a text box on the page, then Clean + insert again."
        : res.insert?.reason || "Cleaned. Click a text box on a webpage, then try again.",
    );
  });
});

let scribRecording = false;
let scribStopping = false;

function stopPopupPtt() {
  if (!scribRecording || scribStopping) return;
  scribStopping = true;
  setStatus("Transcribing…");
  micBtn.disabled = true;
  chrome.runtime.sendMessage({ type: "scrib.rec.stop", appName: "browser" }, (res) => {
    scribRecording = false;
    scribStopping = false;
    micBtn.disabled = false;
    micBtn.classList.remove("rec");
    micBtn.textContent = "Hold to talk";
    if (chrome.runtime.lastError) {
      setStatus(`Error: ${chrome.runtime.lastError.message}`, "err");
      return;
    }
    if (!res?.ok) {
      setStatus(`Error: ${res?.reason ?? "unknown"}`, "err");
      return;
    }
    const text = res.out?.cleaned ?? res.out?.transcript ?? res.out?.raw ?? "";
    if (text) rawEl.value = text;
    setStatus(text ? "Transcript ready. Clean + insert, or hold again." : "No speech detected.", text ? "ok" : "err");
  });
}

micBtn.addEventListener("pointerdown", (e) => {
  if (scribRecording || micBtn.disabled) return;
  e.preventDefault();
  micBtn.setPointerCapture(e.pointerId);
  setStatus("Allow the microphone if Chrome asks, then speak…");
  chrome.runtime.sendMessage({ type: "scrib.rec.start" }, (res) => {
    if (chrome.runtime.lastError) {
      setStatus(`Error: ${chrome.runtime.lastError.message}`, "err");
      return;
    }
    if (!res?.ok) {
      setStatus(`Error: ${res?.reason ?? "unknown"}`, "err");
      return;
    }
    scribRecording = true;
    scribStopping = false;
    micBtn.classList.add("rec");
    micBtn.textContent = "Release to paste";
    setStatus("Listening… release to paste.");
  });
});

micBtn.addEventListener("pointerup", stopPopupPtt);
micBtn.addEventListener("pointercancel", stopPopupPtt);
micBtn.addEventListener("lostpointercapture", stopPopupPtt);

document.getElementById("scrib-shortcuts")?.addEventListener("click", (e) => {
  e.preventDefault();
  void chrome.tabs.create({ url: "chrome://extensions/shortcuts" });
});

chrome.commands.getAll().then((cmds) => {
  const scrib = cmds.find((c) => c.name === "scrib-toggle");
  const hint = document.getElementById("scrib-hint");
  if (!hint) return;
  if (!scrib?.shortcut) {
    hint.innerHTML = "Shortcut not set — click <strong>Change shortcut</strong> and assign <kbd>Ctrl+Shift+1</kbd>";
    return;
  }
  hint.innerHTML = `Hold <kbd>${scrib.shortcut}</kbd> (Control ⌃, not ⌘), speak, release to paste`;
}).catch(() => {});

async function showScribStatus() {
  const { scribStatus } = await chrome.storage.local.get("scribStatus");
  if (!scribStatus?.detail) return;
  if (Date.now() - scribStatus.at > 120000) return;
  const kind = scribStatus.state === "error" ? "err" : scribStatus.state === "ok" || scribStatus.state === "listening" ? "ok" : undefined;
  setStatus(scribStatus.detail, kind);
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.scribStatus) void showScribStatus();
});

showScribStatus().catch(() => {});
detectMeetTab().catch(() => {});
