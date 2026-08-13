const iframe = document.getElementById("app");

function originOf(url) {
  try {
    return new URL(url).origin;
  } catch {
    return "http://localhost:3000";
  }
}

async function loadCalliq() {
  const stored = await chrome.storage.local.get(["webBase"]);
  const origin = (stored.webBase || "http://localhost:3000").replace(/\/$/, "");
  const target = `${origin}/calliq`;
  if (iframe.getAttribute("src") !== target) iframe.src = target;
}

function postJoin(meetingUrl) {
  if (!meetingUrl) return;
  const origin = originOf(iframe.src);
  const send = () => {
    iframe.contentWindow?.postMessage({ type: "calliq.handoff.join", meetingUrl }, origin);
  };
  send();
  setTimeout(send, 400);
  setTimeout(send, 1200);
}

function consumePending(pending) {
  const url = pending?.meetingUrl;
  if (!url || typeof url !== "string") return;
  const send = () => postJoin(url);
  if (iframe.contentWindow) send();
  else iframe.addEventListener("load", send, { once: true });
  void chrome.storage.local.remove("pendingCalliqJoin");
}

loadCalliq()
  .then(async () => {
    const { pendingCalliqJoin } = await chrome.storage.local.get("pendingCalliqJoin");
    consumePending(pendingCalliqJoin);
  })
  .catch(() => {});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local" || !changes.pendingCalliqJoin?.newValue) return;
  consumePending(changes.pendingCalliqJoin.newValue);
});
