import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createPractice } from "../sim/practice.ts";
import { layoutFromLevel } from "../sim/level.ts";
import { step } from "../sim/match.ts";
import type { MatchState } from "../sim/types.ts";
import { defaultSettings } from "./settings.ts";
import { runFixedLoop } from "./gameView.ts";
import { startPracticeGame } from "./practiceGame.ts";

const { loadSceneAssets, renderScreen } = vi.hoisted(() => ({ loadSceneAssets: vi.fn(), renderScreen: vi.fn() }));
vi.mock("./assets.ts", () => ({ loadImage: async () => ({}) }));
vi.mock("./scene.ts", () => ({ loadSceneAssets }));
vi.mock("./renderer.ts", async (original) => ({ ...await original<typeof import("./renderer.ts")>(), renderScreen }));
vi.mock("./chatLine.ts", () => ({ ChatLine: class {
  isOpen = false;
  deferChanges() {}
  dispose() {}
} }));

class Canvas extends EventTarget {
  width = 800;
  height = 600;
  parentElement = {};
  readonly ctx = {
    canvas: this, fillStyle: "", globalAlpha: 1,
    fillRect() {}, drawImage() {}, save() {}, restore() {},
  };
  getContext() { return this.ctx; }
  getBoundingClientRect() { return { left: 0, top: 0, width: 800, height: 600 }; }
}

let now = 0, serial = 0;
const raf = new Map<number, FrameRequestCallback>();
beforeEach(() => {
  vi.clearAllMocks();
  raf.clear(); now = 0;
  vi.stubGlobal("window", new EventTarget());
  vi.stubGlobal("document", { createElement: () => new Canvas() });
  vi.spyOn(performance, "now").mockImplementation(() => now);
  vi.spyOn(Date, "now").mockReturnValue(23_000);
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => { const id = ++serial; raf.set(id, cb); return id; });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => raf.delete(id));
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function frame(at: number) {
  now = at;
  const callbacks = [...raf.values()]; raf.clear();
  for (const cb of callbacks) cb(now);
}

describe("practice fixed ticks at browser frame boundaries", () => {
  it("does not draw or schedule the practice after its real time-up exit", async () => {
    const meta = JSON.parse(readFileSync(new URL("../../public/assets/maps/practice.json", import.meta.url), "utf8"));
    loadSceneAssets.mockResolvedValue({ level: { meta }, cursor: { meta: { animations: [{ unknown_u16: 5, frames: [{}] }] } } });
    let left = false, drawsAfterExit = 0;
    const canvas = new Canvas();
    vi.spyOn(canvas.ctx, "drawImage").mockImplementation(() => { if (left) drawsAfterExit++; });
    renderScreen.mockReturnValue(null);
    const onTimeUp = vi.fn(() => { left = true; });
    const stop = await startPracticeGame({
      canvas: canvas as unknown as HTMLCanvasElement, local: { id: 1, name: "P1", character: "rookie" }, hue: 0,
      sounds: { effects: true, play() {}, stop() {}, stopMusic() {}, playMusic() {} } as never,
      settings: defaultSettings(), announce() {}, onExit() {}, onTimeUp, onFailed() {},
    });
    try {
      for (let i = 1; i <= 700 && !left; i++) frame(i * 250);
      expect(onTimeUp).toHaveBeenCalledOnce();
      expect({ drawsAfterExit, pending: raf.size }).toEqual({ drawsAfterExit: 0, pending: 0 });
    } finally { stop(); }
  });

  it.each([30, 60, 120, 144].flatMap((hz) => [0, 1.25, 1000, 1_000_000_000].map((origin) => ({ hz, origin }))))(
    "matches the complete practice state at $hz Hz, origin $origin", async ({ hz, origin }) => {
      now = origin;
      const meta = JSON.parse(readFileSync(new URL("../../public/assets/maps/practice.json", import.meta.url), "utf8"));
      loadSceneAssets.mockResolvedValue({ level: { meta }, cursor: { meta: { animations: [{ unknown_u16: 5, frames: [{}] }] } } });
      renderScreen.mockReturnValue(null);
      const local = { id: 1, name: "P1", character: "rookie" };
      const reference = createPractice(layoutFromLevel("practice", meta), local, 23);
      const stop = await startPracticeGame({
        canvas: new Canvas() as unknown as HTMLCanvasElement, local, hue: 0,
        sounds: { effects: true, play() {}, stop() {}, stopMusic() {}, playMusic() {} } as never,
        settings: defaultSettings(), announce() {}, onExit() {}, onTimeUp() {}, onFailed() {},
      });
      try {
        for (let i = 1; i <= hz; i++) {
          while (reference.tick < Math.floor(i * 30 / hz)) step(reference, { 1: { dir: null, bomb: false, attack: false, evade: false } });
          frame(origin + i * 1000 / hz);
          const drawn = renderScreen.mock.calls.at(-1)![2] as MatchState;
          expect(drawn.tick, "frame " + i).toBe(reference.tick);
          expect(drawn).toEqual(reference);
        }
        expect(renderScreen).toHaveBeenCalledTimes(hz);
      } finally { stop(); }
    },
  );
});

describe("fixed loop timing limits", () => {
  it.each([34, 200, 10_000])("stops catch-up, drawing and RAF scheduling when a tick ends the loop at %s ms", (at) => {
    const draw = vi.fn();
    let ticks = 0;
    const stop = runFixedLoop(() => { ticks++; stop(); }, draw);
    frame(at);
    expect(ticks).toBe(1);
    expect(draw).not.toHaveBeenCalled();
    expect(raf.size).toBe(0);
  });

  it("does not schedule another RAF when drawing ends the loop", () => {
    const stop = runFixedLoop(() => undefined, () => stop());
    frame(34);
    expect(raf.size).toBe(0);
  });

  it("never starts a frame after an external stop", () => {
    const tick = vi.fn(), draw = vi.fn();
    const stop = runFixedLoop(tick, draw);
    stop(); frame(200);
    expect(tick).not.toHaveBeenCalled();
    expect(draw).not.toHaveBeenCalled();
    expect(raf.size).toBe(0);
  });

  it.each([0, 1000, 1_000_000_000])("keeps a call 0.01 ms before the boundary early, origin %s", (origin) => {
    now = origin;
    const tick = vi.fn(), draw = vi.fn();
    const stop = runFixedLoop(tick, draw);
    frame(origin + 1000 / 30 - 0.01);
    expect(tick).not.toHaveBeenCalled();
    frame(origin + 1000 / 30);
    expect(tick).toHaveBeenCalledOnce();
    expect(draw).toHaveBeenCalledTimes(2);
    stop();
  });

  it("keeps the fractional remainder when a long pause is capped", () => {
    const tick = vi.fn();
    const stop = runFixedLoop(tick, () => undefined);
    frame(10_000);
    expect(tick).toHaveBeenCalledTimes(7);
    frame(10_000 + 1000 / 60);
    expect(tick).toHaveBeenCalledTimes(8);
    stop();
  });
});
