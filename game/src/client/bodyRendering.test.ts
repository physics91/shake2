import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import type { LevelAssets, Sheet } from "./assets.ts";
import type { SoundBank } from "./audio.ts";
import { GameView } from "./gameView.ts";
import { loadSceneAssets } from "./scene.ts";
import { createMatch, step } from "../sim/match.ts";
import type { InputMap } from "../sim/match.ts";
import { layoutFromAscii, setups, VERSUS } from "../sim/testing.ts";
import type { GameMode } from "../sim/types.ts";
import { Dir } from "../sim/types.ts";
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
    if (dir === "character") {
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

async function fixture(mode: GameMode, latePickup: boolean, localId: number, online: boolean, completion = false) {
  const players = setups(3);
  players.forEach((player, i) => { player.character = "shaky"; player.team = i < 2 ? 1 : 2; });
  if (!latePickup) {
    [players[0], players[1]] = [players[1], players[0]];
    players.forEach((player, slot) => { player.slot = slot; });
  }
  const rows = latePickup ? ["1.2.3", "....."] : ["2.1.3", "....."];
  const state = createMatch(layoutFromAscii(rows), players, { ...VERSUS, mode }, 1);
  const assets = await loadSceneAssets("test", ["shaky"]);
  const sounds = { effects: true, stopMusic() {}, playMusic() {}, play() {}, stop() {} } as unknown as SoundBank;
  const surface = canvas();
  const view = new GameView(surface.getContext(), assets, sounds, { localPlayerIds: [localId], hostId: null, music: null });
  const composition = contexts.at(-1)!;
  function draw() {
    const shown = online ? fromWireState(JSON.parse(JSON.stringify(toWireState(state))), state.layout) : state;
    vi.mocked(composition.drawImage).mockClear();
    view.render(shown);
    return vi.mocked(composition.drawImage).mock.calls.filter(([source]) => (source as HTMLImageElement).src === "character/shaky");
  }
  function run(n: number, inputs: InputMap = {}) {
    let bodies: ReturnType<typeof draw> = [];
    for (let i = 0; i < n; i++) {
      step(state, inputs);
      if (state.phase === "playing" || state.phase === "countdown") bodies = draw();
    }
    return bodies;
  }
  function approachCapsule() {
    // A real bomb/death/drop, without injected state or a status item. Player2 survives in
    // the next row, then approaches the natural capsule after player1's death has finished.
    run(150);
    run(1, { 1: { dir: null, bomb: true } });
    run(2, { 2: { dir: Dir.Down, bomb: false } });
    run(completion ? 97 : 98);
    run(4, { 2: { dir: Dir.Up, bomb: false } });
    expect(run(12, { 2: { dir: Dir.Left, bomb: false } })).toHaveLength(completion ? 3 : 2);
    expect(state.tick).toBe(completion ? 266 : 267);
    expect(state.players.find((player) => player.id === 1)!.gone).toBe(!completion);
  }
  function revive() {
    const bodies = run(1, { 2: { dir: Dir.Left, bomb: false } });
    expect(state.tick).toBe(completion ? 267 : 268);
    expect(state.players.find((player) => player.id === 1)!.alive).toBe(true);
    expect(state.events.some((event) => event.type === "revived")).toBe(true);
    return bodies;
  }
  return { view, draw, run, approachCapsule, revive };
}

describe("countdown standing body (0x40b1ce)", () => {
  it.each([false, true])("draws the next extracted frame after fade-out (online=%s)", async (online) => {
    const shown = await fixture(0, true, 1, online);
    try {
      const before = shown.run(40);
      expect(before).toHaveLength(3);
      expect(before.map((call) => call.slice(1, 5))).toEqual(Array(3).fill([2, 2, 66, 53]));
      const after = shown.run(1);
      expect(after).toHaveLength(3);
      // Actual native 0x462b90/0x4125c0 selects shaky anim 4/frame 1 here.
      expect(after.map((call) => call.slice(1, 5))).toEqual(Array(3).fill([69, 2, 58, 55]));
    } finally {
      shown.view.dispose();
    }
  });
});

for (const mode of [6, 7] as const) {
  describe(`capsule revival body timing in mode ${mode}`, () => {
    it.each([false, true])("waits for the next remote pass after a later pickup (online=%s)", async (online) => {
      const shown = await fixture(mode, true, 2, online);
      try {
        shown.approachCapsule();
        // 0x40a9a4 takes the gone branch before player2 revives player1 later this tick.
        expect(shown.revive()).toHaveLength(2);
        expect(shown.draw()).toHaveLength(2);
        expect(shown.run(1)).toHaveLength(3);
      } finally { shown.view.dispose(); }
    });

    it.each([false, true])("skips a completed death body when a later pickup revives it in the same pass (online=%s)", async (online) => {
      const shown = await fixture(mode, true, 2, online, true);
      try {
        shown.approachCapsule();
        // Native common update returns1; 0x40ad03 completes death and skips the body.
        expect(shown.revive()).toHaveLength(2);
        expect(shown.draw()).toHaveLength(2);
        expect(shown.run(1)).toHaveLength(3);
      } finally { shown.view.dispose(); }
    });

    it.each([false, true])("draws the body when an earlier pickup revives the remote player (online=%s)", async (online) => {
      const shown = await fixture(mode, false, 2, online);
      try {
        shown.approachCapsule();
        expect(shown.revive()).toHaveLength(3);
        expect(shown.draw()).toHaveLength(3);
        expect(shown.run(1)).toHaveLength(3);
      } finally { shown.view.dispose(); }
    });

    it.each([false, true])("draws the local revived player after the remote pass (online=%s)", async (online) => {
      const shown = await fixture(mode, true, 1, online);
      try {
        shown.approachCapsule();
        expect(shown.revive()).toHaveLength(3);
        expect(shown.draw()).toHaveLength(3);
        expect(shown.run(1)).toHaveLength(3);
      } finally { shown.view.dispose(); }
    });
  });
}
