import { readFileSync } from "node:fs";
import { setMaxListeners } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { SheetMeta } from "../assets/types.ts";
import { CursorAnim } from "./screenKit.ts";
import { SettingsStore } from "./settings.ts";
import { LobbyScreen, type LobbyScreenOptions } from "./lobbyScreen.ts";

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
let screen: LobbyScreen | undefined;
const send = vi.fn();

beforeEach(() => {
  send.mockClear();
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

function start(origin: number, cursor?: CursorAnim): { surface: Canvas; stage: Element; canvas: Canvas } {
  now = origin;
  const canvas = new Canvas(), stage = new Element(), image = {};
  screen = new LobbyScreen({
    canvas, stage, cursor, playerId: 1, maps: [{ id: "mizar01", title: "mizar01" }], music: [],
    assets: {
      background: image, banner: image, button: image, button2: image, roomButton: image,
      server: image, messageBox: image, winObject: image, gameInfo: image, remote: image,
      guild: image, mark: image, help: image, cursor: { image: cursorImage, meta: cursorMeta },
    },
    settings: new SettingsStore({ get: () => null, set() {} }), waitingOnly: false,
    sounds: { play() {}, unlock() {} }, say() {}, exit() {}, notice: { draw() {} }, account: () => null,
    profile: { nick: "P1", greeting: "", useId: true, character: "rookie", hue: 0 },
    send: (message: unknown) => { send(message); screen!.waitForRoom(); },
  } as unknown as LobbyScreenOptions, { channel: "test", users: [], rooms: [{
    code: "one", number: 0, title: "one", mapId: "mizar01", mode: 0,
    players: 1, max: 2, playing: false, secret: false,
  }] });
  move(canvas, 300, 250);
  return { surface: canvas, stage, canvas };
}

function move(canvas: Canvas, x: number, y: number): void {
  canvas.dispatchEvent(Object.assign(new Event("pointermove"), {
    isPrimary: true, pointerType: "mouse", pointerId: 1, button: -1, buttons: 0, clientX: x, clientY: y,
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

function join(canvas: Canvas): void {
  for (const [type, buttons] of [["pointerdown", 1], ["pointerup", 0]] as const) {
    canvas.dispatchEvent(Object.assign(new Event(type), {
      isPrimary: true, pointerType: "mouse", pointerId: 1, button: 0, buttons,
      clientX: 300, clientY: 110,
    }));
  }
  expect(send).toHaveBeenCalledExactlyOnceWith({ type: "join-room", code: "one" });
}

describe("lobby request cursor settings between frames", () => {
  it.each([0, 1.25, 1000, 1_000_000_000])("keeps a fast refusal's frame reset, origin %s", (origin) => {
    const { surface, canvas } = start(origin);
    draw(origin, surface);
    expect(draw(origin + 7000 / 30, surface)).toEqual([{ anim: 0, frame: 2 }]);
    now = origin + 240;
    join(canvas);
    expect(screen!.busy).toBe(true);
    now = origin + 241;
    screen!.refused("정원 초과 입니다.");
    expect(screen!.busy).toBe(false);
    expect(draw(origin + 8000 / 30, surface)).toEqual([{ anim: 0, frame: 0 }]);
    expect(draw(origin + 14000 / 30, surface)).toEqual([{ anim: 0, frame: 1 }]);
  });

  it.each([0, 1.25, 1000, 1_000_000_000])("clears the wait for a password reply without waiting for a draw, origin %s", (origin) => {
    const { surface, canvas } = start(origin);
    draw(origin, surface);
    draw(origin + 7000 / 30, surface);
    now = origin + 240;
    join(canvas);
    now = origin + 241;
    screen!.passwordAsked("one");
    expect(screen!.busy).toBe(false);
    expect(screen!.takesChat).toBe(false);
    expect(draw(origin + 8000 / 30, surface)).toEqual([{ anim: 0, frame: 0 }]);
  });

  it.each([0, 1.25, 1000, 1_000_000_000])("resets a refusal when the cursor is already normal, origin %s", (origin) => {
    const { surface } = start(origin);
    expect(draw(origin, surface)).toEqual([{ anim: 0, frame: 1 }]);
    now = origin + 1;
    screen!.refused("정원 초과 입니다.");
    expect(draw(origin + 1000 / 30, surface)).toEqual([{ anim: 0, frame: 0 }]);
  });

  it("sets the shared cursor as soon as the room row sends a join", () => {
    const cursor = new CursorAnim(), { surface, canvas } = start(0, cursor);
    draw(0, surface);
    now = 1;
    join(canvas);
    expect(cursor.busy).toBe(true);
    // Busy input still drops a second row click and Esc.
    canvas.dispatchEvent(Object.assign(new Event("pointerdown"), { isPrimary: true, pointerId: 1, button: 0, buttons: 1, clientX: 300, clientY: 110 }));
    canvas.dispatchEvent(Object.assign(new Event("pointerup"), { isPrimary: true, pointerId: 1, button: 0, buttons: 0, clientX: 300, clientY: 110 }));
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("keeps the frame reset when a busy frame was drawn before the refusal", () => {
    const { surface, canvas } = start(0);
    draw(0, surface);
    draw(7000 / 30, surface);
    now = 240;
    join(canvas);
    expect(draw(8000 / 30, surface)).toEqual([{ anim: 1, frame: 0 }]);
    now = 267;
    screen!.refused("정원 초과 입니다.");
    expect(draw(9000 / 30, surface)).toEqual([{ anim: 0, frame: 0 }]);
  });
});
