/**
 * Content script — editable insertion + CallIQ bridge.
 * NEVER receives provider API keys (spec #72).
 * Dictation hotkey is chrome.commands (background) — page keys never reach Docs / chrome://.
 */

globalThis.__pyaiSuiteOff?.();
bootPyaiContent();

function bootPyaiContent() {
  const cleanups = [];

  function alive() {
    try {
      return Boolean(chrome.runtime?.id);
    } catch {
      return false;
    }
  }

  function send(msg, cb) {
    if (!alive()) return;
    try {
      chrome.runtime.sendMessage(msg, (res) => {
        void chrome.runtime?.lastError;
        if (typeof cb === "function") cb(res);
      });
    } catch {
      /* extension reloaded — old script is dead */
    }
  }

  function on(target, type, handler, opts) {
    target.addEventListener(type, handler, opts);
    cleanups.push(() => target.removeEventListener(type, handler, opts));
  }

  function onRuntimeMessage(msg, _sender, sendResponse) {
    if (!alive()) return false;
    if (msg?.type === "scrib.insert") {
      const ok = Boolean(globalThis.__pyaiInsertText?.(msg.text || "")?.ok);
      sendResponse(ok ? { ok: true } : { ok: false, reason: "no_editable_target" });
      return true;
    }
    if (msg?.type === "scrib.ping" || msg?.type === "scrib.activeApp") {
      sendResponse({ ok: true, title: document.title, host: location.hostname, scrib: true });
      return true;
    }
    if (msg?.type === "calliq.handoff" && msg.meetingUrl) {
      window.postMessage({ type: "calliq.handoff.join", meetingUrl: msg.meetingUrl }, location.origin);
      sendResponse({ ok: true, via: "tab" });
      return true;
    }
    return false;
  }
  try {
    chrome.runtime.onMessage.addListener(onRuntimeMessage);
    cleanups.push(() => {
      try {
        chrome.runtime.onMessage.removeListener(onRuntimeMessage);
      } catch {
        /* ignore */
      }
    });
  } catch {
    /* context already dead */
  }

  on(window, "message", (event) => {
    if (event.source !== window || !event.data || typeof event.data !== "object") return;
    if (!alive()) return;
    const type = event.data.type;
    if (type === "calliq.ping") {
      send({ type: "calliq.ping" }, (res) => {
        window.postMessage({ type: "calliq.pong", ok: Boolean(res?.ok), followMe: Boolean(res?.followMe) }, "*");
      });
      return;
    }
    if (type === "calliq.startWithBot") {
      send(
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
      send({ type: "calliq.cancelFollowMe" }, () => {
        window.postMessage({ type: "calliq.cancelFollowMe.result", ok: true }, "*");
      });
      return;
    }
    if (type === "brief.ping") {
      send({ type: "calliq.ping" }, (res) => {
        window.postMessage({ type: "brief.pong", ok: Boolean(res?.ok), followMe: Boolean(res?.followMe) }, "*");
      });
      return;
    }
    if (type === "brief.startCapture") {
      send(
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

  try {
    window.postMessage({ type: "calliq.extension.ready" }, "*");
  } catch {
    /* ignore */
  }

  let pttHeld = false;

  function isPttDown(e) {
    if (e.repeat || !e.ctrlKey || !e.shiftKey || e.metaKey || e.altKey) return false;
    return e.code === "Digit1" || e.code === "Numpad1" || e.key === "1";
  }

  on(
    window,
    "keydown",
    (e) => {
      if (!isPttDown(e)) return;
      e.preventDefault();
      e.stopPropagation();
      if (pttHeld) return;
      pttHeld = true;
      globalThis.__pyaiLockCaret?.() || globalThis.__pyaiRememberFocus?.();
      send({ type: "scrib.ptt.down" });
    },
    true,
  );

  on(
    window,
    "keyup",
    (e) => {
      const one = e.code === "Digit1" || e.code === "Numpad1" || e.key === "1";
      const mod = e.key === "Control" || e.key === "Shift";
      if (!pttHeld && !(one && (e.ctrlKey || e.shiftKey))) return;
      if (!one && !mod && !pttHeld) return;
      if (pttHeld || one) {
        pttHeld = false;
        e.preventDefault();
        send({ type: "scrib.ptt.up" });
      }
    },
    true,
  );

  on(window, "blur", () => {
    if (!pttHeld) return;
    pttHeld = false;
    send({ type: "scrib.ptt.up" });
  });

  globalThis.__pyaiSuiteOff = () => {
    for (const fn of cleanups) {
      try {
        fn();
      } catch {
        /* ignore */
      }
    }
    cleanups.length = 0;
  };
}
