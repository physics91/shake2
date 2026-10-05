import { readFileSync } from "node:fs";
import { setMaxListeners } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { SheetMeta } from "../assets/types.ts";
import type { ClientMessage } from "../server/protocol.ts";
import { createMatch } from "../sim/match.ts";
import { layoutFromAscii, setups, VERSUS } from "../sim/testing.ts";
import { GameView } from "./gameView.ts";
import { RoomScreen, type RoomScreenOptions } from "./roomScreen.ts";
import { LobbyScreen, type LobbyScreenOptions } from "./lobbyScreen.ts";
import type { SceneAssets } from "./scene.ts";
import { answerLocal, localRoom } from "./localRoom.ts";
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
    save() {}, restore() {}, fillRect() {}, clearRect() {}, fillText() {},
    getImageData: (_x: number, _y: number, width: number, height: number) => ({ width, height, data: new Uint8ClampedArray(width * height * 4) }),
    putImageData() {},
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
const stops: (() => void)[] = [];

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
afterEach(() => { for (const stop of stops.splice(0)) stop(); screen?.dispose(); screen = undefined; vi.restoreAllMocks(); vi.unstubAllGlobals(); });

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
  stops.push(() => screen?.dispose());
  return { surface: surfaces[before], stage, canvas };
}

function move(canvas: Canvas, x: number, y: number): void {
  canvas.dispatchEvent(Object.assign(new Event("pointermove"), {
    isPrimary: true, pointerType: "mouse", pointerId: 1, button: -1, buttons: 0, clientX: x, clientY: y,
  }));
}

function click(canvas: Canvas, x: number, y: number): void {
  for (const type of ["pointerdown", "pointerup"]) {
    canvas.dispatchEvent(Object.assign(new Event(type), {
      isPrimary: true, pointerType: "mouse", pointerId: 1, button: 0,
      buttons: type === "pointerdown" ? 1 : 0, clientX: x, clientY: y,
    }));
  }
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


const image = {};
function sheet(dir: string, name: string) {
  return { image, meta: JSON.parse(readFileSync(new URL(`../../public/assets/spr/${dir}/${name}.json`, import.meta.url), "utf8")) as SheetMeta };
}
const sceneAssets = {
  level: { background: image, bricks: [], meta: { area: [51, 51, 651, 531], fixed: [], bricks: [], objects: [] } },
  characters: new Map([["rookie", { body: sheet("character", "rookie"), face: sheet("w_character", "rookie_w"), bomb: sheet("bomb", "bomb_blue") }]]),
  tinted: new Map(), heads: new Map(), fire: sheet("bomb", "fire"), items: sheet("item", "item"),
  objectSheets: ["a", "b", "c"].map((name) => sheet("object", "object_" + name)),
  digits: sheet("object", "count"), clock: sheet("object", "clock"), hurry: sheet("object", "hurry"),
  marker: sheet("object", "diff1"), teamMarker: sheet("object", "diff2"), badState: sheet("object", "bad_state"),
  effects: { ground: sheet("object", "u_ground"), egg: sheet("object", "egg"), revival: sheet("object", "revival") },
  shadow: image, cursor: { image: cursorImage, meta: cursorMeta },
  hud: Object.fromEntries(["mark", "item", "sd", "portraits", "guild", "teambar", "candy", "textbox", "help", "apple", "blindFilter", "images", "load", "roundResult", "gameResult"].map((name) => [name, image])),
} as unknown as SceneAssets;

function menu(kind: "room" | "lobby", cursor: CursorAnim, playerId = 1, send: RoomScreenOptions["send"] = () => undefined): { surface: Canvas; screen: RoomScreen | LobbyScreen; stop(): void } {
  const canvas = new Canvas(), stage = new Element();
  const assets = Object.fromEntries(["background", "banner", "button", "button2", "roomButton", "gameInfo", "remote", "messageBox", "guild", "mark", "help", "statusWindow", "charChange", "winObject", "faces", "option", "basicWindow", "userInfo", "ranking", "object1", "object2", "mapimage"].map((name) => [name, image]));
  const lists = { maps: [{ id: "mizar01", title: "mizar01" }], music: [] };
  const options = {
    canvas, stage, cursor, assets: { ...assets, guilds: [], cursor: { image: cursorImage, meta: cursorMeta } },
    ...lists, playerId, sounds: { play() {}, unlock() {} }, settings: new SettingsStore({ get: () => null, set() {} }),
    notice: { draw() {} }, send, say() {}, exit() {}, leave() {}, kickedOut() {},
    waitingOnly: false, filterChanged() {}, profile: { character: "rookie", hue: 0, nick: "P1", greeting: "", useId: true },
    account: () => null, saveCharacter() {}, saveGreeting() {}, saveNick() {}, whisperTo() {},
    ranking: { rows: [], windowPage: 1, page: async () => false, search: async () => false },
  };
  const next = kind === "room"
    ? new RoomScreen(options as unknown as RoomScreenOptions, localRoom(lists, ["rookie", "rookie"]))
    : new LobbyScreen(options as unknown as LobbyScreenOptions, { channel: "검사", rooms: [], users: [] });
  const stop = () => next.dispose(); stops.push(stop);
  move(canvas, 300, 250);
  return { surface: canvas, screen: next, stop };
}

function game(cursor: CursorAnim, waiting: boolean) {
  const canvas = new Canvas();
  const state = createMatch(layoutFromAscii(["1......2......."]), setups(2), VERSUS, 23);
  if (!waiting) state.phase = "playing";
  const view = new GameView(canvas.ctx as unknown as CanvasRenderingContext2D, sceneAssets,
    { effects: true, stopMusic() {}, playMusic() {}, play() {}, stop() {} } as never,
    { localPlayerIds: [1], hostId: 1, music: null, cursor } as never);
  stops.push(() => view.dispose()); move(canvas, 300, 250);
  return { view, state, surface: view.composition as unknown as Canvas };
}

function gameDraw(next: ReturnType<typeof game>, at: number, help = false) {
  now = at; next.surface.calls = []; next.view.render(next.state, { help });
  return next.surface.calls.filter((call) => call.source === cursorImage).map((call) => {
    for (const [anim, a] of cursorMeta.animations.entries()) {
      const frame = a.frames.findIndex((f) => f.rect[0] === call.args[0] && f.rect[1] === call.args[1]);
      if (frame >= 0) return { anim, frame };
    }
    throw new Error("unknown cursor crop");
  });
}

describe("the session cursor across screen replacement", () => {
  it.each(["room", "lobby"] as const)("keeps the frame on returning to %s", (kind) => {
    const cursor = new CursorAnim();
    const first = menu(kind, cursor);
    expect(draw(0, first.surface)).toEqual([{ anim: 0, frame: 1 }]);
    expect(draw(7000 / 30, first.surface)).toEqual([{ anim: 0, frame: 2 }]);
    first.stop(); now = 300;
    const next = menu(kind, cursor);
    expect(draw(300, next.surface)).toEqual([{ anim: 0, frame: 2 }]);
  });

  it("keeps the room's timer while the game wait hides the cursor", () => {
    const cursor = new CursorAnim(); const first = menu("room", cursor);
    expect(draw(0, first.surface)).toEqual([{ anim: 0, frame: 1 }]);
    expect(draw(7000 / 30, first.surface)).toEqual([{ anim: 0, frame: 2 }]);
    first.stop(); now = 8000 / 30; const waiting = game(cursor, true);
    expect(gameDraw(waiting, 8000 / 30, true)).toEqual([]);
    waiting.view.dispose(); now = 300; const next = menu("room", cursor);
    expect(draw(300, next.surface)).toEqual([{ anim: 0, frame: 2 }]);
  });

  it("continues the cursor from login through lobby and room", () => {
    const cursor = new CursorAnim(); const login = start(0, "login", cursor);
    expect(draw(0, login.surface)).toEqual([{ anim: 0, frame: 1 }]);
    expect(draw(7000 / 30, login.surface)).toEqual([{ anim: 0, frame: 2 }]);
    screen!.dispose(); screen = undefined; now = 300; const lobby = menu("lobby", cursor);
    expect(draw(300, lobby.surface)).toEqual([{ anim: 0, frame: 2 }]);
    lobby.stop(); now = 400; const room = menu("room", cursor);
    expect(draw(400, room.surface)).toEqual([{ anim: 0, frame: 2 }]);
    expect(draw(14000 / 30, room.surface)).toEqual([{ anim: 0, frame: 3 }]);
  });

  it("continues the room's cursor over game help and on returning", () => {
    const cursor = new CursorAnim(); const room = menu("room", cursor);
    expect(draw(0, room.surface)).toEqual([{ anim: 0, frame: 1 }]);
    expect(draw(7000 / 30, room.surface)).toEqual([{ anim: 0, frame: 2 }]);
    room.stop(); now = 8000 / 30; const match = game(cursor, false);
    expect(gameDraw(match, 8000 / 30, true)).toEqual([{ anim: 0, frame: 2 }]);
    expect(gameDraw(match, 14000 / 30, true)).toEqual([{ anim: 0, frame: 3 }]);
    match.view.dispose(); now = 500; const next = menu("room", cursor);
    expect(draw(500, next.surface)).toEqual([{ anim: 0, frame: 3 }]);
  });

  it("keeps the game's draw clock when replacing the game view", () => {
    const cursor = new CursorAnim(); const first = game(cursor, false);
    expect(gameDraw(first, 0, true)).toEqual([{ anim: 0, frame: 1 }]);
    expect(gameDraw(first, 7000 / 30, true)).toEqual([{ anim: 0, frame: 2 }]);
    first.view.dispose(); now = 300; const next = game(cursor, false);
    expect(gameDraw(next, 300, true)).toEqual([{ anim: 0, frame: 2 }]);
    expect(gameDraw(next, 433.9, true)).toEqual([{ anim: 0, frame: 2 }]);
    expect(gameDraw(next, 14000 / 30, true)).toEqual([{ anim: 0, frame: 3 }]);
  });

  it("keeps the current cursor kind on game help", () => {
    const cursor = new CursorAnim(); cursor.set(true);
    const first = game(cursor, false);
    expect(gameDraw(first, 0, true)).toEqual([{ anim: 1, frame: 1 }]);
    expect(gameDraw(first, 7000 / 30, true)).toEqual([{ anim: 1, frame: 2 }]);
  });

  it("retains the status hand across help and screen replacement", () => {
    const cursor = new CursorAnim(); const status = start(0, "status", cursor);
    move(status.canvas, 600, 350);
    expect(draw(0, status.surface)).toEqual([{ anim: 2, frame: 1 }]);
    key("F1");
    expect(draw(1000 / 30, status.surface)).toEqual([{ anim: 2, frame: 1 }]);
    screen!.dispose(); screen = undefined; now = 2000 / 30; const next = game(cursor, false);
    expect(gameDraw(next, 2000 / 30, true)).toEqual([{ anim: 2, frame: 1 }]);
  });

  it("keeps independent sessions independent", () => {
    const a = new CursorAnim(); const first = menu("room", a);
    draw(0, first.surface); draw(7000 / 30, first.surface); first.stop(); now = 300;
    const b = new CursorAnim(); const next = menu("room", b);
    expect(draw(300, next.surface)).toEqual([{ anim: 0, frame: 1 }]);
  });
});


describe("room slot request and reply ordering", () => {
  it.each([2, 3, 4, 5])("finishes an immediate local refusal for slot %i with a normal cursor", (slot) => {
    const cursor = new CursorAnim();
    const lists = { maps: [{ id: "mizar01", title: "mizar01" }], music: [] };
    const room = localRoom(lists, ["rookie", "rookie"]);
    const send = vi.fn((message: ClientMessage) => {
      expect(answerLocal(room, lists, message)).toBeNull();
      if (!(next.screen instanceof RoomScreen)) throw new Error("expected room screen");
      next.screen.refused();
    });
    const next = menu("room", cursor, 1, send);
    click(next.surface, slot % 2 ? 350 : 100, slot < 4 ? 235 : 326);
    expect(send).toHaveBeenCalledExactlyOnceWith({ type: "set-slot", slot, open: true });
    expect(cursor.busy).toBe(false);
    expect(room.closed).toEqual([false, false, true, true, true, true]);
    expect(draw(0, next.surface)).toEqual([{ anim: 0, frame: 1 }]);
  });

  it("keeps a delayed slot request busy until its reply", () => {
    const cursor = new CursorAnim();
    const send = vi.fn();
    const next = menu("room", cursor, 1, send);
    click(next.surface, 100, 235);
    expect(send).toHaveBeenCalledExactlyOnceWith({ type: "set-slot", slot: 2, open: true });
    expect(cursor.busy).toBe(true);
    expect(draw(0, next.surface)).toEqual([{ anim: 1, frame: 1 }]);
    if (!(next.screen instanceof RoomScreen)) throw new Error("expected room screen");
    next.screen.refused();
    expect(cursor.busy).toBe(false);
    expect(draw(1000 / 30, next.surface)).toEqual([{ anim: 0, frame: 0 }]);
  });
});

describe("room reply cursor settings (S->C 0x44)", () => {
  function roomAt(origin: number, playerId = 2) {
    now = origin;
    const cursor = new CursorAnim();
    const room = menu("room", cursor, playerId);
    if (!(room.screen instanceof RoomScreen)) throw new Error("expected room screen");
    return { ...room, screen: room.screen, cursor };
  }

  for (const origin of [0, 1.25, 1000, 1_000_000_000]) {
    it(`resets a normal cursor for another player's kick at origin ${origin}`, () => {
      const room = roomAt(origin);
      expect(draw(origin, room.surface)).toEqual([{ anim: 0, frame: 1 }]);
      expect(draw(origin + 7000 / 30, room.surface)).toEqual([{ anim: 0, frame: 2 }]);
      now = origin + 241;
      room.screen.refused();
      expect(room.cursor.busy).toBe(false);
      expect(draw(origin + 8000 / 30, room.surface)).toEqual([{ anim: 0, frame: 0 }]);
      expect(draw(origin + 14000 / 30, room.surface)).toEqual([{ anim: 0, frame: 1 }]);
    });

    it(`resets a second reply after the first wait ended at origin ${origin}`, () => {
      const room = roomAt(origin, 1);
      draw(origin, room.surface);
      draw(origin + 7000 / 30, room.surface);
      now = origin + 240;
      room.screen.waitForKick();
      now = origin + 241;
      room.screen.refused();
      expect(draw(origin + 15000 / 30, room.surface)).toEqual([{ anim: 0, frame: 1 }]);
      now = origin + 501;
      room.screen.refused();
      expect(draw(origin + 16000 / 30, room.surface)).toEqual([{ anim: 0, frame: 0 }]);
    });
  }

  it("ends a drawn busy cursor without resetting its last advance time", () => {
    const room = roomAt(0, 1);
    draw(0, room.surface);
    draw(7000 / 30, room.surface);
    now = 240;
    room.screen.waitForKick();
    expect(draw(8000 / 30, room.surface)).toEqual([{ anim: 1, frame: 0 }]);
    now = 270;
    room.screen.refused();
    expect(draw(9000 / 30, room.surface)).toEqual([{ anim: 0, frame: 0 }]);
    expect(draw(14000 / 30, room.surface)).toEqual([{ anim: 0, frame: 1 }]);
  });

  it("applies the reply while the pointer is outside the canvas", () => {
    const room = roomAt(0);
    draw(0, room.surface);
    draw(7000 / 30, room.surface);
    room.surface.dispatchEvent(Object.assign(new Event("pointerleave"), { isPrimary: true, pointerId: 1 }));
    now = 241;
    room.screen.refused();
    expect(draw(8000 / 30, room.surface)).toEqual([]);
    move(room.surface, 300, 250);
    expect(draw(9000 / 30, room.surface)).toEqual([{ anim: 0, frame: 0 }]);
  });

  it("preserves a normal cursor for room updates that carry no reply setting", () => {
    const room = roomAt(0);
    draw(0, room.surface);
    draw(7000 / 30, room.surface);
    const changed = localRoom({ maps: [{ id: "mizar01", title: "mizar01" }], music: [] }, ["rookie", "rookie"]);
    changed.music = 1;
    room.screen.update(changed);
    expect(draw(8000 / 30, room.surface)).toEqual([{ anim: 0, frame: 2 }]);
  });
});

describe("explicit ordinary room updates", () => {
  it("keeps a wait when an ordinary snapshot includes another slot or team change", () => {
    const cursor = new CursorAnim(), room = menu("room", cursor);
    if (!(room.screen instanceof RoomScreen)) throw new Error("expected room screen");
    draw(0, room.surface); draw(7000 / 30, room.surface);
    cursor.set(true);
    const changed = localRoom({ maps: [{ id: "mizar01", title: "mizar01" }], music: [] }, ["rookie", "rookie"]);
    changed.closed[2] = false;
    changed.players[1].team = 3;
    room.screen.update(changed, "other");
    expect(draw(8000 / 30, room.surface)).toEqual([{ anim: 1, frame: 0 }]);
  });
});
