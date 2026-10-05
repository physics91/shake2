import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { layoutFromLevel } from "../sim/level.ts";
import { step } from "../sim/match.ts";
import { createPractice } from "../sim/practice.ts";
import { nowMs } from "../sim/constants.ts";
import { CURSE_MS } from "../sim/status.ts";
import { Dir } from "../sim/types.ts";
import type { MatchState } from "../sim/types.ts";
import { fromWireState, toWireState } from "../server/protocol.ts";
import type { LevelAssets, Sheet } from "./assets.ts";
import { blindWindow, drawBlindFilter, resetBlindCentre } from "./blind.ts";
import { BadStateAnimation, MarkerAnimations, PanelFaces, renderScreen } from "./renderer.ts";
import { loadSceneAssets } from "./scene.ts";

const { image, sheet } = vi.hoisted(() => ({
  image: (src: string) => ({ src } as HTMLImageElement),
  sheet: (dir: string, name: string): Sheet => ({
    image: { src: `${dir}/${name}` } as HTMLImageElement,
    meta: {
      source: name, sheet: name, name, width: 1, height: 1,
      animations: Array.from({ length: 40 }, () => ({
        name: "", unknown_u16: 5,
        frames: [{ index: 0, anchor: [0, 0], rect: [0, 0, 1, 1] }],
      })),
    },
  }),
}));

vi.mock("./assets.ts", () => ({
  loadSheet: async (dir: string, name: string) => sheet(dir, name),
  loadImage: async (src: string) => image(src),
  loadImageSheet: async (name: string) => sheet("image", name),
  loadLevel: async () => ({
    background: image("map"), bricks: [],
    meta: { area: [50, 50, 650, 530], fixed: [], bricks: [], objects: [] },
  }) as unknown as LevelAssets,
}));
vi.mock("./sprite.ts", async (original) => ({
  ...await original<typeof import("./sprite.ts")>(),
  blitBlended: vi.fn(), drawFrameOrHalf: vi.fn(), drawFrame: vi.fn(),
}));
vi.mock("./text.ts", async (original) => ({
  ...await original<typeof import("./text.ts")>(), outlinedText: vi.fn(), plainText: vi.fn(),
}));
vi.mock("./blind.ts", async (original) => ({
  ...await original<typeof import("./blind.ts")>(), drawBlindFilter: vi.fn(),
}));

const map = JSON.parse(readFileSync(new URL("../../public/assets/maps/practice.json", import.meta.url), "utf8"));
const layout = layoutFromLevel("practice", map);
const neutral = { dir: null, bomb: false };

function appleFlame(): MatchState {
  const state = createPractice(layout, { id: 1, name: "P1", character: "shaky" }, 1);
  for (let i = 0; i < 8; i++) step(state, { 1: { dir: Dir.Left, bomb: false } });
  for (let i = 0; i < 6; i++) step(state, { 1: { dir: Dir.Down, bomb: false } });
  const own = state.players.find((p) => p.id === 1)!;
  expect(own.inv.apple).toBe(1);
  step(state, { 1: { dir: null, bomb: true } });
  step(state, { 1: neutral });
  step(state, { 1: { ...neutral, attack: true } });
  while (own.status.blind === null) step(state, { 1: neutral });
  return state;
}

async function draw(state: MatchState, wire = false, help = false) {
  const assets = await loadSceneAssets("practice", state.players.map((p) => p.character));
  const backgrounds: number[][] = [];
  const ctx = {
    drawImage(source: unknown, ...args: number[]) { if (source === assets.level.background) backgrounds.push(args); },
    save() {}, restore() {}, fillRect() {}, measureText: () => ({ width: 0 }),
  } as unknown as CanvasRenderingContext2D;
  const shown = wire ? fromWireState(JSON.parse(JSON.stringify(toWireState(state))), layout) : state;
  vi.mocked(drawBlindFilter).mockClear();
  const present = renderScreen(ctx, assets, shown, {
    localPlayerIds: [1], hostId: null, hurryTick: null, lastRoundDraw: false,
    faces: new PanelFaces(), markers: new MarkerAnimations(), badState: new BadStateAnimation(),
    help,
  });
  return { backgrounds, filters: vi.mocked(drawBlindFilter).mock.calls.map(([, , win]) => win), present };
}

beforeEach(() => resetBlindCentre());

describe("blind frame order after a real Apple pickup and flame", () => {
  it.each([false, true])("draws the full background on the first blind tick and presents the retained centre (wire=%s)", async (wire) => {
    const state = appleFlame();
    const result = await draw(state, wire);
    expect(result.backgrounds).toEqual([[0, 0, 800, 600]]);
    expect(result.filters).toEqual([]);
    expect(result.present).toEqual(blindWindow(0, 0));
  });

  it.each([false, true])("uses the point before the current movement for the background, filter and present (wire=%s)", async (wire) => {
    const state = appleFlame();
    const own = state.players.find((p) => p.id === 1)!;
    const old = { x: own.x, y: own.y };
    step(state, { 1: { dir: Dir.Up, bomb: false } });
    expect(own.y).toBe(old.y - 5);
    const win = blindWindow(50 + old.x, 50 + old.y);
    const result = await draw(state, wire);
    expect(result.backgrounds).toEqual([[win.left, win.top, win.width, win.height, win.left, win.top, win.width, win.height]]);
    expect(result.filters).toEqual([win]);
    expect(result.present).toEqual(win);
    expect(await draw(state, wire)).toEqual(result);
  });

  it.each([false, true])("keeps the frame's crop and filter on the expiry tick while the present becomes full (wire=%s)", async (wire) => {
    const state = appleFlame();
    const own = state.players.find((p) => p.id === 1)!;
    while (state.bombs.length > 0) step(state, { 1: neutral });
    const start = own.status.blind!;
    while (nowMs(state.tick + 1) - start <= CURSE_MS) step(state, { 1: neutral });
    const win = blindWindow(50 + own.x, 50 + own.y);
    step(state, { 1: neutral });
    expect(own.status.blind).toBeNull();
    const result = await draw(state, wire);
    expect(result.backgrounds).toEqual([[win.left, win.top, win.width, win.height, win.left, win.top, win.width, win.height]]);
    expect(result.filters).toEqual([win]);
    expect(result.present).toBeNull();
    step(state, { 1: neutral });
    expect((await draw(state, wire)).backgrounds).toEqual([[0, 0, 800, 600]]);
  });

  it.each([false, true])("retains the centre while F1 skips the background and filter (wire=%s)", async (wire) => {
    const state = appleFlame();
    step(state, { 1: neutral });
    const previous = (await draw(state, wire)).present;
    step(state, { 1: { dir: Dir.Up, bomb: false } });
    const result = await draw(state, wire, true);
    expect(result.backgrounds).toEqual([]);
    expect(result.filters).toEqual([]);
    expect(result.present).toEqual(previous);
  });

  it.each([false, true])("keeps the last centre when a restarted practice first blinds again (wire=%s)", async (wire) => {
    const old = appleFlame();
    step(old, { 1: neutral });
    const previous = (await draw(old, wire)).present;
    const next = appleFlame();
    const result = await draw(next, wire);
    expect(result.backgrounds).toEqual([[0, 0, 800, 600]]);
    expect(result.filters).toEqual([]);
    expect(result.present).toEqual(previous);
  });
});
