import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { LevelAssets, Sheet } from "./assets.ts";
import type { SoundBank } from "./audio.ts";
import { GameView, runFixedLoop } from "./gameView.ts";
import { loadSceneAssets } from "./scene.ts";
import { createMatch, step } from "../sim/match.ts";
import { layoutFromAscii, PRACTICE, runUntil, setups, VERSUS } from "../sim/testing.ts";

vi.mock("./assets.ts", () => {
  const image = (src: string) => ({ src } as HTMLImageElement);
  const sheet = (path: string): Sheet => ({
    image: image(path),
    meta: JSON.parse(readFileSync(new URL(`../../public/assets/${path}.json`, import.meta.url), "utf8")),
  });
  return {
    loadSheet: async (dir: string, name: string) => sheet(`spr/${dir}/${name}`),
    loadImageSheet: async (name: string) => sheet(`image/${name}`),
    loadImage: async (src: string) => image(src),
    loadLevel: async (id: string) => ({
      id, background: image("map"), bricks: [],
      meta: { area: [51, 51, 651, 531], fixed: [], bricks: [], objects: [] },
    }) as unknown as LevelAssets,
  };
});
vi.mock("./sprite.ts", async (original) => ({
  ...await original<typeof import("./sprite.ts")>(), blitBlended: vi.fn(),
}));
vi.mock("./text.ts", async (original) => ({
  ...await original<typeof import("./text.ts")>(), outlinedText: vi.fn(), plainText: vi.fn(),
}));

class Canvas extends EventTarget {
  width = 800;
  height = 600;
  readonly ctx = {
    canvas: this, drawImage: vi.fn<(...args: unknown[]) => void>(), fillRect() {}, save() {}, restore() {},
    measureText: (text: string) => ({ width: text.length * 8 }),
  };
  getContext() { return this.ctx; }
  getBoundingClientRect() { return { left: 0, top: 0, width: 800, height: 600 }; }
}

let now = 0, serial = 0;
const raf = new Map<number, FrameRequestCallback>();
beforeEach(() => {
  raf.clear(); now = 0;
  vi.stubGlobal("document", { createElement: () => new Canvas() });
  vi.stubGlobal("window", new EventTarget());
  vi.spyOn(performance, "now").mockImplementation(() => now);
  vi.spyOn(Math, "random").mockReturnValue(0.5);
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => { const id = ++serial; raf.set(id, cb); return id; });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => raf.delete(id));
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function frame(at: number) {
  now = at;
  const callbacks = [...raf.values()]; raf.clear();
  for (const cb of callbacks) cb(now);
}

async function fixture(options: { network?: boolean; fade?: boolean; waiting?: boolean } = {}) {
  const state = createMatch(layoutFromAscii(["1......2......."]), setups(options.network ? 2 : 1), options.network ? VERSUS : PRACTICE, 23);
  if (!options.waiting) runUntil(state, () => state.phase === "playing", 300);
  const assets = await loadSceneAssets("test", ["rookie"]);
  const canvas = new Canvas();
  const view = new GameView(canvas.ctx as unknown as CanvasRenderingContext2D, assets,
    { effects: true, stopMusic() {}, playMusic() {}, play() {}, stop() {} } as unknown as SoundBank,
    { localPlayerIds: [1], hostId: null, music: null, fadeFrom: options.fade ? new Canvas() as unknown as HTMLCanvasElement : undefined });
  canvas.dispatchEvent(Object.assign(new Event("pointermove"), {
    isPrimary: true, pointerType: "mouse", pointerId: 1, button: -1, buttons: 0, clientX: 300, clientY: 250,
  }));
  const composition = view.composition as unknown as Canvas;
  const draw = (extra: { help?: boolean; overlay?: (ctx: CanvasRenderingContext2D) => void } = {}) => {
    composition.ctx.drawImage.mockClear();
    view.render(state, extra);
    return composition.ctx.drawImage.mock.calls.flatMap(([source, left]) =>
      (source as HTMLImageElement).src === "image/cursor"
        ? [assets.cursor.meta.animations[0].frames.findIndex((f) => f.rect[0] === left)] : []);
  };
  return { state, view, draw };
}

describe("game cursor uses the original 30 fps integer timer", () => {
  it.each([30, 60, 120, 144].flatMap((hz) => [0, 1.25, 1000, 1_000_000_000].map((origin) => ({ hz, origin }))))(
    "keeps the native cursor frames at $hz Hz, origin $origin", async ({ hz, origin }) => {
      now = origin;
      const { state, view, draw } = await fixture();
      expect(draw()).toEqual([1]);
      let browserFrame = 0;
      const stop = runFixedLoop(() => step(state, {}), () => {
        // 0x43f070/0x4620e0 at 30 fps: strict >200 integer ms advances every seventh frame.
        const sceneFrame = Math.floor(browserFrame * 30 / hz);
        expect(draw(), `RAF ${browserFrame}`).toEqual([(1 + Math.floor(sceneFrame / 7)) % 4]);
      });
      try {
        for (browserFrame = 1; browserFrame <= hz * 10; browserFrame++) frame(origin + browserFrame * 1000 / hz);
      } finally { stop(); view.dispose(); }
    },
  );

  it("keeps animating while the same network snapshot is redrawn", async () => {
    const { view, draw } = await fixture();
    try {
      expect(draw()).toEqual([1]);
      now = 201; expect(draw()).toEqual([1]);
      now = 1000 / 30 * 7; expect(draw()).toEqual([2]);
      now = 1000; expect(draw()).toEqual([3]); // a skipped scene advances once, without catching up
      expect(draw()).toEqual([3]);
    } finally { view.dispose(); }
  });

  it.each([0, 1.25, 1000, 1_000_000_000])("starts the first help cursor after a field without one, origin %s", async (origin) => {
    now = origin;
    const { view, draw } = await fixture({ network: true });
    try {
      expect(draw()).toEqual([]);
      now = origin + 7 * 1000 / 30;
      expect(draw({ help: true })).toEqual([1]);
    } finally { view.dispose(); }
  });

  it("leaves the cursor timer alone through the real wait and countdown", async () => {
    const { state, view, draw } = await fixture({ network: true, waiting: true });
    try {
      expect(draw()).toEqual([]);
      for (let tick = 1; state.phase !== "playing" && tick <= 300; tick++) {
        step(state, {}); now = tick * 1000 / 30;
        expect(draw()).toEqual([]);
      }
      expect(state.phase).toBe("playing");
      expect(draw({ help: true })).toEqual([1]);
    } finally { view.dispose(); }
  });

  it("advances once when help reappears after hidden field frames", async () => {
    const { view, draw } = await fixture({ network: true });
    try {
      expect(draw({ help: true })).toEqual([1]);
      for (let tick = 1; tick <= 14; tick++) {
        now = tick * 1000 / 30; expect(draw()).toEqual([]);
      }
      now = 500; expect(draw({ help: true })).toEqual([2]);
    } finally { view.dispose(); }
  });

  it.each([30, 60].flatMap((hz) => [0, 1000].map((origin) => ({ hz, origin }))))(
    "starts the cursor on its first scene after fade out at $hz Hz, origin $origin", async ({ hz, origin }) => {
      now = origin;
      const { view, draw } = await fixture({ fade: true });
      try {
        let first: number[] = [];
        for (let frame = 0; frame <= hz; frame++) {
          now = origin + frame * 1000 / hz;
          first = draw();
          if (first.length > 0) break;
        }
        expect(first).toEqual([1]);
      } finally { view.dispose(); }
    },
  );

  it("advances only once when the first draw itself is delayed", async () => {
    const { view, draw } = await fixture({ network: true });
    try {
      now = 1000; expect(draw({ help: true })).toEqual([1]);
      expect(draw({ help: true })).toEqual([1]);
      now = 1200; expect(draw({ help: true })).toEqual([1]);
      now = 1000 + 7 * 1000 / 30; expect(draw({ help: true })).toEqual([2]);
    } finally { view.dispose(); }
  });

  it("keeps the same timer frame for the overlay and help draws in one scene", async () => {
    const { view, draw } = await fixture({ network: true });
    try {
      expect(draw({ overlay() {}, help: true })).toEqual([1, 1]);
      now = 7 * 1000 / 30;
      expect(draw({ overlay() {}, help: true })).toEqual([2, 2]);
    } finally { view.dispose(); }
  });
});
