/**
 * Insert dictation into whatever the user was typing in.
 * Safe in MAIN and isolated worlds. No chrome.* / secrets.
 */
(function pyaiInsertBoot() {
  const MARK = "data-pyai-scrib-target";
  const TYPABLE = new Set([
    "text",
    "search",
    "url",
    "email",
    "tel",
    "password",
    "number",
    "date",
    "datetime-local",
    "month",
    "time",
    "week",
    "",
  ]);

  function unwrap(el) {
    if (!el) return null;
    if (el.nodeType === 3) return el.parentElement;
    return el.nodeType === 1 ? el : null;
  }

  function deepActive(doc) {
    const root = doc || document;
    let el = root.activeElement;
    for (let i = 0; i < 12 && el; i++) {
      if (el.shadowRoot?.activeElement) {
        el = el.shadowRoot.activeElement;
        continue;
      }
      if (el.tagName === "IFRAME" || el.tagName === "FRAME") {
        try {
          const inner = el.contentDocument?.activeElement;
          if (inner && inner !== el) {
            el = inner;
            continue;
          }
        } catch {
          /* cross-origin */
        }
      }
      break;
    }
    return unwrap(el);
  }

  function isOffscreenField(el) {
    if (!el || el.nodeType !== 1) return false;
    if (el.isContentEditable) return false;
    const cls = el.className?.toString?.() || "";
    if (/\bace_text-input\b/.test(cls)) return true;
    const tag = (el.tagName || "").toLowerCase();
    if (tag !== "input" && tag !== "textarea") return false;
    try {
      const s = (el.ownerDocument || document).defaultView?.getComputedStyle?.(el);
      if (s && (s.display === "none" || s.visibility === "hidden")) return true;
    } catch {
      /* ignore */
    }
    const r = el.getBoundingClientRect?.();
    if (r && (r.width < 4 || r.height < 4)) return true;
    return false;
  }

  function isTypableInput(el) {
    const tag = (el.tagName || "").toLowerCase();
    if (tag === "textarea") return !isOffscreenField(el) && !el.readOnly && !el.disabled;
    if (tag !== "input") return false;
    if (el.readOnly || el.disabled) return false;
    if (isOffscreenField(el)) return false;
    return TYPABLE.has((el.getAttribute("type") || "text").toLowerCase());
  }

  function isEditor(el) {
    if (!el || el === document.documentElement) return false;
    if (el.classList?.contains("ace_editor")) return true;
    if (el.classList?.contains("CodeMirror") || el.classList?.contains("cm-editor")) return true;
    if (isTypableInput(el)) return true;
    const ce = el.getAttribute?.("contenteditable");
    if (el.isContentEditable || ce === "true" || ce === "plaintext-only") return true;
    const role = (el.getAttribute?.("role") || "").toLowerCase();
    if (role === "textbox" || role === "searchbox" || role === "combobox") return true;
    if (el.classList?.contains("ProseMirror")) return true;
    if (el.classList?.contains("ql-editor")) return true;
    if (el.classList?.contains("cm-content")) return true;
    if (el.classList?.contains("monaco-editor")) return true;
    if (el.hasAttribute?.("data-slate-editor")) return true;
    if (el.hasAttribute?.("data-lexical-editor")) return true;
    if (el.hasAttribute?.("data-gramm")) return true;
    return false;
  }

  function closestEditor(el) {
    let cur = unwrap(el);
    for (let i = 0; i < 20 && cur && cur !== document.documentElement; i++) {
      if (isEditor(cur)) return cur;
      if (cur.assignedSlot) {
        cur = cur.assignedSlot;
        continue;
      }
      cur = cur.parentElement || cur.getRootNode?.()?.host || null;
    }
    return null;
  }

  function findMarked(root) {
    const doc = root || document;
    try {
      const hit = doc.querySelector?.(`[${MARK}]`);
      if (hit) return hit;
    } catch {
      /* ignore */
    }
    const all = doc.querySelectorAll?.("*") || [];
    for (const node of all) {
      if (node.shadowRoot) {
        const inner = findMarked(node.shadowRoot);
        if (inner) return inner;
      }
      if (node.tagName === "IFRAME" || node.tagName === "FRAME") {
        try {
          if (node.contentDocument) {
            const inner = findMarked(node.contentDocument);
            if (inner) return inner;
          }
        } catch {
          /* ignore */
        }
      }
    }
    return null;
  }

  function clearMarks(root) {
    const doc = root || document;
    try {
      doc.querySelectorAll?.(`[${MARK}]`).forEach((el) => el.removeAttribute(MARK));
    } catch {
      /* ignore */
    }
    const all = doc.querySelectorAll?.("*") || [];
    for (const node of all) {
      if (node.shadowRoot) clearMarks(node.shadowRoot);
      if (node.tagName === "IFRAME" || node.tagName === "FRAME") {
        try {
          if (node.contentDocument) clearMarks(node.contentDocument);
        } catch {
          /* ignore */
        }
      }
    }
  }

  function markTarget(el) {
    const target = closestEditor(el) || unwrap(el);
    if (!target?.setAttribute) return;
    try {
      clearMarks(document);
      target.setAttribute(MARK, "1");
    } catch {
      /* ignore */
    }
  }

  function captureCaret(el) {
    const snap = { el, at: Date.now() };
    try {
      if (typeof el.selectionStart === "number" && !isOffscreenField(el)) {
        snap.start = el.selectionStart;
        snap.end = el.selectionEnd;
      }
    } catch {
      /* ignore */
    }
    try {
      const sel = (el.ownerDocument || document).getSelection?.();
      if (sel?.rangeCount && sel.anchorNode) snap.range = sel.getRangeAt(0).cloneRange();
    } catch {
      /* ignore */
    }
    try {
      const aceHost = el.classList?.contains("ace_editor") ? el : el.closest?.(".ace_editor");
      const editor = aceHost?.env?.editor;
      if (editor?.getCursorPosition) {
        snap.aceHost = aceHost;
        snap.ace = { ...editor.getCursorPosition() };
      }
    } catch {
      /* ignore */
    }
    try {
      const cmHost = el.classList?.contains("CodeMirror") ? el : el.closest?.(".CodeMirror");
      if (cmHost?.CodeMirror?.getCursor) {
        snap.cmHost = cmHost;
        snap.cm = { ...cmHost.CodeMirror.getCursor() };
      }
    } catch {
      /* ignore */
    }
    try {
      const editors = window.monaco?.editor?.getEditors?.() || [];
      const ed = editors.find((e) => e.hasTextFocus?.());
      if (ed?.getPosition) {
        snap.monacoEd = ed;
        snap.monaco = { ...ed.getPosition() };
      }
    } catch {
      /* ignore */
    }
    return snap;
  }

  function restoreCaret(snap) {
    if (!snap) return;
    try {
      if (snap.aceHost?.isConnected && snap.ace) {
        const editor = snap.aceHost.env?.editor;
        editor?.moveCursorToPosition?.(snap.ace);
        editor?.clearSelection?.();
        editor?.focus?.();
        return;
      }
    } catch {
      /* ignore */
    }
    try {
      if (snap.cmHost?.isConnected && snap.cm) {
        snap.cmHost.CodeMirror?.setCursor?.(snap.cm);
        snap.cmHost.CodeMirror?.focus?.();
        return;
      }
    } catch {
      /* ignore */
    }
    try {
      if (snap.monacoEd && snap.monaco) {
        snap.monacoEd.setPosition?.(snap.monaco);
        snap.monacoEd.focus?.();
        return;
      }
    } catch {
      /* ignore */
    }
    try {
      if (snap.el?.isConnected && typeof snap.start === "number") {
        snap.el.focus();
        snap.el.selectionStart = snap.start;
        snap.el.selectionEnd = snap.end ?? snap.start;
        return;
      }
    } catch {
      /* ignore */
    }
    try {
      if (snap.range && snap.el?.isConnected) {
        snap.el.focus?.();
        const sel = (snap.el.ownerDocument || document).getSelection?.();
        sel?.removeAllRanges?.();
        sel?.addRange?.(snap.range);
      }
    } catch {
      /* ignore */
    }
  }

  function nativeSetValue(el, value) {
    const proto =
      el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
    if (setter) setter.call(el, value);
    else el.value = value;
  }

  function insertInField(el, text, caret) {
    try {
      el.focus();
    } catch {
      /* ignore */
    }
    const start = typeof caret?.start === "number" ? caret.start : el.selectionStart;
    const end = typeof caret?.end === "number" ? caret.end : el.selectionEnd;
    const value = String(el.value ?? "");
    const from = typeof start === "number" ? start : value.length;
    const to = typeof end === "number" ? end : value.length;
    const next = value.slice(0, from) + text + value.slice(to);
    nativeSetValue(el, next);
    try {
      const pos = from + text.length;
      el.selectionStart = el.selectionEnd = pos;
    } catch {
      /* ignore */
    }
    el.dispatchEvent(new InputEvent("input", { bubbles: true, cancelable: true, inputType: "insertText", data: text }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  }

  function insertSig(text) {
    return `${text.length}:${text.slice(0, 80)}`;
  }

  function alreadyInserted(text) {
    try {
      const root = (window.top || window).document.documentElement;
      const prev = root.getAttribute("data-pyai-insert");
      if (!prev) return false;
      const bar = prev.indexOf("|");
      const at = Number(prev.slice(0, bar));
      const old = prev.slice(bar + 1);
      return old === insertSig(text) && Date.now() - at < 4000;
    } catch {
      return false;
    }
  }

  function markInserted(text, via) {
    try {
      (window.top || window).document.documentElement.setAttribute(
        "data-pyai-insert",
        `${Date.now()}|${insertSig(text)}`,
      );
    } catch {
      /* ignore */
    }
    return { ok: true, via };
  }

  function inOutputPane(el) {
    if (!el?.closest) return false;
    return Boolean(
      el.closest(
        "#output, #result, #console, .output, .output-window, .console, .terminal, .result, [data-output], pre",
      ),
    );
  }

  function asAceHost(el) {
    if (!el) return null;
    if (el.classList?.contains("ace_editor")) return el;
    return el.closest?.(".ace_editor") || null;
  }

  function pickAceHost() {
    const marked = findMarked(document);
    const snapEl = globalThis.__pyaiCaret?.el;
    const candidates = [
      globalThis.__pyaiCaret?.aceHost,
      asAceHost(marked),
      asAceHost(snapEl),
      document.activeElement?.closest?.(".ace_editor"),
      document.querySelector(".ace_editor.ace_focus"),
      document.querySelector("#editor .ace_editor, .editor .ace_editor, #code .ace_editor, .code-editor .ace_editor"),
      ...document.querySelectorAll(".ace_editor"),
    ].filter(Boolean);
    return candidates.find((el) => el.isConnected !== false && !inOutputPane(el)) || null;
  }

  function insertCodeEditors(text) {
    const marked = findMarked(document);
    try {
      const ace = window.ace;
      const aceHost = pickAceHost();
      if (aceHost) {
        const editor = aceHost.env?.editor || (ace?.edit ? ace.edit(aceHost) : null);
        if (editor) {
          const pos = globalThis.__pyaiCaret?.ace;
          if (pos) {
            editor.moveCursorToPosition?.(pos);
            editor.clearSelection?.();
          }
          editor.focus();
          if (typeof editor.insert === "function") {
            editor.insert(text);
            return true;
          }
          if (editor.session && typeof editor.getCursorPosition === "function") {
            editor.session.insert(pos || editor.getCursorPosition(), text);
            return true;
          }
        }
      }
    } catch {
      /* ignore */
    }

    try {
      const cmHost =
        document.activeElement?.closest?.(".CodeMirror") ||
        marked?.closest?.(".CodeMirror") ||
        document.querySelector(".CodeMirror-focused");
      const cm = cmHost?.CodeMirror;
      if (cm && typeof cm.replaceSelection === "function") {
        cm.focus();
        cm.replaceSelection(text, "around");
        return true;
      }
    } catch {
      /* ignore */
    }

    try {
      const monaco = window.monaco;
      const editors = monaco?.editor?.getEditors?.() || [];
      const ed = editors.find((e) => e.hasTextFocus?.());
      if (ed && typeof ed.trigger === "function") {
        ed.focus();
        ed.trigger("keyboard", "type", { text });
        return true;
      }
    } catch {
      /* ignore */
    }

    return false;
  }

  function fireTextInput(doc, el, text) {
    try {
      el.focus();
    } catch {
      /* ignore */
    }
    try {
      const ev = new Event("textInput", { bubbles: true, cancelable: true });
      Object.defineProperty(ev, "data", { configurable: true, value: text });
      el.dispatchEvent(ev);
    } catch {
      /* ignore */
    }
    try {
      if (doc.execCommand("insertText", false, text)) return true;
    } catch {
      /* ignore */
    }
    return false;
  }

  function fireInsert(doc, el, text) {
    try {
      el.focus();
    } catch {
      /* ignore */
    }
    try {
      if (doc.execCommand("insertText", false, text)) return true;
    } catch {
      /* ignore */
    }
    return fireTextInput(doc, el, text);
  }

  function isDocsEventIframe() {
    try {
      const cls = window.frameElement?.className?.toString?.() || "";
      return cls.includes("docs-texteventtarget") || cls.includes("docs-offscreen-textarea");
    } catch {
      return false;
    }
  }

  function isGoogleDocsPage() {
    if (isDocsEventIframe()) return true;
    if (window !== window.top) return false;
    return Boolean(
      document.querySelector("iframe.docs-texteventtarget-iframe") ||
        document.querySelector("iframe.docs-offscreen-textarea-iframe") ||
        document.querySelector(".kix-appview-editor"),
    );
  }

  /** Docs ignores a fake Event("textInput"). One real command only (avoids 2–3× paste). */
  function insertDocsText(doc, win, el, text) {
    try {
      win?.focus?.();
    } catch {
      /* ignore */
    }
    try {
      el.focus();
    } catch {
      /* ignore */
    }
    try {
      if (doc.execCommand("insertText", false, text)) return true;
    } catch {
      /* ignore */
    }
    try {
      if (doc.execCommand("paste")) return true;
    } catch {
      /* ignore */
    }
    return false;
  }

  function insertDocs(text) {
    // One insert only: the top frame talks to the event iframe. The iframe
    // itself must not also insert (allFrames would paste 2×).
    if (isDocsEventIframe() || window !== window.top) return false;
    const iframe =
      document.querySelector("iframe.docs-texteventtarget-iframe") ||
      document.querySelector("iframe.docs-offscreen-textarea-iframe");
    if (!iframe?.contentDocument) return false;
    try {
      document.querySelector(".kix-appview-editor")?.click();
      iframe.contentWindow?.focus();
    } catch {
      /* ignore */
    }
    const doc = iframe.contentDocument;
    const el = doc.querySelector("[contenteditable=true]") || doc.body;
    return Boolean(el && insertDocsText(doc, iframe.contentWindow, el, text));
  }

  function pickTarget() {
    const snapEl = globalThis.__pyaiCaret?.el;
    if (snapEl?.isConnected && !isOffscreenField(snapEl) && !inOutputPane(snapEl)) {
      return closestEditor(snapEl) || snapEl;
    }
    const marked = findMarked(document);
    if (marked && !isOffscreenField(marked) && !inOutputPane(marked)) return closestEditor(marked) || marked;
    const active = closestEditor(deepActive(document));
    if (active && !isOffscreenField(active) && !inOutputPane(active)) return active;
    return null;
  }

  function insertText(text) {
    if (!text) return { ok: false };
    if (alreadyInserted(text)) return { ok: true, via: "dedupe" };
    restoreCaret(globalThis.__pyaiCaret);
    if (insertDocs(text)) {
      globalThis.__pyaiCaretLocked = false;
      return markInserted(text, "docs");
    }
    if (isGoogleDocsPage() || isDocsEventIframe()) {
      globalThis.__pyaiCaretLocked = false;
      return { ok: false };
    }
    if (insertCodeEditors(text)) {
      globalThis.__pyaiCaretLocked = false;
      return markInserted(text, "code");
    }

    const el = pickTarget();
    if (!el || isOffscreenField(el)) {
      globalThis.__pyaiCaretLocked = false;
      return { ok: false };
    }

    if (isTypableInput(el)) {
      insertInField(el, text, globalThis.__pyaiCaret);
      globalThis.__pyaiCaretLocked = false;
      return markInserted(text, "field");
    }

    const doc = el.ownerDocument || document;
    if (fireInsert(doc, el, text)) {
      globalThis.__pyaiCaretLocked = false;
      return markInserted(text, "editor");
    }
    globalThis.__pyaiCaretLocked = false;
    return { ok: false };
  }

  function describeField(el, snap) {
    const frame = window.frameElement;
    const frameClass = frame?.className?.toString?.() || "";
    if (frameClass.includes("docs-texteventtarget") || frameClass.includes("docs-offscreen-textarea")) return "docs";
    if (snap?.ace || el?.classList?.contains("ace_editor") || el?.closest?.(".ace_editor")) return "ace";
    if (snap?.monaco || el?.classList?.contains("monaco-editor") || el?.closest?.(".monaco-editor")) return "monaco";
    if (snap?.cm || el?.classList?.contains("CodeMirror") || el?.closest?.(".CodeMirror")) return "codemirror";
    const tag = (el?.tagName || "").toLowerCase();
    if (tag === "textarea") return "textarea";
    if (tag === "input") return "input";
    if (el?.isContentEditable) return "contenteditable";
    return "unknown";
  }

  function caretMeta() {
    const snap = globalThis.__pyaiCaret;
    const el = snap?.el;
    return {
      field: describeField(el, snap),
      locked: Boolean(globalThis.__pyaiCaretLocked),
    };
  }

  function rememberFocus(force) {
    if (globalThis.__pyaiCaretLocked && !force) return;
    const el = closestEditor(deepActive(document));
    if (!el) return;
    markTarget(el);
    globalThis.__pyaiCaret = captureCaret(el);
  }

  function lockCaret() {
    rememberFocus(true);
    globalThis.__pyaiCaretLocked = true;
    return caretMeta();
  }

  globalThis.__pyaiInsertText = insertText;
  globalThis.__pyaiRememberFocus = rememberFocus;
  globalThis.__pyaiLockCaret = lockCaret;
  globalThis.__pyaiCaretMeta = caretMeta;
  globalThis.__pyaiMarkTarget = markTarget;

  if (!globalThis.__pyaiInsertFocusHook) {
    globalThis.__pyaiInsertFocusHook = true;
    document.addEventListener("focusin", rememberFocus, true);
  }
})();
