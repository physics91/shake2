import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

import type { SheetMeta } from "../assets/types.ts";
import { nowMs } from "../sim/constants.ts";
import { step } from "../sim/match.ts";
import { addBomb, playingMatch, runUntil } from "../sim/testing.ts";
import { Anim, Dir } from "../sim/types.ts";
import type { MatchState, PlayerState } from "../sim/types.ts";
import { fromWireState, toWireState } from "../server/protocol.ts";
import type { LevelAssets, Sheet } from "./assets.ts";
import { BadStateAnimation, MarkerAnimations, PanelFaces, renderField } from "./renderer.ts";
import { loadSceneAssets } from "./scene.ts";
import { drawFrame } from "./sprite.ts";

const { image, sheet } = vi.hoisted(() => ({
  image: (src: string) => ({ src } as HTMLImageElement),
  sheet: (dir: string, name: string): Sheet => ({
    image: { src: `${dir}/${name}` } as HTMLImageElement,
    meta: {
      source: name, sheet: name, name, width: 1, height: 1,
      animations: Array.from({ length: 40 }, () => ({
        name: "", unknown_u16: 5,
        frames: [{ index: 1, anchor: [0, 0], rect: [0, 0, 1, 1] }],
      })),
    },
  }),
}));

vi.mock("./assets.ts", () => ({
  loadSheet: async (dir: string, name: string) => {
    const loaded = sheet(dir, name);
    if (dir === "character") {
      loaded.meta = JSON.parse(readFileSync(new URL(`../../public/assets/spr/character/${name}.json`, import.meta.url), "utf8"));
    }
    return loaded;
  },
  loadImage: async (src: string) => image(src),
  loadImageSheet: async (name: string) => sheet("image", name),
  loadLevel: async (id: string) => ({
    id, background: image("map"), bricks: [],
    meta: { area: [51, 51, 651, 531], fixed: [], bricks: [], objects: [] },
  }) as unknown as LevelAssets,
}));
vi.mock("./sprite.ts", async (original) => ({
  ...await original<typeof import("./sprite.ts")>(),
  blitBlended: vi.fn(), drawFrameOrHalf: vi.fn(), drawFrame: vi.fn(),
}));
vi.mock("./text.ts", async (original) => ({
  ...await original<typeof import("./text.ts")>(), outlinedText: vi.fn(), plainText: vi.fn(),
}));

const body = JSON.parse(readFileSync(new URL("../../public/assets/spr/character/shaky.json", import.meta.url), "utf8")) as SheetMeta;
function headAt(player: PlayerState) {
  return { x: 51 + player.x, y: 51 + player.y - body.animations[player.anim].frames[player.frame].anchor[1] - 8 };
}
function match() {
  const state = playingMatch(["1.....2.....3"], 3, { practice: false, mode: 1, roundSeconds: 150, medalsToWin: 3 });
  state.players.forEach((player, i) => { player.character = "shaky"; player.team = i < 2 ? 1 : 2; });
  return state;
}
async function markers(state: MatchState, online = false) {
  const assets = await loadSceneAssets("test", ["shaky"]);
  const ctx = {
    drawImage() {}, fillRect() {}, fillText() {}, save() {}, restore() {},
    measureText: (text: string) => ({ width: text.length * 8 }),
  } as unknown as CanvasRenderingContext2D;
  const shown = online ? fromWireState(JSON.parse(JSON.stringify(toWireState(state))), state.layout) : state;
  vi.mocked(drawFrame).mockClear();
  renderField(ctx, assets, shown, { localPlayerIds: [1], hostId: null, hurryTick: null, lastRoundDraw: false, faces: new PanelFaces(), markers: new MarkerAnimations(), badState: new BadStateAnimation() });
  return vi.mocked(drawFrame).mock.calls.flatMap(([, source, , , x, y]) =>
    "src" in source.image && source.image.src === "object/diff2" ? [{ x, y }] : []);
}

describe("teammate marker before the player's update (0x40aa3a)", () => {
  it.each([false, true])("uses the old position and body frame while the body moves (online=%s)", async (online) => {
    const state = match();
    const before = { ...state.players[1], anim: Anim.Walk + Dir.Left, frame: 0 };
    step(state, { 2: { dir: Dir.Left, bomb: false } });
    expect(state.players[1].x).toBe(before.x - 5);
    expect(state.players[1].frame).toBe(0);
    expect(await markers(state, online)).toEqual([headAt(before)]);
    runUntil(state, () => nowMs(state.tick + 1) - state.players[1].animMs > 55, 10, { 2: { dir: Dir.Left, bomb: false } });
    const old = structuredClone(state.players[1]);
    step(state, { 2: { dir: Dir.Left, bomb: false } });
    expect(state.players[1].frame).not.toBe(old.frame);
    expect(await markers(state, online)).toEqual([headAt(old)]);
  });

  it("uses the old anchor when a standing frame changes without movement", async () => {
    const state = match();
    runUntil(state, () => nowMs(state.tick + 1) - state.players[1].animMs > 1000 / body.animations[Anim.Stand].unknown_u16, 40);
    const old = structuredClone(state.players[1]);
    step(state, {});
    expect(state.players[1].frame).not.toBe(old.frame);
    expect(await markers(state, true)).toEqual([headAt(old)]);
  });

  it("keeps the arrow on the tick the teammate's death ends, then removes it", async () => {
    const state = match();
    addBomb(state, 7, { fuseMs: 0 });
    runUntil(state, () => !state.players[1].alive, 20);
    while (!state.players[1].gone) {
      const old = structuredClone(state.players[1]);
      step(state, {});
      if (state.players[1].gone) expect(await markers(state, true)).toEqual([headAt(old)]);
    }
    step(state, {});
    expect(await markers(state)).toEqual([]);
  });

  it("shows the loaded field's teammate before the first update", async () => {
    const state = match();
    expect(await markers(state, true)).toEqual([headAt(state.players[1])]);
  });

  it("uses the next round's spawn position and standing frame", async () => {
    const state = match();
    step(state, { 2: { dir: Dir.Left, bomb: false } });
    state.phase = "round-over";
    state.phaseTick = state.tick;
    runUntil(state, () => state.round === 2, 200);
    expect(await markers(state, true)).toEqual([headAt(state.players[1])]);
  });
});
