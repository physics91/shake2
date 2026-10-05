import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import type { LevelAssets, Sheet } from "./assets.ts";
import type { SoundBank } from "./audio.ts";
import { GameView } from "./gameView.ts";
import { loadSceneAssets } from "./scene.ts";
import { createMatch, step } from "../sim/match.ts";
import { layoutFromAscii, runUntil, setups, VERSUS } from "../sim/testing.ts";
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
    if (dir === "character" || (dir === "object" && ["diff1", "diff2"].includes(name))) {
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

async function fixture(roundSeconds = 150) {
  const players = setups(4);
  players.forEach((player, i) => { player.character = "shaky"; player.team = i < 3 ? 1 : 2; });
  const state = createMatch(layoutFromAscii(["1...2...3...4"]), players, { ...VERSUS, mode: 1, roundSeconds }, 1);
  runUntil(state, () => state.phase === "playing", 300);
  const assets = await loadSceneAssets("test", ["shaky"]);
  const sounds = { effects: true, stopMusic() {}, playMusic() {}, play() {}, stop() {} } as unknown as SoundBank;
  function screen(localId = 1) {
    const surface = canvas();
    const view = new GameView(surface.getContext(), assets, sounds, { localPlayerIds: [localId], hostId: null, music: null });
    const composition = contexts.at(-1)!;
    function draw(online = false) {
      const shown = online ? fromWireState(JSON.parse(JSON.stringify(toWireState(state))), state.layout) : state;
      vi.mocked(composition.drawImage).mockClear();
      view.render(shown);
      const frames = (name: "diff1" | "diff2") => vi.mocked(composition.drawImage).mock.calls.flatMap(([source, left]) => {
        if ((source as HTMLImageElement).src !== `object/${name}`) return [];
        const meta = name === "diff1" ? assets.marker.meta : assets.teamMarker.meta;
        return [meta.animations[0].frames.findIndex((frame) => frame.rect[0] === left)];
      });
      return { own: frames("diff1"), team: frames("diff2") };
    }
    return { view, draw };
  }
  return { state, screen };
}

describe("marker animation follows each screen's draw history (0x40aaee)", () => {
  it.each([false, true])("draws frame 0 first and advances between teammates (online=%s)", async (online) => {
    const { screen } = await fixture();
    const { view, draw } = screen();
    try {
      expect(draw(online)).toEqual({ own: [0], team: [0, 1] });
      expect(draw(online)).toEqual({ own: [0], team: [0, 1] });
    } finally { view.dispose(); }
  });

  it("uses the new shared frame for the next teammate at the next advance boundary", async () => {
    const { state, screen } = await fixture();
    const { view, draw } = screen();
    try {
      draw();
      for (let i = 1; i < 5; i++) {
        step(state, {});
        expect(draw().team).toEqual([1, 1]);
      }
      step(state, {});
      expect(draw().team).toEqual([1, 2]);
    } finally { view.dispose(); }
  });

  it("advances only once when intermediate screens were not drawn", async () => {
    const { state, screen } = await fixture();
    const { view, draw } = screen();
    try {
      draw();
      for (let i = 0; i < 150; i++) step(state, {});
      expect(draw(true).team).toEqual([1, 2]);
    } finally { view.dispose(); }
  });

  it("keeps independent animation state for screens sharing the same assets", async () => {
    const { screen } = await fixture();
    const first = screen(1), second = screen(2);
    try {
      expect(first.draw().team).toEqual([0, 1]);
      expect(second.draw().team).toEqual([0, 1]);
      expect(second.draw().own).toEqual([0]);
    } finally { first.view.dispose(); second.view.dispose(); }
  });

  it("restarts at frame 0 after the next round reloads the world", async () => {
    const { state, screen } = await fixture(4);
    const { view, draw } = screen();
    try {
      draw();
      for (let i = 0; i < 5; i++) { step(state, {}); draw(); }
      runUntil(state, () => state.round === 2 && state.phase === "playing", 1000);
      expect(draw().team).toEqual([0, 1]);
      expect(draw().own).toEqual([0]);
    } finally { view.dispose(); }
  });
});
