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

async function findProductTab(origin, product, preferredId) {
  if (preferredId != null) {
    const tab = await chrome.tabs.get(preferredId).catch(() => null);
    if (tab?.id != null && (tab.url || "").startsWith(origin)) return tab;
  }
  const path = product === "brief" ? "/brief" : "/calliq";
  const tabs = await chrome.tabs.query({ url: `${origin}/*` });
  return (
    tabs.find((tab) => {
      try {
        const pathname = new URL(tab.url || "").pathname;
        return pathname === path || pathname.startsWith(`${path}/`);
      } catch {
        return false;
      }
    }) ?? null
  );
}

function waitTabComplete(tabId) {
  return new Promise((resolve) => {
    const finish = () => {
      chrome.tabs.onUpdated.removeListener(onUpdated);
      resolve();
    };
    const timer = setTimeout(finish, 8000);
    function onUpdated(id, info) {
      if (id === tabId && info.status === "complete") {
        clearTimeout(timer);
        finish();
      }
    }
    chrome.tabs.get(tabId)
      .then((tab) => {
        if (tab.status === "complete") {
          clearTimeout(timer);
          finish();
        }
      })
      .catch(() => {
        clearTimeout(timer);
        finish();
      });
    chrome.tabs.onUpdated.addListener(onUpdated);
  });
}

async function sidePanelIsOpen() {
  if (!chrome.runtime.getContexts) return false;
  const ctx = await chrome.runtime.getContexts({ contextTypes: ["SIDE_PANEL"] });
  return ctx.length > 0;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function handoffToSidePanel(meetingUrl) {
  await chrome.storage.local.set({
    pendingCalliqJoin: { meetingUrl, at: Date.now() },
  });
  for (let i = 0; i < 10; i++) {
    if (await sidePanelIsOpen()) return true;
    await sleep(150);
  }
  return false;
}

async function handoffToExistingTab(tab, origin, product, meetingUrl) {
  const target = `${origin}${productPath(product, meetingUrl)}`;
  await waitTabComplete(tab.id);
  const sent = await chrome.tabs
    .sendMessage(tab.id, { type: "calliq.handoff", meetingUrl })
    .catch(() => null);
  if (sent?.ok) {
    if (product === "brief") await chrome.tabs.update(tab.id, { active: true });
    return true;
  }
  await chrome.tabs.update(tab.id, { url: target, active: product === "brief" });
  return true;
}

async function handoffMeeting(meetingUrl) {
  if (!followMe) return;
  const origin = (followMe.webOrigin || (await getWebBase())).replace(/\/$/, "");
  const product = followMe.product || "calliq";
  const destTabId = followMe.destTabId;
  followMe = null;
  await chrome.storage.local.set({
    calliqFollowMe: false,
    lastMeetingUrl: meetingUrl,
    lastHandoffProduct: product,
  });

  if (product === "calliq") {
    const existing = await findProductTab(origin, "calliq", destTabId);
    if (destTabId != null && existing?.id != null) {
      await handoffToExistingTab(existing, origin, "calliq", meetingUrl);
      return;
    }
    if (await handoffToSidePanel(meetingUrl)) return;
    if (existing?.id != null) {
      await handoffToExistingTab(existing, origin, "calliq", meetingUrl);
      return;
    }
    await chrome.tabs.create({
      url: `${origin}${productPath("calliq", meetingUrl)}`,
      active: false,
    });
    return;
  }

  const existing = await findProductTab(origin, "brief", destTabId);
  if (existing?.id != null) {
    await handoffToExistingTab(existing, origin, "brief", meetingUrl);
    return;
  }
  await chrome.tabs.create({
    url: `${origin}${productPath("brief", meetingUrl)}`,
    active: true,
  });
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

  async function existingMeet() {
    if (opts.meetTabId != null) {
      const tab = await chrome.tabs.get(opts.meetTabId).catch(() => null);
      const url = extractMeetingUrl(tab?.url || "");
      if (url && !isNewMeetUrl(tab.url || "")) {
        return { tabId: tab.id, url };
      }
    }
    const tabs = await chrome.tabs.query({
      url: ["https://meet.google.com/*", "https://*.zoom.us/*", "https://teams.microsoft.com/*"],
    });
    for (const tab of tabs) {
      const url = extractMeetingUrl(tab.url || "");
      if (url && !isNewMeetUrl(tab.url || "")) return { tabId: tab.id, url };
    }
    return null;
  }

  const already = await existingMeet();
  if (already) {
    followMe.meetTabId = already.tabId;
    await handoffMeeting(already.url);
    return { ok: true, joined: already.url, product };
  }

  if (opts.createNew === false) {
    const tabs = await chrome.tabs.query({
      url: ["https://meet.google.com/*", "https://*.zoom.us/*", "https://teams.microsoft.com/*"],
    });
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
          : "No Google Meet tab found. Join Meet first, then click Bring bot into this Meet.",
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

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false }).catch(() => undefined);
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
