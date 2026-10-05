import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import type { LevelAssets, Sheet } from "./assets.ts";
import type { SoundBank } from "./audio.ts";
import { GameView } from "./gameView.ts";
import { loadSceneAssets } from "./scene.ts";
import { createMatch, step } from "../sim/match.ts";
import { layoutFromAscii, setups, VERSUS } from "../sim/testing.ts";
import { createPractice } from "../sim/practice.ts";
import { layoutFromLevel } from "../sim/level.ts";
import type { GameMode, InputFrame, MatchState } from "../sim/types.ts";
import { Dir, ItemKind } from "../sim/types.ts";
import { fromWireState, toWireState } from "../server/protocol.ts";

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
    if (dir === "character" || (dir === "object" && name === "bad_state")) {
      loaded.meta = JSON.parse(readFileSync(new URL(`../../public/assets/spr/${dir}/${name}.json`, import.meta.url), "utf8"));
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
  ...await original<typeof import("./sprite.ts")>(), blitBlended: vi.fn(),
}));
vi.mock("./text.ts", async (original) => ({
  ...await original<typeof import("./text.ts")>(), outlinedText: vi.fn(), plainText: vi.fn(),
}));

const contexts: CanvasRenderingContext2D[] = [];
function canvas() {
  const element = Object.assign(new EventTarget(), { width: 800, height: 600 });
  const ctx = {
    canvas: element, drawImage: vi.fn(), fillRect() {}, fillText() {}, save() {}, restore() {},
    measureText: (text: string) => ({ width: text.length * 8 }),
  } as unknown as CanvasRenderingContext2D;
  contexts.push(ctx);
  return Object.assign(element, { getContext: () => ctx });
}
beforeAll(() => {
  vi.stubGlobal("document", { createElement: canvas });
  vi.stubGlobal("window", new EventTarget());
});
afterAll(() => vi.unstubAllGlobals());


const DOWN: InputFrame = { dir: Dir.Down, bomb: false };
const RIGHT: InputFrame = { dir: Dir.Right, bomb: false };
const UP: InputFrame = { dir: Dir.Up, bomb: false };
const BOMB: InputFrame = { dir: null, bomb: true };

async function fixture(rows = ["1B2", "..."], seed = 111, roundSeconds = 150, mode: GameMode = 0) {
  const players = setups((rows.join("").match(/[1-6]/g) ?? []).length);
  players.forEach((player, i) => {
    player.character = "shaky";
    if (mode !== 0) player.team = i < 2 ? 1 : 2;
  });
  const state = createMatch(layoutFromAscii(rows), players, { ...VERSUS, roundSeconds, mode }, seed);
  const assets = await loadSceneAssets("test", ["shaky"]);
  return { state, assets };
}

function screen(state: MatchState, assets: Awaited<ReturnType<typeof loadSceneAssets>>, localId = 1) {
  const sounds = { effects: true, stopMusic() {}, playMusic() {}, play() {}, stop() {} } as unknown as SoundBank;
  const surface = canvas();
  const view = new GameView(surface.getContext(), assets, sounds, { localPlayerIds: [localId], hostId: null, music: null });
  const composition = contexts.at(-1)!;
  function draw(online = false) {
    const shown = online ? fromWireState(JSON.parse(JSON.stringify(toWireState(state))), state.layout) : state;
    vi.mocked(composition.drawImage).mockClear();
    view.render(shown);
    return vi.mocked(composition.drawImage).mock.calls.flatMap(([source, left]) => {
      if ((source as HTMLImageElement).src !== "object/bad_state") return [];
      return [assets.badState.meta.animations[0].frames.findIndex((frame) => frame.rect[0] === left)];
    });
  }
  function run(n: number, input?: InputFrame, online = false) {
    let frames: number[] = [];
    for (let i = 0; i < n; i++) {
      step(state, input ? { 1: input } : {});
      // Only field frames were presented in this history, including the countdown. Result/wait
      // snapshots between rounds can arrive while a browser tab is not presenting frames.
      if (state.phase === "playing" || state.phase === "countdown") frames = draw(online);
    }
    return frames;
  }
  function pickSwitch(online = false) {
    run(150, undefined, online);
    run(1, BOMB, online);
    run(4, DOWN, online);
    run(6, RIGHT, online);
    run(75, undefined, online);
    const frames = run(4, UP, online);
    expect(state.players[0].badState).not.toBeNull();
    return frames;
  }
  return { view, draw, run, pickSwitch };
}

describe("shared bad-state animation advances before the player pass (0x40a957)", () => {
  it.each([[1, false], [1, true], [2, false], [2, true]] as const)(
    "advances while no stars are visible (local=%s, online=%s)", async (localId, online) => {
      const { state, assets } = await fixture();
      expect(state.hidden[1]).toBe(ItemKind.Switch);
      const shown = screen(state, assets, localId);
      try {
        // Real brick roll, bomb, movement and pickup. Native frame at tick 240 is 1; absolute
        // timedFrame(240, 5, 2) instead selects 0. Both players use this same sprite phase.
        expect(shown.pickSwitch(online)).toEqual([1]);
        expect(shown.draw(online)).toEqual([1]);
      } finally { shown.view.dispose(); }
    },
  );

  it("holds the updated frame until the next strict 200 ms boundary", async () => {
    const { state, assets } = await fixture();
    const shown = screen(state, assets);
    try {
      shown.pickSwitch();
      for (let i = 0; i < 6; i++) expect(shown.run(1)).toEqual([1]);
      expect(shown.run(1)).toEqual([0]);
      expect(shown.draw()).toEqual([0]);
    } finally { shown.view.dispose(); }
  });

  it("advances once after intermediate field frames were not drawn", async () => {
    const { state, assets } = await fixture();
    const shown = screen(state, assets);
    try {
      shown.pickSwitch();
      for (let i = 0; i < 21; i++) step(state, {});
      expect(shown.draw(true)).toEqual([0]);
      expect(shown.draw(true)).toEqual([0]);
    } finally { shown.view.dispose(); }
  });

  it("keeps separate clocks for views sharing the same assets", async () => {
    const { state, assets } = await fixture();
    const first = screen(state, assets);
    let second: ReturnType<typeof screen> | undefined;
    try {
      first.pickSwitch();
      expect(first.run(7)).toEqual([0]);
      second = screen(state, assets, 2);
      expect(second.draw(true)).toEqual([1]);
      expect(first.draw()).toEqual([0]);
    } finally { first.view.dispose(); second?.view.dispose(); }
  });

  it("recreates the shared sprite when the next round reloads the world", async () => {
    const { state, assets } = await fixture(["B..", "1B2", "..."], 8907, 90);
    const shown = screen(state, assets);
    try {
      expect(state.hidden[4]).toBe(ItemKind.Switch);
      shown.pickSwitch();
      shown.run(914);
      expect(state.round).toBe(2);
      expect(state.hidden[4]).toBe(ItemKind.Switch);
      shown.run(150);
      shown.run(6);
      shown.run(1, BOMB);
      shown.run(4, DOWN);
      shown.run(6, RIGHT);
      shown.run(75);
      expect(shown.run(4, UP)).toEqual([1]);
      expect(state.tick).toBe(1400);
    } finally { shown.view.dispose(); }
  });

  it("uses the same prepass clock for the practice player's stars (0x407b78)", async () => {
    const map = JSON.parse(readFileSync(new URL("../../public/assets/maps/practice.json", import.meta.url), "utf8"));
    const state = createPractice(layoutFromLevel("practice", map), { id: 1, name: "P1", character: "shaky" }, 1);
    const assets = await loadSceneAssets("practice", state.players.map((player) => player.character));
    const shown = screen(state, assets);
    try {
      // The shipped display switch is at cell 130. Walk from the loader's spawn through
      // cells 97 -> 98 -> 99 -> 100 -> 115 -> 130, stopping when its freeze blocks input.
      shown.run(24, RIGHT);
      expect(shown.run(10, DOWN)).toEqual([1]);
      expect(state.players.find((player) => player.id === 1)!.status.frozen).not.toBeNull();
      expect(shown.run(1)).toEqual([1]);
      expect(shown.run(1)).toEqual([0]);
    } finally { shown.view.dispose(); }
  });
});


function runInputs(state: MatchState, shown: ReturnType<typeof screen>, n: number, inputs: Parameters<typeof step>[1] = {}, online = false) {
  let frames: number[] = [];
  for (let i = 0; i < n; i++) {
    step(state, inputs);
    if (state.phase === "playing" || state.phase === "countdown") frames = shown.draw(online);
    else frames = [];
  }
  return frames;
}

describe("remote stars follow the alive branch of the player draw pass (0x40ab22)", () => {
  it.each([false, true])("keeps the death-start frame then hides remote dying stars (online=%s)", async (online) => {
    const { state, assets } = await fixture();
    const shown = screen(state, assets, 2);
    try {
      shown.pickSwitch(online);
      runInputs(state, shown, 1, { 2: BOMB }, online);
      runInputs(state, shown, 60, {}, online);
      expect(state.players[0].alive).toBe(true);
      // This pass entered the alive branch before its flame check started death.
      expect(runInputs(state, shown, 1, {}, online)).toEqual([1]);
      expect(state.players[0].alive).toBe(false);
      expect(state.players[0].badState).not.toBeNull();
      // The next pass enters 0x40acd8: it draws the death body but no stars.
      expect(runInputs(state, shown, 1, {}, online)).toEqual([]);
      expect(shown.draw(online)).toEqual([]);
    } finally { shown.view.dispose(); }
  });

  it.each([false, true])("keeps the local player's stars while death runs (online=%s)", async (online) => {
    const { state, assets } = await fixture();
    const shown = screen(state, assets);
    try {
      shown.pickSwitch(online);
      runInputs(state, shown, 1, { 2: BOMB }, online);
      for (let i = 0; i < 110; i++) {
        const frames = runInputs(state, shown, 1, {}, online);
        if (state.players[0].gone) {
          expect(frames).toEqual([]);
          break;
        }
        expect(frames).toHaveLength(1);
      }
      expect(state.players[0].alive).toBe(false);
      expect(state.players[0].gone).toBe(true);
      expect(state.players[0].badState).not.toBeNull();
      expect(shown.draw(online)).toEqual([]);
    } finally { shown.view.dispose(); }
  });

  it.each([[6, false], [6, true], [7, false], [7, true]] as const)(
    "waits for the next remote pass after a later player revives a gone teammate (mode=%s, online=%s)", async (mode, online) => {
      const { state, assets } = await fixture(["1B2....3", "........"], 111, 150, mode);
      const shown = screen(state, assets, 2);
      try {
        shown.pickSwitch(online);
        runInputs(state, shown, 1, { 2: BOMB }, online);
        runInputs(state, shown, 4, { 2: DOWN }, online);
        runInputs(state, shown, 8, { 2: { dir: Dir.Left, bomb: false } }, online);
        runInputs(state, shown, 99, {}, online);
        expect(state.tick).toBe(352);
        expect(state.players[0].gone).toBe(true);
        // Player1's loop was skipped; player2's pickup revives player1 later in this pass.
        expect(runInputs(state, shown, 1, { 2: UP }, online)).toEqual([]);
        expect(state.players[0].alive).toBe(true);
        expect(state.players[0].gone).toBe(false);
        expect(state.events.some((event) => event.type === "revived")).toBe(true);
        expect(runInputs(state, shown, 1, {}, online)).toHaveLength(1);
      } finally { shown.view.dispose(); }
    },
  );

  it("keeps practice's local dying stars, without drawing dummy stars", async () => {
    const map = JSON.parse(readFileSync(new URL("../../public/assets/maps/practice.json", import.meta.url), "utf8"));
    const state = createPractice(layoutFromLevel("practice", map), { id: 1, name: "P1", character: "shaky" }, 1);
    const assets = await loadSceneAssets("practice", state.players.map((player) => player.character));
    const shown = screen(state, assets);
    try {
      shown.run(24, RIGHT);
      shown.run(1, BOMB);
      shown.run(10, DOWN);
      const own = state.players.find((player) => player.id === 1)!;
      for (let i = 0; i < 15; i++) expect(shown.run(1)).toHaveLength(1);
      expect(own.alive).toBe(false);
      expect(own.gone).toBe(false);
      expect(own.badState).not.toBeNull();
    } finally { shown.view.dispose(); }
  });
});
