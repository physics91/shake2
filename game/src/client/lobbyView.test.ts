import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { LobbyActions, LobbyState, LobbyView as View } from "./lobbyView.ts";
import type { LobbyScreenAssets } from "./lobbyScreen.ts";
import type { ClientMessage } from "../server/protocol.ts";

const { loadLobbyAssets, events, roomInfoAllowed, send } = vi.hoisted(() => ({
  loadLobbyAssets: vi.fn(), events: [] as string[], roomInfoAllowed: { value: true },
  send: vi.fn<(message: ClientMessage) => void>(),
}));

// The view's real request/reply methods run while its asset promise is held.
vi.mock("./lobbyScreen.ts", () => ({
  loadLobbyAssets,
  LobbyScreen: class {
    private readonly host: { send(message: ClientMessage): void };
    constructor(host: { send(message: ClientMessage): void }) { this.host = host; }
    get takesRoomInfo() { return roomInfoAllowed.value; }
    requestRoomInfo(code: string) {
      if (!this.takesRoomInfo) return false;
      events.push(`info popup ${code}`);
      this.host.send({ type: "room-info", code });
      return true;
    }
    setLog() {}
    update() {}
    joinRoom(room: LobbyState["rooms"][number]) { this.host.send({ type: "join-room", code: room.code }); }
    showUser(id: number) { events.push(`user popup ${id}`); return true; }
    waitForRoom() { events.push("wait"); }
    passwordAsked(code: string) { events.push(`password ${code}`); }
    showMessage(text: string) { events.push(`message ${text}`); }
    refused(text: string) { events.push(`refused ${text}`); }
    dispose() {}
  },
}));
vi.mock("./optionPanel.ts", () => ({ OptionPanel: class { root = {}; dispose() {} } }));
vi.mock("./shell.ts", () => ({ sounds: {} }));

class Element extends EventTarget {
  readonly children: (Element | string)[] = [];
  value = "";
  style = {};
  textContent = "";
  scrollHeight = 0;
  focus = vi.fn(() => { dom.activeElement = this; });
  blur = vi.fn(() => { if (dom.activeElement === this) dom.activeElement = dom.body; });
  attributes = new Map<string, string>();
  setAttribute(name: string, value: string) { this.attributes.set(name, value); }
  getAttribute(name: string) { return this.attributes.get(name) ?? null; }
  append(child: Element | string) { this.children.push(child); }
  contains(target: Element | null): boolean {
    return this === target || this.children.some((child) => child instanceof Element && child.contains(target));
  }
  replaceChildren(...children: (Element | string)[]) {
    if (this.children.some((child) => child instanceof Element && child.contains(dom.activeElement))) dom.activeElement = dom.body;
    this.children.splice(0, this.children.length, ...children);
  }
  querySelectorAll(selector: string): Element[] {
    const attribute = selector.slice(1, -1);
    return this.children.flatMap((child) => child instanceof Element
      ? [...(child.attributes.has(attribute) ? [child] : []), ...child.querySelectorAll(selector)] : []);
  }
  remove() {}
}

const dom = { body: new Element(), activeElement: null as Element | null, createElement: () => {
  const element = new Element();
  elements.push(element);
  return element;
} };

let ready: (assets: LobbyScreenAssets) => void;
let view: View;
const elements: Element[] = [];

beforeEach(async () => {
  events.length = 0;
  elements.length = 0;
  roomInfoAllowed.value = true;
  send.mockClear();
  loadLobbyAssets.mockReturnValue(new Promise<LobbyScreenAssets>((resolve) => { ready = resolve; }));
  dom.activeElement = dom.body;
  vi.stubGlobal("document", dom);
  const { LobbyView } = await import("./lobbyView.ts");
  const actions: LobbyActions = {
    send, say() {}, exit() {}, filterChanged() {},
    profile: { character: "bobo", hue: 0, nick: "tester", greeting: "", useId: true },
    account: () => null,
    saveCharacter() {}, saveGreeting() {}, saveNick() {}, whisperTo() {},
    settings: {} as LobbyActions["settings"],
    ranking: {} as LobbyActions["ranking"],
    notice: {} as LobbyActions["notice"],
  };
  view = new LobbyView({ playerId: 1, maps: [] }, {
    channel: "test", users: [],
    rooms: [{ code: "ABCD", number: 0, title: "test", mapId: "practice", mode: 0, players: 1, max: 6, playing: false, secret: false }],
  }, [], false, actions);
});

describe("the hidden room info control", () => {
  function clickInfo() {
    const button = elements.find((element) => element.attributes.get("aria-label")?.endsWith("번 방 정보"));
    expect(button).toBeDefined();
    button!.dispatchEvent(new Event("click"));
    return button!;
  }

  it("opens the canvas popup and sends its request once", async () => {
    await finishLoading();
    const button = clickInfo();
    expect(events).toEqual(["info popup ABCD"]);
    expect(send).toHaveBeenCalledExactlyOnceWith({ type: "room-info", code: "ABCD" });
    expect(button.blur).toHaveBeenCalledOnce();
  });

  it("waits for the canvas before opening the popup and asking for its data", async () => {
    const button = clickInfo();
    expect(send).not.toHaveBeenCalled();
    expect(button.blur).not.toHaveBeenCalled();
    await finishLoading();
    expect(events).toEqual(["info popup ABCD"]);
    expect(send).toHaveBeenCalledExactlyOnceWith({ type: "room-info", code: "ABCD" });
    expect(button.blur).toHaveBeenCalledOnce();
  });

  it("drops a queued click when the lobby is left before its pictures arrive", async () => {
    clickInfo();
    view.dispose();
    await finishLoading();
    expect(send).not.toHaveBeenCalled();
    expect(events).toEqual([]);
  });

  it("drops the same click that the canvas drops under another window or a wait", async () => {
    await finishLoading();
    roomInfoAllowed.value = false;
    clickInfo();
    expect(send).not.toHaveBeenCalled();
    expect(events).toEqual([]);
  });
});

afterEach(() => {
  view?.dispose();
  vi.unstubAllGlobals();
});

async function finishLoading() {
  ready({} as LobbyScreenAssets);
  await Promise.resolve();
}

describe("a room reply before the lobby pictures are ready", () => {
  it("opens the password popup after loading, with the preceding wait ended by that reply", async () => {
    view.waitForRoom();
    view.passwordAsked("ABCD");
    expect(events).toEqual([]);
    await finishLoading();
    expect(events).toEqual(["wait", "password ABCD"]);
  });

  it("ends the wait with the refusal, rather than just drawing its message", async () => {
    view.waitForRoom();
    view.refused("방을 찾을 수 없습니다");
    await finishLoading();
    expect(events).toEqual(["wait", "refused 방을 찾을 수 없습니다"]);
  });

  it("keeps notices and password replies in their received order", async () => {
    view.showMessage("notice");
    view.waitForRoom();
    view.passwordAsked("ABCD");
    await finishLoading();
    expect(events).toEqual(["message notice", "wait", "password ABCD"]);
  });

  it("delivers replies immediately after the screen is ready", async () => {
    await finishLoading();
    view.waitForRoom();
    view.passwordAsked("EFGH");
    expect(events).toEqual(["wait", "password EFGH"]);
  });

  it("discards late loading and replies when the lobby has been left", async () => {
    view.waitForRoom();
    view.dispose();
    view.passwordAsked("ABCD");
    await finishLoading();
    expect(events).toEqual([]);
  });
});

describe("keyboard focus when the lobby rosters are refreshed", () => {
  const room = { code: "ABCD", number: 0, title: "test", mapId: "practice", mode: 0 as const, players: 1, max: 6, playing: false, secret: false };
  const user = { id: 1, name: "tester", card: { nick: "tester", greeting: "", wins: 0, losses: 0, cell: 0, rank: 0, manner: 0, exp: 0, guild: -1, level: 1 } };
  const state: LobbyState = { channel: "test", rooms: [room], users: [user] };
  const find = (root: Element, predicate: (element: Element) => boolean): Element | undefined => {
    if (predicate(root)) return root;
    for (const child of root.children) {
      if (child instanceof Element) {
        const found = find(child, predicate);
        if (found) return found;
      }
    }
  };
  const label = (text: string) => find(view.root as unknown as Element, (element) => element.getAttribute("aria-label") === text)!;
  const join = () => find(view.root as unknown as Element, (element) => element.children.includes("참가"))!;

  it("keeps the same user's information control through reordering and a name change", async () => {
    await finishLoading();
    view.update(state);
    label("tester 정보").focus();
    view.update({ ...state, users: [{ ...user, id: 2, name: "other" }, { ...user, name: "renamed" }] });
    expect(dom.activeElement).toBe(label("renamed 정보"));
    dom.activeElement!.dispatchEvent(new Event("click"));
    expect(events).toEqual(["user popup 1"]);
  });

  it.each(["join", "info"])("keeps the room's %s control when its number and list position change", async (action) => {
    await finishLoading();
    view.update(state);
    (action === "join" ? join() : label("001번 방 정보")).focus();
    view.update({ ...state, rooms: [{ ...room, number: 4, title: "changed", players: 2 }, { ...room, code: "OTHER", number: 0 }] });
    const control = action === "join" ? join() : label("005번 방 정보");
    expect(dom.activeElement).toBe(control);
    control.dispatchEvent(new Event("click"));
    expect(send).toHaveBeenCalledExactlyOnceWith({ type: action === "join" ? "join-room" : "room-info", code: "ABCD" });
  });

  it.each(["user", "room"])("does not focus a replacement when the selected %s is gone", (kind) => {
    view.update(state);
    (kind === "user" ? label("tester 정보") : label("001번 방 정보")).focus();
    view.update({ ...state, rooms: [{ ...room, code: "NEW" }], users: [{ ...user, id: 2 }] });
    expect(dom.activeElement).toBe(dom.body);
  });

  it("leaves a text editor's focus and draft alone during roster updates", () => {
    const input = find(view.root as unknown as Element, (element) => element.getAttribute("id") === "lobby-title")!;
    input.value = "draft";
    input.focus();
    view.update(state);
    expect(dom.activeElement).toBe(input);
    expect(input.value).toBe("draft");
  });
});
