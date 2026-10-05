import { describe, expect, it, vi } from "vitest";

import type { LevelAssets, Sheet } from "./assets.ts";
import { step } from "../sim/match.ts";
import { addBomb, playingMatch, run, runUntil, VERSUS } from "../sim/testing.ts";
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
          index: index + 1, anchor: [0, 0], rect: [index, 0, index + 1, 1],
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

async function objectDraws(state: MatchState, online = false) {
  const assets = await loadSceneAssets("test", state.players.map((p) => p.character));
  assets.level.meta.objects = state.layout.objects.map((object) => ({
    cell: object.cell, anim: object.anim,
    rect: [object.cell % state.layout.width * 40, Math.floor(object.cell / state.layout.width) * 32, 0, 0],
    kind_flag: Number(object.loop), unknown_u32: 0, unknown_a: object.sheet, unknown_b: 0,
  }));
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
  return drawImage.mock.calls.flatMap(([source, left]) => {
    const src = (source as HTMLImageElement).src;
    return /^object\/object_[abc]$/.test(src) ? [{ source: src, frame: left }] : [];
  });
}

function idleZone(): MatchState {
  const state = playingMatch(["1...z....2"], 2);
  run(state, 80);
  expect(state.objects[0]).toMatchObject({ frame: 0, active: false });
  return state;
}

describe("objects drawn at their own sheet pass (0x411700)", () => {
  it.each([false, true])("keeps the idle zone picture on its explosion tick (online=%s)", async (online) => {
    const state = idleZone();
    addBomb(state, 3, { fuseMs: 0 });
    step(state, {});
    expect(state.objects[0]).toMatchObject({ frame: 1, active: true });
    expect(state.flame[4]).toBe(1);
    expect(await objectDraws(state, online)).toEqual([{ source: "object/object_a", frame: 0 }]);
    step(state, {});
    expect(await objectDraws(state, online)).toEqual([{ source: "object/object_a", frame: 1 }]);
  });

  it("keeps the already drawn frame when another explosion restarts the zone", async () => {
    const state = idleZone();
    addBomb(state, 3, { fuseMs: 0 });
    runUntil(state, () => state.objects[0].frame === 2, 20);
    addBomb(state, 3, { fuseMs: 0 });
    step(state, {});
    expect(state.objects[0].frame).toBe(1);
    expect(await objectDraws(state, true)).toEqual([{ source: "object/object_a", frame: 2 }]);
  });

  it("draws an Object_A once before the sudden-death pass removes it", async () => {
    const state = playingMatch(["z...1........2."], 2, { ...VERSUS, roundSeconds: 60 });
    step(state, {});
    expect(state.objects[0].cell).toBe(-1);
    expect(await objectDraws(state, true)).toEqual([{ source: "object/object_a", frame: 1 }]);
    step(state, {});
    expect(await objectDraws(state)).toEqual([]);
  });

  it("hides an Object_B removed by the preceding sudden-death pass", async () => {
    const state = playingMatch(["r...1........2."], 2, { ...VERSUS, roundSeconds: 60 });
    step(state, {});
    expect(state.objects[0].cell).toBe(-1);
    expect(await objectDraws(state, true)).toEqual([]);
  });

  it("draws a looping Object_B's newly advanced frame in the same tick", async () => {
    const state = playingMatch(["1...r....2"], 2);
    step(state, {});
    expect(state.objects[0].frame).toBe(1);
    expect(await objectDraws(state)).toEqual([{ source: "object/object_b", frame: 1 }]);
  });

  it("shows freshly loaded objects before the first pass", async () => {
    const state = playingMatch(["1...z....2"], 2);
    expect(await objectDraws(state, true)).toEqual([{ source: "object/object_a", frame: 0 }]);
  });

  it("replaces the previous round's picture with the freshly loaded objects", async () => {
    const state = idleZone();
    addBomb(state, 3, { fuseMs: 0 });
    step(state, {});
    step(state, {});
    expect(await objectDraws(state)).toEqual([{ source: "object/object_a", frame: 1 }]);
    state.phase = "round-over";
    state.phaseTick = state.tick;
    runUntil(state, () => state.round === 2, 200);
    expect(await objectDraws(state, true)).toEqual([{ source: "object/object_a", frame: 0 }]);
  });
});
