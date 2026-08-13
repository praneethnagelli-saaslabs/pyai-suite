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

async function dictate(rawText, appName, tabContext) {
  const apiBase = await getApiBase();
  const res = await fetch(`${apiBase}/api/scrib/dictate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      rawText,
      appName,
      ...(tabContext ? { tabContext } : {}),
    }),
  });
  if (!res.ok) throw new Error(`dictate failed: ${res.status}`);
  return res.json();
}

async function pingOffscreen() {
  try {
    const r = await chrome.runtime.sendMessage({ type: "scrib.offscreen.ping" });
    return Boolean(r?.ok);
  } catch {
    return false;
  }
}

async function ensureOffscreen() {
  if (await pingOffscreen()) return;
  try {
    await chrome.offscreen.createDocument({
      url: "offscreen.html",
      reasons: ["USER_MEDIA"],
      justification: "Scrib dictation uses the microphone without opening a tab",
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (!/already exists|Only a single offscreen/i.test(msg)) throw e;
  }
  for (let i = 0; i < 20; i++) {
    if (await pingOffscreen()) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error("Scrib recorder failed to start. Reload the extension.");
}

async function sendOffscreen(msg) {
  await ensureOffscreen();
  let lastErr = new Error("Scrib recorder is not ready. Reload the extension.");
  for (let i = 0; i < 6; i++) {
    try {
      const out = await chrome.runtime.sendMessage(msg);
      if (out) return out;
    } catch (e) {
      lastErr = e instanceof Error ? e : new Error(String(e));
      await new Promise((r) => setTimeout(r, 80));
      await ensureOffscreen();
    }
  }
  throw lastErr;
}

async function setScribStatus(state, detail) {
  const row = { at: Date.now(), state, detail };
  await chrome.storage.local.set({ scribStatus: row });
  const badge =
    state === "listening" ? "ON" : state === "busy" ? "…" : state === "ok" ? "✓" : state === "copy" ? "⌘V" : state === "error" ? "!" : "";
  const color =
    state === "error" ? "#b91c1c" : state === "ok" ? "#15803d" : state === "listening" ? "#0f766e" : "#4a6078";
  await chrome.action.setBadgeText({ text: badge });
  await chrome.action.setBadgeBackgroundColor({ color });
  await chrome.action.setTitle({
    title: detail ? `PyAI Suite — ${detail}` : "PyAI Suite",
  });
}

function tabAppContext(tab, field) {
  let host = "";
  let path = "";
  try {
    const u = new URL(tab?.url || "");
    host = u.hostname || "";
    path = u.pathname || "";
  } catch {
    /* ignore */
  }
  const title = typeof tab?.title === "string" ? tab.title.slice(0, 200) : "";
  const appName = [host, path, title].filter(Boolean).join(" ").trim() || "browser";
  return {
    appName,
    tabContext: {
      host: host || undefined,
      path: path || undefined,
      title: title || undefined,
      field: field || "unknown",
    },
  };
}

function insertTextFromTranscript(out) {
  return out?.cleaned || out?.transcript || out?.raw || "";
}

async function transcribe(audioBase64, format, appName, tabContext) {
  const apiBase = await getApiBase();
  const res = await fetch(`${apiBase}/api/scrib/transcribe`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      audioBase64,
      format: format || "webm",
      appName,
      ...(tabContext ? { tabContext } : {}),
    }),
  });
  if (!res.ok) throw new Error(`transcribe failed: ${res.status}`);
  return res.json();
}

function isRestrictedUrl(url) {
  return !url || /^(chrome|chrome-extension|edge|about|devtools|view-source):/i.test(url);
}

async function getInsertTab() {
  const wins = await chrome.windows.getAll({ populate: true, windowTypes: ["normal"] });
  const preferred = wins.find((w) => w.focused) ?? wins[0];
  const tab = preferred?.tabs?.find((t) => t.active) ?? preferred?.tabs?.[0];
  if (tab?.id != null) return tab;
  const [fallback] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  return fallback ?? null;
}

function withTimeout(promise, ms, fallback) {
  let timer;
  return Promise.race([
    Promise.resolve(promise).finally(() => clearTimeout(timer)),
    new Promise((resolve) => {
      timer = setTimeout(() => resolve(fallback), ms);
    }),
  ]);
}

async function rememberInsertTarget(tabId) {
  const results = await withTimeout(
    chrome.scripting
      .executeScript({
        target: { tabId, allFrames: true },
        world: "MAIN",
        files: ["insert.js"],
      })
      .then(() =>
        chrome.scripting.executeScript({
          target: { tabId, allFrames: true },
          world: "MAIN",
          func: () => globalThis.__pyaiLockCaret?.() || globalThis.__pyaiCaretMeta?.() || null,
        }),
      ),
    1500,
    undefined,
  ).catch(() => undefined);
  const hit = results?.find((r) => r?.result?.field && r.result.field !== "unknown")?.result
    || results?.find((r) => r?.result?.field)?.result;
  return hit?.field || "unknown";
}

async function runInsert(tabId, text, world) {
  const attempt = async () => {
    await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      world,
      files: ["insert.js"],
    });
    const results = await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      world,
      func: (value) => globalThis.__pyaiInsertText?.(value) ?? { ok: false },
      args: [text],
    });
    const hit = results?.find((r) => r.result?.ok && r.result?.via !== "dedupe");
    return hit?.result ?? { ok: false };
  };

  return withTimeout(attempt(), 2500, { ok: false });
}

/**
 * Trusted caret insert via CDP. Works in Google Docs, Monaco, Ace, and most
 * web IDEs because the event is privileged — unlike fake DOM textInput.
 * Attaches only for this call, then detaches. Never reads the page or network.
 */
async function trustedType(tabId, text) {
  if (!text || tabId == null) return false;
  const target = { tabId };
  let attached = false;
  try {
    await chrome.debugger.attach(target, "1.3");
    attached = true;
  } catch (e) {
    const msg = String(e?.message || e);
    if (!/already attached/i.test(msg)) return false;
  }
  try {
    await chrome.debugger.sendCommand(target, "Input.insertText", { text });
    return true;
  } catch {
    return false;
  } finally {
    if (attached) {
      await chrome.debugger.detach(target).catch(() => undefined);
    }
  }
}

function trustDomInsert(via) {
  return via === "field" || via === "code";
}

async function writeClipboard(text) {
  const out = await sendOffscreen({ type: "scrib.offscreen.clipboard", text });
  return Boolean(out?.ok);
}

async function insertIntoActiveTab(text) {
  const tab = await getInsertTab();
  if (!tab?.id) {
    await writeClipboard(text);
    throw new Error("Copied. Focus a text box and press ⌘V.");
  }
  if (isRestrictedUrl(tab.url)) {
    const copied = await writeClipboard(text);
    throw new Error(
      copied
        ? "Chrome pages can't receive dictation. Press ⌘V to paste."
        : "Can't insert on Chrome settings / new tab. Open a website and try again.",
    );
  }

  const copied = await writeClipboard(text);

  let dom = { ok: false, via: "" };
  try {
    const main = await runInsert(tab.id, text, "MAIN");
    if (main?.ok) dom = main;
  } catch {
    /* isolated world next */
  }
  if (!dom.ok) {
    try {
      const iso = await runInsert(tab.id, text, "ISOLATED");
      if (iso?.ok) dom = iso;
    } catch {
      /* message next */
    }
  }
  if (!dom.ok) {
    try {
      await injectScrib(tab.id);
      const sent = await withTimeout(
        chrome.tabs.sendMessage(tab.id, { type: "scrib.insert", text }),
        1500,
        null,
      );
      if (sent?.ok) dom = { ok: true, via: "message" };
    } catch {
      /* ignore */
    }
  }

  if (dom.ok && trustDomInsert(dom.via)) return { ok: true };

  try {
    if (await trustedType(tab.id, text)) return { ok: true, via: "trusted" };
  } catch {
    /* clipboard fallback */
  }

  if (dom.ok) return { ok: true };
  if (copied) return { ok: false, reason: "Copied — click the field and press ⌘V." };
  throw new Error("Click in the field, then try again.");
}

let scribHotkeyOn = false;
let scribPttStartedAt = 0;
let scribPttStopping = false;
let scribPttWanted = false;
/** @type {{ appName: string, tabContext: { host?: string, path?: string, title?: string, field?: string } } | null} */
let scribListenCtx = null;

async function showScribHud(tabId, text) {
  if (tabId == null) return;
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  if (!tab || isRestrictedUrl(tab.url)) return;
  await chrome.scripting
    .executeScript({
      target: { tabId, allFrames: false },
      func: (msg) => {
        let hud = document.querySelector("[data-pyai='scrib-hud']");
        if (!msg) {
          hud?.remove();
          return;
        }
        if (!hud) {
          hud = document.createElement("div");
          hud.setAttribute("data-pyai", "scrib-hud");
          hud.style.cssText =
            "position:fixed;z-index:2147483647;left:50%;bottom:24px;transform:translateX(-50%);padding:8px 12px;border-radius:8px;background:#111b26;color:#f8fafc;font:12px/1.3 system-ui,sans-serif;box-shadow:0 8px 24px rgba(0,0,0,.2);pointer-events:none;";
          document.documentElement.appendChild(hud);
        }
        hud.textContent = msg;
      },
      args: [text || ""],
    })
    .catch(() => undefined);
}

async function startScribHotkey() {
  const tab = await getInsertTab();
  let field = "unknown";
  if (tab?.id) field = await rememberInsertTarget(tab.id);
  scribListenCtx = tabAppContext(tab, field);
  const where = [scribListenCtx.tabContext.host || "this tab", field !== "unknown" ? field : null]
    .filter(Boolean)
    .join(" · ");
  await setScribStatus("busy", "Starting microphone…");
  const out = await sendOffscreen({ type: "scrib.offscreen.start" });
  if (out?.ok === false) {
    await setScribStatus("error", out.reason || "Mic failed. Click Record in the popup once to allow the microphone.");
    if (tab?.id) await showScribHud(tab.id, out.reason || "Mic failed");
    return;
  }
  scribHotkeyOn = true;
  scribPttStartedAt = Date.now();
  await setScribStatus("listening", `Listening in ${where}… release to paste`);
  if (tab?.id) {
    await showScribHud(tab.id, `Listening in ${where}… release to paste`);
    await armPttRelease(tab.id);
  }
}

async function armPttRelease(tabId) {
  await chrome.scripting
    .executeScript({
      target: { tabId, allFrames: true },
      func: () => {
        if (globalThis.__pyaiPttArmed) return;
        globalThis.__pyaiPttArmed = true;
        const ping = (msg) => {
          try {
            if (!chrome.runtime?.id) return;
            chrome.runtime.sendMessage(msg, () => void chrome.runtime?.lastError);
          } catch {
            /* extension reloaded */
          }
        };
        const release = (e) => {
          const one = e.code === "Digit1" || e.code === "Numpad1" || e.key === "1";
          const mod = e.key === "Control" || e.key === "Shift";
          if (!one && !mod) return;
          ping({ type: "scrib.ptt.up" });
        };
        window.addEventListener("keyup", release, true);
        window.addEventListener("blur", () => ping({ type: "scrib.ptt.up" }));
      },
    })
    .catch(() => undefined);
}

async function stopScribHotkey() {
  scribHotkeyOn = false;
  const tab = await getInsertTab();
  await setScribStatus("busy", "Transcribing…");
  if (tab?.id) await showScribHud(tab.id, "Transcribing…");
  const clearSoon = async (state, msg) => {
    await setScribStatus(state, msg);
    if (tab?.id) await showScribHud(tab.id, msg);
    setTimeout(() => {
      void chrome.action.setBadgeText({ text: "" });
      if (tab?.id) void showScribHud(tab.id, "");
    }, 2800);
  };
  try {
    const clip = await sendOffscreen({ type: "scrib.offscreen.stop" });
    if (!clip?.ok || !clip.audioBase64) {
      await clearSoon("error", clip?.reason || "No speech captured");
      return;
    }
    const ctx = scribListenCtx || tabAppContext(tab);
    scribListenCtx = null;
    const out = await transcribe(clip.audioBase64, clip.format || "webm", ctx.appName, ctx.tabContext);
    const text = insertTextFromTranscript(out);
    if (!text) {
      await clearSoon("error", "No speech. Speak while the badge says ON.");
      return;
    }
    await new Promise((r) => setTimeout(r, 80));
    try {
      const insert = await insertIntoActiveTab(text);
      if (insert?.ok) {
        await clearSoon("ok", "Pasted");
        return;
      }
      await clearSoon("copy", insert?.reason || "Copied — press ⌘V");
    } catch (e) {
      await clearSoon("copy", e instanceof Error ? e.message : "Copied — press ⌘V");
    }
  } catch (e) {
    await clearSoon("error", e instanceof Error ? e.message : "Dictation failed");
  }
}

async function onScribPttDown(source) {
  if (scribHotkeyOn || scribPttStopping) return;
  scribPttWanted = true;
  await setScribStatus("listening", `Hold to talk (${source})`);
  try {
    await startScribHotkey();
    if (!scribPttWanted && scribHotkeyOn) await onScribPttUp();
  } catch (e) {
    scribHotkeyOn = false;
    scribPttWanted = false;
    await setScribStatus("error", e instanceof Error ? e.message : String(e));
  }
}

async function onScribPttUp() {
  scribPttWanted = false;
  if (!scribHotkeyOn || scribPttStopping) return;
  scribPttStopping = true;
  try {
    await stopScribHotkey();
  } catch (e) {
    scribHotkeyOn = false;
    await setScribStatus("error", e instanceof Error ? e.message : String(e));
  } finally {
    scribPttStopping = false;
  }
}

chrome.commands.onCommand.addListener((command) => {
  if (command !== "scrib-toggle") return;
  if (!scribHotkeyOn) {
    void onScribPttDown("command");
    return;
  }
  // Chrome only sees keydown. If keyup never arrived (chrome://), a second press stops.
  if (Date.now() - scribPttStartedAt > 700) void onScribPttUp();
});

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
    const timer = setTimeout(finish, 3000);
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
    void chrome.storage.local.set({
      pendingCalliqJoin: { meetingUrl, at: Date.now() },
    });
    const existing = await findProductTab(origin, "calliq", destTabId);
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

async function injectScrib(tabId) {
  if (tabId == null) return;
  await chrome.scripting.executeScript({
    target: { tabId, allFrames: true },
    files: ["insert.js", "content.js"],
  }).catch(() => undefined);
}

async function injectScribIntoOpenTabs() {
  const tabs = await chrome.tabs.query({});
  for (const tab of tabs) {
    if (!tab.id || isRestrictedUrl(tab.url)) continue;
    await injectScrib(tab.id);
  }
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false }).catch(() => undefined);
  void injectScribIntoOpenTabs();
});
chrome.runtime.onStartup.addListener(() => {
  void injectScribIntoOpenTabs();
});
chrome.tabs.onActivated.addListener((info) => {
  void injectScrib(info.tabId);
});
chrome.tabs.onUpdated.addListener((tabId, change, tab) => {
  if (change.status === "complete" && !isRestrictedUrl(tab.url)) void injectScrib(tabId);
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
    getInsertTab()
      .then(async (tab) => {
        const field = tab?.id ? await rememberInsertTarget(tab.id) : "unknown";
        const ctx = tabAppContext(tab, field);
        const appName = msg.appName && msg.appName !== "browser" ? msg.appName : ctx.appName;
        const out = await dictate(msg.rawText, appName, ctx.tabContext);
        let insert = { ok: false };
        try {
          insert = await insertIntoActiveTab(insertTextFromTranscript(out));
        } catch (e) {
          insert = { ok: false, reason: e instanceof Error ? e.message : String(e) };
        }
        sendResponse({ ok: true, out, insert });
      })
      .catch((e) => sendResponse({ ok: false, reason: String(e) }));
    return true;
  }
  if (msg?.type === "scrib.ptt.down" || msg?.type === "scrib.hotkey") {
    void onScribPttDown("page");
    sendResponse({ ok: true });
    return false;
  }
  if (msg?.type === "scrib.ptt.up") {
    void onScribPttUp();
    sendResponse({ ok: true });
    return false;
  }
  if (msg?.type === "scrib.rec.start") {
    getInsertTab()
      .then(async (tab) => {
        const field = tab?.id ? await rememberInsertTarget(tab.id) : "unknown";
        scribListenCtx = tabAppContext(tab, field);
        return sendOffscreen({ type: "scrib.offscreen.start" });
      })
      .then((out) => sendResponse(out?.ok === false ? out : { ok: true }))
      .catch((e) => sendResponse({ ok: false, reason: String(e) }));
    return true;
  }
  if (msg?.type === "scrib.rec.stop") {
    sendOffscreen({ type: "scrib.offscreen.stop" })
      .then(async (clip) => {
        if (!clip?.ok) {
          sendResponse({ ok: false, reason: clip?.reason ?? "Recording failed" });
          return;
        }
        if (!clip.audioBase64) {
          sendResponse({ ok: false, reason: "No audio captured. Click Record, speak, then Stop." });
          return;
        }
        const tab = await getInsertTab();
        const ctx = scribListenCtx || tabAppContext(tab);
        scribListenCtx = null;
        const appName = msg.appName && msg.appName !== "browser" ? msg.appName : ctx.appName;
        const out = await transcribe(clip.audioBase64, clip.format || "webm", appName, ctx.tabContext);
        sendResponse({ ok: true, out });
      })
      .catch((e) => sendResponse({ ok: false, reason: String(e) }));
    return true;
  }
  if (msg?.type === "scrib.transcribe") {
    transcribe(msg.audioBase64, msg.format, msg.appName, msg.tabContext)
      .then((out) => sendResponse({ ok: true, out }))
      .catch((e) => sendResponse({ ok: false, reason: String(e) }));
    return true;
  }
  if (msg?.type === "scrib.insert") {
    insertIntoActiveTab(msg.text || "")
      .then((insert) => sendResponse({ ok: true, insert }))
      .catch((e) => sendResponse({ ok: false, reason: e instanceof Error ? e.message : String(e) }));
    return true;
  }
  return false;
});
