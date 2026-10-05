import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MESSAGE_BOX } from "./lobbyLayout.ts";
import { newSlide } from "./startLayout.ts";
import { StartScreen, type StartScreenOptions } from "./startScreen.ts";
import { outlinedText } from "./text.ts";

vi.mock("./statusScreen.ts", () => ({ StatusPage: class { dispose() {} owns() { return false; } deferChanges() {} } }));
vi.mock("./text.ts", () => ({
  FONT_12: "12px", FONT_13: "13px", YELLOW: "#ffff00", outlinedText: vi.fn(), plainText() {}, fitText: (text: string) => text,
}));

class Element extends EventTarget {
  readonly attributes = new Map<string, string>();
  readonly children: Element[] = [];
  readonly style = {};
  value = "";
  selectionStart = 0;
  width = 800;
  height = 600;
  readOnly = false;
  readonly tagName: string;
  constructor(tagName: string) { super(); this.tagName = tagName; }
  setAttribute(name: string, value: string) { this.attributes.set(name, value); }
  append(element: Element) { this.children.push(element); }
  setSelectionRange(start: number, _end: number) { this.selectionStart = start; }
  focus() { dom.activeElement = this; }
  blur() { if (dom.activeElement === this) dom.activeElement = dom.body; }
  remove() { this.blur(); }
  getContext() {
    return { canvas: this, drawImage() {}, fillRect() {}, save() {}, restore() {} };
  }
}

const dom = {
  body: new Element("BODY"),
  activeElement: null as Element | null,
  hasFocus: () => true,
  createElement: (tag: string) => new Element(tag.toUpperCase()),
};

let now: number;
let screen: StartScreen | undefined;
let stage: Element;
let frames: Map<number, FrameRequestCallback>;
let authConnect: ReturnType<typeof vi.fn>;

beforeEach(() => {
  now = 0;
  stage = new Element("DIV");
  frames = new Map();
  authConnect = vi.fn();
  let nextFrame = 0;
  dom.activeElement = dom.body;
  vi.stubGlobal("document", dom);
  vi.stubGlobal("window", new EventTarget());
  vi.stubGlobal("HTMLElement", Element);
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { frames.set(++nextFrame, callback); return nextFrame; });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
  vi.spyOn(performance, "now").mockImplementation(() => now);
});

afterEach(() => {
  screen?.dispose();
  screen = undefined;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function frame(at: number): void {
  now = at;
  const callbacks = [...frames.values()];
  frames.clear();
  for (const callback of callbacks) callback(at);
}

function start(savedId: string): void {
  screen = new StartScreen({
    canvas: new Element("CANVAS"), stage, begin: "login", savedId,
    list: { slide: newSlide(), rows: [], selected: -1 }, status: {},
    sounds: { play() {}, unlock() {} }, assets: {}, authConnect,
    register: () => true, check: () => true,
  } as unknown as StartScreenOptions);
  // Finish the login's initial fade before its controls take releases.
  frame(400);
}

function field(label: string): Element {
  const found = stage.children.find((element) => element.attributes.get("aria-label") === label);
  if (!found) throw new Error(`missing field ${label}`);
  return found;
}

function type(label: string, value: string): void {
  const input = field(label);
  input.value = value;
  input.setSelectionRange(value.length, value.length);
  input.dispatchEvent(new Event("input"));
}

function register(): void {
  screen!.signUpCommand("open");
  type("회원가입 아이디", "newbie");
  type("회원가입 닉네임", "새내기");
  type("회원가입 비밀번호", "pass1");
  type("회원가입 비밀번호확인", "pass1");
  screen!.signUpCommand("agree");
  screen!.signUpCommand("submit");
}

function drawnLoginField(field: "id" | "pw"): string | undefined {
  return vi.mocked(outlinedText).mock.calls.findLast((call) => call[2] === 405 && call[3] === (field === "id" ? 276 : 302))?.[1];
}

describe("login fields behind a message box", () => {
  it.each(["id", "pw"] as const)("keeps the %s record until another editor event after the box expires", (loginField) => {
    start(loginField === "pw" ? "tester" : "");
    const label = loginField === "id" ? "아이디" : "비밀번호";
    type(label, "wrong");
    screen!.loginFailed();
    // The original edits its buffer first, then the message box blocks copying it to the field.
    type(label, "wrongabc");
    frame(now + 34);
    expect(drawnLoginField(loginField)).toBe(loginField === "pw" ? "*****" : "wrong");
    frame(now + MESSAGE_BOX.hideMs);
    frame(now + 34);
    expect(drawnLoginField(loginField)).toBe(loginField === "pw" ? "*****" : "wrong");
    // An ordinary arrow's key-down also copies the editor, including what was typed behind the box.
    field(label).setSelectionRange(7, 7);
    field(label).dispatchEvent(new Event("keydown"));
    frame(now + 34);
    expect(drawnLoginField(loginField)).toBe(loginField === "pw" ? "********" : "wrongabc");
    expect(authConnect).toHaveBeenCalledTimes(1);
  });
});

describe("login keyboard focus after signing up", () => {
  it.each(["", "tester"])("returns to the previous login field when the success message expires (saved ID %j)", (savedId) => {
    start(savedId);
    type("아이디", savedId || "typedid");
    type("비밀번호", "typedpass");
    const previous = field(savedId ? "비밀번호" : "아이디");
    expect(dom.activeElement).toBe(previous);
    register();
    screen!.signUpAnswer("register", 0);
    frame(now + MESSAGE_BOX.hideMs);
    expect(dom.activeElement).toBe(previous);
    expect(field("아이디").value).toBe(savedId || "typedid");
    expect(field("비밀번호").value).toBe("typedpass");
    expect(authConnect).toHaveBeenCalledTimes(1);
  });

  it("leaves an assistive control focused when the success message expires", () => {
    start("");
    register();
    screen!.signUpAnswer("register", 0);
    const button = new Element("BUTTON");
    button.focus();
    frame(now + MESSAGE_BOX.hideMs);
    expect(dom.activeElement).toBe(button);
  });

  it("keeps the sign-up editor when a refused registration message expires", () => {
    start("");
    register();
    screen!.signUpAnswer("register", 4);
    const current = dom.activeElement;
    expect(current?.attributes.get("aria-label")).toMatch(/^회원가입 /);
    frame(now + MESSAGE_BOX.hideMs);
    expect(dom.activeElement).toBe(current);
    expect(field("회원가입 아이디").value).toBe("newbie");
  });

  it("resets the login fields and reconnects when Esc acknowledges the success message", () => {
    start("tester");
    type("아이디", "changed");
    type("비밀번호", "typedpass");
    register();
    screen!.signUpAnswer("register", 0);
    window.dispatchEvent(Object.assign(new Event("keydown", { cancelable: true }), { code: "Escape", key: "Escape" }));
    expect(dom.activeElement).toBe(field("비밀번호"));
    expect(field("아이디").value).toBe("tester");
    expect(field("비밀번호").value).toBe("");
    expect(authConnect).toHaveBeenCalledTimes(2);
  });
});
