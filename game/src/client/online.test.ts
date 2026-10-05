import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Manifest, SheetMeta } from "../assets/types.ts";
import type { ServerMessage } from "../server/protocol.ts";
import type { LobbyActions } from "./lobbyView.ts";
import type { StartActions } from "./startView.ts";
import type { RoomScreenOptions } from "./roomScreen.ts";
import { AUTH_FAILED, type ServerList, type StartScene } from "./startScreen.ts";
import { defaultSettings } from "./settings.ts";
import type { CursorAnim } from "./screenKit.ts";

const { views, lobbies, rooms } = vi.hoisted(() => ({
  views: [] as { actions: StartActions; begin: StartScene; cursor?: CursorAnim; saveRefused: ReturnType<typeof vi.fn>; list: ServerList; serverInfo: ReturnType<typeof vi.fn> }[],
  lobbies: [] as LobbyActions[],
  rooms: [] as RoomScreenOptions[],
}));
const { fadeOver, lobbyFadeIn } = vi.hoisted(() => ({ fadeOver: vi.fn(), lobbyFadeIn: vi.fn() }));
const { localStart, playMusic, stopMusic, stopAll, gameScreens } = vi.hoisted(() => ({
  localStart: vi.fn(), playMusic: vi.fn(), stopMusic: vi.fn(), stopAll: vi.fn(),
  gameScreens: [] as { loaded: ReturnType<typeof vi.fn>; failed: ReturnType<typeof vi.fn>; exit(): void }[],
}));
vi.mock("./screenKit.ts", async (original) => ({ ...await original<typeof import("./screenKit.ts")>(), fadeOver }));

// Keep the real auth connection and session; the canvas is observed through its view boundary.
vi.mock("./startView.ts", () => ({
  defaultServerUrl: () => "ws://test/ws",
  StartView: class {
    root = {};
    errorLine = {};
    serverUrl = "ws://test/ws";
    saveRefused = vi.fn();
    serverInfo = vi.fn();
    cursor?: CursorAnim;
    constructor(options: { actions: StartActions; begin: StartScene; list: ServerList; cursor?: CursorAnim }) {
      this.cursor = options.cursor;
      views.push({ actions: options.actions, begin: options.begin, cursor: options.cursor, saveRefused: this.saveRefused, list: options.list, serverInfo: this.serverInfo });
    }
    loggedIn() {}
    connected() { this.cursor?.set(false); }
    authFailed() {}
    leave(done: () => void) { done(); }
    dispose() {}
  },
}));
vi.mock("./lobbyView.ts", () => ({ LobbyView: class {
  root = { querySelector: () => ({}) };
  errorLine = {};
  constructor(_welcome: unknown, _state: unknown, _log: unknown, _waiting: unknown, actions: LobbyActions, fadeIn: boolean) {
    lobbies.push(actions);
    lobbyFadeIn(fadeIn);
  }
  update() {}
  dispose() {}
} }));
vi.mock("./roomScreen.ts", () => ({
  loadRoomAssets: async () => ({}),
  RoomScreen: class {
    constructor(options: RoomScreenOptions) { rooms.push(options); }
    update() {}
    setLog() {}
    showKicked() {}
    refused() {}
    dispose() {}
  },
}));
vi.mock("./menu.ts", () => ({ portraitCanvas: () => ({}), mapChoices: () => [], playableMaps: (manifest: Manifest) => manifest.maps, mapTitle: (title: string) => title }));
vi.mock("./localGame.ts", () => ({ startLocalGame: localStart }));
vi.mock("./shell.ts", () => ({
  mount() {}, settings: { current: defaultSettings() }, sounds: { unlock() {}, playMusic, stopMusic, stopAll },
  gameScreen: (_title: string, _keys: string, exit: () => void) => {
    const screen = { root: { querySelector: () => null }, loaded: vi.fn(), failed: vi.fn(), announce() {}, exit };
    gameScreens.push(screen);
    return screen;
  },
}));

// Load after the mock factories are registered, before a test's fake timers and 5 s deadline.
const { mountOnline } = await import("./online.ts");

class Element extends EventTarget {
  readonly tagName: string;
  readonly children: unknown[] = [];
  value = "";
  style = {};
  textContent = "";
  readonly attributes = new Map<string, string>();
  constructor(tagName: string) { super(); this.tagName = tagName; }
  setAttribute(name: string, value: string) { this.attributes.set(name, value); }
  getAttribute(name: string) { return this.attributes.get(name) ?? null; }
  toggleAttribute() {}
  append(child: unknown) { this.children.push(child); }
  contains(target: Element | null): boolean {
    return this === target || this.children.some((child) => child instanceof Element && child.contains(target));
  }
  replaceChildren(...children: unknown[]) {
    if (this.children.some((child) => child instanceof Element && child.contains(dom.activeElement))) dom.activeElement = dom.body;
    this.children.splice(0, this.children.length, ...children);
  }
  focus() { dom.activeElement = this; }
  remove() {}
  querySelector() { return null; }
  querySelectorAll(selector: string): Element[] {
    const attribute = selector.slice(1, -1);
    return this.children.flatMap((child) => child instanceof Element
      ? [...(child.attributes.has(attribute) ? [child] : []), ...child.querySelectorAll(selector)] : []);
  }
}

class Socket extends EventTarget {
  static OPEN = 1;
  readyState = 0;
  sent: string[] = [];

  constructor(_url: string) {
    super();
    sockets.push(this);
  }
  send(data: string): void {
    this.sent.push(data);
  }
  close(): void {
    this.readyState = 3;
  }
  open(): void {
    this.readyState = Socket.OPEN;
    this.dispatchEvent(new Event("open"));
  }
  receive(message: object): void {
    this.dispatchEvent(new MessageEvent("message", { data: JSON.stringify(message) }));
  }
  disconnect(): void {
    this.close();
    this.dispatchEvent(new Event("close"));
  }
}

const sockets: Socket[] = [];
const elements: Element[] = [];
const dom = { body: new Element("BODY"), activeElement: null as Element | null, querySelector: () => null,
  createElement: (tag: string) => {
    const element = new Element(tag.toUpperCase());
    elements.push(element);
    return element;
  },
};
let stop: (() => void) | undefined;

beforeEach(() => {
  sockets.length = 0;
  views.length = 0;
  lobbies.length = 0;
  rooms.length = 0;
  gameScreens.length = 0;
  localStart.mockReset(); playMusic.mockClear(); stopMusic.mockClear(); stopAll.mockClear();
  elements.length = 0;
  fadeOver.mockClear(); lobbyFadeIn.mockClear();
  vi.useFakeTimers();
  vi.stubGlobal("WebSocket", Socket);
  dom.activeElement = dom.body;
  vi.stubGlobal("document", dom);
});

async function inLobby() {
  const { view, socket: auth } = await loggedIn();
  view.actions.connect();
  const game = sockets[1];
  game.open();
  game.receive({
    type: "welcome", playerId: 1, maps: [], music: [],
    account: { id: "tester", character: "bobo", hue: 0, nick: "tester", greeting: "", useId: true },
  });
  game.receive({ type: "lobby", channel: "test", rooms: [], users: [] });
  return { auth, game, ranking: lobbies[0].ranking };
}

describe("the ranking request's connection", () => {
  it("lets the carried session fade resume when the start screen already faded out", async () => {
    await inLobby();
    expect(lobbyFadeIn).toHaveBeenCalledWith(false);
    expect(fadeOver).toHaveBeenCalledWith(expect.anything(), null, true);
  });
  it("accepts the lobby ranking after the separate auth connection fails", async () => {
    const { auth, game, ranking } = await inLobby();
    const asked = ranking.page(1);
    const { requestId } = JSON.parse(game.sent.at(-1)!);
    auth.disconnect();
    expect(game.readyState).toBe(Socket.OPEN);
    game.receive({ type: "ranking", requestId, page: 1, rows: [{ rank: 1, id: "tester", cell: 100, wins: 1, level: 1, guild: -1, gender: 0 }] });
    expect(await asked).toBe(true);
    expect(ranking.rows[0].id).toBe("tester");
  });

  it("cancels the lobby ranking when the game connection fails", async () => {
    const { auth, game, ranking } = await inLobby();
    const asked = ranking.page(1);
    game.disconnect();
    expect(auth.readyState).toBe(Socket.OPEN);
    expect(await asked).toBe(false);
  });
});

describe("the assistive room slot after a server update", () => {
  const room = {
    code: "ABCD", number: 0, title: "test", hostId: 1, mapId: "test", music: 0, mode: 0,
    closed: [false, false, false, false, false, false], playing: false,
    players: [{ id: 1, slot: 0, name: "tester", character: "bobo", hue: 0, useId: true, ready: false, team: 1 }],
  };
  const slotButton = () => {
    const slots = elements.filter((element) => element.getAttribute("aria-label") === "자리").at(-1)!;
    const row = slots.children[1] as Element;
    return row.children.find((element) => element instanceof Element && element.tagName === "BUTTON") as Element;
  };

  it("keeps the selected slot for reopening after the close answer rebuilds its row", async () => {
    const { game } = await inLobby();
    game.receive({ type: "room", room });
    await Promise.resolve();
    const button = slotButton();
    button.focus();
    button.dispatchEvent(new Event("click"));
    expect(JSON.parse(game.sent.at(-1)!)).toEqual({ type: "set-slot", slot: 1, open: false });
    game.receive({ type: "room", room: { ...room, closed: [false, true, false, false, false, false] } });
    expect(dom.activeElement?.children).toContain("열기");
    dom.activeElement!.dispatchEvent(new Event("click"));
    expect(JSON.parse(game.sent.at(-1)!)).toEqual({ type: "set-slot", slot: 1, open: true });
  });

  it("does not move the keyboard to another slot when the selected one becomes occupied", async () => {
    const { game } = await inLobby();
    game.receive({ type: "room", room });
    slotButton().focus();
    game.receive({ type: "room", room: { ...room, players: [...room.players, { ...room.players[0], id: 2, slot: 1, name: "other" }] } });
    expect(dom.activeElement).toBe(dom.body);
  });
});

afterEach(() => {
  stop?.();
  stop = undefined;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("chat ignored under the kick notice", () => {
  async function inRoom() {
    const { game } = await inLobby();
    game.receive({ type: "room", room: {
      code: "ABCD", number: 0, title: "test", hostId: 2, mapId: "test", music: 0, mode: 0,
      closed: [false, false, true, true, true, true], playing: false,
      players: [1, 2].map((id, slot) => ({ id, slot, name: `test${id}`, character: "bobo", hue: 0, useId: true, ready: false, team: id })),
    } });
    await Promise.resolve();
    game.sent.length = 0;
    return { game, room: rooms[0] };
  }

  function kick(game: Socket) {
    game.receive({ type: "kick", slot: 0, ok: true });
    game.receive({ type: "room", room: null });
  }

  it.each(["canvas", "form"] as const)("does not remember an unsent %s line as the last sent line", async (input) => {
    const { game, room } = await inRoom();
    const clock = vi.spyOn(performance, "now").mockReturnValue(10_000);
    kick(game);
    if (input === "canvas") room.say("unsent line");
    else {
      elements.find((element) => element.attributes.get("id") === "room-chat")!.value = "unsent line";
      elements.find((element) => element.tagName === "FORM")!.dispatchEvent(new Event("submit", { cancelable: true }));
    }
    expect(game.sent).toEqual([]);
    room.kickedOut();
    clock.mockReturnValue(12_100);
    lobbies.at(-1)!.say("unsent line");
    expect(game.sent.map((text) => JSON.parse(text))).toEqual([{ type: "chat", text: "unsent line" }]);
  });

  it.each([
    { text: "/w friend hello", packet: { type: "whisper", to: "friend", text: "hello" } },
    { text: "/users", packet: { type: "users" } },
  ])("does not consume the timer of ignored $text", async ({ text, packet }) => {
    const { game, room } = await inRoom();
    vi.spyOn(performance, "now").mockReturnValue(10_000);
    kick(game);
    room.say(text);
    expect(game.sent).toEqual([]);
    room.kickedOut();
    lobbies.at(-1)!.say(text);
    expect(game.sent.map((message) => JSON.parse(message))).toEqual([packet]);
  });

  it("keeps the duplicate check for chat that was actually sent before the kick", async () => {
    const { game, room } = await inRoom();
    const clock = vi.spyOn(performance, "now").mockReturnValue(10_000);
    room.say("sent line");
    expect(game.sent.map((text) => JSON.parse(text))).toEqual([{ type: "chat", text: "sent line" }]);
    game.sent.length = 0;
    kick(game);
    clock.mockReturnValue(12_100);
    room.say("ignored line");
    room.kickedOut();
    clock.mockReturnValue(14_200);
    lobbies.at(-1)!.say("sent line");
    expect(game.sent).toEqual([]);
  });
});

async function loggedIn(channels: { name: string; colour: string }[] = []) {
  stop = mountOnline({} as Manifest);
  const view = views[0];
  view.actions.authConnect();
  const socket = sockets[0];
  socket.open();
  socket.receive({ type: "login", ok: true, account: { id: "tester" }, token: "test-session", channels });
  return { view, socket };
}

describe("program restart", () => {
  it("silences all old audio before opening the new logo", async () => {
    const { view, socket } = await loggedIn();
    view.actions.exit();

    expect(stopAll).toHaveBeenCalledOnce();
    expect(socket.readyState).toBe(3);
    expect(views.at(-1)!.begin).toBe("logo");
  });
});

describe("local match music before its assets load", () => {
  async function inLocalRoom(): Promise<void> {
    stop = mountOnline({
      characters: ["bobo", "doona"], maps: [{ id: "test", title: "test", objects: 0 }],
      music: [{ name: "tbwait22", role: "room", file: "tbwait22.flac", loopEnd: 3 }],
    } as unknown as Manifest);
    views[0].actions.local();
    await Promise.resolve();
    expect(playMusic).toHaveBeenCalledExactlyOnceWith({ file: "tbwait22.flac", loopEnd: 3 }, 10_000);
  }

  it("stops the room music before starting an unresolved scene load", async () => {
    localStart.mockImplementation(() => new Promise(() => undefined));
    await inLocalRoom();
    rooms[0].send({ type: "start" });
    expect(localStart).toHaveBeenCalledOnce();
    expect(stopMusic).toHaveBeenCalledOnce();
    expect(stopMusic.mock.invocationCallOrder[0]).toBeLessThan(localStart.mock.invocationCallOrder[0]);
    expect(gameScreens[0].loaded).not.toHaveBeenCalled();
  });

  it("leaves the waiting tune stopped when the scene load fails", async () => {
    localStart.mockRejectedValue(new Error("map unavailable"));
    await inLocalRoom();
    rooms[0].send({ type: "start" });
    await Promise.resolve();
    expect(gameScreens[0].failed).toHaveBeenCalledWith("시작하지 못했습니다: map unavailable");
    expect(stopMusic).toHaveBeenCalledOnce();
    expect(playMusic).toHaveBeenCalledOnce();
  });

  it("keeps the returned room music when a cancelled scene resolves later", async () => {
    let loaded!: (stop: () => void) => void;
    localStart.mockImplementation(() => new Promise((resolve) => { loaded = resolve; }));
    await inLocalRoom();
    rooms[0].send({ type: "start" });
    expect(stopMusic).toHaveBeenCalledOnce();
    gameScreens[0].exit();
    await Promise.resolve();
    expect(playMusic).toHaveBeenCalledTimes(2);
    const stopOld = vi.fn();
    loaded(stopOld);
    await Promise.resolve();
    expect(stopOld).toHaveBeenCalledOnce();
    expect(stopMusic).toHaveBeenCalledOnce();
    expect(gameScreens[0].loaded).not.toHaveBeenCalled();
  });
});

describe("the shared cursor when a connection or room request finishes", () => {
  const account = { id: "tester", character: "bobo", hue: 0, nick: "tester", greeting: "", useId: true };
  const room = {
    code: "ABCD", number: 0, title: "test", hostId: 1, mapId: "test", music: 0, mode: 0,
    closed: [false, false, false, false, false, false], playing: false,
    players: [{ id: 1, slot: 0, name: "tester", character: "bobo", hue: 0, useId: true, ready: false, team: 1 }],
  };

  it("ends the server row's busy cursor when the game server accepts its login", async () => {
    const { view } = await loggedIn();
    const cursor = view.cursor!;
    cursor.set(true);
    view.actions.connect();
    const game = sockets[1];
    game.open();
    game.receive({ type: "welcome", playerId: 1, maps: [], music: [], account });
    expect(cursor.busy).toBe(false);
  });

  it("ends the lobby wait before passing the same cursor into the accepted room", async () => {
    const { game } = await inLobby();
    const cursor = lobbies[0].cursor!;
    cursor.set(true); // The cursor selected by the pending lobby frame.
    game.receive({ type: "room", room });
    await Promise.resolve();
    expect(cursor.busy).toBe(false);
    expect(rooms.at(-1)!.cursor).toBe(cursor);
  });

  it("keeps a room's busy cursor when an unrelated roster update arrives", async () => {
    const { game } = await inLobby();
    game.receive({ type: "room", room });
    await Promise.resolve();
    const cursor = rooms.at(-1)!.cursor!;
    cursor.set(true);
    game.receive({ type: "room", room: { ...room, players: [...room.players] } });
    expect(cursor.busy).toBe(true);
  });

  it("ends the server row's equivalent wait before opening the local room", async () => {
    stop = mountOnline({ characters: ["bobo", "doona"], maps: [], music: [] } as unknown as Manifest);
    const view = views[0], cursor = view.cursor!;
    cursor.set(true);
    view.actions.local();
    await Promise.resolve();
    expect(cursor.busy).toBe(false);
    expect(rooms.at(-1)!.cursor).toBe(cursor);
  });
});

describe("server load query replies", () => {
  it.each([false, true])("ignores the old reply after a newer query (old timed out: %s)", async (timedOut) => {
    const { view, socket } = await loggedIn([{ name: "test", colour: "#fff" }]);
    view.actions.listServers();
    const first = JSON.parse(socket.sent.at(-1)!);
    if (timedOut) await vi.advanceTimersByTimeAsync(5001);
    view.actions.listServers();
    const newest = JSON.parse(socket.sent.at(-1)!);
    view.serverInfo.mockClear();

    socket.receive({ ...first, name: "test", load: 0 });
    expect(view.serverInfo).not.toHaveBeenCalled();
    socket.receive({ ...newest, name: "test", load: 50 });
    expect(view.serverInfo).toHaveBeenCalledTimes(1);
    expect(view.list.rows[0].load).toBe(50);
  });

  it("does not let the old timeout finish a newer query", async () => {
    const { view, socket } = await loggedIn([{ name: "test", colour: "#fff" }]);
    view.actions.listServers();
    await vi.advanceTimersByTimeAsync(2500);
    view.actions.listServers();
    const newest = JSON.parse(socket.sent.at(-1)!);
    await vi.advanceTimersByTimeAsync(2501);
    expect(view.serverInfo).not.toHaveBeenCalled();
    socket.receive({ ...newest, name: "test", load: 50 });
    expect(view.list.rows[0].load).toBe(50);
    expect(view.serverInfo).toHaveBeenCalledTimes(1);
  });
});

describe("an auth disconnect during a scene 5 save", () => {
  it.each(["status", "guild"] as const)("ends a pending %s save with the existing failure box", async (kind) => {
    const { view, socket } = await loggedIn();
    const sent = kind === "status"
      ? view.actions.saveStatus({ nick: "tester", greeting: "hello", useId: true })
      : view.actions.saveGuild(-1);
    expect(sent).toBe(true);
    expect(JSON.parse(socket.sent.at(-1)!).type).toBe(`set-${kind}`);

    socket.disconnect();
    expect(view.saveRefused).toHaveBeenCalledExactlyOnceWith(AUTH_FAILED);
    // The disconnect belongs to this connection, so an old close cannot end another operation.
    socket.dispatchEvent(new Event("close"));
    expect(view.saveRefused).toHaveBeenCalledTimes(1);
  });

  it("does not show a save failure when no save is pending", async () => {
    const { view, socket } = await loggedIn();
    socket.disconnect();
    expect(view.saveRefused).not.toHaveBeenCalled();
  });
});

describe("room reply cursor settings before view delivery", () => {
  const room = {
    code: "one", number: 0, title: "one", hostId: 1, mapId: "test", music: 0, mode: 0,
    closed: [false, true, false, false, false, false], playing: false,
    players: [{ id: 1, slot: 0, name: "tester", character: "bobo", hue: 0, useId: true, ready: false, team: 1 }],
  };
  const meta = JSON.parse(readFileSync(new URL("../../public/assets/image/cursor.json", import.meta.url), "utf8")) as SheetMeta;

  for (const ok of [false, true]) {
    for (const busy of [false, true]) {
      it(`applies kick ${ok ? "success" : "refusal"} with a ${busy ? "busy" : "normal"} cursor before assets load`, async () => {
        const { game } = await inLobby();
        const incoming = ok ? { ...room, players: [...room.players, { ...room.players[0], id: 2, slot: 1, name: "P2" }] } : room;
        game.receive({ type: "room", room: incoming });
        expect(rooms).toHaveLength(0);
        const cursor = views[0].cursor!;
        cursor.advance(0, meta); cursor.advance(7000 / 30, meta);
        if (busy) cursor.set(true);
        game.receive({ type: "kick", slot: ok ? 1 : 2, ok });
        expect(cursor.advance(8000 / 30, meta)).toEqual({ anim: 0, frame: 0 });
        expect(cursor.advance(14000 / 30, meta)).toEqual({ anim: 0, frame: 1 });
      });
    }
  }

  for (const change of ["slot", "team"] as const) {
    it(`resets an unchanged ${change} reply even with a normal cursor`, async () => {
      const { game } = await inLobby();
      game.receive({ type: "room", room });
      const cursor = views[0].cursor!;
      cursor.advance(0, meta); cursor.advance(7000 / 30, meta);
      game.receive({ type: "room", room: structuredClone(room), change } as ServerMessage);
      expect(cursor.advance(8000 / 30, meta)).toEqual({ anim: 0, frame: 0 });
      expect(cursor.advance(14000 / 30, meta)).toEqual({ anim: 0, frame: 1 });
    });

    it(`ends a later wait on an identical ${change} reply before the screen loads`, async () => {
      const { game } = await inLobby();
      game.receive({ type: "room", room });
      const cursor = views[0].cursor!;
      cursor.set(true);
      game.receive({ type: "room", room: structuredClone(room), change } as ServerMessage);
      expect(cursor.busy).toBe(false);
    });
  }

  it("keeps cursor progress and a pending wait for ordinary room snapshots", async () => {
    const { game } = await inLobby();
    game.receive({ type: "room", room });
    const cursor = views[0].cursor!;
    cursor.advance(0, meta); cursor.advance(7000 / 30, meta);
    game.receive({ type: "room", room: structuredClone(room) });
    expect(cursor.advance(8000 / 30, meta)).toEqual({ anim: 0, frame: 2 });
    cursor.set(true);
    game.receive({ type: "room", room: { ...room, music: 1 } });
    expect(cursor.busy).toBe(true);
  });
});
