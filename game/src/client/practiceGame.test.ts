import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { PracticeGameOptions } from "./practiceGame.ts";
import type { ChatLine } from "./chatLine.ts";
import { defaultSettings } from "./settings.ts";

const { loadImage, loadSceneAssets, made, render, runFixedLoop, detach, chatLines, chatOpened, chatClosed, chatDisposed } = vi.hoisted(() => ({
  loadImage: vi.fn(), loadSceneAssets: vi.fn(), made: vi.fn(), render: vi.fn(), runFixedLoop: vi.fn(),
  chatLines: [] as ChatLine[],
  detach: vi.fn(), chatOpened: vi.fn(), chatClosed: vi.fn(), chatDisposed: vi.fn(),
}));
vi.mock("./assets.ts", () => ({ loadImage }));
vi.mock("./scene.ts", () => ({ loadSceneAssets }));
vi.mock("../sim/level.ts", () => ({ PRACTICE_MAP: "practice", layoutFromLevel: () => ({}) }));
vi.mock("../sim/practice.ts", () => ({ createPractice: () => ({ players: [{ character: "bobo" }], events: [] }) }));
vi.mock("./gameView.ts", () => ({
  runFixedLoop,
  GameView: class {
    constructor() { made(); }
    ingest() {}
    render(...args: unknown[]) { render(...args); }
    dispose() {}
  },
}));
vi.mock("./chatLine.ts", async (original) => {
  const { ChatLine } = await original<typeof import("./chatLine.ts")>();
  return { ChatLine: class extends ChatLine {
    open() { super.open(); chatLines.push(this); chatOpened(); }
    close() { const text = super.close(); chatClosed(); return text; }
    dispose() { super.dispose(); chatDisposed(); }
  } };
});
vi.mock("./input.ts", () => ({
  KeyState: class { endTick() {} }, soloKeys: () => ({}), boundCodes: () => new Set(), attachKeyboard: () => detach, isButtonActivation: () => false,
  readKeysWhileLoading: async (_keys: unknown, _bound: unknown, load: () => Promise<unknown>) => load(),
}));
vi.mock("./screenCapture.ts", () => ({ attachCapture: () => detach }));
vi.mock("./screenKit.ts", async (original) => ({
  ...await original<typeof import("./screenKit.ts")>(), freezeCanvas: () => ({}),
}));

let cancelled: boolean;
let options: PracticeGameOptions & { cancelled: () => boolean };

class Element extends EventTarget {
  readonly tagName: string;
  readonly attributes = new Map<string, string>();
  readonly style = {};
  value = "";
  selectionStart = 0;
  readOnly = false;
  constructor(tag: string) { super(); this.tagName = tag.toUpperCase(); }
  setAttribute(name: string, value: string) { this.attributes.set(name, value); }
  setSelectionRange(start: number, _end: number) { this.selectionStart = start; }
  focus() { dom.activeElement = this; }
  blur() { if (dom.activeElement === this) dom.activeElement = dom.body; }
  append() {}
  remove() { this.blur(); }
}
const elements: Element[] = [];
const dom = {
  body: new Element("body"), activeElement: null as Element | null, hasFocus: () => true,
  createElement: (tag: string) => { const element = new Element(tag); elements.push(element); return element; },
};

beforeEach(() => {
  vi.clearAllMocks();
  elements.length = 0;
  chatLines.length = 0;
  dom.activeElement = dom.body;
  cancelled = false;
  loadImage.mockResolvedValue({});
  loadSceneAssets.mockResolvedValue({ level: { meta: {} } });
  runFixedLoop.mockReturnValue(detach);
  vi.stubGlobal("window", new EventTarget());
  vi.stubGlobal("document", dom);
  const canvas = Object.assign(new EventTarget(), { getContext: () => ({}), parentElement: new Element("div") });
  options = {
    canvas: canvas as unknown as HTMLCanvasElement,
    local: { id: 1, name: "tester", character: "bobo" }, hue: 0,
    sounds: {} as PracticeGameOptions["sounds"],
    settings: defaultSettings(),
    announce() {}, onExit() {}, onTimeUp() {}, onFailed() {},
    cancelled: () => cancelled,
  };
});

afterEach(() => vi.unstubAllGlobals());

function key(code: string, value = code, ime?: { keyCode: number; isComposing: boolean }): Event {
  const event = Object.assign(new Event("keydown", { cancelable: true }), { code, key: value, ...ime });
  dom.activeElement?.dispatchEvent(event);
  window.dispatchEvent(event);
  return event;
}

function editor(): Element {
  return elements.findLast((element) => element.attributes.get("aria-label") === "채팅")!;
}

function type(text: string, composing = false): void {
  const input = editor(); input.value = text; input.setSelectionRange(text.length, text.length);
  input.dispatchEvent(Object.assign(new Event("input"), { isComposing: composing }));
}

describe("leaving practice while its pictures are loading", () => {
  it("does not start after the box pictures arrive if the screen has been left", async () => {
    let loaded!: () => void;
    loadImage.mockImplementationOnce(() => new Promise((resolve) => { loaded = () => resolve({}); }));
    const { startPracticeGame } = await import("./practiceGame.ts");
    const starting = startPracticeGame(options);
    cancelled = true;
    loaded();
    const stop = await starting;
    stop();
    expect(loadSceneAssets).not.toHaveBeenCalled();
    expect(made).not.toHaveBeenCalled();
    expect(runFixedLoop).not.toHaveBeenCalled();
  });

  it.each([1, 2])("does not build a view or attach game inputs when scene load %s arrives after leaving", async (load) => {
    let loaded!: () => void;
    let requested!: () => void;
    const request = new Promise<void>((resolve) => { requested = resolve; });
    if (load === 2) loadSceneAssets.mockResolvedValueOnce({ level: { meta: {} } });
    loadSceneAssets.mockImplementationOnce(() => {
      requested();
      return new Promise((resolve) => { loaded = () => resolve({ level: { meta: {} } }); });
    });
    const { startPracticeGame } = await import("./practiceGame.ts");
    const starting = startPracticeGame(options);
    await request;
    cancelled = true;
    loaded();
    const stop = await starting;
    stop();
    expect(made).not.toHaveBeenCalled();
    expect(runFixedLoop).not.toHaveBeenCalled();
    expect(detach).not.toHaveBeenCalled();
    expect(chatDisposed).toHaveBeenCalledOnce();
  });

  it("starts normally and stops once when the screen was kept", async () => {
    const { startPracticeGame } = await import("./practiceGame.ts");
    const stop = await startPracticeGame(options);
    expect(made).toHaveBeenCalledOnce();
    expect(runFixedLoop).toHaveBeenCalledOnce();
    stop();
    stop();
    expect(chatDisposed).toHaveBeenCalledOnce();
    expect(detach).toHaveBeenCalledTimes(3);
  });
});

describe("practice restart while its pictures are loading", () => {
  it.each([1, 2])("keeps one restart when Esc and NO are pressed again during scene load %s", async (load) => {
    const { startPracticeGame } = await import("./practiceGame.ts");
    const stop = await startPracticeGame(options);
    let loaded!: () => void;
    let requested!: () => void;
    const request = new Promise<void>((resolve) => { requested = resolve; });
    if (load === 2) loadSceneAssets.mockResolvedValueOnce({ level: { meta: {} } });
    loadSceneAssets.mockImplementationOnce(() => {
      requested();
      return new Promise((resolve) => { loaded = () => resolve({ level: { meta: {} } }); });
    });
    try {
      key("Escape");
      key("KeyN", "n");
      await request;
      key("Escape");
      key("KeyN", "n");
      expect(loadSceneAssets).toHaveBeenCalledTimes(2 + load);
      loaded();
      await vi.waitFor(() => expect(made).toHaveBeenCalledTimes(2));
      expect(loadSceneAssets).toHaveBeenCalledTimes(4);
      // The next practice can still open and answer its own Esc box.
      key("Escape");
      key("KeyN", "n");
      await vi.waitFor(() => expect(made).toHaveBeenCalledTimes(3));
    } finally {
      stop();
      loaded();
    }
  });

  it("drops chat, macro and help keys during loading and accepts them after the restart", async () => {
    const { startPracticeGame } = await import("./practiceGame.ts");
    const stop = await startPracticeGame(options);
    let loaded!: () => void;
    loadSceneAssets.mockImplementationOnce(() => new Promise((resolve) => { loaded = () => resolve({ level: { meta: {} } }); }));
    try {
      key("Escape");
      key("KeyN", "n");
      key("Enter");
      key("F2");
      key("F1");
      expect(chatOpened).not.toHaveBeenCalled();
      loaded();
      await vi.waitFor(() => expect(made).toHaveBeenCalledTimes(2));
      const draw = runFixedLoop.mock.calls[0][1];
      draw();
      expect(render).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ help: false }));
      key("Enter");
      expect(chatOpened).toHaveBeenCalledOnce();
      key("Escape");
      key("F2");
      expect(chatOpened).toHaveBeenCalledTimes(2);
      key("F1");
      draw();
      expect(render).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ help: true }));
    } finally {
      stop();
      loaded();
    }
  });
});

describe.each(["Enter", "Escape"])("practice IME %s", (code) => {
  it.each([true, false])("ignores a process key with isComposing=%s, then handles the ordinary key during composition", async (isComposing) => {
    const { startPracticeGame } = await import("./practiceGame.ts");
    options.announce = vi.fn();
    const stop = await startPracticeGame(options);
    try {
      key("Enter");
      type("앞");
      editor().dispatchEvent(new Event("compositionstart"));
      editor().dispatchEvent(Object.assign(new Event("compositionupdate"), { data: "한" }));
      type("앞한", true);
      expect(chatOpened).toHaveBeenCalledOnce();
      key(code, code, { keyCode: 229, isComposing });
      expect(chatClosed).not.toHaveBeenCalled();
      key(code, code, { keyCode: code === "Enter" ? 13 : 27, isComposing: true });
      expect(chatClosed).toHaveBeenCalledOnce();
      if (code === "Enter") expect(options.announce).toHaveBeenLastCalledWith("채팅: 앞");
      else expect(options.announce).not.toHaveBeenCalledWith("채팅: 앞");
    } finally {
      stop();
    }
  });
});

describe("practice box chat editing", () => {
  it.each(["x", "Backspace", "ArrowLeft", "ArrowRight", "Escape", "F5"])("consumes %s without making the editor read-only, before drawing", async (value) => {
    const { startPracticeGame } = await import("./practiceGame.ts");
    const stop = await startPracticeGame(options);
    try {
      key("Escape"); key("F10");
      expect(key(value, value).defaultPrevented).toBe(true);
      expect(editor().readOnly).toBe(false);
    } finally { stop(); }
  });

  it.each(["n", "Enter"])("accepts a new chat character after restarting with %s, before drawing", async (answer) => {
    const { startPracticeGame } = await import("./practiceGame.ts");
    options.announce = vi.fn();
    const stop = await startPracticeGame(options);
    try {
      key("Escape"); key("F10");
      const draw = runFixedLoop.mock.calls[0][1];
      draw(); expect(key("KeyX", "x").defaultPrevented).toBe(true);
      if (answer === "Enter") key("ArrowRight");
      expect(key(answer, answer).defaultPrevented).toBe(true);
      await vi.waitFor(() => expect(made).toHaveBeenCalledTimes(2));
      key("Enter"); expect(editor().readOnly).toBe(false);
      type("Z"); key("Enter");
      expect(options.announce).toHaveBeenLastCalledWith("채팅: Z");
    } finally { stop(); }
  });

  it.each(["Delete", "IME"])("lets %s edit the buffer while the box holds the record", async (edit) => {
    options.settings.macros[9] = "abc";
    const { startPracticeGame } = await import("./practiceGame.ts");
    const stop = await startPracticeGame(options);
    try {
      key("Escape"); key("F10");
      const input = editor();
      if (edit === "Delete") {
        input.setSelectionRange(2, 2);
        expect(key("Delete").defaultPrevented).toBe(false);
        if (!input.readOnly) type("ab");
      } else {
        expect(key("KeyR", "Process", { keyCode: 229, isComposing: true }).defaultPrevented).toBe(false);
        if (!input.readOnly) {
          input.dispatchEvent(new Event("compositionstart"));
          input.dispatchEvent(Object.assign(new Event("compositionupdate"), { data: "한" }));
          type("abc한", true);
          input.dispatchEvent(new Event("compositionend"));
        }
      }
      expect(input.value).toBe(edit === "Delete" ? "ab" : "abc한");
      expect(chatLines.at(-1)!.view().text).toBe("abc");
      const draw = runFixedLoop.mock.calls[0][1];
      draw();
      expect(render).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ chat: { balloons: [], line: null } }));
      expect(chatLines.at(-1)!.view().text).toBe("abc");
      key("KeyN", "n");
      await vi.waitFor(() => expect(made).toHaveBeenCalledTimes(2));
      key("Enter");
      expect(input.value).toBe("");
      expect(chatLines.at(-1)!.view().text).toBe("");
      type("X"); key("Enter");
    } finally { stop(); }
  });
});
