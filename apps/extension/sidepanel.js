const iframe = document.getElementById("app");
let webOrigin = "http://localhost:3000";
let pendingUrl = null;

function targetOrigin() {
  try {
    return new URL(iframe.src || webOrigin).origin;
  } catch {
    return webOrigin;
  }
}

function postJoin(meetingUrl) {
  if (!meetingUrl) return false;
  const win = iframe.contentWindow;
  if (!win) return false;
  const origin = targetOrigin();
  try {
    const frameOrigin = win.location.origin;
    if (frameOrigin.startsWith("chrome-extension:")) return false;
  } catch {
    /* cross-origin iframe — CallIQ has loaded */
  }
  try {
    win.postMessage({ type: "calliq.handoff.join", meetingUrl }, origin);
    void chrome.storage.local.set({
      calliqJoinAck: { meetingUrl, at: Date.now() },
    });
    return true;
  } catch {
    return false;
  }
}

function flushPending() {
  if (!pendingUrl) return;
  if (postJoin(pendingUrl)) pendingUrl = null;
}

function queueJoin(meetingUrl) {
  if (!meetingUrl || typeof meetingUrl !== "string") return;
  pendingUrl = meetingUrl;
  flushPending();
}

async function loadCalliq() {
  const stored = await chrome.storage.local.get(["webBase"]);
  webOrigin = (stored.webBase || "http://localhost:3000").replace(/\/$/, "");
  const target = `${webOrigin}/calliq`;
  if (iframe.getAttribute("src") !== target) iframe.src = target;
}

iframe.addEventListener("load", () => {
  flushPending();
});

loadCalliq()
  .then(async () => {
    const { pendingCalliqJoin } = await chrome.storage.local.get("pendingCalliqJoin");
    if (pendingCalliqJoin?.meetingUrl) queueJoin(pendingCalliqJoin.meetingUrl);
  })
  .catch(() => {});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local" || !changes.pendingCalliqJoin?.newValue?.meetingUrl) return;
  queueJoin(changes.pendingCalliqJoin.newValue.meetingUrl);
});
