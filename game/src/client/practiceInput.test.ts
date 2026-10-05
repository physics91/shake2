import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { PracticeGameOptions } from "./practiceGame.ts";
import { defaultSettings } from "./settings.ts";

const { loadSceneAssets, runFixedLoop, step } = vi.hoisted(() => ({ loadSceneAssets: vi.fn(), runFixedLoop: vi.fn(), step: vi.fn() }));
vi.mock("./assets.ts", () => ({ loadImage: async () => ({}) }));
vi.mock("./scene.ts", () => ({ loadSceneAssets }));
vi.mock("../sim/level.ts", () => ({ PRACTICE_MAP: "practice", layoutFromLevel: () => ({}) }));
vi.mock("../sim/practice.ts", () => ({ createPractice: () => ({ players: [{ character: "bobo" }], events: [] }) }));
vi.mock("../sim/match.ts", () => ({ step }));
vi.mock("./gameView.ts", () => ({
  runFixedLoop,
  GameView: class {
    ingest() {}
    render() {}
    dispose() {}
  },
}));
vi.mock("./chatLine.ts", () => ({ ChatLine: class {
  isOpen = false;
  open() { this.isOpen = true; }
  close() { this.isOpen = false; return ""; }
  deferChanges() {}
  dispose() {}
} }));
vi.mock("./screenCapture.ts", () => ({ attachCapture: () => () => undefined }));

// The scene and real keyboard adapter share window events; rendering and fixed ticks are manual.
class Editor extends EventTarget {
  tagName = "INPUT";
  hasAttribute(name: string) { return name === "data-direct-input"; }
}

let stop: () => void;
let tick: () => void;
let options: PracticeGameOptions;
beforeEach(async () => {
  vi.clearAllMocks();
  loadSceneAssets.mockResolvedValue({ level: { meta: {} } });
  vi.stubGlobal("window", new EventTarget());
  vi.stubGlobal("HTMLElement", Editor);
  runFixedLoop.mockImplementation((onTick: () => void) => {
    tick = onTick;
    return () => undefined;
  });
  const canvas = Object.assign(new EventTarget(), {
    getContext: () => ({}), parentElement: {},
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }),
  });
  const { startPracticeGame } = await import("./practiceGame.ts");
  options = {
    canvas: canvas as unknown as HTMLCanvasElement,
    local: { id: 1, name: "tester", character: "bobo" }, hue: 0,
    sounds: { play: vi.fn() } as unknown as PracticeGameOptions["sounds"], settings: defaultSettings(),
    announce() {}, onExit: vi.fn(), onTimeUp() {}, onFailed() {},
  };
  stop = await startPracticeGame(options);
});
afterEach(() => {
  stop();
  vi.unstubAllGlobals();
});

function key(code: string, type = "keydown"): void {
  const event = new Event(type, { cancelable: true });
  Object.assign(event, { code, key: code === "Space" ? " " : code, repeat: false });
  Object.defineProperty(event, "target", { value: new Editor() });
  window.dispatchEvent(event);
}

function pointer(type: string, fields: Partial<PointerEvent> = {}) {
  options.canvas.dispatchEvent(Object.assign(new Event(type), {
    pointerId: 1, isPrimary: true, button: 0, buttons: type === "pointerdown" ? 1 : 0,
    clientX: 356, clientY: 348, ...fields,
  }));
}

describe("practice box pointer input", () => {
  it("ignores a right click, then accepts a fresh left click on YES", () => {
    key("Escape");
    pointer("pointerdown", { button: 2, buttons: 2 });
    pointer("pointerup", { button: 2 });
    expect(options.onExit).not.toHaveBeenCalled();
    pointer("pointerdown");
    pointer("pointerup");
    expect(options.onExit).toHaveBeenCalledOnce();
  });

  it.each(["pointercancel", "lostpointercapture", "blur"])("drops a press after %s without activating YES", (type) => {
    key("Escape");
    pointer("pointerdown");
    if (type === "blur") window.dispatchEvent(new Event("blur"));
    else pointer(type);
    pointer("pointerup");
    expect(options.onExit).not.toHaveBeenCalled();
  });

  it("ignores a second pointer's YES while the first pointer holds NO", () => {
    key("Escape");
    pointer("pointerdown", { clientX: 448 });
    pointer("pointerdown", { pointerId: 2, isPrimary: false });
    pointer("pointerup", { pointerId: 2, isPrimary: false });
    expect(options.onExit).not.toHaveBeenCalled();
  });
});

describe.each(["Enter", "F1"])("practice input paused by %s", (toggle) => {
  it("drops an action tapped and released before the pause closes between ticks", () => {
    key(toggle);
    key("Space");
    key("Space", "keyup");
    key(toggle);
    tick();
    expect(step).toHaveBeenLastCalledWith(expect.anything(), { 1: { dir: null, bomb: false, attack: false, evade: false } });
  });

  it("still reads an action held when the pause closes", () => {
    key(toggle);
    key("Space");
    key(toggle);
    tick();
    expect(step).toHaveBeenLastCalledWith(expect.anything(), { 1: { dir: null, bomb: true, attack: false, evade: false } });
  });
});

it("keeps an ordinary game tap between ticks", () => {
  key("Space");
  key("Space", "keyup");
  tick();
  expect(step).toHaveBeenLastCalledWith(expect.anything(), { 1: { dir: null, bomb: true, attack: false, evade: false } });
});

describe("keys pressed while practice loads", () => {
  it("stops capturing keys as soon as a pending load is cancelled", async () => {
    stop();
    const cancel = new AbortController();
    let loaded!: () => void;
    let requested!: () => void;
    const request = new Promise<void>((resolve) => { requested = resolve; });
    loadSceneAssets.mockImplementationOnce(() => {
      requested();
      return new Promise((resolve) => { loaded = () => resolve({ level: { meta: {} } }); });
    });
    const { startPracticeGame } = await import("./practiceGame.ts");
    const starting = startPracticeGame({ ...options, cancelled: () => cancel.signal.aborted, signal: cancel.signal });
    await request;
    cancel.abort();
    const event = new Event("keydown", { cancelable: true });
    Object.assign(event, { code: "Space", key: " ", repeat: false });
    Object.defineProperty(event, "target", { value: new EventTarget() });
    window.dispatchEvent(event);
    loaded();
    stop = await starting;
    expect(event.defaultPrevented).toBe(false);
  });

  it.each([
    ["ControlLeft", false, { bomb: false, attack: true }],
    ["Space", false, { bomb: true, attack: false }],
    ["Space", true, { bomb: false, attack: false }],
  ] as const)("reads %s held through loading, with released=%s", async (code, released, expected) => {
    stop();
    let loaded!: () => void;
    let requested!: () => void;
    const request = new Promise<void>((resolve) => { requested = resolve; });
    loadSceneAssets.mockImplementationOnce(() => {
      requested();
      return new Promise((resolve) => { loaded = () => resolve({ level: { meta: {} } }); });
    });
    const { startPracticeGame } = await import("./practiceGame.ts");
    const starting = startPracticeGame(options);
    await request;
    key(code);
    if (released) key(code, "keyup");
    loaded();
    stop = await starting;
    tick();
    expect(step).toHaveBeenLastCalledWith(expect.anything(), { 1: { dir: null, evade: false, ...expected } });
  });
});
