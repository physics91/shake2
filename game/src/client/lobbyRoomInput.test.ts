import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { LobbyScreen, LobbyScreenOptions } from "./lobbyScreen.ts";
import type { RoomScreen, RoomScreenOptions } from "./roomScreen.ts";
import type { ChatLine } from "./chatLine.ts";
import { localRoom } from "./localRoom.ts";
import { defaultSettings } from "./settings.ts";

vi.mock("./tintArt.ts", () => ({ loadTintedSheet: () => Promise.resolve({}) }));
vi.mock("./screenCapture.ts", () => ({ attachCapture: () => () => undefined }));
class Element extends EventTarget {
  readonly tagName: string;
  readonly attributes = new Map<string, string>();
  readonly children: Element[] = [];
  value = "";
  selectionStart = 0;
  style = {};
  textContent = "";
  constructor(tag = "div") { super(); this.tagName = tag.toUpperCase(); }
  setAttribute(name: string, value: string) { this.attributes.set(name, value); }
  setSelectionRange(start: number, _end: number) { this.selectionStart = start; }
  focus() { dom.activeElement = this; }
  blur() { if (dom.activeElement === this) dom.activeElement = dom.body; }
  append(element: Element) { this.children.push(element); }
  contains(element: Element) { return this === element || this.children.includes(element); }
  remove() { this.blur(); }
  getContext() { return {}; }
}

const dom = { body: new Element("body"), createElement: (tag: string) => new Element(tag), activeElement: null as Element | null, hasFocus: () => true };

const say = vi.fn();
const leave = vi.fn();
let screen: LobbyScreen | RoomScreen | undefined;

beforeEach(() => {
  say.mockClear();
  leave.mockClear();
  vi.stubGlobal("window", new EventTarget());
  vi.stubGlobal("HTMLElement", Element);
  dom.activeElement = dom.body;
  vi.stubGlobal("document", dom);
  vi.stubGlobal("requestAnimationFrame", () => 1);
  vi.stubGlobal("cancelAnimationFrame", () => undefined);
});

afterEach(() => {
  screen?.dispose();
  screen = undefined;
  vi.unstubAllGlobals();
});

async function enter(kind: "lobby" | "room") {
  const common = { canvas: new Element(), stage: new Element(), assets: {}, playerId: 1, maps: [], say, settings: { current: defaultSettings() } };
  if (kind === "room") {
    const { RoomScreen } = await import("./roomScreen.ts");
    screen = new RoomScreen({ ...common, music: [], leave } as unknown as RoomScreenOptions,
      localRoom({ maps: [], music: [] }, ["bobo", "doona"]));
  } else {
    const { LobbyScreen } = await import("./lobbyScreen.ts");
    screen = new LobbyScreen({ ...common, exit: leave } as unknown as LobbyScreenOptions,
      { channel: "test", rooms: [], users: [] });
  }
  type("앞");
}

function press(key: string, keyCode: number, isComposing = true) {
  const event = new Event("keydown", { cancelable: true });
  Object.assign(event, { key, code: key, keyCode, isComposing });
  if (dom.activeElement) {
    Object.defineProperty(event, "target", { value: dom.activeElement });
    dom.activeElement.dispatchEvent(event);
  }
  window.dispatchEvent(event);
  return event;
}

function type(value: string, caret = value.length): Element {
  const input = dom.activeElement!;
  input.value = value;
  input.setSelectionRange(caret, caret);
  input.dispatchEvent(new Event("input"));
  return input;
}

describe.each(["lobby", "room"] as const)("%s IME process keys", (kind) => {
  it("leaves IME Enter to the editor, then accepts an ordinary Enter", async () => {
    await enter(kind);
    const ime = press("Enter", 229);
    expect(say).not.toHaveBeenCalled();
    expect(ime.defaultPrevented).toBe(false);
    // Ordinary Enter retains the original composition-cancel and chat-send behavior.
    press("Enter", 13);
    expect(say).toHaveBeenCalledExactlyOnceWith("앞");
  });

  it.each([true, false])("leaves IME Esc to the editor with isComposing=%s, then accepts an ordinary Esc", async (composing) => {
    await enter(kind);
    const ime = press("Escape", 229, composing);
    expect(leave).not.toHaveBeenCalled();
    if (kind === "room") expect((screen as RoomScreen).boxUp).toBe(false);
    expect(ime.defaultPrevented).toBe(false);
    press("Escape", 27, false);
    if (kind === "room") expect((screen as RoomScreen).boxUp).toBe(true);
    else expect(leave).toHaveBeenCalledExactlyOnceWith(false);
  });
});

describe("room editor under the EXIT box", () => {
  it.each(["Delete", "IME"])("holds the drawn record while %s edits the buffer and until a key after NO", async (edit) => {
    await enter("room");
    type("old", 2);
    const chat = (screen as unknown as { chat: ChatLine }).chat;
    press("Escape", 27, false);
    if (edit === "Delete") {
      expect(press("Delete", 46, false).defaultPrevented).toBe(false);
      type("ol", 2);
    } else {
      expect(press("Process", 229).defaultPrevented).toBe(false);
      dom.activeElement!.dispatchEvent(new Event("compositionstart"));
      dom.activeElement!.dispatchEvent(Object.assign(new Event("compositionupdate"), { data: "한" }));
      type("ol한d", 3);
      dom.activeElement!.dispatchEvent(new Event("compositionend"));
    }
    const edited = edit === "Delete" ? "ol" : "ol한d";
    expect(dom.activeElement!.value).toBe(edited);
    expect(chat.view().text).toBe("old");
    expect(press("n", 78, false).defaultPrevented).toBe(true);
    expect(chat.view().text).toBe("old");
    press("ArrowLeft", 37, false);
    expect(chat.view().text).toBe(edited);
    press("Enter", 13, false);
    expect(say).toHaveBeenCalledExactlyOnceWith(edited);
  });

  it.each(["old", "앞한뒤"])("deletes the character at the caret in %s, then sends it after NO", async (text) => {
    await enter("room");
    const input = type(text, 1);
    press("Escape", 27, false);
    const deleted = press("Delete", 46, false);
    // Apply the browser's default deletion only when the scene leaves it to the actual editor.
    if (!deleted.defaultPrevented) type(text.slice(0, 1) + text.slice(2), 1);
    const no = press("n", 78, false);
    expect(no.defaultPrevented).toBe(true);
    expect((screen as RoomScreen).boxUp).toBe(false);
    press("Enter", 13, false);
    expect(say).toHaveBeenCalledExactlyOnceWith(text.slice(0, 1) + text.slice(2));
    expect(input.value).toBe("");
  });

  it.each(["Backspace", "x", "ArrowLeft", "ArrowRight"])("keeps %s from editing the line while the box is up", async (key) => {
    await enter("room");
    const input = type("old", 1);
    press("Escape", 27, false);
    expect(press(key, 0, false).defaultPrevented).toBe(true);
    expect(input.value).toBe("old");
    expect(input.selectionStart).toBe(1);
    expect((screen as RoomScreen).boxUp).toBe(true);
  });
});
