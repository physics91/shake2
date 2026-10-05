import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setMaxListeners } from "node:events";

import { StartScreen, type ServerList, type StartScreenOptions } from "./startScreen.ts";
import { newStatusState } from "./statusScreen.ts";
import { SettingsStore } from "./settings.ts";
import { LOGIN, newSlide, SERVER_BUTTONS } from "./startLayout.ts";
import { plainText } from "./text.ts";
import { FIELDS, RANKING, STATUS_BUTTONS } from "./statusLayout.ts";
import { SIGN_UP_BOXES, SIGN_UP_BUTTONS, SIGN_UP_FIELDS } from "./signUpLayout.ts";
import { MESSAGE_BOX } from "./lobbyLayout.ts";

vi.mock("./screenCapture.ts", () => ({ attachCapture: () => () => undefined }));
vi.mock("./tintArt.ts", () => ({ loadTintedSheet: () => Promise.reject(new Error("unused portrait")) }));
vi.mock("./text.ts", async (original) => ({ ...await original<typeof import("./text.ts")>(), outlinedText() {}, plainText: vi.fn(), fitText: (_ctx: unknown, text: string) => text }));

class Element extends EventTarget {
  readonly attributes = new Map<string, string>();
  readonly children: Element[] = [];
  readonly style = {};
  readonly tagName: string;
  value = "";
  selectionStart = 0;
  readOnly = false;
  constructor(tag: string) { super(); this.tagName = tag.toUpperCase(); }
  setAttribute(name: string, value: string) { this.attributes.set(name, value); }
  append(element: Element) { this.children.push(element); }
  contains(element: Element) { return this.children.includes(element); }
  setSelectionRange(start: number, _end: number) { this.selectionStart = start; }
  focus() { dom.activeElement = this; }
  blur() { if (dom.activeElement === this) dom.activeElement = dom.body; }
  remove() { this.blur(); }
  getContext() { return { canvas: this, drawImage() {}, fillRect() {}, save() {}, restore() {} }; }
  getBoundingClientRect() { return { left: 0, top: 0, width: 800, height: 600 }; }
}
class Input extends Element {
  constructor() { super("input"); }
}
const dom = {
  body: new Element("body"), activeElement: null as Element | null,
  createElement: (tag: string) => tag === "input" ? new Input() : new Element(tag), hasFocus: () => true,
};
let stage: Element;
let canvas: Element;
let screen: StartScreen | undefined;
let now: number;
let frames: Map<number, FrameRequestCallback>;
const login = vi.fn(() => "sent" as const);
const check = vi.fn(() => true);
const register = vi.fn(() => true);
const connect = vi.fn();
const exit = vi.fn();

beforeEach(() => {
  now = 0; stage = new Element("div"); canvas = new Element("canvas"); frames = new Map();
  dom.activeElement = dom.body;
  login.mockClear(); check.mockClear(); register.mockClear(); connect.mockClear(); exit.mockClear(); vi.mocked(plainText).mockClear();
  let nextFrame = 0;
  const testWindow = new EventTarget();
  // StartScreen has thirteen real editor focus listeners; browsers have no ten-listener warning.
  setMaxListeners(20, testWindow);
  vi.stubGlobal("document", dom); vi.stubGlobal("window", testWindow);
  vi.stubGlobal("HTMLElement", Element); vi.stubGlobal("HTMLInputElement", Input);
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { frames.set(++nextFrame, callback); return nextFrame; });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
  vi.spyOn(performance, "now").mockImplementation(() => now);
});
afterEach(() => { screen?.dispose(); screen = undefined; vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function frame(at: number): void {
  now = at; const callbacks = [...frames.values()]; frames.clear();
  for (const callback of callbacks) callback(at);
}
function start(begin: "login" | "status" | "servers", savedId = "", list: ServerList = { slide: newSlide(), rows: [], selected: -1 }): SettingsStore {
  const banner = { image: {}, meta: { animations: [{ unknown_u16: 5, frames: [{ rect: [0, 0, 1, 1], anchor: [0, 0] }] }] } };
  const settings = new SettingsStore({ get: () => null, set() {} });
  screen = new StartScreen({
    canvas, stage, begin, savedId,
    assets: { cursor: banner, status: { guilds: [], banner } }, status: newStatusState("bobo"),
    settings,
    list,
    sounds: { play() {}, unlock() {} }, account: () => null, authConnect() {},
    login, check, register, connect, exit, saveStatus: () => true,
    ranking: { rows: [], windowPage: 1, page: async () => false, search: async () => false },
  } as unknown as StartScreenOptions);
  frame(400);
  return settings;
}
function field(label: string): Element {
  const input = stage.children.find((element) => element.attributes.get("aria-label") === label);
  if (!input) throw new Error(`missing ${label}`);
  return input;
}
function type(label: string, value: string): void {
  const input = field(label); input.value = value; input.setSelectionRange(value.length, value.length);
  input.dispatchEvent(new Event("input"));
}
function press(key: string, shiftKey = false, keyCode = key === "Tab" ? 9 : key === "Enter" ? 13 : 0): Event {
  const event = new Event("keydown", { cancelable: true });
  Object.assign(event, { key, code: key, shiftKey, keyCode });
  dom.activeElement?.dispatchEvent(event); window.dispatchEvent(event); return event;
}
function overlay(kind: "message" | "help"): void {
  if (kind === "message") screen!.showMessage("notice");
  else press("F1");
}

function held(code: string, type = "keydown"): void {
  const event = new Event(type, { cancelable: true });
  Object.assign(event, { key: code.slice(3).toLowerCase(), code });
  window.dispatchEvent(event);
}

function click([left, top, right, bottom]: readonly number[]): void {
  for (const type of ["pointerdown", "pointerup"]) {
    const event = new Event(type, { cancelable: true });
    Object.assign(event, { pointerId: 1, isPrimary: true, button: 0, buttons: type === "pointerdown" ? 1 : 0,
      clientX: (left + right) / 2, clientY: (top + bottom) / 2 });
    canvas.dispatchEvent(event);
  }
}

describe("server rows beyond the original forty positions", () => {
  function list(count = 80): ServerList {
    return { slide: newSlide(), selected: -1, rows: [
      ...Array.from({ length: count }, (_, channel) => ({ name: `channel${channel}`, channel, load: 0, ping: 0, colour: "#ffffff" })),
      { name: "2인 대전", local: true, load: 0, ping: 0, colour: "#ffffff" },
    ] };
  }
  function finishSlide(): void { for (let i = 0; i < 20; i++) frame(now + 34); }
  function names(): string[] {
    vi.mocked(plainText).mockClear(); frame(now + 34);
    return [...new Set(vi.mocked(plainText).mock.calls.map(([, text]) => text).filter((text) => text.startsWith("channel") || text === "2인 대전"))];
  }
  function refresh(): void { click(SERVER_BUTTONS.refresh.hit); finishSlide(); }

  it("draws and selects all eighty channels and the local row on separate pages", () => {
    const state = list(); start("servers", "", state); finishSlide();
    expect(names()).toEqual(state.rows.slice(0, 40).map((row) => row.name));
    click([514, 484, 726, 499]); expect(state.selected).toBe(39);
    refresh(); expect(state.slide.open).toBe(false);
    refresh(); expect(state.selected).toBe(-1);
    expect(names()).toEqual(state.rows.slice(40, 80).map((row) => row.name));
    click([76, 142, 288, 157]); expect(state.selected).toBe(40);
    refresh(); refresh(); expect(names()).toEqual(["2인 대전"]);
    click([514, 142, 726, 157]); expect(state.selected).toBe(-1);
    click([76, 142, 288, 157]); click([76, 142, 288, 157]);
    expect(state.selected).toBe(80); expect(connect).toHaveBeenCalledOnce();
  });

  it("cycles the page mirror through the same refresh actions and respects overlays", () => {
    const state = list(); start("servers", "", state); finishSlide();
    screen!.nextServerPage(); finishSlide(); expect(names()[0]).toBe("channel40");
    screen!.showMessage("notice"); screen!.nextServerPage(); expect(names()[0]).toBe("channel40");
    press("Escape"); press("F1"); screen!.nextServerPage();
    press("Escape"); expect(names()[0]).toBe("channel40");
    refresh(); expect(state.slide.open).toBe(false);
    screen!.nextServerPage(); finishSlide(); expect(names()).toEqual(["2인 대전"]);
    screen!.nextServerPage(); finishSlide(); expect(names()[0]).toBe("channel0");
  });

  it("keeps ordinary refresh on the same forty-row list", () => {
    const state = list(39); start("servers", "", state); finishSlide();
    const before = names(); refresh(); refresh(); expect(names()).toEqual(before);
    screen!.nextServerPage(); expect(names()).toEqual(before);
    click([514, 484, 726, 499]); expect(state.selected).toBe(39);
  });

  it("returns keys from an assistive control when the canvas EXIT opens the quit box", () => {
    start("servers", "", list()); finishSlide();
    const mirror = new Element("button"); mirror.focus();
    screen!.nextServerPage(); finishSlide(); expect(dom.activeElement).toBe(mirror);
    click(SERVER_BUTTONS.exit.hit); press("y");
    expect(exit).toHaveBeenCalledOnce();
  });

  it.each(["help", "message"] as const)("keeps assistive focus when %s drops the canvas click", (kind) => {
    start("servers", "", list()); finishSlide(); overlay(kind);
    const mirror = new Element("button"); mirror.focus();
    click(SERVER_BUTTONS.exit.hit);
    expect(dom.activeElement).toBe(mirror);
    if (kind === "message") {
      click(MESSAGE_BOX.button.hit);
      expect(dom.activeElement).toBe(dom.body);
      click(SERVER_BUTTONS.exit.hit); press("y");
      expect(exit).toHaveBeenCalledOnce();
    }
  });
});

describe("status editor behind the quit box", () => {
  function openBox(): Element {
    start("status", "tester"); type("닉네임", "abc");
    const nick = field("닉네임"); nick.setSelectionRange(2, 2);
    click(STATUS_BUTTONS.exit.hit);
    return nick;
  }

  it.each(["main", "option", "changing key"])("takes Y after a canvas EXIT returns from a mirror on %s", (page) => {
    start("status", "tester");
    let input = field("닉네임");
    if (page !== "main") {
      screen!.statusCommand("option"); input = field("단축 메시지");
    }
    type(input.attributes.get("aria-label")!, "abc"); input.setSelectionRange(2, 2);
    if (page === "changing key") screen!.statusCommand("key1");
    const mirror = new Element("button"); mirror.focus();
    click(STATUS_BUTTONS.exit.hit);
    expect(input.value).toBe("abc"); expect(input.selectionStart).toBe(2);
    press("y");
    expect(exit).toHaveBeenCalledOnce();
  });

  it("restores the nick caret after canvas EXIT and NO from a mirror", () => {
    start("status", "tester"); type("닉네임", "abc");
    const nick = field("닉네임"); nick.setSelectionRange(2, 2);
    const mirror = new Element("button"); mirror.focus();
    click(STATUS_BUTTONS.exit.hit); press("n");
    expect(dom.activeElement).toBe(nick); expect(screen!.dropsClicks).toBe(false);
    const caret = nick.selectionStart;
    type("닉네임", nick.value.slice(0, caret) + "X" + nick.value.slice(caret));
    expect(nick.value).toBe("abXc");
  });

  it("returns the ranking search and game keys after an arrow click from a mirror", async () => {
    start("status", "tester"); screen!.statusCommand("ranking"); await Promise.resolve();
    type("찾을 아이디", "abc"); const search = field("찾을 아이디"); search.setSelectionRange(2, 2);
    const mirror = new Element("button"); mirror.focus();
    click(RANKING.up.hit);
    expect(dom.activeElement).toBe(search); expect(search.selectionStart).toBe(2);
    press("F1"); expect(screen!.dropsClicks).toBe(true);
    press("Escape"); expect(screen!.dropsClicks).toBe(false);
    mirror.focus(); click(STATUS_BUTTONS.exit.hit); press("n");
    expect(dom.activeElement).toBe(search); expect(screen!.dropsClicks).toBe(false);
    mirror.focus(); click(STATUS_BUTTONS.exit.hit); press("y"); expect(exit).toHaveBeenCalledOnce();
  });

  it.each(["help", "message", "saving", "fade"] as const)("keeps assistive focus when %s rejects a status canvas click", (kind) => {
    start("status", "tester");
    if (kind === "saving") screen!.statusCommand("ok");
    else if (kind === "fade") screen!.leave(() => undefined);
    else overlay(kind);
    const mirror = new Element("button"); mirror.focus();
    click(STATUS_BUTTONS.exit.hit);
    expect(dom.activeElement).toBe(mirror); expect(exit).not.toHaveBeenCalled();
    if (kind === "message") {
      click(MESSAGE_BOX.button.hit);
      expect(dom.activeElement).toBe(field("닉네임"));
    }
  });

  it.each(["x", "Backspace", "ArrowLeft", "ArrowRight", "Tab", "F5"])("keeps %s in the quit box and retains the nick caret after NO", (key) => {
    const nick = openBox();
    expect(press(key).defaultPrevented).toBe(true);
    expect(nick.value).toBe("abc");
    expect(nick.selectionStart).toBe(2);
    expect(press("n").defaultPrevented).toBe(true);
    const at = nick.selectionStart;
    nick.value = `${nick.value.slice(0, at)}X${nick.value.slice(at)}`;
    nick.setSelectionRange(at + 1, at + 1); nick.dispatchEvent(new Event("input"));
    expect(nick.value).toBe("abXc");
  });

  it("still lets Delete remove the next character before the box handles the key", () => {
    const nick = openBox();
    expect(press("Delete").defaultPrevented).toBe(false);
    // The native deletion edits the real ChatLine buffer; its caret stays before the removed c.
    nick.value = "ab"; nick.dispatchEvent(new Event("input"));
    press("n");
    expect(nick.value).toBe("ab");
    expect(nick.selectionStart).toBe(2);
  });

  it.each(["Delete", "IME"])("holds the drawn nick after %s until an editor key following NO", (edit) => {
    const nick = openBox();
    const page = (screen as unknown as { statusPage: { fields: { view(): { text: string; caret: number } }[] } }).statusPage;
    if (edit === "Delete") press("Delete");
    else press("Process", false, 229);
    const text = edit === "Delete" ? "ab" : "ab한c";
    nick.value = text; nick.dispatchEvent(new Event("input"));
    expect(page.fields[0].view().text).toBe("abc");
    press("n"); frame(now + 34);
    expect(page.fields[0].view().text).toBe("abc");
    press("ArrowLeft");
    expect(page.fields[0].view().text).toBe(text);
  });
});

describe("shared field editor reload", () => {
  it("returns each login field with its caret at the end", () => {
    start("login"); type("아이디", "abc"); field("아이디").setSelectionRange(2, 2);
    press("Tab"); type("비밀번호", "pw"); field("비밀번호").setSelectionRange(1, 1);
    press("Tab"); expect(field("아이디").selectionStart).toBe(3);
    press("Tab"); expect(field("비밀번호").selectionStart).toBe(2);
  });

  it("reloads a clicked login field but keeps the caret on a background click", () => {
    start("login"); type("아이디", "abc"); field("아이디").setSelectionRange(2, 2);
    click([0, 0, 1, 1]); expect(field("아이디").selectionStart).toBe(2);
    click(LOGIN.id.field); expect(field("아이디").selectionStart).toBe(3);
  });

  it.each(["Tab", "click"])("reloads the sign-up ID after %s returns to it", (action) => {
    start("login"); screen!.signUpCommand("open");
    type("회원가입 아이디", "abc"); field("회원가입 아이디").setSelectionRange(2, 2);
    if (action === "Tab") for (let i = 0; i < 6; i++) press("Tab");
    else { click(SIGN_UP_FIELDS.nick.click); click(SIGN_UP_FIELDS.id.click); }
    expect(dom.activeElement).toBe(field("회원가입 아이디"));
    expect(field("회원가입 아이디").selectionStart).toBe(3);
  });

  it.each([
    ["termsUp", SIGN_UP_BUTTONS.termsUp.hit],
    ["termsDown", SIGN_UP_BUTTONS.termsDown.hit],
    ["agree", SIGN_UP_BOXES.agree],
    ["disagree", SIGN_UP_BOXES.disagree],
    ["blank", [449, 249, 451, 251]],
    ["outside", [49, 39, 51, 41]],
  ] as const)("reloads the current sign-up field before a %s click", (_name, hit) => {
    start("login"); screen!.signUpCommand("open");
    const input = field("회원가입 아이디");
    type("회원가입 아이디", "abc"); input.setSelectionRange(2, 2);
    click(hit);
    expect(dom.activeElement).toBe(input);
    expect(input.value).toBe("abc");
    expect(input.selectionStart).toBe(3);
    press("X");
    // Apply the browser insert at the caret left by the actual window release.
    const caret = input.selectionStart;
    type("회원가입 아이디", input.value.slice(0, caret) + "X" + input.value.slice(caret));
    expect(input.value).toBe("abcX");
  });

  it.each(Object.entries(SIGN_UP_FIELDS))("reloads the %s sign-up editor on a background click", (_name, spec) => {
    start("login"); screen!.signUpCommand("open");
    click(spec.click);
    const label = `회원가입 ${spec.label}`, input = field(label);
    type(label, "앞한뒤"); input.setSelectionRange(1, 1);
    click([449, 249, 451, 251]);
    expect(dom.activeElement).toBe(input);
    expect(input.value).toBe("앞한뒤");
    expect(input.selectionStart).toBe(3);
  });

  it("keeps the sign-up caret when only a message is dismissed", () => {
    start("login"); screen!.signUpCommand("open");
    const input = field("회원가입 아이디");
    type("회원가입 아이디", "abc"); input.setSelectionRange(2, 2);
    screen!.showMessage("notice"); press("Escape");
    expect(dom.activeElement).toBe(input);
    expect(input.selectionStart).toBe(2);
  });

  it.each(["Tab", "click"])("reloads the status nick after %s returns to it", (action) => {
    start("status"); type("닉네임", "abc"); field("닉네임").setSelectionRange(2, 2);
    if (action === "Tab") for (let i = 0; i < 3; i++) press("Tab");
    else { click(FIELDS[1].hit); click(FIELDS[0].hit); }
    expect(dom.activeElement).toBe(field("닉네임"));
    expect(field("닉네임").selectionStart).toBe(3);
  });
});

describe("status option key input ownership", () => {
  function changeKey(): SettingsStore {
    const settings = start("status", "tester");
    screen!.statusCommand("option"); screen!.statusCommand("key1");
    return settings;
  }

  it.each(["Enter", "Space", "Tab"])("leaves %s to a focused assistive button without rebinding", (key) => {
    const settings = changeKey(); new Element("button").focus();
    const event = press(key); frame(now + 34); held(key, "keyup");
    screen!.statusCommand("optionOk");
    expect(event.defaultPrevented).toBe(false);
    expect(settings.current.keys).toEqual([0x39, 0x1d, 0x2c]);
  });

  it.each(["select", "summary", "input"])("ignores keys from an external %s during key capture", (tag) => {
    const settings = changeKey(); dom.createElement(tag).focus();
    held("KeyA"); frame(now + 34); held("KeyA", "keyup");
    screen!.statusCommand("optionOk");
    expect(settings.current.keys).toEqual([0x39, 0x1d, 0x2c]);
  });

  it("returns the keyboard from a key mirror and accepts the chosen game key", () => {
    const settings = start("status", "tester"); screen!.statusCommand("option");
    const mirror = new Element("button"); mirror.focus(); screen!.statusCommand("key1");
    expect(dom.activeElement).toBe(dom.body);
    held("KeyB"); frame(now + 34); held("KeyB", "keyup"); screen!.statusCommand("optionOk");
    expect(settings.current.keys).toEqual([0x30, 0x1d, 0x2c]);
  });

  it.each(["wrong page", "help", "message"] as const)("keeps the mirror focused when %s rejects its action during capture", (gate) => {
    changeKey();
    if (gate !== "wrong page") overlay(gate);
    const mirror = new Element("button"); mirror.focus();
    screen!.statusCommand(gate === "wrong page" ? "guildNext" : "musicOff");
    expect(dom.activeElement).toBe(mirror); expect(screen!.awaitsKeys).toBe(false);
  });

  it.each([["Enter", 0x1c], ["Space", 0x39], ["Tab", 0x0f]] as const)("still binds owned %s and prevents its browser action", (key, dik) => {
    const settings = changeKey();
    const event = press(key); frame(now + 34); held(key, "keyup");
    screen!.statusCommand("optionOk");
    expect(event.defaultPrevented).toBe(true);
    expect(settings.current.keys).toEqual([dik, 0x1d, 0x2c]);
  });
});

describe("status option key poll under help", () => {
  function changeKey(): SettingsStore {
    const settings = start("status", "tester");
    screen!.statusCommand("option"); screen!.statusCommand("key1");
    return settings;
  }
  function help(): void { press("F1"); held("F1", "keyup"); }

  it("does not bind a key pressed and released behind help", () => {
    const settings = changeKey(); help();
    held("KeyA"); frame(now + 34); held("KeyA", "keyup");
    press("Escape"); frame(now + 34); screen!.statusCommand("optionOk");
    expect(settings.current.keys).toEqual([0x39, 0x1d, 0x2c]);
  });

  it("takes a still-held key on the first tick after help closes", () => {
    const settings = changeKey(); help(); held("KeyB"); frame(now + 34);
    const page = (screen as unknown as { statusPage: { option: { keys: number[] } } }).statusPage;
    expect(page.option.keys).toEqual([0x39, 0x1d, 0x2c]);
    press("Escape"); frame(now + 34); held("KeyB", "keyup"); screen!.statusCommand("optionOk");
    expect(settings.current.keys).toEqual([0x30, 0x1d, 0x2c]);
  });

  it("does not show the D refusal behind help", () => {
    changeKey(); const message = vi.spyOn(screen!, "showMessage");
    help(); held("KeyD"); frame(now + 68); held("KeyD", "keyup");
    expect(message).not.toHaveBeenCalled();
    press("Escape"); expect(screen!.dropsClicks).toBe(false);
  });

  it("continues polling through an ordinary message box", () => {
    const settings = changeKey(); screen!.showMessage("notice");
    held("KeyA"); frame(now + 34); held("KeyA", "keyup");
    press("Escape"); screen!.statusCommand("optionOk");
    expect(settings.current.keys).toEqual([0x1e, 0x1d, 0x2c]);
  });
});

describe("start flow Tab with a scene overlay", () => {
  it.each(["message", "help"] as const)("moves between the login fields under %s", (kind) => {
    start("login"); type("아이디", "old"); overlay(kind);
    expect(press("Tab").defaultPrevented).toBe(true);
    expect(dom.activeElement).toBe(field("비밀번호"));
    press("Tab"); expect(dom.activeElement).toBe(field("아이디"));
    expect(field("아이디").value).toBe("old");
  });

  it("discards the message's uncopied buffer when changing login fields", () => {
    start("login", "tester"); type("비밀번호", "old"); overlay("message"); type("비밀번호", "oldabc");
    press("Tab");
    expect(dom.activeElement).toBe(field("아이디"));
    expect(field("비밀번호").value).toBe("old");
    type("아이디", "changed"); press("Tab");
    expect(field("아이디").value).toBe("tester");
    frame(now + MESSAGE_BOX.hideMs); press("Tab"); press("Tab");
    expect(field("비밀번호").value).toBe("old");
  });

  it.each(["message", "help"] as const)("cycles the status fields under %s", (kind) => {
    start("status", "tester"); overlay(kind);
    for (const label of ["인사말", "길드 비밀번호", "닉네임"]) {
      expect(press("Tab").defaultPrevented).toBe(true);
      expect(dom.activeElement).toBe(field(label));
    }
  });

  it("drops uncopied status edits when the shared editor changes fields", () => {
    start("status", "tester"); type("닉네임", "old"); overlay("message"); type("닉네임", "oldabc");
    press("Tab"); expect(field("닉네임").value).toBe("old");
    type("인사말", "queued"); press("Tab");
    expect(field("인사말").value).toBe("");
    press("Tab"); expect(dom.activeElement).toBe(field("닉네임"));
    frame(now + MESSAGE_BOX.hideMs); expect(field("닉네임").value).toBe("old");
  });

  it("changes option macro lines under a message without copying its queued edits", () => {
    start("status", "tester"); screen!.statusCommand("option");
    type("단축 메시지", "old"); frame(now + 34); overlay("message"); type("단축 메시지", "queued");
    press("Tab"); expect(field("단축 메시지").value).toBe("");
    for (let i = 0; i < 9; i++) press("Tab");
    expect(field("단축 메시지").value).toBe("old");
  });

  it("keeps sign-up Tab inside the window under its message without unlocking characters", () => {
    start("login"); screen!.signUpCommand("open"); overlay("message");
    expect(press("Tab").defaultPrevented).toBe(true);
    expect(dom.activeElement).toBe(dom.body); // The ID check is a logical focus with no editor.
    press("Tab"); expect(dom.activeElement).toBe(field("회원가입 닉네임"));
    expect(field("회원가입 닉네임").readOnly).toBe(true);
  });

  it("leaves Shift+Tab available for the assistive controls", () => {
    start("login"); overlay("message");
    expect(press("Tab", true).defaultPrevented).toBe(false);
    expect(dom.activeElement).toBe(field("아이디"));
  });
});

describe("start flow Enter with a scene overlay", () => {
  it.each(["message", "help"] as const)("moves from ID to password under %s without sending login", (kind) => {
    start("login"); type("아이디", "tester"); overlay(kind);
    if (kind === "message") type("아이디", "queued");
    expect(press("Enter").defaultPrevented).toBe(true);
    expect(dom.activeElement).toBe(field("비밀번호"));
    expect(field("아이디").value).toBe("tester");
    expect(login).not.toHaveBeenCalled();
  });

  it.each(["message", "help"] as const)("sends the copied password on Enter under %s and waits before another request", (kind) => {
    start("login", "tester"); type("비밀번호", "old"); overlay(kind); type("비밀번호", "oldabc");
    expect(press("Enter").defaultPrevented).toBe(true);
    expect(login).toHaveBeenCalledExactlyOnceWith("tester", kind === "message" ? "old" : "oldabc");
    press("Enter"); expect(login).toHaveBeenCalledTimes(1);
  });

  describe.each(["message", "help"] as const)("sign-up Enter under %s", (kind) => {
    it.each(["id", "nick"] as const)("checks %s without registering and waits for the answer", (target) => {
      start("login"); screen!.signUpCommand("open");
      const label = target === "id" ? "회원가입 아이디" : "회원가입 닉네임";
      const text = target === "id" ? "tester" : "새내기";
      type(label, text);
      for (let i = 0; i < (target === "id" ? 1 : 3); i++) press("Tab");
      overlay(kind);
      expect(press("Enter").defaultPrevented).toBe(true);
      expect(check).toHaveBeenCalledExactlyOnceWith(target, text);
      press("Enter"); expect(check).toHaveBeenCalledTimes(1);
      expect(field(label).readOnly).toBe(true);
      expect(register).not.toHaveBeenCalled();
      // An answer ends the blocking request; its own notice does not suppress Enter on the check.
      screen!.signUpAnswer(target, 1); press("Tab"); press("Enter");
      expect(check).toHaveBeenCalledTimes(2);
    });
  });

  it.each(["message", "help"] as const)("leaves IME process Enter to the editor under %s", (kind) => {
    start("login", "tester"); type("비밀번호", "old"); overlay(kind);
    expect(press("Enter", false, 229).defaultPrevented).toBe(false);
    expect(login).not.toHaveBeenCalled();
  });
});
