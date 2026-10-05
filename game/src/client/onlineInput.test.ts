import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Manifest, SheetMeta } from "../assets/types.ts";
import { TICK_RATE } from "../sim/constants.ts";
import { layoutFromAscii, VERSUS } from "../sim/testing.ts";
import { createMatch } from "../sim/match.ts";
import type { ServerMessage } from "../server/protocol.ts";
import { parseClientMessage, toWireState } from "../server/protocol.ts";
import { Room } from "../server/room.ts";
import type { StartActions } from "./startView.ts";
import type { ChatLine } from "./chatLine.ts";
import type { CursorAnim } from "./screenKit.ts";
import { defaultSettings } from "./settings.ts";

const { loadSceneAssets, views, screens, chatLines, chatDisposed, captureDetached, cursors, captureSources } = vi.hoisted(() => ({
  loadSceneAssets: vi.fn(), views: [] as StartActions[],
  cursors: [] as CursorAnim[],
  chatLines: [] as ChatLine[],
  screens: [] as { loaded: ReturnType<typeof vi.fn>; failed: ReturnType<typeof vi.fn>; canvas: EventTarget; exit(): void }[],
  chatDisposed: vi.fn(), captureDetached: vi.fn(),
  captureSources: [] as (() => HTMLCanvasElement | null)[],
}));

// Exercise the session's actual game controller, keyboard adapter and editor; hold assets and drawing.
vi.mock("./startView.ts", () => ({
  defaultServerUrl: () => "ws://test/ws",
  StartView: class {
    root = {};
    errorLine = {};
    serverUrl = "ws://test/ws";
    constructor(options: { actions: StartActions; cursor: CursorAnim }) { views.push(options.actions); cursors.push(options.cursor); }
    loggedIn() {}
    connected() {}
    leave(done: () => void) { done(); }
    dispose() {}
  },
}));
vi.mock("./lobbyView.ts", () => ({ LobbyView: class {
  root = { querySelector: () => null };
  errorLine = {};
  update() {}
  dispose() {}
} }));
vi.mock("./roomScreen.ts", () => ({ loadRoomAssets: () => new Promise(() => undefined) }));
vi.mock("./assets.ts", () => ({ loadImage: async () => ({}) }));
vi.mock("./scene.ts", () => ({ loadSceneAssets }));
vi.mock("./menu.ts", () => ({ portraitCanvas: () => ({}), mapChoices: () => [], mapTitle: (title: string) => title }));
vi.mock("./gameView.ts", () => ({ GameView: class {
  composition = {} as HTMLCanvasElement;
  catchUp() {}
  ingest() {}
  render() {}
  dispose() {}
} }));
vi.mock("./chatLine.ts", async (original) => {
  const { ChatLine } = await original<typeof import("./chatLine.ts")>();
  return { ChatLine: class extends ChatLine {
    open() { super.open(); chatLines.push(this); }
    dispose() { super.dispose(); chatDisposed(); }
  } };
});
vi.mock("./screenCapture.ts", () => ({ attachCapture: (_canvas: HTMLCanvasElement, _blocked: unknown, source: () => HTMLCanvasElement | null) => {
  captureSources.push(source);
  return captureDetached;
} }));
vi.mock("./shell.ts", () => ({
  mount() {}, settings: { current: defaultSettings() }, sounds: { unlock() {}, stopMusic() {}, play: vi.fn() },
  gameScreen: (_title: string, _keys: string, exit: () => void) => {
    const screen = {
      root: { querySelector: () => null }, stage: new Element("div"),
      canvas: Object.assign(new EventTarget(), {
        getContext: () => ({}),
        getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }),
      }),
      loaded: vi.fn(), failed: vi.fn(), announce() {}, setExitAction() {}, exit,
    };
    screens.push(screen);
    return screen;
  },
}));

class Element extends EventTarget {
  readonly tagName: string;
  readonly attributes = new Map<string, string>();
  readonly children: Element[] = [];
  readonly dataset = {};
  value = "";
  selectionStart = 0;
  readOnly = false;
  style = {};
  textContent = "";
  constructor(tagName: string) { super(); this.tagName = tagName.toUpperCase(); }
  setAttribute(name: string, value: string) { this.attributes.set(name, value); }
  hasAttribute(name: string) { return this.attributes.has(name); }
  contains(element: Element | null): boolean { return element === this || this.children.some((child) => child.contains(element)); }
  setSelectionRange(start: number, _end: number) { this.selectionStart = start; }
  focus() { dom.activeElement = this; }
  blur() { if (dom.activeElement === this) dom.activeElement = dom.body; }
  toggleAttribute() {}
  append(element: Element) { this.children.push(element); }
  replaceChildren() {}
  remove() { this.blur(); }
  querySelector() { return null; }
  querySelectorAll() { return []; }
}

const elements: Element[] = [];
const frames = new Map<number, FrameRequestCallback>();
const dom = {
  body: new Element("body"), activeElement: null as Element | null, hasFocus: () => true,
  createElement: (tag: string) => { const element = new Element(tag); elements.push(element); return element; },
  querySelector: () => null,
};

class Socket extends EventTarget {
  static OPEN = 1;
  readyState = 0;
  sent: object[] = [];
  constructor(_url: string) { super(); sockets.push(this); }
  send(text: string) { this.sent.push(JSON.parse(text)); }
  close() { this.readyState = 3; }
  open() { this.readyState = Socket.OPEN; this.dispatchEvent(new Event("open")); }
  receive(message: object) { this.dispatchEvent(new MessageEvent("message", { data: JSON.stringify(message) })); }
}

const sockets: Socket[] = [];
let stop: () => void;
let fail: (error: Error) => void;
let loaded: () => void;
const room = {
  code: "ABCD", number: 0, title: "test", hostId: 1, mapId: "test", music: 0, mode: 0,
  closed: [false, false, true, true, true, true], playing: true,
  players: [1, 2].map((id, slot) => ({ id, slot, name: `test${id}`, character: "bobo", hue: 0, useId: true, ready: true, team: id })),
};
const layout = layoutFromAscii(["1....", ".....", "....2"]);

beforeEach(async () => {
  vi.clearAllMocks();
  sockets.length = 0;
  views.length = 0;
  cursors.length = 0;
  screens.length = 0;
  chatLines.length = 0;
  captureSources.length = 0;
  elements.length = 0;
  frames.clear();
  const { settings } = await import("./shell.ts");
  settings.current.keys.splice(0, 3, ...defaultSettings().keys);
  settings.current.macros[9] = "";
  dom.activeElement = dom.body;
  loadSceneAssets.mockResolvedValue({});
  loadSceneAssets.mockImplementationOnce(() => new Promise((resolve, reject) => { loaded = () => resolve({}); fail = reject; }));
  vi.stubGlobal("window", new EventTarget());
  vi.stubGlobal("HTMLElement", Element);
  vi.stubGlobal("WebSocket", Socket);
  vi.stubGlobal("document", dom);
  let nextFrame = 0;
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { frames.set(++nextFrame, callback); return nextFrame; });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
  const { mountOnline } = await import("./online.ts");
  stop = mountOnline({ characters: ["bobo"], maps: [], music: [] } as unknown as Manifest);
  views[0].authConnect();
  sockets[0].open();
  sockets[0].receive({ type: "login", ok: true, account: { id: "tester" }, token: "session", channels: [] });
  views[0].connect();
  sockets[1].open();
  sockets[1].receive({ type: "welcome", playerId: 2, maps: [], music: [], account: { id: "tester", character: "bobo" } });
  sockets[1].receive({ type: "lobby", channel: "test", rooms: [], users: [] });
  beginMatch();
});

afterEach(() => {
  stop?.();
  vi.unstubAllGlobals();
});

function beginMatch() {
  sockets[1].receive({ type: "room", room });
  sockets[1].receive({ type: "match-start", layout, music: 0 });
}

function key(code: string, type = "keydown", value = code === "Space" ? " " : code, keyCode = 0) {
  const event = new Event(type, { cancelable: true });
  Object.assign(event, { code, key: value, keyCode });
  Object.defineProperty(event, "target", { value: dom.activeElement });
  dom.activeElement?.dispatchEvent(event);
  window.dispatchEvent(event);
  return event;
}

function pointer(type: string, fields: Partial<PointerEvent> = {}) {
  screens[0].canvas.dispatchEvent(Object.assign(new Event(type), {
    pointerId: 1, isPrimary: true, button: 0, buttons: type === "pointerdown" ? 1 : 0,
    clientX: 356, clientY: 348, ...fields,
  }));
}

function draw() {
  const callbacks = [...frames.values()]; frames.clear();
  for (const callback of callbacks) callback(performance.now());
}

function snapshot(phase: "playing" | "round-over" = "playing") {
  const state = createMatch(layout, room.players, VERSUS, 1);
  state.phase = phase;
  sockets[1].receive({ type: "snapshot", state: toWireState(state), events: [], typing: [], bars: [] });
}

it("offers no capture surface until the loaded online game has drawn its first snapshot", async () => {
  snapshot();
  expect(captureSources[0]()).toBeNull();
  loaded();
  await vi.waitFor(() => expect(screens[0].loaded).toHaveBeenCalledOnce());
  expect(captureSources[0]()).toBeNull();
  draw();
  expect(captureSources[0]()).not.toBeNull();
});

describe("cursor replies while the game controller owns the screen", () => {
  const meta = JSON.parse(readFileSync(new URL("../../public/assets/image/cursor.json", import.meta.url), "utf8")) as SheetMeta;

  for (const kind of ["match-start", "kick"] as const) {
    for (const busy of [false, true]) {
      it(`resets ${kind} before delivery with a ${busy ? "busy" : "normal"} cursor`, () => {
        const cursor = cursors[0];
        cursor.advance(0, meta); cursor.advance(7000 / 30, meta);
        if (busy) cursor.set(true);
        sockets[1].receive(kind === "match-start" ? { type: kind, layout, music: 0 } : { type: kind, slot: 0, ok: false });
        expect(cursor.advance(8000 / 30, meta)).toEqual({ anim: 0, frame: 0 });
        expect(cursor.advance(14000 / 30, meta)).toEqual({ anim: 0, frame: 1 });
      });
    }
  }

  it("preserves cursor progress and waiting for ordinary snapshots", () => {
    const cursor = cursors[0];
    cursor.advance(0, meta); cursor.advance(7000 / 30, meta);
    snapshot();
    expect(cursor.advance(8000 / 30, meta)).toEqual({ anim: 0, frame: 2 });
    cursor.set(true);
    snapshot();
    expect(cursor.busy).toBe(true);
  });
});

describe("an action key that also opens chat or help", () => {
  let server: Room;
  let snapshots: Extract<ServerMessage, { type: "snapshot" }>[];

  beforeEach(() => {
    snapshots = [];
    const peer = (id: number) => ({ id, send: (message: ServerMessage) => {
      if (id === 2 && message.type === "snapshot") snapshots.push(message);
    } });
    const profile = (id: number) => ({
      name: `test${id}`, nick: `test${id}`, character: "bobo", hue: 0, useId: true,
      card: { nick: `test${id}`, greeting: "", guild: -1, level: 12, wins: 0, losses: 0, cell: 0, rank: 0, manner: 0, exp: 0 },
    });
    server = new Room({ code: "ABCD", number: 0, title: "test", password: "" }, peer(1), profile(1), {
      maps: [layout.id], layoutFor: () => layout, musicCount: 0, rules: VERSUS, now: () => 0, changed() {},
    });
    server.join(peer(2), profile(2));
    server.setReady(2, true);
    expect(server.start(1)).toBeNull();
    for (let tick = 0; tick < 5 * TICK_RATE; tick++) server.tick();
  });

  async function bindBomb(dik: number): Promise<void> {
    const { settings } = await import("./shell.ts");
    settings.current.keys.splice(0, 3, dik, 0x1d, 0x2c);
    sockets[1].receive({ type: "match-start", layout, music: 0 });
    await vi.waitFor(() => expect(screens[1].loaded).toHaveBeenCalledOnce());
    snapshot();
    sockets[1].sent.length = 0;
  }

  // Preserve message order, with 100 ms of server time between messages as on a paced connection.
  function receiveWithTicks(): void {
    for (const raw of sockets[1].sent) {
      const message = parseClientMessage(JSON.stringify(raw));
      if (message?.type === "input") server.input(2, message.dir, message, message.paused);
      else if (message?.type === "typing") server.typing(2, message.on);
      for (let tick = 0; tick < 3; tick++) server.tick();
    }
    sockets[1].sent.length = 0;
  }

  it.each([["Enter", 0x1c], ["F1", 0x3b], ["F5", 0x3f]] as const)("opens %s without bombing before the pause arrives", async (code, dik) => {
    await bindBomb(dik);
    key(code);
    receiveWithTicks();
    expect(snapshots.at(-1)!.state.bombs).toEqual([]);
    key(code, "keyup");
    key("Escape");
    receiveWithTicks();
    expect(snapshots.at(-1)!.state.bombs).toEqual([]);
  });

  it.each([["Enter", 0x1c], ["F1", 0x3b], ["F5", 0x3f]] as const)("reads %s still held after Escape closes the pause", async (code, dik) => {
    await bindBomb(dik);
    key(code);
    receiveWithTicks();
    key("Escape");
    receiveWithTicks();
    expect(snapshots.at(-1)!.state.bombs).toMatchObject([{ owner: 2 }]);
  });

  it("reads Enter held when Enter closes the chat line", async () => {
    await bindBomb(0x1c);
    key("Enter");
    key("Enter", "keyup");
    receiveWithTicks();
    expect(snapshots.at(-1)!.state.bombs).toEqual([]);
    key("Enter");
    receiveWithTicks();
    expect(snapshots.at(-1)!.state.bombs).toMatchObject([{ owner: 2 }]);
  });

  it("still sends an ordinary Space bomb without opening chat", async () => {
    await bindBomb(0x39);
    key("Space");
    key("Space", "keyup");
    receiveWithTicks();
    expect(snapshots.at(-1)!.state.bombs).toMatchObject([{ owner: 2 }]);
  });
});

describe("online exit box chat editing", () => {
  let input: Element;
  beforeEach(async () => {
    const { settings } = await import("./shell.ts");
    settings.current.macros[9] = "abc";
    loaded();
    await vi.waitFor(() => expect(screens[0].loaded).toHaveBeenCalledOnce());
    snapshot();
    input = elements.findLast((element) => element.attributes.get("aria-label") === "채팅")!;
    key("Escape"); key("F10");
  });

  it.each(["x", "Backspace", "ArrowLeft", "ArrowRight", "Escape", "F5"])("consumes %s without making the editor read-only, before drawing", (value) => {
    expect(key(value, "keydown", value).defaultPrevented).toBe(true);
    expect(input.readOnly).toBe(false);
    expect(input.value).toBe("abc");
    expect(input.selectionStart).toBe(3);
  });

  it("consumes NO and accepts the next chat character before another frame", () => {
    draw(); expect(key("KeyX", "keydown", "x").defaultPrevented).toBe(true);
    const before = input.value;
    const answer = key("KeyN", "keydown", "n");
    expect(answer.defaultPrevented).toBe(true);
    expect(input.readOnly).toBe(false);
    input.value = `${before}Z`; input.setSelectionRange(input.value.length, input.value.length);
    input.dispatchEvent(new Event("input")); key("Enter");
    expect(sockets[1].sent).toContainEqual({ type: "game-chat", text: `${before}Z` });
  });

  it("accepts the next editor key on a NO click before another frame", () => {
    draw(); expect(key("KeyX", "keydown", "x").defaultPrevented).toBe(true);
    pointer("pointerdown", { clientX: 448 }); pointer("pointerup", { clientX: 448 });
    expect(key("KeyX", "keydown", "x").defaultPrevented).toBe(false);
    expect(input.readOnly).toBe(false);
    expect(sockets[1].sent).not.toContainEqual({ type: "leave-room" });
  });

  it("consumes YES while sending the leave request, without adding it to chat", () => {
    draw();
    const before = input.value;
    const answer = key("KeyY", "keydown", "y");
    expect(answer.defaultPrevented).toBe(true);
    expect(input.value).toBe(before);
    expect(sockets[1].sent).toContainEqual({ type: "leave-room" });
    expect(sockets[1].sent).not.toContainEqual(expect.objectContaining({ type: "game-chat" }));
  });

  it("also unlocks when the round result closes the box", () => {
    draw(); expect(key("KeyX", "keydown", "x").defaultPrevented).toBe(true);
    snapshot("round-over"); draw();
    expect(key("KeyX", "keydown", "x").defaultPrevented).toBe(false);
    expect(input.readOnly).toBe(false);
  });

  it.each(["Delete", "IME"])("keeps the record while %s edits the buffer, through NO and the next frame", (edit) => {
    if (edit === "Delete") {
      input.setSelectionRange(2, 2);
      expect(key("Delete").defaultPrevented).toBe(false);
      if (!input.readOnly) {
        input.value = "ab"; input.setSelectionRange(2, 2);
        input.dispatchEvent(new Event("input"));
      }
    } else {
      expect(key("KeyR", "keydown", "Process", 229).defaultPrevented).toBe(false);
      if (!input.readOnly) {
        input.dispatchEvent(new Event("compositionstart"));
        input.dispatchEvent(Object.assign(new Event("compositionupdate"), { data: "한" }));
        input.value = "abc한"; input.setSelectionRange(4, 4);
        input.dispatchEvent(Object.assign(new Event("input"), { isComposing: true }));
        input.dispatchEvent(new Event("compositionend"));
      }
    }
    const edited = edit === "Delete" ? "ab" : "abc한";
    expect(input.value).toBe(edited);
    expect(chatLines.at(-1)!.view().text).toBe("abc");
    draw();
    expect(chatLines.at(-1)!.view().text).toBe("abc");
    expect(key("KeyN", "keydown", "n").defaultPrevented).toBe(true);
    draw();
    expect(chatLines.at(-1)!.view().text).toBe("abc");
    key("ArrowLeft");
    expect(chatLines.at(-1)!.view().text).toBe(edited);
    key("Enter");
    expect(sockets[1].sent).toContainEqual({ type: "game-chat", text: edited });
  });
});

describe("online exit box pointer input", () => {
  beforeEach(() => {
    const state = createMatch(layout, room.players, VERSUS, 1);
    state.phase = "playing";
    sockets[1].receive({ type: "snapshot", state: toWireState(state), events: [], typing: [], bars: [] });
    key("Escape");
    sockets[1].sent.length = 0;
  });

  it("ignores a right click, then accepts a fresh left click on YES", () => {
    pointer("pointerdown", { button: 2, buttons: 2 });
    pointer("pointerup", { button: 2 });
    expect(sockets[1].sent).toEqual([]);
    pointer("pointerdown");
    pointer("pointerup");
    expect(sockets[1].sent).toContainEqual({ type: "leave-room" });
  });

  it.each(["pointercancel", "lostpointercapture", "blur"])("drops a press after %s without sending leave-room", (type) => {
    pointer("pointerdown");
    if (type === "blur") window.dispatchEvent(new Event("blur"));
    else pointer(type);
    pointer("pointerup");
    expect(sockets[1].sent).not.toContainEqual({ type: "leave-room" });
  });

  it("ignores a second pointer's YES while the first pointer holds NO", () => {
    pointer("pointerdown", { clientX: 448 });
    pointer("pointerdown", { pointerId: 2, isPrimary: false });
    pointer("pointerup", { pointerId: 2, isPrimary: false });
    expect(sockets[1].sent).not.toContainEqual({ type: "leave-room" });
  });
});

describe("an online match whose pictures fail to load", () => {
  it("stops a server-side walk and drops a bomb tap queued before the loading failure", async () => {
    const socket = sockets[1];
    const snapshots: Extract<ServerMessage, { type: "snapshot" }>[] = [];
    const peer = (id: number) => ({ id, send: (message: ServerMessage) => {
      if (id === 2 && message.type === "snapshot") snapshots.push(message);
    } });
    const profile = (id: number) => ({
      name: `test${id}`, nick: `test${id}`, character: "bobo", hue: 0, useId: true,
      card: { nick: `test${id}`, greeting: "", guild: -1, level: 12, wins: 0, losses: 0, cell: 0, rank: 0, manner: 0, exp: 0 },
    });
    const server = new Room({ code: "ABCD", number: 0, title: "test", password: "" }, peer(1), profile(1), {
      maps: [layout.id], layoutFor: () => layout, musicCount: 0, rules: VERSUS, now: () => 0, changed() {},
    });
    server.join(peer(2), profile(2));
    server.setReady(2, true);
    expect(server.start(1)).toBeNull();
    for (let tick = 0; tick < 5 * TICK_RATE; tick++) server.tick();
    const receiveInputs = () => {
      for (const raw of socket.sent) {
        const message = parseClientMessage(JSON.stringify(raw));
        if (message?.type === "input") server.input(2, message.dir, message, message.paused);
        else if (message?.type === "typing") server.typing(2, message.on);
      }
      socket.sent.length = 0;
    };
    const own = () => snapshots.at(-1)!.state.players.find((player) => player.id === 2)!;
    const before = own().x;
    key("ArrowLeft");
    receiveInputs();
    for (let tick = 0; tick < 3; tick++) server.tick();
    expect(own().x).toBeLessThan(before);
    expect(own().anim).toBeLessThan(4);
    // A complete tap has reached the server, but no simulation tick has consumed it yet.
    key("Space");
    key("Space", "keyup");
    receiveInputs();
    fail(new Error("map failed"));
    await vi.waitFor(() => expect(screens[0].failed).toHaveBeenCalledOnce());
    receiveInputs();
    for (let tick = 0; tick < 6; tick++) server.tick();
    expect(own().anim).toBeGreaterThanOrEqual(4);
    const stoppedX = own().x;
    for (let tick = 0; tick < 6; tick++) server.tick();
    expect(own().x).toBe(stoppedX);
    expect(snapshots.at(-1)!.state.bombs).toEqual([]);
  });

  it("stops gameplay input and releases the old input and typing state", async () => {
    const socket = sockets[1];
    key("ArrowRight");
    key("F2");
    expect(socket.sent).toContainEqual({ type: "typing", on: true });
    fail(new Error("map failed"));
    await vi.waitFor(() => expect(screens[0].failed).toHaveBeenCalledOnce());
    expect(socket.sent.slice(-3)).toEqual([
      { type: "typing", on: false },
      { type: "input", dir: null, bomb: false, attack: false, evade: false, paused: true },
      { type: "input", dir: null, bomb: false, attack: false, evade: false, paused: false },
    ]);
    socket.sent.length = 0;
    expect(key("Space").defaultPrevented).toBe(false);
    key("ArrowRight", "keyup");
    key("Enter");
    expect(socket.sent).toEqual([]);
    expect(chatDisposed).toHaveBeenCalledOnce();
    expect(captureDetached).toHaveBeenCalledOnce();
    // The failure notice's existing exit action remains available, and cleanup runs only once.
    screens[0].exit();
    expect(socket.sent).toEqual([{ type: "leave-room" }]);
    stop();
    expect(chatDisposed).toHaveBeenCalledOnce();
    expect(captureDetached).toHaveBeenCalledOnce();
  });

  it("does not let a late failure stop a new match after the old loading screen was left", async () => {
    screens[0].exit();
    sockets[1].receive({ type: "room", room: null });
    beginMatch();
    await vi.waitFor(() => expect(screens[1].loaded).toHaveBeenCalledOnce());
    sockets[1].sent.length = 0;
    fail(new Error("old map failed"));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(screens[0].failed).not.toHaveBeenCalled();
    expect(sockets[1].sent).toEqual([]);
    expect(key("ArrowRight").defaultPrevented).toBe(true);
    expect(sockets[1].sent.at(-1)).toEqual({ type: "input", dir: 3, bomb: false, attack: false, evade: false, paused: false });
  });
});
