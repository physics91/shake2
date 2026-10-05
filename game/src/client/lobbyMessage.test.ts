import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { LobbyScreen, type LobbyScreenOptions } from "./lobbyScreen.ts";
import { RoomScreen, type RoomScreenOptions } from "./roomScreen.ts";
import { localRoom } from "./localRoom.ts";
import { CREATE, CREATE_POPUP, LOBBY_SCROLL, MESSAGE_BOX, MY_INFO, PASSWORD_POPUP, REMOTE, REMOTE_POPUP } from "./lobbyLayout.ts";
import { GREETING_POPUP, MY_INFO_BUTTONS } from "./myInfoLayout.ts";
import { SCROLL_DOWN } from "./roomLayout.ts";
import { ITEM_NICK } from "../server/items.ts";
import type { OwnAccount, RoomSummary } from "../server/protocol.ts";
import { CHECKS, KEY_BOXES, macroBox } from "./optionLayout.ts";
import { RANKING_BUTTONS, RANKING_POPUP } from "./rankingWindowLayout.ts";
import { SettingsStore } from "./settings.ts";
import { outlinedText } from "./text.ts";

vi.mock("./screenCapture.ts", () => ({ attachCapture: () => () => undefined }));
vi.mock("./tintArt.ts", () => ({ loadTintedSheet: () => Promise.reject(new Error("unused portrait")) }));
vi.mock("./text.ts", async (original) => ({
  ...await original<typeof import("./text.ts")>(), outlinedText: vi.fn(), plainText() {},
}));

const context = { drawImage() {}, fillRect() {}, save() {}, restore() {}, measureText: () => ({ width: 0 }) };
const cursor = { image: {}, meta: { animations: [{ unknown_u16: 5, frames: [{ rect: [0, 0, 1, 1], anchor: [0, 0] }] }] } };
class Element extends EventTarget {
  readonly attributes = new Map<string, string>();
  readonly children: Element[] = [];
  readonly style = {};
  value = "";
  selectionStart = 0;
  readonly tagName: string;
  constructor(tagName: string) { super(); this.tagName = tagName.toUpperCase(); }
  setAttribute(name: string, value: string) { this.attributes.set(name, value); }
  append(element: Element) { this.children.push(element); }
  contains(element: Element) { return this.children.includes(element); }
  setSelectionRange(start: number, _end: number) { this.selectionStart = start; }
  focus() { dom.activeElement = this; }
  blur() { if (dom.activeElement === this) dom.activeElement = dom.body; }
  remove() { this.blur(); }
  getContext() { return context; }
  getBoundingClientRect() { return { left: 0, top: 0, width: 800, height: 600 }; }
}
const dom = {
  body: new Element("body"), activeElement: null as Element | null,
  createElement: (tag: string) => new Element(tag), hasFocus: () => true,
};
let now: number;
let stage: Element;
let canvas: Element;
let lobby: LobbyScreen | undefined;
let room: RoomScreen | undefined;
let frames: Map<number, FrameRequestCallback>;
const say = vi.fn();
const send = vi.fn();

beforeEach(() => {
  now = 0;
  stage = new Element("div");
  canvas = new Element("canvas");
  frames = new Map();
  let nextFrame = 0;
  dom.activeElement = dom.body;
  vi.stubGlobal("document", dom);
  vi.stubGlobal("window", new EventTarget());
  vi.stubGlobal("HTMLElement", Element);
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { frames.set(++nextFrame, callback); return nextFrame; });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
  vi.spyOn(performance, "now").mockImplementation(() => now);
  vi.mocked(outlinedText).mockClear();
  say.mockClear();
  send.mockClear();
});
afterEach(() => {
  lobby?.dispose(); room?.dispose(); lobby = undefined; room = undefined;
  vi.restoreAllMocks(); vi.unstubAllGlobals();
});

function enterLobby(overrides: Partial<LobbyScreenOptions> = {}, rooms: RoomSummary[] = []): SettingsStore {
  const settings = new SettingsStore({ get: () => null, set() {} });
  lobby = new LobbyScreen({
    canvas, stage, assets: { cursor }, maps: [], waitingOnly: false,
    profile: { character: "bobo", hue: 0, nick: "tester", greeting: "", useId: true },
    settings,
    ranking: { windowPage: 1, rows: [], page: async () => true },
    account: () => null, notice: { draw() {} }, sounds: { play() {} }, send, say,
    ...overrides,
  } as unknown as LobbyScreenOptions, { channel: "test", rooms, users: [] });
  return settings;
}
function enterRoom(): void {
  room = new RoomScreen({
    canvas, stage, assets: { cursor }, playerId: 1, maps: [], music: [], say, send,
    settings: new SettingsStore({ get: () => null, set() {} }), sounds: { play() {} },
  } as unknown as RoomScreenOptions, localRoom({ maps: [], music: [] }, ["bobo", "doona"]));
}
function draw(at = now): void {
  now = at;
  vi.mocked(outlinedText).mockClear();
  const callbacks = [...frames.values()]; frames.clear();
  for (const callback of callbacks) callback(at);
}
function click([left, top, right, bottom]: readonly number[]): void {
  for (const type of ["pointerdown", "pointerup"]) {
    const event = new Event(type, { cancelable: true });
    Object.assign(event, { pointerId: 1, isPrimary: true, button: 0, buttons: type === "pointerdown" ? 1 : 0,
      clientX: (left + right) / 2, clientY: (top + bottom) / 2 });
    canvas.dispatchEvent(event);
  }
}
function field(label: string): Element {
  const input = stage.children.find((element) => element.attributes.get("aria-label") === label);
  if (!input) throw new Error(`missing ${label}`);
  return input;
}
function type(input: Element, value: string): void {
  input.value = value; input.setSelectionRange(value.length, value.length);
  input.dispatchEvent(new Event("input"));
}
function key(key: string, type = "keydown", keyCode = key === "Enter" ? 13 : 0, code = key): Event {
  const event = new Event(type, { cancelable: true });
  Object.assign(event, { key, code, keyCode });
  dom.activeElement?.dispatchEvent(event);
  window.dispatchEvent(event);
  return event;
}
function drawnTitle(): string | undefined {
  const at = CREATE_POPUP.title.text;
  return vi.mocked(outlinedText).mock.calls.findLast(([, , x, y]) => x === at.x && y === at.y)?.[1];
}

describe("IME reopening the lobby's closed chat line", () => {
  function closeChat(): Element {
    enterLobby(); click(REMOTE.hit); key("Escape");
    expect(dom.activeElement).toBe(dom.body);
    return field("채팅");
  }

  it.each([false, true])("keeps the first Hangul input after the remote's Esc, with help=%s", (help) => {
    const chat = closeChat();
    if (help) key("F1");
    const process = key("Process", "keydown", 229, "KeyR");
    expect(process.defaultPrevented).toBe(false);
    expect(dom.activeElement).toBe(chat);
    type(chat, "한");
    if (help) key("Escape");
    key("Enter");
    expect(say).toHaveBeenCalledExactlyOnceWith("한");
  });

  it("leaves the closed chat alone while the remote is open", () => {
    enterLobby(); click(REMOTE.hit);
    key("Process", "keydown", 229, "KeyR");
    expect(dom.activeElement).toBe(dom.body);
    expect(say).not.toHaveBeenCalled();
  });

  it("leaves an assistive text field focused when IME input starts there", () => {
    closeChat();
    const outside = new Element("input"); outside.focus();
    key("Process", "keydown", 229, "KeyR");
    expect(dom.activeElement).toBe(outside);
    expect(say).not.toHaveBeenCalled();
  });
});

describe("returning from assistive controls to canvas chat", () => {
  it.each(["lobby", "closed lobby", "room"])("sends the visible line after returning to %s", (kind) => {
    if (kind === "room") enterRoom(); else enterLobby();
    const input = field("채팅");
    if (kind === "closed lobby") { click(REMOTE.hit); key("Escape"); }
    else { type(input, "abc"); input.setSelectionRange(2, 2); }
    new Element("input").focus(); click([299, 539, 301, 541]);
    // The remote's Esc leaves chat closed; returning to the canvas gives the next key to the game.
    expect(dom.activeElement).toBe(kind === "closed lobby" ? dom.body : input);
    expect(input.selectionStart).toBe(kind === "closed lobby" ? 0 : 2);
    const character = key("X");
    if (dom.activeElement === input && !character.defaultPrevented) {
      const caret = input.selectionStart;
      type(input, input.value.slice(0, caret) + "X" + input.value.slice(caret));
    }
    const expected = kind === "closed lobby" ? "X" : "abXc";
    expect(input.value).toBe(expected); key("Enter");
    expect(say).toHaveBeenCalledExactlyOnceWith(expected);
  });

  it.each(["lobby", "room"])("returns to %s chat when its scroll button is clicked", (kind) => {
    if (kind === "room") enterRoom(); else enterLobby();
    const input = field("채팅"); type(input, "abc"); input.setSelectionRange(2, 2);
    new Element("input").focus(); click(kind === "room" ? SCROLL_DOWN.hit : LOBBY_SCROLL.down.hit);
    expect(dom.activeElement).toBe(input); expect(input.selectionStart).toBe(2); expect(input.value).toBe("abc");
  });

  it.each(["lobby help", "lobby message", "lobby busy", "room help", "room kicked"])("leaves assistive focus when %s blocks the click", (overlay) => {
    if (overlay.startsWith("room")) enterRoom(); else enterLobby();
    if (overlay.endsWith("help")) key("F1");
    else if (overlay.endsWith("message")) lobby!.showMessage("notice");
    else if (overlay.endsWith("busy")) lobby!.waitForRoom();
    else room!.showKicked();
    const outside = new Element("input"); outside.focus(); click([299, 539, 301, 541]);
    expect(dom.activeElement).toBe(outside);
  });

  it("keeps the new popup's title editor focused after the lobby's CREATE", () => {
    enterLobby(); type(field("채팅"), "old"); new Element("input").focus(); click(CREATE.hit);
    expect(dom.activeElement).toBe(field("방 제목")); expect(field("채팅").value).toBe("");
  });

  it("returns to room chat under EXIT without publishing the held record before NO", () => {
    enterRoom(); const input = field("채팅"); type(input, "old"); key("Escape"); type(input, "queued");
    new Element("input").focus(); click([299, 539, 301, 541]);
    expect(dom.activeElement).toBe(input); expect(input.value).toBe("queued");
    const chat = (room as unknown as { chat: { view(): { text: string } } }).chat;
    expect(chat.view().text).toBe("old"); key("n"); expect(room!.boxUp).toBe(false);
    expect(chat.view().text).toBe("old"); key("Enter"); expect(say).toHaveBeenCalledExactlyOnceWith("queued");
  });
});

describe("returning from assistive fields to lobby popup editors", () => {
  type Editor = "title" | "secret" | "greeting" | "nickname" | "password";
  const saveGreeting = vi.fn(), saveNick = vi.fn();
  function openEditor(kind: Editor): Element {
    saveGreeting.mockClear(); saveNick.mockClear();
    enterLobby({ saveGreeting, saveNick, account: () => ({ items: [ITEM_NICK] }) as OwnAccount }, [
      { code: "secret-room", number: 0, title: "Secret", mapId: "random", mode: 0,
        players: 1, max: 6, playing: false, secret: true },
    ]);
    if (kind === "title" || kind === "secret") {
      click(CREATE.hit);
      if (kind === "secret") {
        type(field("방 제목"), "Room"); click(CREATE_POPUP.secret.check.hit); click(CREATE_POPUP.password.hit);
      }
    } else if (kind === "password") click([99, 109, 101, 111]);
    else {
      click(MY_INFO.hit);
      click(kind === "greeting" ? MY_INFO_BUTTONS.greeting.hit : [337, 247, 339, 249]);
    }
    return field({ title: "방 제목", secret: "비밀방 비밀번호", greeting: "인사말",
      nickname: "닉네임 (Enter 저장, Esc 취소)", password: "방 비밀번호 (Enter 확인, Esc 취소)" }[kind]);
  }
  function returnClick(kind: Editor): void {
    click(kind === "greeting" ? [339, 284, 341, 286] : kind === "nickname" ? [339, 294, 341, 296]
      : kind === "password" ? [299, 269, 301, 271] : [299, 319, 301, 321]);
  }

  it.each<Editor>(["title", "secret", "greeting", "nickname", "password"])("keeps the caret and sends the first character after returning to %s", (kind) => {
    const input = openEditor(kind); type(input, "abc"); input.setSelectionRange(2, 2);
    new Element("input").focus(); returnClick(kind);
    expect(dom.activeElement).toBe(input); expect(input.selectionStart).toBe(2);
    const character = key("X");
    if (dom.activeElement === input && !character.defaultPrevented) {
      const caret = input.selectionStart;
      type(input, input.value.slice(0, caret) + "X" + input.value.slice(caret));
    }
    expect(input.value).toBe("abXc"); key("Enter");
    if (kind === "greeting") expect(saveGreeting).toHaveBeenCalledExactlyOnceWith("abXc");
    else if (kind === "nickname") expect(saveNick).toHaveBeenCalledExactlyOnceWith("abXc");
    else if (kind === "password") expect(send).toHaveBeenLastCalledWith({ type: "join-room", code: "secret-room", password: "abXc" });
    else expect(send).toHaveBeenLastCalledWith({ type: "create-room", title: kind === "title" ? "abXc" : "Room",
      ...(kind === "secret" && { password: "abXc" }) });
  });

  it.each<Editor>(["title", "greeting", "password"])("does not refocus a %s editor closed by cancellation", (kind) => {
    const input = openEditor(kind); type(input, "abc"); new Element("input").focus();
    click(kind === "title" ? CREATE_POPUP.cancel.hit : kind === "greeting" ? GREETING_POPUP.cancel.hit : PASSWORD_POPUP.cancel.hit);
    expect(dom.activeElement).not.toBe(input); expect(input.value).toBe("");
    expect(send).not.toHaveBeenCalled(); expect(saveGreeting).not.toHaveBeenCalled();
  });

  it.each(["help", "message", "busy"])("keeps assistive focus when %s drops a popup click", (overlay) => {
    const kind = overlay === "busy" ? "nickname" : "title";
    openEditor(kind);
    if (overlay === "help") key("F1");
    else if (overlay === "message") lobby!.showMessage("notice");
    else lobby!.waitForRoom();
    const outside = new Element("input"); outside.focus(); returnClick(kind);
    expect(dom.activeElement).toBe(outside);
  });

  it("returns to the title when the disabled secret-password field is clicked", () => {
    const title = openEditor("title"); type(title, "abc"); title.setSelectionRange(2, 2);
    new Element("input").focus(); click(CREATE_POPUP.password.hit);
    expect(dom.activeElement).toBe(title); expect(title.selectionStart).toBe(2);
  });
});

describe("lobby message editor copies", () => {
  it.each(["macro", "friend"])("returns to the %s editor after a canvas click leaves an assistive field", (kind) => {
    const settings = enterLobby(); click(REMOTE.hit); click(REMOTE_POPUP.buttons[1].hit);
    lobby!.friendsAnswered([], true);
    click(kind === "macro" ? macroBox(0).hit : [409, 201, 534, 217]);
    const input = field(kind === "macro" ? "단축 메시지" : "친구 아이디");
    type(input, "abc"); input.setSelectionRange(2, 2);
    const outside = new Element("input"); outside.focus();
    click(kind === "macro" ? CHECKS.music.hit : [649, 319, 651, 321]);
    expect(dom.activeElement).toBe(input);
    expect(input.selectionStart).toBe(2);
    const character = key("X");
    if (dom.activeElement === input && !character.defaultPrevented) {
      const caret = input.selectionStart;
      type(input, input.value.slice(0, caret) + "X" + input.value.slice(caret));
    }
    expect(input.value).toBe("abXc");
    key("Enter");
    if (kind === "macro") {
      key("Enter");
      expect(settings.current.macros[1]).toBe("abXc");
    } else expect(send).toHaveBeenLastCalledWith({ type: "add-friend", name: "abXc" });
  });

  it.each(["help", "message"])("keeps assistive focus when %s drops the canvas click", (overlay) => {
    enterLobby(); click(REMOTE.hit); click(REMOTE_POPUP.buttons[1].hit);
    lobby!.friendsAnswered([], true); click(macroBox(0).hit);
    if (overlay === "help") key("F1");
    else lobby!.showMessage("notice");
    const outside = new Element("input"); outside.focus();
    click(CHECKS.music.hit);
    expect(dom.activeElement).toBe(outside);
  });

  it("leaves the macro editor closed when the click starts a key change", () => {
    enterLobby(); click(REMOTE.hit); click(REMOTE_POPUP.buttons[1].hit);
    lobby!.friendsAnswered([], true); click(macroBox(0).hit);
    const input = field("단축 메시지"); type(input, "abc");
    new Element("input").focus(); click(KEY_BOXES[0].hit);
    expect(dom.activeElement).toBe(dom.body);
    expect(input.value).toBe("");
  });

  it.each(["Tab", "click"])("reloads the create fields after %s returns to them", (action) => {
    enterLobby(); click(CREATE.hit); click(CREATE_POPUP.secret.check.hit);
    const title = field("방 제목"), password = field("비밀방 비밀번호");
    type(title, "abc"); title.setSelectionRange(2, 2);
    if (action === "Tab") key("Tab"); else click(CREATE_POPUP.password.hit);
    type(password, "pw"); password.setSelectionRange(1, 1);
    if (action === "Tab") key("Tab"); else click(CREATE_POPUP.title.hit);
    expect(title.selectionStart).toBe(3);
    if (action === "Tab") key("Tab"); else click(CREATE_POPUP.password.hit);
    expect(password.selectionStart).toBe(2);
  });

  it("leaves the title caret in place when the secret check turns on", () => {
    enterLobby(); click(CREATE.hit);
    const title = field("방 제목"); type(title, "abc"); title.setSelectionRange(2, 2);
    click(CREATE_POPUP.secret.check.hit);
    expect(dom.activeElement).toBe(title); expect(title.selectionStart).toBe(2);
  });

  it.each(["clear", "message"])("keeps a saved macro after an external reload while %s", (overlay) => {
    const settings = enterLobby(); click(REMOTE.hit); click(REMOTE_POPUP.buttons[1].hit);
    lobby!.friendsAnswered([], true); click(macroBox(0).hit);
    const input = field("단축 메시지"); type(input, "old"); draw();
    if (overlay === "message") {
      lobby!.showMessage("이미 시작 되었습니다."); type(input, "oldqueued");
    }
    const macros = [...settings.current.macros]; macros[1] = "new";
    settings.save({ ...settings.current, macros }); draw();
    expect(input.value).toBe("new");
    type(input, `${input.value}!`); key("Enter"); key("Enter");
    expect(settings.current.macros[1]).toBe(overlay === "clear" ? "new!" : "new");
  });

  it.each(["macro", "friend"])("keeps %s text typed under help when a server message arrives", (kind) => {
    enterLobby(); click(REMOTE.hit); click(REMOTE_POPUP.buttons[1].hit);
    lobby!.friendsAnswered([], true);
    click(kind === "macro" ? macroBox(0).hit : [409, 201, 534, 217]);
    const input = field(kind === "macro" ? "단축 메시지" : "친구 아이디");
    type(input, "old"); draw();
    key("F1"); type(input, "oldabc"); draw();
    lobby!.refused("방을 찾을 수 없습니다");
    key("Enter");
    if (kind === "macro") {
      key("Enter");
      const settings = (lobby as unknown as { options: { settings: SettingsStore } }).options.settings;
      expect(settings.current.macros[1]).toBe("oldabc");
    } else expect(send).toHaveBeenLastCalledWith({ type: "add-friend", name: "oldabc" });
  });

  it("drops uncopied create fields when Tab replaces the shared editor", () => {
    enterLobby(); click(CREATE.hit); click(CREATE_POPUP.secret.check.hit);
    const title = field("방 제목"), password = field("비밀방 비밀번호");
    type(title, " bad"); key("Enter"); type(title, "abc");
    key("Tab"); expect(dom.activeElement).toBe(password);
    expect(title.value).toBe("");
    type(password, "queued"); key("Tab");
    expect(dom.activeElement).toBe(title); expect(password.value).toBe("");
    draw(MESSAGE_BOX.hideMs); key("ArrowLeft"); draw();
    expect(drawnTitle()).toBe("");
  });

  it.each(["timer", "Escape", "button"])("keeps a rejected title hidden until the next editor key after %s", (close) => {
    enterLobby(); click(CREATE.hit);
    const title = field("방 제목");
    type(title, " bad"); key("Enter");
    type(title, "abc"); draw();
    expect(title.value).toBe("abc");
    expect(drawnTitle()).toBe("");
    if (close === "timer") draw(MESSAGE_BOX.hideMs);
    else if (close === "Escape") key("Escape");
    else click(MESSAGE_BOX.button.hit);
    draw();
    expect(drawnTitle()).toBe("");
    key("Shift", "keyup"); draw();
    expect(drawnTitle()).toBe("");
    key("ArrowLeft"); draw();
    expect(drawnTitle()).toBe("abc");
  });

  it.each(["macro", "friend"])("does not publish the %s automatically when the message timer ends", (kind) => {
    enterLobby(); click(REMOTE.hit); click(REMOTE_POPUP.buttons[1].hit);
    lobby!.friendsAnswered([], true);
    click(kind === "macro" ? macroBox(0).hit : [409, 201, 534, 217]);
    const input = field(kind === "macro" ? "단축 메시지" : "친구 아이디"); type(input, "old"); draw();
    // An asynchronous reply's box can arrive while a macro is being edited.
    lobby!.refused("방을 찾을 수 없습니다");
    type(input, "oldabc"); draw();
    const option = (lobby as unknown as { option: { window: { macros: string[]; popup: { name: string } | null } } }).option;
    const record = () => kind === "macro" ? option.window.macros[1] : option.window.popup?.name;
    expect(record()).toBe("old");
    draw(MESSAGE_BOX.hideMs); draw();
    expect(record()).toBe("old");
    key("ArrowLeft"); draw();
    expect(record()).toBe("oldabc");
  });

  it("keeps the ranking popup's displayed ID through a message timer", async () => {
    enterLobby(); click(REMOTE.hit); click(REMOTE_POPUP.buttons[0].hit);
    await Promise.resolve(); await Promise.resolve();
    click(RANKING_BUTTONS.find.hit);
    const id = field("찾을 아이디 (Enter 찾기, Esc 취소)"); type(id, "old");
    lobby!.refused("방을 찾을 수 없습니다"); type(id, "oldabc");
    const drawnId = () => vi.mocked(outlinedText).mock.calls.findLast(([, , x, y]) => x === RANKING_POPUP.text.x && y === RANKING_POPUP.text.y)?.[1];
    draw(); expect(drawnId()).toBe("old");
    draw(MESSAGE_BOX.hideMs); draw(); expect(drawnId()).toBe("old");
    key("ArrowLeft"); draw(); expect(drawnId()).toBe("oldabc");
  });

  it.each(["open", "expired"])("sends the copied chat record when the message is %s", (state) => {
    enterLobby(); const chat = field("채팅"); type(chat, "old");
    lobby!.showMessage("이미 시작 되었습니다."); type(chat, "oldabc");
    if (state === "expired") draw(MESSAGE_BOX.hideMs);
    key("Enter");
    expect(say).toHaveBeenCalledExactlyOnceWith(state === "open" ? "old" : "oldabc");
  });
});

it("keeps the kicked room's chat record while its editor still takes characters", () => {
  room = new RoomScreen({ canvas, stage, assets: {}, playerId: 1, maps: [], music: [], say } as unknown as RoomScreenOptions,
    localRoom({ maps: [], music: [] }, ["bobo", "doona"]));
  const chat = field("채팅"); type(chat, "old");
  room.showKicked(); type(chat, "oldabc");
  const line = (room as unknown as { chat: { view(): { text: string; caret: number } } }).chat;
  expect(chat.value).toBe("oldabc");
  expect(line.view()).toEqual({ text: "old", caret: 3 });
  key("Enter");
  expect(say).toHaveBeenCalledExactlyOnceWith("old");
});
