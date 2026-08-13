/**
 * Generic editable-target abstraction for Scrib (spec #71, #37, #72).
 *
 * This module knows NOTHING about individual websites. It operates only on
 * generic editable surfaces discoverable through standard DOM/Selection APIs:
 *   - <textarea>, <input>
 *   - [contenteditable] elements (rich editors: Google Docs, Notion, Gmail, …)
 *   - any element exposing a live Selection/Range
 *
 * There are NO host/hostname branches, NO site-specific selectors, and NO
 * per-domain insertion hacks anywhere in this file. Cleanup style comes from
 * the focused field + tab context sent to the cleaner, never a host map.
 *
 * The extension background worker uses this to insert text; provider API keys
 * are NEVER touched here (see docs/security.md — secrets live in secure native
 * storage, the extension only talks to the local app/backend).
 */

export type EditableKind = "textarea" | "input" | "contenteditable" | "unknown";

export interface CaretPosition {
  start: number;
  end: number;
}

export interface EditableTarget {
  readonly kind: EditableKind;
  /** Human-readable tag of the focused element (id/class/role), not a hostname. */
  readonly label: string;
  /** Current selected range, in chars where applicable. */
  getCaret(): CaretPosition;
  /** Replace the current selection with `text`, moving the caret after it. */
  insert(text: string): void;
  /** Replace the text within [from,to) with `text`. */
  replaceRange(from: number, to: number, text: string): void;
  /** Read the full current text value. */
  getValue(): string;
  /** True if an IME composition is in progress (don't fight the user). */
  isComposing(): boolean;
}

const INPUT_LIKE = new Set(["text", "search", "url", "email", "tel", "password", "number", ""]);

/**
 * Detect the kind of an arbitrary element using only standard DOM introspection.
 * Duck-typed on `tagName`/`getAttribute` so it works under jsdom, test fakes,
 * and the real DOM without depending on the `Element` constructor.
 */
interface MinimalEl {
  tagName?: string;
  getAttribute?(name: string): string | null;
  type?: string;
}

export function detectKind(el: EventTarget | MinimalEl | null | undefined): EditableKind {
  if (!el || typeof (el as MinimalEl).tagName !== "string") return "unknown";
  const node = el as MinimalEl;
  const tag = node.tagName!.toUpperCase();
  if (tag === "TEXTAREA") return "textarea";
  if (tag === "INPUT") {
    const type = (node.type ?? "").toLowerCase();
    return INPUT_LIKE.has(type) ? "input" : "unknown";
  }
  if (node.getAttribute?.("contenteditable") === "true" || node.getAttribute?.("contenteditable") === "plaintext-only") {
    return "contenteditable";
  }
  return "unknown";
}

function labelFor(el: MinimalEl): string {
  const tag = (el.tagName ?? "el").toLowerCase();
  const id = (el as { id?: string }).id ? `#${(el as { id: string }).id}` : "";
  const cls = typeof (el as { className?: unknown }).className === "string" && (el as { className: string }).className
    ? `.${((el as { className: string }).className).trim().split(/\s+/).slice(0, 2).join(".")}`
    : "";
  const role = el.getAttribute?.("role") ? `[role=${el.getAttribute("role")}]` : "";
  return `${tag}${id}${cls}${role}` || tag;
}

/** Build a target from whatever element currently has focus (or any element). */
export function resolveTarget(el?: MinimalEl | null): EditableTarget | null {
  const node = el ?? (typeof document !== "undefined" ? (document.activeElement as unknown as MinimalEl | null) : null);
  const kind = detectKind(node);
  if (kind === "unknown" || !node) return null;
  return makeTarget(node, kind);
}

function makeTarget(el: MinimalEl, kind: EditableKind): EditableTarget {
  const label = labelFor(el);
  const isComposing = () => Boolean((el as { isComposing?: boolean }).isComposing);

  if (kind === "textarea" || kind === "input") {
    const field = el as HTMLTextAreaElement & HTMLInputElement;
    return {
      kind,
      label,
      isComposing,
      getCaret: () => ({ start: field.selectionStart ?? 0, end: field.selectionEnd ?? 0 }),
      insert: (text) => {
        const s = field.selectionStart ?? field.value.length;
        const e = field.selectionEnd ?? field.value.length;
        field.setRangeText(text, s, e, "end");
        field.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: text }));
      },
      replaceRange: (from, to, text) => {
        field.setRangeText(text, from, to, "end");
        field.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertReplacementText", data: text }));
      },
      getValue: () => field.value,
    };
  }

  // contenteditable / rich editor: use the Selection/Range API (no site-specific code).
  const ce = el as HTMLElement;
  return {
    kind: "contenteditable",
    label,
    isComposing,
    getCaret: () => {
      const sel = document.getSelection();
      if (!sel || sel.rangeCount === 0) return { start: 0, end: 0 };
      const range = sel.getRangeAt(0);
      const pre = range.cloneRange();
      pre.selectNodeContents(ce);
      pre.setEnd(range.endContainer, range.endOffset);
      const end = pre.toString().length;
      return { start: end - (range.toString().length), end };
    },
    insert: (text) => {
      const sel = document.getSelection();
      if (!sel || sel.rangeCount === 0) {
        ce.focus();
      }
      const range = sel && sel.rangeCount > 0 ? sel.getRangeAt(0) : null;
      if (range) {
        range.deleteContents();
        const node = document.createTextNode(text);
        range.insertNode(node);
        range.setStartAfter(node);
        range.collapse(true);
        sel?.removeAllRanges();
        sel?.addRange(range);
      } else {
        ce.appendChild(document.createTextNode(text));
      }
      ce.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: text }));
    },
    replaceRange: (from, to, text) => {
      // Collapse selection to [from,to) by selecting character offsets, then replace.
      const sel = document.getSelection();
      if (!sel) return;
      const full = ce.textContent ?? "";
      const before = full.slice(0, from);
      const after = full.slice(to);
      ce.textContent = before + text + after;
      const pos = (before + text).length;
      const range = document.createRange();
      range.setStart(ce.firstChild ?? ce, Math.min(pos, ce.childNodes.length));
      range.collapse(true);
      sel.removeAllRanges();
      sel.addRange(range);
      ce.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertReplacementText", data: text }));
    },
    getValue: () => ce.innerText ?? ce.textContent ?? "",
  };
}

/**
 * Streaming-safe insertion reconciler (spec #37 smart reconciliation).
 *
 * As partial transcripts arrive, we keep the last inserted text so we can:
 *   - revise a partial without duplicating it
 *   - replace a final transcript cleanly
 *   - handle deletions/corrections
 *
 * Calling `insertPartial` repeatedly only updates the *current* partial span;
 * `finalize` writes the cleaned final text once. We never append partials
 * blindly, so the user never sees doubled text.
 */
export class InsertionReconciler {
  private lastSpan: { from: number; to: number } | null = null;

  constructor(private target: EditableTarget) {}

  /** Replace the previously-inserted partial (if any) with the new partial. */
  insertPartial(text: string): void {
    if (this.target.isComposing()) return; // never fight an active IME
    const caret = this.target.getCaret();
    if (this.lastSpan) {
      this.target.replaceRange(this.lastSpan.from, this.lastSpan.to, text);
      this.lastSpan = { from: this.lastSpan.from, to: this.lastSpan.from + text.length };
    } else {
      const from = caret.start;
      this.target.insert(text);
      this.lastSpan = { from, to: from + text.length };
    }
  }

  /** Write the cleaned final text, replacing the whole partial span. */
  finalize(text: string): void {
    if (this.lastSpan) {
      this.target.replaceRange(this.lastSpan.from, this.lastSpan.to, text);
      this.lastSpan = null;
    } else {
      this.target.insert(text);
    }
  }

  reset(): void {
    this.lastSpan = null;
  }
}
