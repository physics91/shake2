import { describe, expect, it, vi } from "vitest";

import type { LevelAssets, Sheet } from "./assets.ts";
import { nowMs } from "../sim/constants.ts";
import { addItem } from "../sim/grid.ts";
import { step } from "../sim/match.ts";
import { startInvisible } from "../sim/status.ts";
import { addBomb, playingMatch, runUntil } from "../sim/testing.ts";
import { Dir, ItemKind } from "../sim/types.ts";
import type { MatchState } from "../sim/types.ts";
import { fromWireState, toWireState } from "../server/protocol.ts";
import { BadStateAnimation, MarkerAnimations, PanelFaces, renderField } from "./renderer.ts";
import { loadSceneAssets } from "./scene.ts";
import { blitBlended } from "./sprite.ts";

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
        frames: [{ index: 1, anchor: [0, 0], rect: [0, 0, 1, 1] }],
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
    meta: { area: [11, 34, 611, 514], fixed: [], bricks: [], objects: [] },
  }) as unknown as LevelAssets,
}));

vi.mock("./sprite.ts", async (original) => ({
  ...await original<typeof import("./sprite.ts")>(),
  blitBlended: vi.fn(), drawFrameOrHalf: vi.fn(),
}));

vi.mock("./text.ts", async (original) => ({
  ...await original<typeof import("./text.ts")>(), outlinedText: vi.fn(), plainText: vi.fn(),
}));

async function shadowDraws(state: MatchState, online = false) {
  const assets = await loadSceneAssets("test", state.players.map((p) => p.character));
  const ctx = {
    drawImage() {}, fillRect() {}, fillText() {}, save() {}, restore() {},
    measureText: (text: string) => ({ width: text.length * 8 }),
  } as unknown as CanvasRenderingContext2D;
  const shown = online ? fromWireState(JSON.parse(JSON.stringify(toWireState(state))), state.layout) : state;
  vi.mocked(blitBlended).mockClear();
  renderField(ctx, assets, shown, {
    localPlayerIds: [state.players[0].id], hostId: null, hurryTick: null,
    lastRoundDraw: false, faces: new PanelFaces(), markers: new MarkerAnimations(), badState: new BadStateAnimation(),
  });
  return vi.mocked(blitBlended).mock.calls.flatMap(([, source, x, y, weight]) =>
    source.src === "image/shadow.png" ? [{ x, y, weight }] : []);
}

const shadowAt = (x: number, y: number) => ({ x: 11 + x - 14, y: 34 + y - 7, weight: 100 });

describe("shadows drawn before bombs and players (0x40914f)", () => {
  it.each([false, true])("draws at the position before this tick's movement (online=%s)", async (online) => {
    const state = playingMatch(["1.....2"], 2);
    const { x, y } = state.players[0];
    const other = state.players[1];
    step(state, { 1: { dir: Dir.Right, bomb: false } });
    expect(state.players[0].x).toBe(x + 5);
    expect(await shadowDraws(state, online)).toEqual([shadowAt(x, y), shadowAt(other.x, other.y)]);
    step(state, { 1: { dir: Dir.Right, bomb: false } });
    expect(await shadowDraws(state, online)).toEqual([shadowAt(x + 5, y), shadowAt(other.x, other.y)]);
  });

  it("keeps the last shadow on the tick an invisibility item is picked up", async () => {
    const state = playingMatch(["1.....2"], 2);
    addItem(state, { cell: 0, kind: ItemKind.Mystery, sub: 38, tick: 0, dropped: false });
    step(state, {});
    expect(state.players[0].status.invisible).not.toBeNull();
    expect(await shadowDraws(state, true)).toEqual(state.players.map((p) => shadowAt(p.x, p.y)));
    step(state, {});
    expect(await shadowDraws(state)).toEqual([shadowAt(state.players[1].x, state.players[1].y)]);
  });

  it("first draws the shadow on the tick after an egg cancels invisibility", async () => {
    const state = playingMatch(["1.....2"], 2);
    startInvisible(state.players[0], nowMs(state.tick));
    addItem(state, { cell: 0, kind: ItemKind.Mystery, sub: 37, tick: 0, dropped: false });
    step(state, {});
    expect(state.players[0].status.invisible).toBeNull();
    expect(await shadowDraws(state, true)).toEqual([shadowAt(state.players[1].x, state.players[1].y)]);
    step(state, {});
    expect(await shadowDraws(state)).toEqual(state.players.map((p) => shadowAt(p.x, p.y)));
  });

  it("first draws the shadow on the tick after invisibility expires", async () => {
    const state = playingMatch(["1.....2"], 2);
    startInvisible(state.players[0], nowMs(state.tick));
    runUntil(state, () => state.players[0].status.invisible === null, 400);
    expect(await shadowDraws(state, true)).toEqual([shadowAt(state.players[1].x, state.players[1].y)]);
    step(state, {});
    expect(await shadowDraws(state)).toEqual(state.players.map((p) => shadowAt(p.x, p.y)));
  });

  it("keeps the last shadow on the tick the death animation ends", async () => {
    const state = playingMatch(["1.....2.....3"], 3);
    addBomb(state, 1, { fuseMs: 0 });
    runUntil(state, () => state.players[0].gone, 200);
    expect(state.phase).toBe("playing");
    expect(await shadowDraws(state, true)).toEqual(state.players.map((p) => shadowAt(p.x, p.y)));
    step(state, {});
    expect(await shadowDraws(state)).toEqual(state.players.slice(1).map((p) => shadowAt(p.x, p.y)));
  });

  it("shows the loaded field's shadows before the first playing pass", async () => {
    const state = playingMatch(["1.....2"], 2);
    expect(await shadowDraws(state, true)).toEqual(state.players.map((p) => shadowAt(p.x, p.y)));
  });

  it("uses the new round's spawn points instead of its previous shadow positions", async () => {
    const state = playingMatch(["1.....2"], 2);
    step(state, { 1: { dir: Dir.Right, bomb: false } });
    step(state, { 1: { dir: Dir.Right, bomb: false } });
    state.phase = "round-over";
    state.phaseTick = state.tick;
    runUntil(state, () => state.round === 2, 200);
    expect(await shadowDraws(state, true)).toEqual(state.players.map((p) => shadowAt(p.x, p.y)));
  });
});
