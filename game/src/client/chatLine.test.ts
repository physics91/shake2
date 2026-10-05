import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ChatLine } from "./chatLine.ts";

class Input extends EventTarget {
  tagName = "INPUT";
  value = "";
  selectionStart = 0;
  style = {};
  setAttribute() {}
  setSelectionRange(start: number, _end: number) { this.selectionStart = start; }
  focus() { dom.activeElement = this; }
  blur() { dom.activeElement = null; }
  remove() {}
}

const dom = {
  activeElement: null as { tagName: string } | null,
  hasFocus: () => true,
  createElement: () => new Input(),
};

let line: ChatLine;
let stage: EventTarget;
const frames: FrameRequestCallback[] = [];

beforeEach(() => {
  frames.length = 0;
  vi.stubGlobal("document", dom);
  vi.stubGlobal("window", new EventTarget());
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => frames.push(callback));
  stage = Object.assign(new EventTarget(), { append() {} });
  line = new ChatLine(stage as unknown as HTMLElement);
  line.open();
});

describe("restoring an open game's editor focus", () => {
  function restore(from: "blur" | "focus") {
    if (from === "blur") {
      line.element.dispatchEvent(new Event("blur"));
      expect(frames).toHaveLength(1);
      frames.shift()!(0);
    } else window.dispatchEvent(new Event("focus"));
  }

  it.each(["blur", "focus"] as const)("leaves the assistive button focused after %s", (from) => {
    const button = { tagName: "BUTTON" };
    dom.activeElement = button;
    restore(from);
    expect(dom.activeElement).toBe(button);
  });

  it.each(["blur", "focus"] as const)("returns canvas focus to the open editor after %s", (from) => {
    dom.activeElement = { tagName: "BODY" };
    restore(from);
    expect(dom.activeElement).toBe(line.element);
  });

  it("focuses the editor when an explicit game action opens it from a button", () => {
    line.close();
    dom.activeElement = { tagName: "BUTTON" };
    line.open();
    expect(dom.activeElement).toBe(line.element);
  });

  it("restores the editor after a button's focus is released by a canvas click", () => {
    dom.activeElement = { tagName: "BUTTON" };
    restore("blur");
    dom.activeElement = { tagName: "BODY" };
    stage.dispatchEvent(new Event("pointerup"));
    expect(dom.activeElement).toBe(line.element);
  });
});

afterEach(() => {
  line.dispose();
  vi.unstubAllGlobals();
});

function input(value: string, composing = false, caret = value.length) {
  line.element.value = value;
  line.element.setSelectionRange(caret, caret);
  const event = new Event("input");
  Object.assign(event, { isComposing: composing });
  line.element.dispatchEvent(event);
}

function composeInMiddle() {
  line.text = "XY";
  line.element.setSelectionRange(1, 1);
  line.element.dispatchEvent(new Event("compositionstart"));
  const update = new Event("compositionupdate");
  Object.assign(update, { data: "한" });
  line.element.dispatchEvent(update);
  input("X한Y", true);
  expect(line.view()).toEqual({ text: "X한Y", caret: 1 });
}

describe("replacing a chat editor's text during IME composition", () => {
  it("shows the recalled line and its end caret without the previous composing syllable", () => {
    composeInMiddle();
    // Chromium cancels its composition on a value assignment without compositionend.
    line.text = "abcde";
    expect(line.view()).toEqual({ text: "abcde", caret: 5 });
  });

  it("accepts and sends the characters typed after recall without needing compositionend", () => {
    composeInMiddle();
    line.text = "abcde";
    input("abcdez");
    expect(line.close()).toBe("abcdez");
  });

  it("clears a composing syllable when the replacement is empty, then allows a new composition", () => {
    composeInMiddle();
    line.text = "";
    expect(line.view()).toEqual({ text: "", caret: 0 });
    line.element.dispatchEvent(new Event("compositionstart"));
    const update = new Event("compositionupdate");
    Object.assign(update, { data: "글" });
    line.element.dispatchEvent(update);
    input("글", true);
    expect(line.view()).toEqual({ text: "글", caret: 0 });
    line.element.dispatchEvent(new Event("compositionend"));
    expect(line.close()).toBe("글");
  });
});

describe("rejecting an insert after the caret moves between rendered frames", () => {
  it("leaves the caret where typing began when a plain insert exceeds the byte limit", () => {
    const full = "a".repeat(36);
    line.text = full;
    // Arrow keys move the browser caret without an input event or a canvas frame.
    line.element.setSelectionRange(35, 35);
    line.element.dispatchEvent(new Event("beforeinput"));
    input(`${full.slice(0, 35)}b${full.slice(35)}`, false, 36);
    expect(line.element.value).toBe(full);
    expect(line.element.selectionStart).toBe(35);
    expect(line.view()).toEqual({ text: full, caret: 35 });
  });

  it("leaves the caret at the start of a refused Hangul composition", () => {
    const full = "가".repeat(18);
    line.text = full;
    line.element.setSelectionRange(17, 17);
    line.element.dispatchEvent(new Event("compositionstart"));
    const update = new Event("compositionupdate");
    Object.assign(update, { data: "한" });
    line.element.dispatchEvent(update);
    line.element.dispatchEvent(new Event("beforeinput"));
    input(`${full.slice(0, 17)}한${full.slice(17)}`, true, 18);
    line.element.dispatchEvent(new Event("beforeinput"));
    line.element.dispatchEvent(new Event("compositionend"));
    expect(line.element.value).toBe(full);
    expect(line.element.selectionStart).toBe(17);
    expect(line.view()).toEqual({ text: full, caret: 34 });
  });
});

describe("copying the editor after a screen's message box", () => {
  it("keeps editing and validating the buffer while its displayed field is held", () => {
    line.text = "old";
    line.deferChanges(true);
    input("new");
    expect(line.element.value).toBe("new");
    expect(line.view()).toEqual({ text: "old", caret: 3 });
    input("x".repeat(37));
    expect(line.element.value).toBe("new");
    expect(line.view()).toEqual({ text: "old", caret: 3 });
    line.deferChanges(false);
    expect(line.view()).toEqual({ text: "old", caret: 3 });
    input("newz");
    expect(line.view()).toEqual({ text: "newz", caret: 4 });
  });

  it("copies the queued buffer on an ordinary key-down after the box, including its moved caret", () => {
    line.text = "a";
    line.deferChanges(true);
    input("abcdef");
    line.element.dispatchEvent(new Event("keyup"));
    expect(line.view()).toEqual({ text: "a", caret: 1 });
    line.deferChanges(false);
    line.element.setSelectionRange(5, 5);
    line.element.dispatchEvent(new Event("keyup"));
    expect(line.view()).toEqual({ text: "a", caret: 1 });
    line.element.dispatchEvent(new Event("keydown"));
    expect(line.view()).toEqual({ text: "abcdef", caret: 5 });
  });

  it("keeps a replacement field held when an asynchronous answer assigns its new text", () => {
    line.text = "old";
    line.deferChanges(true);
    input("queued");
    line.text = "saved";
    input("savedz");
    expect(line.view()).toEqual({ text: "saved", caret: 5 });
    line.deferChanges(false);
    line.element.dispatchEvent(new Event("keydown"));
    expect(line.view()).toEqual({ text: "savedz", caret: 6 });
  });

  it("keeps a reopened editor held until the box has gone", () => {
    line.text = "old";
    line.deferChanges(true);
    line.close();
    line.open();
    input("new");
    expect(line.view()).toEqual({ text: "", caret: 0 });
    line.deferChanges(false);
    line.element.dispatchEvent(new Event("keydown"));
    expect(line.view()).toEqual({ text: "new", caret: 3 });
  });

  it("copies a subsequent IME update after the box without requiring a new composition", () => {
    line.text = "XY";
    line.deferChanges(true);
    line.element.setSelectionRange(1, 1);
    line.element.dispatchEvent(new Event("compositionstart"));
    const first = new Event("compositionupdate");
    Object.assign(first, { data: "한" });
    line.element.dispatchEvent(first);
    input("X한Y", true);
    expect(line.view()).toEqual({ text: "XY", caret: 2 });
    line.deferChanges(false);
    const update = new Event("compositionupdate");
    Object.assign(update, { data: "글" });
    line.element.dispatchEvent(update);
    input("X글Y", true);
    expect(line.view()).toEqual({ text: "X글Y", caret: 1 });
  });
});
