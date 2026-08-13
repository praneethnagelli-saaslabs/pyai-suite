const iframe = document.getElementById("app");
let webOrigin = "http://localhost:3000";
let pendingUrl = null;
/** Set only after CallIQ posts calliq.iframe.ready — never guess from iframe.src. */
let frameOrigin = null;

function allowedOrigin(origin) {
  return origin === webOrigin;
}

function postJoin(meetingUrl) {
  if (!meetingUrl || !frameOrigin) return false;
  const win = iframe.contentWindow;
  if (!win) return false;
  win.postMessage({ type: "calliq.handoff.join", meetingUrl }, frameOrigin);
  void chrome.storage.local.set({
    calliqJoinAck: { meetingUrl, at: Date.now() },
  });
  return true;
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
  if (iframe.getAttribute("src") !== target) {
    frameOrigin = null;
    iframe.src = target;
  }
}

window.addEventListener("message", (event) => {
  if (event.source !== iframe.contentWindow) return;
  if (!allowedOrigin(event.origin)) return;
  if (event.data?.type !== "calliq.iframe.ready") return;
  frameOrigin = event.origin;
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
