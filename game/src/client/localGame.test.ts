import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { layoutFromAscii, setups, VERSUS } from "../sim/testing.ts";
import type { MatchState } from "../sim/types.ts";
import type { GameViewOptions } from "./gameView.ts";
import { SOLO_KEYS, VERSUS_KEYS } from "./input.ts";
import { startLocalGame } from "./localGame.ts";
import { defaultSettings } from "./settings.ts";

const hooks = vi.hoisted(() => ({
  tick: (() => undefined) as () => void,
  draw: (() => undefined) as () => void,
  state: null as MatchState | null,
  views: [] as GameViewOptions[],
  load: vi.fn(), stopLoop: vi.fn(), dispose: vi.fn(), capture: vi.fn(), render: vi.fn(),
}));
vi.mock("../sim/level.ts", () => ({ layoutFromLevel: () => layoutFromAscii(["1...2", ".#.#.", "B..B."]) }));
vi.mock("./scene.ts", () => ({ loadSceneAssets: hooks.load }));
vi.mock("./screenCapture.ts", () => ({ attachCapture: () => hooks.capture }));
vi.mock("./gameView.ts", () => ({
  GameView: class {
    composition = {};
    constructor(_ctx: unknown, _assets: unknown, _sounds: unknown, options: GameViewOptions) { hooks.views.push(options); }
    ingest(state: MatchState) { hooks.state = state; }
    render(...args: unknown[]) { hooks.render(...args); }
    dispose() { hooks.dispose(); }
  },
  runFixedLoop(tick: () => void, draw: () => void) { hooks.tick = tick; hooks.draw = draw; return hooks.stopLoop; },
}));

class Element extends EventTarget {
  readonly tagName: string;
  readonly attributes = new Map<string, string>();
  readonly style = {};
  value = "";
  selectionStart = 0;
  removed = false;
  constructor(tag: string) { super(); this.tagName = tag.toUpperCase(); }
  setAttribute(name: string, value: string) { this.attributes.set(name, value); }
  hasAttribute(name: string) { return this.attributes.has(name); }
  setSelectionRange(start: number, _end: number) { this.selectionStart = start; }
  focus() { dom.activeElement = this; }
  blur() { if (dom.activeElement === this) dom.activeElement = dom.body; }
  append() {}
  remove() { this.removed = true; this.blur(); }
}
const elements: Element[] = [];
const dom = {
  body: new Element("body"), activeElement: null as Element | null, hasFocus: () => true,
  createElement: (tag: string) => { const element = new Element(tag); elements.push(element); return element; },
};

function key(type: string, code: string, value = code, keyCode = 0): Event {
  const event = new Event(type, { cancelable: true });
  Object.assign(event, { code, key: value, keyCode });
  dom.activeElement?.dispatchEvent(event);
  window.dispatchEvent(event);
  return event;
}

function type(text: string): void {
  const input = elements.at(-1)!;
  input.value = text;
  input.setSelectionRange(text.length, text.length);
  input.dispatchEvent(new Event("input"));
}

function drawn() {
  hooks.draw();
  return hooks.render.mock.calls.at(-1)![1] as { help: boolean; chat: { line: { text: string } | null; balloons: { slot: number; text: string }[] } };
}

beforeEach(() => {
  vi.clearAllMocks();
  hooks.views.length = 0;
  hooks.state = null;
  elements.length = 0;
  dom.activeElement = dom.body;
  hooks.load.mockResolvedValue({ level: { meta: {} } });
  vi.stubGlobal("window", new EventTarget());
  vi.stubGlobal("document", dom);
  vi.stubGlobal("HTMLElement", Element);
  vi.spyOn(Date, "now").mockReturnValue(23_000);
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("local match controllers", () => {
  const base = {
    canvas: { getContext: () => ({}) } as unknown as HTMLCanvasElement,
    levelId: "test", rules: VERSUS, sounds: {} as never, music: null, announce() {},
  };

  it("reads keys for the human, runs AI on fixed ticks, and keeps a playing host's Esc in the match", async () => {
    const [human, opponent] = setups(2);
    const onExit = vi.fn();
    const stop = await startLocalGame({ ...base, players: [{ setup: human, binding: SOLO_KEYS }, { setup: opponent, ai: true }], onExit });
    try {
      expect(hooks.views[0].localPlayerIds).toEqual([human.id]);
      for (let t = 0; t < 150; t++) hooks.tick();
      const state = hooks.state!;
      const startX = state.players[0].x;
      key("keydown", "ArrowRight");
      hooks.tick();
      key("keyup", "ArrowRight");
      expect(state.players[0].x).toBeGreaterThan(startX);
      let aiBombs = state.events.filter((event) => event.type === "bomb-placed" && event.owner === opponent.id).length, aiMoved = false;
      const x = state.players[1].x, y = state.players[1].y;
      for (let t = 0; t < 140; t++) {
        hooks.tick();
        aiBombs += state.events.filter((event) => event.type === "bomb-placed" && event.owner === opponent.id).length;
        aiMoved ||= state.players[1].x !== x || state.players[1].y !== y;
      }
      expect(aiMoved).toBe(true);
      expect(aiBombs).toBeGreaterThan(0);
      key("keydown", "Escape");
      const lastTick = state.tick;
      hooks.tick();
      expect(state.tick).toBe(lastTick + 1);
      expect(onExit).not.toHaveBeenCalled();
      stop();
      const stoppedTick = state.tick;
      hooks.tick();
      expect(state.tick).toBe(stoppedTick);
      expect(hooks.stopLoop).toHaveBeenCalledOnce();
      expect(hooks.dispose).toHaveBeenCalledOnce();
      expect(hooks.capture).toHaveBeenCalledOnce();
    } finally { stop(); }
  });

  it("keeps both existing keyboard players locally controlled", async () => {
    const players = setups(2).map((setup, i) => ({ setup, binding: VERSUS_KEYS[i] }));
    const stop = await startLocalGame({ ...base, players, onExit() {} });
    try {
      expect(hooks.views[0].localPlayerIds).toEqual([1, 2]);
      for (let t = 0; t < 150; t++) hooks.tick();
      const state = hooks.state!;
      const before = state.players.map((p) => p.y);
      key("keydown", "KeyS");
      key("keydown", "ArrowDown");
      hooks.tick();
      expect(state.players.map((p, i) => p.y > before[i])).toEqual([true, true]);
    } finally { stop(); }
  });

  it("uses the configured gamepad and falls back to the held keyboard when it disappears", async () => {
    const pad = { axes: [1, 0], buttons: [] };
    const getGamepads = vi.fn().mockReturnValue([pad]);
    vi.stubGlobal("navigator", { getGamepads });
    const stop = await startLocalGame({ ...base, players: [{ setup: setups(1)[0], binding: SOLO_KEYS }, { setup: setups(2)[1], ai: true }], settings: { ...defaultSettings(), control: 1 }, onExit() {} });
    try {
      for (let t = 0; t < 150; t++) hooks.tick();
      const player = hooks.state!.players[0];
      const x = player.x;
      key("keydown", "ArrowLeft");
      hooks.tick();
      expect(player.x).toBeGreaterThan(x);
      getGamepads.mockReturnValue([]);
      const afterPad = player.x;
      hooks.tick();
      expect(player.x).toBeLessThan(afterPad);
    } finally { stop(); }
  });

  it("never starts an AI match whose asset load was cancelled", async () => {
    let loaded!: (assets: unknown) => void;
    hooks.load.mockImplementation(() => new Promise((resolve) => { loaded = resolve; }));
    const cancel = new AbortController();
    const pending = startLocalGame({ ...base, players: [{ setup: setups(1)[0], binding: SOLO_KEYS }, { setup: setups(2)[1], ai: true }], signal: cancel.signal, onExit() {} });
    cancel.abort();
    loaded({ level: { meta: {} } });
    const stop = await pending;
    stop();
    expect(hooks.views).toHaveLength(0);
    expect(hooks.state).toBeNull();
    expect(elements).toHaveLength(0);
  });

  it.each(["keyboard", "assistive"])("leaves only the first wait through the %s exit and cleans up the editor", async (source) => {
    const onExit = vi.fn();
    let requestExit!: () => void;
    const stop = await startLocalGame({ ...base, players: [{ setup: setups(1)[0], binding: SOLO_KEYS }, { setup: setups(2)[1], ai: true }], onExit, setExitAction: (action) => { requestExit = action; } });
    try {
      expect(hooks.state!.phase).toBe("waiting");
      if (source === "keyboard") key("keydown", "Escape");
      else requestExit();
      const tick = hooks.state!.tick;
      hooks.tick();
      expect(hooks.state!.tick).toBe(tick);
      expect(onExit).toHaveBeenCalledOnce();
      expect(elements[0].removed).toBe(true);
      requestExit();
      expect(onExit).toHaveBeenCalledOnce();
    } finally { stop(); }
  });

  it("draws original help only on the field, keeps the world walking, and drops completed taps", async () => {
    const onExit = vi.fn();
    let requestExit!: () => void;
    const stop = await startLocalGame({ ...base, players: [{ setup: setups(1)[0], binding: SOLO_KEYS }, { setup: setups(2)[1], ai: true }], onExit, setExitAction: (action) => { requestExit = action; } });
    try {
      key("keydown", "F1");
      expect(drawn().help).toBe(false);
      for (let t = 0; t < 150; t++) hooks.tick();
      key("keydown", "ArrowRight");
      hooks.tick();
      const state = hooks.state!;
      const human = state.players[0];
      const x = human.x, tick = state.tick;
      key("keydown", "F1");
      key("keyup", "ArrowRight");
      expect(drawn().help).toBe(true);
      hooks.tick();
      expect(state.tick).toBe(tick + 1);
      expect(human.x).toBeGreaterThan(x);
      requestExit();
      expect(onExit).not.toHaveBeenCalled();
      key("keydown", "Space", " ");
      key("keyup", "Space", " ");
      key("keydown", "Escape");
      expect(drawn().help).toBe(false);
      hooks.tick();
      expect(state.bombs.filter((b) => b.owner === human.id)).toHaveLength(0);
      state.phase = "round-over";
      key("keydown", "F1");
      expect(drawn().help).toBe(false);
      requestExit();
      expect(onExit).not.toHaveBeenCalled();
    } finally { stop(); }
  });

  it.each(["Enter", "F1", "F5"])("handles a bound %s before polling its action, then reads keys still held on closing", async (code) => {
    const binding = { ...SOLO_KEYS, bomb: [code] };
    const stop = await startLocalGame({ ...base, players: [{ setup: setups(1)[0], binding }, { setup: setups(2)[1], ai: true }], settings: defaultSettings(), onExit() {} });
    try {
      for (let t = 0; t < 150; t++) hooks.tick();
      key("keydown", code);
      key("keyup", code);
      hooks.tick();
      expect(hooks.state!.bombs.filter((b) => b.owner === 1)).toHaveLength(0);
      key("keydown", "Escape");
      hooks.tick();
      expect(hooks.state!.bombs.filter((b) => b.owner === 1)).toHaveLength(0);
      key("keydown", code);
      key("keydown", "Escape");
      hooks.tick();
      expect(hooks.state!.bombs.filter((b) => b.owner === 1)).toHaveLength(1);
    } finally { stop(); }
  });

  it("uses the original chat line, recall, macros, phase gates and five-second balloon", async () => {
    let now = 10_000;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    const settings = defaultSettings();
    settings.macros[4] = "단축 메시지";
    const stop = await startLocalGame({ ...base, players: [{ setup: setups(1)[0], binding: SOLO_KEYS }, { setup: setups(2)[1], ai: true }], settings, onExit() {} });
    try {
      key("keydown", "Enter");
      type("대기 중");
      expect(drawn().chat.line).toBeNull();
      key("keydown", "Enter");
      for (let t = 0; t < 150; t++) hooks.tick();
      expect(drawn().chat.balloons).toEqual([]);
      key("keydown", "Enter");
      key("keydown", "ArrowUp");
      expect(drawn().chat.line?.text).toBe("대기 중");
      type("  안녕  ");
      key("keydown", "Enter", "Enter", 229);
      expect(drawn().chat.line).not.toBeNull();
      key("keydown", "Enter");
      expect(drawn().chat).toMatchObject({ line: null, balloons: [{ slot: 0, text: "  안녕" }] });
      now += 4999;
      expect(drawn().chat.balloons).toHaveLength(1);
      now++;
      expect(drawn().chat.balloons).toEqual([]);
      key("keydown", "F5");
      expect(drawn().chat.line?.text).toBe("단축 메시지");
      key("keydown", "Escape");
      expect(drawn().chat.line).toBeNull();
      hooks.state!.phase = "match-over";
      key("keydown", "Enter");
      expect(elements[0].value).toBe("");
      expect(drawn().chat).toMatchObject({ line: null, balloons: [] });
    } finally { stop(); }
  });
});
