import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { OptionPanel } from "./optionPanel.ts";
import { SettingsStore } from "./settings.ts";

class Element extends EventTarget {
  readonly children: (Element | string)[] = [];
  readonly attributes = new Map<string, string>();
  readonly tagName: string;
  id = "";
  value = "";
  className = "";
  checked = false;
  open = false;
  textContent = "";
  constructor(tag: string) { super(); this.tagName = tag.toUpperCase(); }
  setAttribute(name: string, value: string) {
    this.attributes.set(name, value);
    if (name === "id") this.id = value;
  }
  getAttribute(name: string) { return this.attributes.get(name) ?? null; }
  append(child: Element | string) { this.children.push(child); }
  contains(target: Element | null): boolean {
    return this === target || this.children.some((child) => child instanceof Element && child.contains(target));
  }
  replaceChildren(...children: (Element | string)[]) {
    if (this.children.some((child) => child instanceof Element && child.contains(dom.activeElement))) dom.activeElement = dom.body;
    this.children.splice(0, this.children.length, ...children);
  }
  focus() { dom.activeElement = this; }
  querySelectorAll(selector: string): Element[] {
    const attribute = selector.slice(1, -1);
    return this.children.flatMap((child) => child instanceof Element
      ? [...(child.attributes.has(attribute) ? [child] : []), ...child.querySelectorAll(selector)] : []);
  }
}

const elements: Element[] = [];
const dom = {
  body: new Element("body"), activeElement: null as Element | null,
  createElement(tag: string) {
    const element = new Element(tag);
    elements.push(element);
    return element;
  },
};
const send = vi.fn();
const message = vi.fn();
let panel: OptionPanel;

beforeEach(() => {
  elements.length = 0;
  dom.activeElement = dom.body;
  send.mockClear();
  message.mockClear();
  vi.stubGlobal("document", dom);
  panel = new OptionPanel({
    settings: new SettingsStore({ get: () => null, set() {} }), send, message, busy: () => false,
  });
});

afterEach(() => {
  panel.dispose();
  vi.unstubAllGlobals();
});

function field(id: string): Element {
  const element = elements.find((element) => element.id === id);
  if (!element) throw new Error(`missing ${id}`);
  return element;
}

function askToAdd(): Element {
  const input = field("option-friend");
  input.value = "missing";
  input.focus();
  const form = elements.find((element) => element.tagName === "FORM" && element.contains(input))!;
  form.dispatchEvent(new Event("submit", { cancelable: true }));
  expect(send).toHaveBeenCalledExactlyOnceWith({ type: "add-friend", name: "missing" });
  return input;
}

describe("a late reply to the assistive friend controls", () => {
  it.each(["canvas", "macro", "body"])("preserves focus moved to the %s while the add was pending", (target) => {
    askToAdd();
    const next = target === "canvas" ? new Element("input") : target === "macro" ? field("option-macro-1") : dom.body;
    next.focus();

    panel.friendReplied({ message: "존재하지 않는 아이디입니다.", askAgain: false });

    expect(message).toHaveBeenCalledOnce();
    expect(dom.activeElement).toBe(next);
  });

  it("keeps the add field when the user is still there and allows the next request", () => {
    const input = askToAdd();
    panel.friendReplied({ message: null, askAgain: false });
    expect(dom.activeElement).toBe(input);
    input.value = "nextfriend";
    elements.find((element) => element.tagName === "FORM" && element.contains(input))!
      .dispatchEvent(new Event("submit", { cancelable: true }));
    expect(send.mock.calls.map(([request]) => request)).toEqual([
      { type: "add-friend", name: "missing" }, { type: "add-friend", name: "nextfriend" },
    ]);
  });

  it("returns from the deleted row's control before the refreshed list removes it", () => {
    panel.friendsAnswered([{ name: "friend1", location: "", badge: null }]);
    const button = elements.find((element) => element.attributes.get("aria-label") === "friend1 삭제")!;
    button.focus();
    button.dispatchEvent(new Event("click"));
    expect(send).toHaveBeenCalledExactlyOnceWith({ type: "delete-friend", name: "friend1" });

    panel.friendReplied({ message: "삭제 되었습니다", askAgain: true });
    expect(send.mock.calls.at(-1)?.[0]).toEqual({ type: "friends" });
    panel.friendsAnswered([]);
    expect(dom.activeElement).toBe(field("option-friend"));
  });
});

describe("the keyboard selection when a friend list arrives", () => {
  const friend = { name: "friend1", location: "", badge: null };
  const button = () => elements.filter((element) => element.attributes.get("aria-label") === "friend1 삭제").at(-1)!;

  it("keeps the selected friend's delete action through reordering and a location update", () => {
    panel.friendsAnswered([friend]);
    button().focus();
    panel.friendsAnswered([{ ...friend, name: "other" }, { ...friend, location: "002번 방" }]);
    expect(dom.activeElement).toBe(button());
    dom.activeElement!.dispatchEvent(new Event("click"));
    expect(send).toHaveBeenCalledExactlyOnceWith({ type: "delete-friend", name: "friend1" });
  });

  it("does not select another friend when the focused one disappears", () => {
    panel.friendsAnswered([friend]);
    button().focus();
    panel.friendsAnswered([{ ...friend, name: "other" }]);
    expect(dom.activeElement).toBe(dom.body);
  });
});
