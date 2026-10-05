import { describe, expect, it, vi } from "vitest";

import type { LevelAssets, Sheet } from "./assets.ts";
import { createMatch, removePlayer, step } from "../sim/match.ts";
import { layoutFromAscii, runUntil, setups, VERSUS } from "../sim/testing.ts";
import { BadStateAnimation, MarkerAnimations, PanelFaces, renderField } from "./renderer.ts";
import { loadSceneAssets } from "./scene.ts";

const { image, sheet } = vi.hoisted(() => {
  const images = new Map<string, HTMLImageElement>();
  const image = (src: string) => {
    if (!images.has(src)) images.set(src, { src } as HTMLImageElement);
    return images.get(src)!;
  };
  const sheet = (dir: string, name: string): Sheet => ({
    image: image(`${dir}/${name}`),
    meta: {
      source: name, sheet: name, name, width: 1, height: 1,
      animations: Array.from({ length: 40 }, () => ({
        name: "", unknown_u16: 10,
        frames: [{ index: 0, anchor: [0, 0], rect: [0, 0, 1, 1] }],
      })),
    },
  });
  return { image, sheet };
});

vi.mock("./assets.ts", () => ({
  loadSheet: async (dir: string, name: string) => sheet(dir, name),
  loadImage: async (src: string) => image(src),
  loadImageSheet: async (name: string) => sheet("image", name),
  loadLevel: async (id: string) => ({
    id, background: image("map"), bricks: [],
    meta: { area: [0, 0, 360, 32], fixed: [], bricks: [], objects: [] },
  }) as unknown as LevelAssets,
}));

// Shadows and the candy blend read pixels; the bomb's actual drawImage call is kept.
vi.mock("./sprite.ts", async (original) => ({
  ...await original<typeof import("./sprite.ts")>(), blitBlended: vi.fn(),
}));

vi.mock("./text.ts", async (original) => ({
  ...await original<typeof import("./text.ts")>(), outlinedText: vi.fn(), plainText: vi.fn(),
}));

function drawing() {
  const drawImage = vi.fn();
  const ctx = {
    drawImage, fillRect() {}, fillText() {}, save() {}, restore() {},
    measureText: (text: string) => ({ width: text.length * 8 }),
  } as unknown as CanvasRenderingContext2D;
  return { ctx, bombImages: () => drawImage.mock.calls
    .map(([source]) => (source as HTMLImageElement).src)
    .filter((src) => src?.startsWith("bomb/bomb_")) };
}

describe("bombs after their owner leaves", () => {
  it("keeps the original bomb picture and still burns a remaining player", async () => {
    const players = setups(3);
    players[0].character = "bobo";
    players[1].character = "rookie";
    players[2].character = "doona";
    const state = createMatch(layoutFromAscii(["1.3.....2"]), players, VERSUS, 1);
    const assets = await loadSceneAssets("test", players.map((p) => p.character), players.map((p) => ({
      id: p.id, character: p.character, hue: 0, face: true, head: false,
    })));
    const view = { localPlayerIds: [2], hostId: 2, hurryTick: null, lastRoundDraw: false, faces: new PanelFaces(), markers: new MarkerAnimations(), badState: new BadStateAnimation() };
    runUntil(state, () => state.phase === "playing", 300);
    step(state, { 1: { dir: null, bomb: true } });
    const before = drawing();
    renderField(before.ctx, assets, state, view);
    expect(before.bombImages()).toEqual(["bomb/bomb_pink"]);

    removePlayer(state, 1);
    step(state, {});
    expect(state.phase).toBe("playing");
    expect(state.players.map((p) => p.id)).toEqual([2, 3]);
    expect(state.bombs[0].owner).toBe(1);
    const after = drawing();
    renderField(after.ctx, assets, state, view);
    expect(after.bombImages()).toEqual(["bomb/bomb_pink"]);

    runUntil(state, () => state.bombs[0].exploded, 100);
    expect(state.players.every((p) => p.alive)).toBe(true);
    step(state, {});
    expect(state.players.find((p) => p.id === 3)?.alive).toBe(false);
    expect(state.events).toContainEqual({ type: "death", playerId: 3 });
    runUntil(state, () => state.phase !== "playing", 300);
    expect(state.roundWinnerId).toBe(2);
    expect(state.bombs).toEqual([]);
    expect(state.flame.every((flame) => flame === 0)).toBe(true);
  });

  it("uses the present owner's character when a scene has no player tints", async () => {
    const players = setups(2);
    players[0].character = "bobo";
    const state = createMatch(layoutFromAscii(["1.......2"]), players, VERSUS, 1);
    const assets = await loadSceneAssets("test", players.map((p) => p.character));
    runUntil(state, () => state.phase === "playing", 300);
    step(state, { 1: { dir: null, bomb: true } });
    const drawn = drawing();
    renderField(drawn.ctx, assets, state, {
      localPlayerIds: [1], hostId: 1, hurryTick: null, lastRoundDraw: false, faces: new PanelFaces(), markers: new MarkerAnimations(), badState: new BadStateAnimation(),
    });
    expect(drawn.bombImages()).toEqual(["bomb/bomb_pink"]);
  });
});
