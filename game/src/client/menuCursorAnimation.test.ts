import { readFileSync } from "node:fs";
import { setMaxListeners } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { SheetMeta } from "../assets/types.ts";
import { CursorAnim } from "./screenKit.ts";
import { SettingsStore } from "./settings.ts";
import { newSlide } from "./startLayout.ts";
import { StartScreen, type StartScreenOptions } from "./startScreen.ts";
import { newStatusState } from "./statusScreen.ts";

vi.mock("./text.ts", async (original) => ({
  ...await original<typeof import("./text.ts")>(),
  outlinedText() {}, plainText() {}, fitText: (_ctx: unknown, text: string) => text,
}));

class Element extends EventTarget {
  readonly attributes = new Map<string, string>();
  readonly children: Element[] = [];
  readonly style = {};
  readonly tagName: string;
  value = "";
  selectionStart = 0;
  constructor(tag = "div") { super(); this.tagName = tag.toUpperCase(); }
  setAttribute(name: string, value: string) { this.attributes.set(name, value); }
  append(element: Element) { this.children.push(element); }
  contains(element: Element) { return this.children.includes(element); }
  setSelectionRange(start: number) { this.selectionStart = start; }
  focus() { dom.activeElement = this; }
  blur() { if (dom.activeElement === this) dom.activeElement = dom.body; }
  remove() { this.blur(); }
}
class Input extends Element { constructor() { super("input"); } }
class Canvas extends Element {
  width = 800;
  height = 600;
  calls: { source: unknown; args: number[] }[] = [];
  readonly ctx = {
    canvas: this,
    drawImage: (source: unknown, ...args: number[]) => this.calls.push({ source, args }),
    save() {}, restore() {}, fillRect() {},
    measureText: (text: string) => ({ width: text.length * 8 }),
  };
  constructor() { super("canvas"); }
  getContext() { return this.ctx; }
  getBoundingClientRect() { return { left: 0, top: 0, width: 800, height: 600 }; }
}
const cursorMeta = JSON.parse(readFileSync(new URL("../../public/assets/image/cursor.json", import.meta.url), "utf8")) as SheetMeta;
const bannerMeta = JSON.parse(readFileSync(new URL("../../public/assets/spr/misc/banner1.json", import.meta.url), "utf8")) as SheetMeta;
const cursorImage = {};
const dom = {
  body: new Element("body"), activeElement: null as Element | null,
  createElement: (tag: string): Element => {
    if (tag === "canvas") { const canvas = new Canvas(); surfaces.push(canvas); return canvas; }
    return tag === "input" ? new Input() : new Element(tag);
  },
  hasFocus: () => true,
};
let now: number;
let frames: Map<number, FrameRequestCallback>;
let surfaces: Canvas[];
let screen: StartScreen | undefined;

beforeEach(() => {
  now = 0; frames = new Map(); surfaces = [];
  dom.activeElement = dom.body;
  const testWindow = new EventTarget();
  setMaxListeners(30, testWindow);
  vi.stubGlobal("window", testWindow);
  vi.stubGlobal("document", dom);
  vi.stubGlobal("HTMLElement", Element);
  vi.stubGlobal("HTMLInputElement", Input);
  let serial = 0;
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { frames.set(++serial, callback); return serial; });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
  vi.spyOn(performance, "now").mockImplementation(() => now);
});
afterEach(() => { screen?.dispose(); screen = undefined; vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function start(origin: number, begin: "login" | "status" = "login", cursor?: CursorAnim): { surface: Canvas; stage: Element; canvas: Canvas } {
  now = origin;
  const canvas = new Canvas(), stage = new Element();
  const before = surfaces.length;
  const image = {};
  screen = new StartScreen({
    canvas, stage, begin, cursor, savedId: "",
    assets: {
      login: image, button: image, button2: image, messageBox: image, help: image,
      cursor: { image: cursorImage, meta: cursorMeta },
      status: {
        background: image, option: image, images: image, ranking: image, faces: image,
        guildIcons: image, marks: image, banner: { image, meta: bannerMeta }, guilds: [],
      },
    },
    status: newStatusState("rookie"), settings: new SettingsStore({ get: () => null, set() {} }),
    list: { slide: newSlide(), rows: [], selected: -1 },
    sounds: { play() {}, unlock() {} }, account: () => null, authConnect() {}, login: () => "sent",
    ranking: { rows: [], windowPage: 1, page: async () => false, search: async () => false },
  } as unknown as StartScreenOptions);
  canvas.dispatchEvent(Object.assign(new Event("pointermove"), {
    isPrimary: true, pointerType: "mouse", pointerId: 1, button: -1, buttons: 0, clientX: 300, clientY: 250,
  }));
  return { surface: surfaces[before], stage, canvas };
}

function move(canvas: Canvas, x: number, y: number): void {
  canvas.dispatchEvent(Object.assign(new Event("pointermove"), {
    isPrimary: true, pointerType: "mouse", pointerId: 1, button: -1, buttons: 0, clientX: x, clientY: y,
  }));
}

function key(code: "F1" | "Escape"): void {
  window.dispatchEvent(Object.assign(new Event("keydown", { cancelable: true }), {
    key: code, code, keyCode: code === "F1" ? 112 : 27,
  }));
}

function draw(at: number, surface: Canvas): { anim: number; frame: number }[] {
  now = at; surface.calls = [];
  const callbacks = [...frames.values()]; frames.clear();
  for (const callback of callbacks) callback(at);
  return surface.calls.filter((call) => call.source === cursorImage).map((call) => {
    for (const [anim, animation] of cursorMeta.animations.entries()) {
      const frame = animation.frames.findIndex((frame) => frame.rect[0] === call.args[0] && frame.rect[1] === call.args[1]);
      if (frame >= 0) return { anim, frame };
    }
    throw new Error("unknown cursor crop");
  });
}

function submitLogin(stage: Element): void {
  for (const [label, text] of [["아이디", "P1"], ["비밀번호", "pw"]]) {
    const input = stage.children.find((element) => element.attributes.get("aria-label") === label)!;
    input.value = text;
    input.setSelectionRange(text.length);
    input.dispatchEvent(new Event("input"));
  }
  for (let press = 0; press < 2; press++) {
    window.dispatchEvent(Object.assign(new Event("keydown", { cancelable: true }), {
      key: "Enter", code: "Enter", keyCode: 13,
    }));
  }
}

describe("cursor settings between menu frames", () => {
  it.each([0, 1.25, 1000, 1_000_000_000])("keeps a fast login answer's frame reset, origin %s", (origin) => {
    const { surface, stage } = start(origin);
    expect(draw(origin, surface)).toEqual([{ anim: 0, frame: 1 }]);
    expect(draw(origin + 7000 / 30, surface)).toEqual([{ anim: 0, frame: 2 }]);
    now = origin + 240;
    submitLogin(stage);
    now = origin + 241;
    screen!.loginFailed();
    expect(draw(origin + 8000 / 30, surface)).toEqual([{ anim: 0, frame: 0 }, { anim: 0, frame: 0 }]);
    // A setting keeps +0x154: the next advance is still due from the 233 ms draw.
    expect(draw(origin + 14000 / 30, surface)).toEqual([{ anim: 0, frame: 1 }, { anim: 0, frame: 1 }]);
  });

  it.each([0, 1.25, 1000, 1_000_000_000])("resets an answer even when the cursor is already normal, origin %s", (origin) => {
    const { surface } = start(origin);
    expect(draw(origin, surface)).toEqual([{ anim: 0, frame: 1 }]);
    now = origin + 1;
    screen!.loginFailed();
    expect(draw(origin + 1000 / 30, surface)).toEqual([{ anim: 0, frame: 0 }, { anim: 0, frame: 0 }]);
  });

  it("sets the session cursor as soon as a real login is sent, while the pointer is outside", () => {
    const cursor = new CursorAnim();
    const { surface, stage, canvas } = start(0, "login", cursor);
    draw(0, surface);
    canvas.dispatchEvent(Object.assign(new Event("pointerleave"), { isPrimary: true, pointerId: 1 }));
    now = 1;
    submitLogin(stage);
    expect(cursor.busy).toBe(true);
    expect(draw(1000 / 30, surface)).toEqual([]);
    now = 34;
    screen!.loginFailed();
    expect(cursor.busy).toBe(false);
    move(canvas, 300, 250);
    expect(draw(2000 / 30, surface)).toEqual([{ anim: 0, frame: 0 }, { anim: 0, frame: 0 }]);
  });

  it("restarts a repeated busy setting without restarting its timer", () => {
    const { surface } = start(0);
    screen!.connecting();
    expect(draw(0, surface)).toEqual([{ anim: 1, frame: 1 }]);
    expect(draw(7000 / 30, surface)).toEqual([{ anim: 1, frame: 2 }]);
    now = 240;
    screen!.connecting();
    expect(draw(8000 / 30, surface)).toEqual([{ anim: 1, frame: 0 }]);
    expect(draw(14000 / 30, surface)).toEqual([{ anim: 1, frame: 1 }]);
  });
});

function trace(hz: number, origin: number, busy = false): { anim: number; frame: number }[][] {
  const { surface, stage } = start(origin);
  const rows: { anim: number; frame: number }[][] = [];
  for (let i = 0; i <= hz; i++) {
    // The actual login fields and Enter request switch to wait after the entry fade.
    if (busy && i === hz / 2) {
      for (const [label, text] of [["아이디", "P1"], ["비밀번호", "pw"]]) {
        const input = stage.children.find((element) => element.attributes.get("aria-label") === label)!;
        input.value = text; input.setSelectionRange(text.length); input.dispatchEvent(new Event("input"));
      }
      // Enter on ID first moves to password; the second Enter submits.
      for (let press = 0; press < 2; press++) {
        window.dispatchEvent(Object.assign(new Event("keydown", { cancelable: true }), { key: "Enter", code: "Enter", keyCode: 13 }));
      }
    }
    rows.push(draw(origin + i * 1000 / hz, surface));
  }
  screen!.dispose(); screen = undefined;
  expect(frames.size).toBe(0);
  return rows;
}

describe("the menu cursor at the scene's 30 fps clock", () => {
  it.each([0, 1.25, 1000, 1_000_000_000].flatMap((origin) => [60, 120, 144].map((hz) => ({ origin, hz }))))(
    "keeps the login cursor on the same frame at $hz Hz, origin $origin", ({ origin, hz }) => {
      const reference = trace(30, origin);
      const actual = trace(hz, origin);
      for (let i = 0; i < actual.length; i++) expect(actual[i], `draw ${i}`).toEqual(reference[Math.floor(i * 30 / hz + 1e-6)]);
      expect(reference[6]).toEqual([{ anim: 0, frame: 1 }]);
      expect(reference[7]).toEqual([{ anim: 0, frame: 2 }]);
    },
  );

  it.each([0, 1.25, 1000, 1_000_000_000])("does not advance on an extra draw at 201 ms, origin %s", (origin) => {
    const { surface } = start(origin);
    expect(draw(origin, surface)).toEqual([{ anim: 0, frame: 1 }]);
    expect(draw(origin + 201, surface)).toEqual([{ anim: 0, frame: 1 }]);
    expect(draw(origin + 7000 / 30, surface)).toEqual([{ anim: 0, frame: 2 }]);
  });

  it("draws the same frame on both sides of a message box", () => {
    const { surface } = start(1000);
    screen!.showMessage("검사");
    expect(draw(1000, surface)).toEqual([{ anim: 0, frame: 1 }, { anim: 0, frame: 1 }]);
    expect(draw(1201, surface)).toEqual([{ anim: 0, frame: 1 }, { anim: 0, frame: 1 }]);
    expect(draw(1000 + 7000 / 30, surface)).toEqual([{ anim: 0, frame: 2 }, { anim: 0, frame: 2 }]);
  });

  it("keeps the real login wait cursor on the same clock", () => {
    const reference = trace(30, 1000, true);
    const actual = trace(60, 1000, true);
    expect(actual[30][0].anim).toBe(1);
    for (let i = 0; i < actual.length; i++) expect(actual[i], `draw ${i}`).toEqual(reference[Math.floor(i / 2)]);
  });
});

describe("CursorAnim's native integer clock", () => {
  it.each([0, 1000, 1_000_000_000])("keeps a fractional draw below the strict 201 ms boundary, origin %s", (origin) => {
    const cursor = new CursorAnim();
    expect(cursor.advance(origin, cursorMeta)).toEqual({ anim: 0, frame: 1 });
    expect(cursor.advance(origin + 200.9, cursorMeta)).toEqual({ anim: 0, frame: 1 });
    expect(cursor.advance(origin + 201, cursorMeta)).toEqual({ anim: 0, frame: 2 });
  });
});

describe("the status cursor while help replaces the scene draw", () => {
  it.each([0, 1000])("keeps the hand and its animation after F1, origin %s", (origin) => {
    const { surface, canvas } = start(origin, "status");
    move(canvas, 600, 350);
    expect(draw(origin, surface)).toEqual([{ anim: 2, frame: 1 }]);
    key("F1");
    expect(draw(origin + 1000 / 30, surface)).toEqual([{ anim: 2, frame: 1 }]);
    expect(draw(origin + 7000 / 30, surface)).toEqual([{ anim: 2, frame: 0 }]);
  });

  it.each(["F1", "Escape"] as const)("defers moving off the banner until help closes with %s", (code) => {
    const { surface, canvas } = start(0, "status");
    move(canvas, 600, 350);
    expect(draw(0, surface)).toEqual([{ anim: 2, frame: 1 }]);
    key("F1");
    move(canvas, 300, 250);
    expect(draw(1000 / 30, surface)).toEqual([{ anim: 2, frame: 1 }]);
    key(code);
    expect(draw(2000 / 30, surface)).toEqual([{ anim: 0, frame: 0 }]);
  });

  it("keeps the hand on both cursor draws around a message in help", () => {
    const { surface, canvas } = start(0, "status");
    move(canvas, 600, 350);
    expect(draw(0, surface)).toEqual([{ anim: 2, frame: 1 }]);
    key("F1");
    screen!.showMessage("검사");
    expect(draw(1000 / 30, surface)).toEqual([{ anim: 2, frame: 1 }, { anim: 2, frame: 1 }]);
  });

  it("does not enter the hand when moving onto the banner during help", () => {
    const { surface, canvas } = start(0, "status");
    expect(draw(0, surface)).toEqual([{ anim: 0, frame: 1 }]);
    key("F1");
    move(canvas, 600, 350);
    expect(draw(1000 / 30, surface)).toEqual([{ anim: 0, frame: 1 }]);
    key("F1");
    expect(draw(2000 / 30, surface)).toEqual([{ anim: 2, frame: 0 }]);
  });

  it("does not read the banner before the first status draw", () => {
    const { surface, canvas } = start(0, "status");
    move(canvas, 600, 350);
    key("F1");
    expect(draw(0, surface)).toEqual([{ anim: 0, frame: 1 }]);
    key("F1");
    expect(draw(1000 / 30, surface)).toEqual([{ anim: 2, frame: 0 }]);
  });
});
