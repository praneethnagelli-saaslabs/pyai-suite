/**
 * Background service worker.
 * Holds the local API base URL only — never provider secrets.
 * Dictation cleanup / STT go to localhost API; keys stay server-side.
 * CallIQ "follow me": watch Meet tab → open CallIQ with ?join= when room is ready.
 * Brief: same Meet watch → open Brief with ?capture= (no bot; capture tab audio in the app).
 */

const DEFAULT_API = "http://127.0.0.1:4000";
const DEFAULT_WEB = "http://localhost:3000";

/** @type {{ webOrigin: string, product: "calliq" | "brief", destTabId?: number, meetTabId?: number, until: number } | null} */
let followMe = null;

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

function isNewMeetUrl(url) {
  return /meet\.google\.com\/new\/?$/i.test(url || "");
}

async function getApiBase() {
  const stored = await chrome.storage.local.get(["apiBase"]);
  return stored.apiBase || DEFAULT_API;
}

async function getWebBase() {
  const stored = await chrome.storage.local.get(["webBase"]);
  return stored.webBase || DEFAULT_WEB;
}

async function dictate(rawText, appName) {
  const apiBase = await getApiBase();
  const res = await fetch(`${apiBase}/api/scrib/dictate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      rawText,
      appName,
      mode: "light",
    }),
  });
  if (!res.ok) throw new Error(`dictate failed: ${res.status}`);
  return res.json();
}

async function transcribe(audioBase64, format, appName) {
  const apiBase = await getApiBase();
  const res = await fetch(`${apiBase}/api/scrib/transcribe`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      audioBase64,
      format: format || "webm",
      appName,
      mode: "light",
    }),
  });
  if (!res.ok) throw new Error(`transcribe failed: ${res.status}`);
  return res.json();
}

async function insertIntoActiveTab(text) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) throw new Error("no active tab");
  return chrome.tabs.sendMessage(tab.id, { type: "scrib.insert", text });
}

function productPath(product, meetingUrl) {
  if (product === "brief") {
    const q = meetingUrl ? `capture=${encodeURIComponent(meetingUrl)}` : "capture=1";
    return `/brief?${q}`;
  }
  return `/calliq?join=${encodeURIComponent(meetingUrl || "")}`;
}

async function handoffMeeting(meetingUrl) {
  if (!followMe) return;
  const origin = (followMe.webOrigin || (await getWebBase())).replace(/\/$/, "");
  const product = followMe.product || "calliq";
  const target = `${origin}${productPath(product, meetingUrl)}`;
  const destTabId = followMe.destTabId;
  followMe = null;
  await chrome.storage.local.set({
    calliqFollowMe: false,
    lastMeetingUrl: meetingUrl,
    lastHandoffProduct: product,
  });

  if (destTabId != null) {
    try {
      await chrome.tabs.update(destTabId, { url: target, active: product === "brief" });
      return;
    } catch {
      /* tab closed */
    }
  }
  await chrome.tabs.create({ url: target, active: product === "brief" });
}

async function startFollowMe(opts) {
  const webOrigin = (opts.webOrigin || (await getWebBase())).replace(/\/$/, "");
  const product = opts.product === "brief" ? "brief" : "calliq";
  followMe = {
    webOrigin,
    product,
    destTabId: opts.destTabId,
    meetTabId: opts.meetTabId,
    until: Date.now() + 15 * 60 * 1000,
  };
  await chrome.storage.local.set({ calliqFollowMe: true, followMeProduct: product });

  // Already on a real Meet? Hand off immediately.
  if (opts.meetTabId != null) {
    const tab = await chrome.tabs.get(opts.meetTabId).catch(() => null);
    const url = extractMeetingUrl(tab?.url || "");
    if (url && !isNewMeetUrl(tab.url)) {
      await handoffMeeting(url);
      return { ok: true, joined: url, product };
    }
  }

  if (opts.createNew === false) {
    const tabs = await chrome.tabs.query({
      url: ["https://meet.google.com/*", "https://*.zoom.us/*", "https://teams.microsoft.com/*"],
    });
    for (const tab of tabs) {
      const url = extractMeetingUrl(tab.url || "");
      if (url && !isNewMeetUrl(tab.url || "")) {
        followMe.meetTabId = tab.id;
        await handoffMeeting(url);
        return { ok: true, joined: url, product };
      }
    }
    const pending = tabs.find((t) => isNewMeetUrl(t.url || ""));
    if (pending?.id != null) {
      followMe.meetTabId = pending.id;
      return { ok: true, waiting: true, product };
    }
    return {
      ok: false,
      reason:
        product === "brief"
          ? "No Google Meet tab found. Open Meet, or use Open Meet + Brief."
          : "No Google Meet tab found. Start a call first, or use Start call with CallIQ Bot.",
    };
  }

  const meetTab = await chrome.tabs.create({ url: "https://meet.google.com/new", active: true });
  followMe.meetTabId = meetTab.id;
  if (product === "brief") {
    const briefTab = await chrome.tabs.create({
      url: `${webOrigin}/brief?capture=1`,
      active: false,
    });
    followMe.destTabId = briefTab.id;
  }
  return { ok: true, waiting: true, product };
}

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (!followMe) return;
  if (Date.now() > followMe.until) {
    followMe = null;
    await chrome.storage.local.set({ calliqFollowMe: false });
    return;
  }
  const url = changeInfo.url || tab.url || "";
  if (!url) return;
  if (followMe.meetTabId != null && tabId !== followMe.meetTabId) {
    // Also accept if user navigated a different Meet tab while follow-me is on
    if (!/meet\.google\.com|zoom\.us|teams\.microsoft\.com/i.test(url)) return;
  }
  if (isNewMeetUrl(url)) return;
  const meetingUrl = extractMeetingUrl(url);
  if (!meetingUrl) return;
  followMe.meetTabId = tabId;
  await handoffMeeting(meetingUrl);
});

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== "dictate") return;
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const info = tab?.id
      ? await chrome.tabs.sendMessage(tab.id, { type: "scrib.activeApp" }).catch(() => ({}))
      : {};
    const raw = "hey can you like uh send this to the team tomorrow";
    const out = await dictate(raw, info.title || info.host || "browser");
    await insertIntoActiveTab(out.cleaned || out.raw || raw);
  } catch (e) {
    console.error("scrib dictate failed", String(e));
  }
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type === "calliq.ping") {
    sendResponse({ ok: true, followMe: Boolean(followMe) });
    return false;
  }
  if (msg?.type === "calliq.startWithBot" || msg?.type === "brief.startCapture") {
    startFollowMe({
      webOrigin: msg.webOrigin,
      product: msg.type === "brief.startCapture" ? "brief" : "calliq",
      destTabId: msg.destTabId ?? sender.tab?.id,
      meetTabId: msg.meetTabId,
      createNew: msg.createNew !== false,
    })
      .then((out) => sendResponse(out))
      .catch((e) => sendResponse({ ok: false, reason: String(e) }));
    return true;
  }
  if (msg?.type === "calliq.cancelFollowMe") {
    followMe = null;
    chrome.storage.local.set({ calliqFollowMe: false });
    sendResponse({ ok: true });
    return false;
  }
  if (msg?.type === "scrib.dictate") {
    dictate(msg.rawText, msg.appName)
      .then(async (out) => {
        const insert = await insertIntoActiveTab(out.cleaned || out.raw);
        sendResponse({ ok: true, out, insert });
      })
      .catch((e) => sendResponse({ ok: false, reason: String(e) }));
    return true;
  }
  if (msg?.type === "scrib.transcribe") {
    transcribe(msg.audioBase64, msg.format, msg.appName)
      .then(async (out) => {
        const insert = await insertIntoActiveTab(out.cleaned || out.transcript || out.raw || "");
        sendResponse({ ok: true, out, insert });
      })
      .catch((e) => sendResponse({ ok: false, reason: String(e) }));
    return true;
  }
  return false;
});
