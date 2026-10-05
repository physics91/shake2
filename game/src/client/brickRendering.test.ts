import { describe, expect, it, vi } from "vitest";

import type { LevelAssets, Sheet } from "./assets.ts";
import { step } from "../sim/match.ts";
import { addBomb, playingMatch, runUntil } from "../sim/testing.ts";
import { CellKind, ItemKind } from "../sim/types.ts";
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
      source: name, sheet: name, name, width: 6, height: 1,
      animations: Array.from({ length: 40 }, () => ({
        name: "", unknown_u16: 5,
        frames: Array.from({ length: 6 }, (_, index) => ({
          index, anchor: [0, 0], rect: [index, 0, index + 1, 1],
        })),
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

async function draws(state: MatchState, online = false, reverseSheets = false, sharedAnimation = false) {
  const assets = await loadSceneAssets("test", state.players.map((p) => p.character));
  assets.level.bricks = [sheet("brick", "first"), sheet("brick", "second")];
  if (sharedAnimation) {
    assets.level.bricks[0].meta.animations[1].frames[3].rect = [2, 0, 3, 1];
    assets.level.bricks[1].meta.animations[1].frames.pop();
  }
  assets.level.meta.bricks = state.layout.kinds.flatMap((kind, cell) => kind === CellKind.Brick
    ? [{ cell, sprite: sharedAnimation ? 1 : reverseSheets ? (cell === 2 ? 1 : 0) : 0, unknown_u16: 0 }]
    : []);
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
  return {
    bricks: drawImage.mock.calls.flatMap(([source, left]) => {
      const src = (source as HTMLImageElement).src;
      return src.startsWith("brick/") ? [{ source: src, frame: left }] : [];
    }),
    items: drawImage.mock.calls.filter(([source]) => (source as HTMLImageElement).src === "item/item").length,
  };
}

describe("the brick draw before animation advance and bombs (0x401890)", () => {
  it("still draws the intact brick when a later explosion starts its crumble", async () => {
    const state = playingMatch(["1.B....2"], 2);
    addBomb(state, 3, { fuseMs: 0 });
    step(state, {});
    expect(state.breaking[0].frame).toBe(1);
    expect((await draws(state, true)).bricks).toEqual([{ source: "brick/first", frame: 0 }]);
    step(state, {});
    expect(state.breaking[0].frame).toBe(2);
    expect((await draws(state, true)).bricks).toEqual([{ source: "brick/first", frame: 1 }]);
  });

  it("draws the old crumble frame on each timer advance and the new one on the following tick", async () => {
    const state = playingMatch(["1.B....2"], 2);
    addBomb(state, 3, { fuseMs: 0 });
    step(state, {});
    step(state, {});
    runUntil(state, () => state.breaking[0].frame === 3, 20);
    expect((await draws(state)).bricks).toEqual([{ source: "brick/first", frame: 2 }]);
    step(state, {});
    expect(state.breaking[0].frame).toBe(3);
    expect((await draws(state)).bricks).toEqual([{ source: "brick/first", frame: 3 }]);
  });

  it("draws the last crumble frame alongside its revealed item before hiding the brick", async () => {
    const state = playingMatch(["1.B....2"], 2);
    state.hidden[2] = ItemKind.Speed;
    addBomb(state, 3, { fuseMs: 0 });
    step(state, {});
    runUntil(state, () => state.breaking.length === 0, 100);
    expect(await draws(state, true)).toEqual({
      bricks: [{ source: "brick/first", frame: 5 }], items: 1,
    });
    step(state, {});
    expect(await draws(state, true)).toEqual({ bricks: [], items: 1 });
  });

  it("keeps map list order when the cells use different sheets", async () => {
    const state = playingMatch(["1.B.B..2"], 2);
    expect((await draws(state, false, true)).bricks).toEqual([
      { source: "brick/second", frame: 0 }, { source: "brick/first", frame: 0 },
    ]);
  });

  it("uses the first sheet's repeated frame for a second-sheet brick", async () => {
    const state = playingMatch(["1...B....2"], 2);
    addBomb(state, 5, { fuseMs: 0 });
    step(state, {});
    runUntil(state, () => state.breaking[0].frame === 3, 30);
    step(state, {});
    expect((await draws(state, true, true, true)).bricks).toEqual([{ source: "brick/second", frame: 2 }]);
  });

  it("draws the shared final frame even when the second sheet lists fewer frames", async () => {
    const state = playingMatch(["1...B....2"], 2);
    state.hidden[4] = ItemKind.Speed;
    addBomb(state, 5, { fuseMs: 0 });
    step(state, {});
    runUntil(state, () => state.breaking.length === 0, 100);
    expect(await draws(state, true, true, true)).toEqual({
      bricks: [{ source: "brick/second", frame: 5 }], items: 1,
    });
  });

  it("shows intact loaded bricks before the first playing update", async () => {
    const state = playingMatch(["1.B....2"], 2);
    expect((await draws(state)).bricks).toEqual([{ source: "brick/first", frame: 0 }]);
  });

  it("replaces the previous round's drawn bricks with the freshly loaded field", async () => {
    const state = playingMatch(["1.B....2"], 2);
    addBomb(state, 3, { fuseMs: 0 });
    step(state, {});
    step(state, {});
    state.phase = "round-over";
    state.phaseTick = state.tick;
    runUntil(state, () => state.round === 2, 200);
    expect(state.breaking).toEqual([]);
    expect((await draws(state, true)).bricks).toEqual([{ source: "brick/first", frame: 0 }]);
  });
});
