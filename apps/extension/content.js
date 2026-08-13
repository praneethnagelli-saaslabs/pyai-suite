/**
 * Content script — editable insertion + CallIQ bridge.
 * NEVER receives provider API keys (spec #72).
 */

function detectEditable(el) {
  if (!el) return null;
  const tag = (el.tagName || "").toLowerCase();
  if (tag === "textarea") return { kind: "textarea", el };
  if (tag === "input") {
    const type = (el.getAttribute("type") || "text").toLowerCase();
    if (["text", "search", "url", "email", "tel", "", "password", "number"].includes(type)) {
      return { kind: "input", el };
    }
  }
  if (el.isContentEditable || el.getAttribute?.("contenteditable") === "true") {
    return { kind: "contenteditable", el };
  }
  return null;
}

function insertText(target, text) {
  const el = target.el;
  if (target.kind === "textarea" || target.kind === "input") {
    const start = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? el.value.length;
    const before = el.value.slice(0, start);
    const after = el.value.slice(end);
    el.value = before + text + after;
    const pos = start + text.length;
    el.selectionStart = el.selectionEnd = pos;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    return;
  }
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) {
    el.focus();
    el.innerText = (el.innerText || "") + text;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    return;
  }
  const range = sel.getRangeAt(0);
  range.deleteContents();
  range.insertNode(document.createTextNode(text));
  range.collapse(false);
  sel.removeAllRanges();
  sel.addRange(range);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === "scrib.insert") {
    const active = document.activeElement;
    const target = detectEditable(active);
    if (!target) {
      sendResponse({ ok: false, reason: "no_editable_target" });
      return true;
    }
    insertText(target, msg.text || "");
    sendResponse({ ok: true, kind: target.kind });
    return true;
  }
  if (msg?.type === "scrib.activeApp") {
    sendResponse({ ok: true, title: document.title, host: location.hostname });
    return true;
  }
  return false;
});

window.addEventListener("message", (event) => {
  if (event.source !== window || !event.data || typeof event.data !== "object") return;
  const type = event.data.type;
  if (type === "calliq.ping") {
    chrome.runtime.sendMessage({ type: "calliq.ping" }, (res) => {
      window.postMessage({ type: "calliq.pong", ok: Boolean(res?.ok), followMe: Boolean(res?.followMe) }, "*");
    });
    return;
  }
  if (type === "calliq.startWithBot") {
    chrome.runtime.sendMessage(
      {
        type: "calliq.startWithBot",
        webOrigin: event.data.webOrigin || location.origin,
        createNew: event.data.createNew !== false,
      },
      (res) => {
        window.postMessage({ type: "calliq.startWithBot.result", ok: Boolean(res?.ok), ...res }, "*");
      },
    );
    return;
  }
  if (type === "calliq.cancelFollowMe") {
    chrome.runtime.sendMessage({ type: "calliq.cancelFollowMe" }, () => {
      window.postMessage({ type: "calliq.cancelFollowMe.result", ok: true }, "*");
    });
    return;
  }
  if (type === "brief.ping") {
    chrome.runtime.sendMessage({ type: "calliq.ping" }, (res) => {
      window.postMessage({ type: "brief.pong", ok: Boolean(res?.ok), followMe: Boolean(res?.followMe) }, "*");
    });
    return;
  }
  if (type === "brief.startCapture") {
    chrome.runtime.sendMessage(
      {
        type: "brief.startCapture",
        webOrigin: event.data.webOrigin || location.origin,
        createNew: event.data.createNew === true,
        destTabId: undefined,
      },
      (res) => {
        window.postMessage({ type: "brief.startCapture.result", ok: Boolean(res?.ok), ...res }, "*");
      },
    );
  }
});

window.postMessage({ type: "calliq.extension.ready" }, "*");
