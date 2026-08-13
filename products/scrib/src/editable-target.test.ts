import { describe, it, expect } from "vitest";
import {
  detectKind,
  resolveTarget,
  InsertionReconciler,
  type EditableTarget,
  type EditableKind,
} from "./editable-target.js";

/** Minimal fake of a textarea/input supporting setRangeText + selection. */
function fakeField(kind: "textarea" | "input", initial = ""): EditableTarget & { _value: string } {
  const field = {
    value: initial,
    selectionStart: initial.length,
    selectionEnd: initial.length,
    setRangeText(text: string, start: number, end: number, _mode?: string) {
      this.value = this.value.slice(0, start) + text + this.value.slice(end);
      this.selectionStart = start + text.length;
      this.selectionEnd = start + text.length;
    },
    dispatchEvent: () => true,
    isComposing: () => false,
    getCaret: () => ({ start: field.selectionStart, end: field.selectionEnd }),
    insert: (t: string) => {
      const s = field.selectionStart;
      const e = field.selectionEnd;
      field.setRangeText(t, s, e, "end");
    },
    replaceRange: (from: number, to: number, t: string) => {
      field.setRangeText(t, from, to, "end");
    },
    getValue: () => field.value,
    kind,
    label: kind,
  };
  return field as unknown as EditableTarget & { _value: string };
}

describe("detectKind (no site coupling — generic only)", () => {
  it("recognizes textarea/input/contenteditable, ignores everything else", () => {
    expect(detectKind(makeEl("TEXTAREA"))).toBe("textarea");
    expect(detectKind(makeEl("INPUT", "text"))).toBe("input");
    expect(detectKind(makeEl("INPUT", "checkbox"))).toBe("unknown");
    expect(detectKind(makeEl("DIV", undefined, "true"))).toBe("contenteditable");
    expect(detectKind(makeEl("DIV"))).toBe("unknown");
    expect(detectKind(null)).toBe("unknown");
  });
});

describe("resolveTarget", () => {
  it("returns null for non-editable and a target for editable", () => {
    expect(resolveTarget(makeEl("DIV"))).toBeNull();
    const t = resolveTarget(makeEl("TEXTAREA"));
    expect(t?.kind).toBe("textarea");
  });
});

describe("InsertionReconciler (streaming-safe, no double insertion)", () => {
  it("replaces the partial span instead of appending", () => {
    const f = fakeField("textarea", "Hello ");
    const target = resolveTargetFromField(f);
    const r = new InsertionReconciler(target);
    r.insertPartial("wor");
    r.insertPartial("world");
    expect(target.getValue()).toBe("Hello world");
    r.finalize("world!");
    expect(target.getValue()).toBe("Hello world!");
  });

  it("inserts final text when no partial was shown", () => {
    const f = fakeField("textarea", "Say ");
    const target = resolveTargetFromField(f);
    const r = new InsertionReconciler(target);
    r.finalize("hi there");
    expect(target.getValue()).toBe("Say hi there");
  });

  it("never double-counts when partial+final overlap", () => {
    const f = fakeField("input", "");
    const target = resolveTargetFromField(f);
    const r = new InsertionReconciler(target);
    r.insertPartial("meet");
    r.insertPartial("meeting");
    r.finalize("meeting now");
    expect(target.getValue()).toBe("meeting now");
  });
});

// -- tiny test helpers ------------------------------------------------------

function makeEl(tag: string, type?: string, contenteditable?: string): Element {
  const attrs: Record<string, string> = {};
  if (type) attrs.type = type;
  if (contenteditable) attrs.contenteditable = contenteditable;
  return {
    tagName: tag.toUpperCase(),
    id: "",
    className: "",
    type,
    getAttribute: (k: string) => attrs[k] ?? null,
  } as unknown as Element;
}

/** Wrap a fakeField into the shape a real document.activeElement would give. */
function resolveTargetFromField(f: EditableTarget & { _value: string }): EditableTarget {
  // resolveTarget uses document.activeElement in browser; in tests we construct directly.
  return f as unknown as EditableTarget;
}

void (null as unknown as EditableKind);
