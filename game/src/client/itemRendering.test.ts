import { describe, expect, it, vi } from "vitest";

import type { LevelAssets, Sheet } from "./assets.ts";
import { addItem } from "../sim/grid.ts";
import { step } from "../sim/match.ts";
import { createPractice } from "../sim/practice.ts";
import { addBomb, layoutFromAscii, playingMatch, runUntil } from "../sim/testing.ts";
import { ItemKind } from "../sim/types.ts";
import type { MatchState } from "../sim/types.ts";
import { fromWireState, toWireState } from "../server/protocol.ts";
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
        name: "", unknown_u16: 5,
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
    meta: { area: [0, 0, 600, 480], fixed: [], bricks: [], objects: [] },
  }) as unknown as LevelAssets,
}));

vi.mock("./sprite.ts", async (original) => ({
  ...await original<typeof import("./sprite.ts")>(), blitBlended: vi.fn(),
}));

vi.mock("./text.ts", async (original) => ({
  ...await original<typeof import("./text.ts")>(), outlinedText: vi.fn(), plainText: vi.fn(),
}));

async function itemDraws(state: MatchState, online = false): Promise<number> {
  const assets = await loadSceneAssets("test", state.players.map((p) => p.character));
  const drawImage = vi.fn();
  const ctx = {
    drawImage, fillRect() {}, fillText() {}, save() {}, restore() {},
    measureText: (text: string) => ({ width: text.length * 8 }),
  } as unknown as CanvasRenderingContext2D;
  const shown = online ? fromWireState(JSON.parse(JSON.stringify(toWireState(state))), state.layout) : state;
  renderField(ctx, assets, shown, {
    localPlayerIds: [state.players[0].id], hostId: null, hurryTick: null,
    lastRoundDraw: false, faces: new PanelFaces(), markers: new MarkerAnimations(), badState: new BadStateAnimation(),
  });
  return drawImage.mock.calls.filter(([source]) => (source as HTMLImageElement).src === "item/item").length;
}

describe("the item pass before bombs and players (0x406472, 0x4092ae)", () => {
  it("draws an item on the explosion tick that burns it, including after JSON transport", async () => {
    const state = playingMatch(["1......2"], 2);
    addItem(state, { cell: 2, kind: ItemKind.Speed, tick: 0, dropped: false });
    const bomb = addBomb(state, 3, { fuseMs: 0 });
    step(state, {});
    expect(bomb.exploded).toBe(true);
    expect(state.items).toEqual([]);
    expect(await itemDraws(state, true)).toBe(1);
    step(state, {});
    expect(await itemDraws(state, true)).toBe(0);
  });

  it("draws a picked item through its pickup tick and removes its picture on the next tick", async () => {
    const state = playingMatch(["1......2"], 2);
    addItem(state, { cell: 0, kind: ItemKind.Bomb, tick: 0, dropped: false });
    step(state, {});
    expect(state.events).toContainEqual({ type: "item-picked", playerId: 1, kind: ItemKind.Bomb });
    expect(state.items).toEqual([]);
    expect(await itemDraws(state)).toBe(1);
    step(state, {});
    expect(await itemDraws(state)).toBe(0);
  });

  it("first draws a generator's new item on the tick after the fire ends", async () => {
    const state = playingMatch(["1..g...2"], 2);
    state.rng = 1;
    addBomb(state, 3, { owner: 1, exploded: true, fireCells: [3], fireFrame: 7 });
    step(state, {});
    expect(state.items).toHaveLength(1);
    expect(await itemDraws(state)).toBe(0);
    step(state, {});
    expect(await itemDraws(state)).toBe(1);
  });

  it("first draws a dead player's dropped item on the next tick", async () => {
    const state = playingMatch(["1....2....3"], 3);
    state.players[0].inv.glove = true;
    addBomb(state, 1, { fuseMs: 0 });
    runUntil(state, () => state.players[0].gone, 200);
    expect(state.phase).toBe("playing");
    expect(state.items).toHaveLength(1);
    expect(await itemDraws(state)).toBe(0);
    step(state, {});
    expect(await itemDraws(state)).toBe(1);
  });

  it("draws a brick's revealed item in the same tick, before the bomb pass", async () => {
    const state = playingMatch(["1.B..2"], 2);
    state.hidden[2] = ItemKind.Speed;
    addBomb(state, 3, { fuseMs: 0 });
    runUntil(state, () => state.items.some((item) => item.cell === 2), 200);
    expect(await itemDraws(state)).toBe(1);
  });

  it("shows practice's loaded display items before the first simulation tick", async () => {
    const state = createPractice(layoutFromAscii(Array.from({ length: 15 }, () => ".".repeat(15))), {
      id: 1, name: "P1", character: "rookie",
    }, 1);
    expect(state.tick).toBe(0);
    expect(state.items.length).toBeGreaterThan(0);
    expect(await itemDraws(state)).toBe(state.items.length);
  });
});
