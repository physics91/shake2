import { readFileSync } from "node:fs";
import { afterAll, beforeAll, expect, it, vi } from "vitest";

import type { LevelAssets, Sheet } from "./assets.ts";
import type { SoundBank } from "./audio.ts";
import { GameView } from "./gameView.ts";
import { loadSceneAssets } from "./scene.ts";
import { Room } from "../server/room.ts";
import type { InputMap } from "../sim/match.ts";
import { layoutFromAscii, VERSUS } from "../sim/testing.ts";
import type { ServerMessage } from "../server/protocol.ts";
import type { GameMode } from "../sim/types.ts";
import { Dir } from "../sim/types.ts";
import { fromWireState, toWireState, userCard } from "../server/protocol.ts";

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
    if (dir === "character" || name === "egg") {
      loaded.meta = JSON.parse(readFileSync(new URL(`../../public/assets/spr/${dir}/${name}.json`, import.meta.url), "utf8"));
    }
    return loaded;
  },
  loadImage: async (src: string) => image(src),
  loadImageSheet: async (name: string) => sheet("image", name),
  loadLevel: async (id: string) => ({
    id, background: image("map"), bricks: [],
    meta: { area: [50, 50, 650, 530], fixed: [], bricks: [], objects: [] },
  }) as unknown as LevelAssets,
}));
vi.mock("./sprite.ts", async (original) => {
  const actual = await original<typeof import("./sprite.ts")>();
  return { ...actual, blitBlended: vi.fn(), drawFrameOrHalf: vi.fn(actual.drawFrame) };
});
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

type Snapshot = Extract<ServerMessage, { type: "snapshot" }>;

async function fixture(mode: GameMode, localId = 2, jsonRoundTrip = false, options: { rows?: string[]; seed?: number } = {}) {
  const layout = layoutFromAscii(options.rows ?? ["1B2.3", "....."]);
  const seed = options.seed ?? 215794; // The first actual brick roll is the shake shield.
  let packet: Snapshot | null = null;
  let clock = seed * 1000;
  const peers = [1, 2, 3].map((id) => ({ id, send(message: ServerMessage) {
    if (id === 2 && message.type === "snapshot") packet = JSON.parse(JSON.stringify(message));
  } }));
  function profile(id: number) {
    const name = `P${id}`;
    return { name, nick: name, useId: true, character: "shaky", hue: 0,
      card: userCard({ id: name, nick: name, greeting: "", character: "shaky", hue: 0, useId: true,
        wins: 0, losses: 0, cell: 0, level: 12, guild: -1, rank: 0, gender: 0, manner: 0,
        exp: 0, candy: 0, items: [0], pairs: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9] }),
    };
  }
  const room = new Room({ code: "TEST", number: 1, title: "TEST", password: "" }, peers[0], profile(1), {
    maps: ["test"], layoutFor: () => layout, musicCount: 0, rules: VERSUS, now: () => clock, changed() {},
  });
  for (const peer of peers.slice(1)) expect(room.join(peer, profile(peer.id))).toBeNull();
  expect(room.setMode(1, mode)).toBeNull();
  if (mode !== 0) for (const id of [1, 2, 3]) expect(room.setTeam(id, id)).toBeNull();
  room.setReady(2, true);
  room.setReady(3, true);
  expect(room.start(1)).toBeNull();
  const assets = await loadSceneAssets("test", ["shaky"]);
  const sounds = { effects: true, stopMusic() {}, playMusic() {}, play() {}, stop() {} } as unknown as SoundBank;
  const surface = canvas();
  const view = new GameView(surface.getContext(), assets, sounds, { localPlayerIds: [localId], hostId: 1, music: null });
  const composition = contexts.at(-1)!;
  function snapshot(): Snapshot {
    if (!packet) throw new Error("Room did not send a snapshot");
    return packet;
  }
  function state() { return fromWireState(snapshot().state, layout); }
  function target() { return state().players.find((player) => player.id === 1)!; }
  function draw() {
    const current = state();
    const shown = jsonRoundTrip ? fromWireState(JSON.parse(JSON.stringify(toWireState(current))), layout) : current;
    vi.mocked(composition.drawImage).mockClear();
    view.render(shown);
    return vi.mocked(composition.drawImage).mock.calls.filter(([source]) => source === assets.effects.egg.image);
  }
  function run(n: number, inputs: InputMap = {}) {
    for (const id of [1, 2, 3]) {
      const input = inputs[id];
      room.input(id, input?.dir ?? null, { bomb: input?.bomb ?? false, attack: false, evade: false });
    }
    let drawn: ReturnType<typeof draw> = [];
    for (let i = 0; i < n; i++) {
      clock = seed * 1000 + Math.floor(snapshot().state.tick * 1000 / 30);
      room.tick();
      if (state().phase === "playing" || state().phase === "countdown") drawn = draw();
    }
    return drawn;
  }
  function shield() {
    run(150);
    run(1, { 1: { dir: null, bomb: true } });
    run(4, { 1: { dir: Dir.Down, bomb: false } });
    run(6, { 1: { dir: Dir.Right, bomb: false } });
    run(66);
    run(3, { 1: { dir: Dir.Up, bomb: false } });
    run(10);
    expect(state().tick).toBe(240);
    expect(target().status.shield).toBe(8000);
    expect(snapshot().events.some((event) => event.type === "item-picked" && event.playerId === 1)).toBe(true);
  }
  function expiry(bomb: boolean) {
    shield();
    run(239);
    run(1, bomb ? { 1: { dir: null, bomb: true } } : {});
    run(60);
    expect(state().tick).toBe(540);
    expect(target().alive).toBe(true);
    expect(target().status.shield).toBe(8000);
    return { x: target().x, y: target().y, frame: state().effects[0].frame };
  }
  function eggAt(x: number, y: number, frame: number) {
    const meta = assets.effects.egg.meta.animations[0].frames[frame];
    const [left, top, right, bottom] = meta.rect;
    return [assets.effects.egg.image, left, top, right - left, bottom - top,
      Math.max(0, 50 + x - meta.anchor[0]), Math.max(0, 50 + y - meta.anchor[1]), right - left, bottom - top];
  }
  return { view, state, target, run, draw, shield, expiry, eggAt };
}

for (const mode of [0, 6] as const) {
  for (const localId of [1, 2]) {
    it.each([false, true])(`follows the living owner on the last protected tick before death for viewer${localId} in mode${mode} (JSON round trip=%s)`, async (jsonRoundTrip) => {
      const shown = await fixture(mode, localId, jsonRoundTrip);
      try {
        const previous = shown.expiry(true);
        const drawn = shown.run(1, { 1: { dir: Dir.Right, bomb: false } });
        expect(shown.target().alive).toBe(true);
        expect(shown.target().gone).toBe(false);
        expect(shown.target().x).toBe(previous.x + 5);
        expect(shown.target().status.shield).toBeNull();
        expect(shown.state().effectSprites).toEqual([{ kind: "egg", ...previous, x: previous.x + 5 }]);
        expect(drawn).toEqual([shown.eggAt(previous.x + 5, previous.y, previous.frame)]);
        expect(shown.draw()).toEqual(drawn);
        expect(shown.run(1)).toEqual([]);
        expect(shown.target().alive).toBe(false);
        expect(shown.target().x).toBe(previous.x + 5);
      } finally { shown.view.dispose(); }
    });
  }
  it.each([false, true])(`keeps the final egg on shield expiry, then dies on the next tick in mode${mode} (JSON round trip=%s)`, async (jsonRoundTrip) => {
    const shown = await fixture(mode, 2, jsonRoundTrip);
    try {
      const previous = shown.expiry(true);
      expect(shown.run(1)).toEqual([shown.eggAt(previous.x, previous.y, previous.frame)]);
      expect(shown.target().alive).toBe(true);
      expect(shown.run(1)).toEqual([]);
      expect(shown.target().alive).toBe(false);
    } finally { shown.view.dispose(); }
  });
  it.each([false, true])(`follows the living owner on strict shield expiry in mode${mode} (JSON round trip=%s)`, async (jsonRoundTrip) => {
    const shown = await fixture(mode, 2, jsonRoundTrip);
    try {
      const previous = shown.expiry(false);
      const drawn = shown.run(1, { 1: { dir: Dir.Right, bomb: false } });
      expect(shown.target().alive).toBe(true);
      expect(shown.target().status.shield).toBeNull();
      expect(drawn).toEqual([shown.eggAt(previous.x + 5, previous.y, previous.frame)]);
      expect(shown.run(1)).toEqual([]);
    } finally { shown.view.dispose(); }
  });
}

const overlaps = [
  { name: "shield-inv", seed: 215794, wait: 144 },
  { name: "inv-shield", seed: 205850, wait: 239 },
];
for (const overlap of overlaps) {
  it.each([false, true])(`follows the owner until the last protected tick after natural ${overlap.name} pickups (JSON round trip=%s)`, async (jsonRoundTrip) => {
    const shown = await fixture(0, 2, jsonRoundTrip, { rows: ["1B.B2.3", "......."], seed: overlap.seed });
    try {
      // Two actual brick pickups, with player2 breaking the second brick and escaping.
      shown.run(150);
      shown.run(1, { 1: { dir: null, bomb: true } });
      shown.run(4, { 1: { dir: Dir.Down, bomb: false } });
      shown.run(6, { 1: { dir: Dir.Right, bomb: false } });
      shown.run(75);
      shown.run(4, { 1: { dir: Dir.Up, bomb: false } });
      shown.run(1, { 2: { dir: null, bomb: true } });
      shown.run(6, { 1: { dir: Dir.Down, bomb: false }, 2: { dir: Dir.Down, bomb: false } });
      shown.run(6, { 2: { dir: Dir.Right, bomb: false } });
      shown.run(16, { 1: { dir: Dir.Right, bomb: false } });
      shown.run(61);
      shown.run(5, { 1: { dir: Dir.Up, bomb: false } });
      expect(shown.state().tick).toBe(335);
      expect(shown.target().status.shield).toBe(overlap.name === "shield-inv" ? 8000 : 11166);
      expect(shown.target().status.invisible).toBe(overlap.name === "shield-inv" ? 11166 : null);
      shown.run(overlap.wait);
      shown.run(1, { 1: { dir: null, bomb: true } });
      shown.run(60);
      expect(shown.target().alive).toBe(true);
      const previous = { x: shown.target().x, y: shown.target().y, frame: shown.state().effects[0].frame };
      const drawn = shown.run(1, { 1: { dir: Dir.Right, bomb: false } });
      expect(shown.target().alive).toBe(true);
      expect(shown.target().status.shield).toBeNull();
      expect(drawn).toEqual([shown.eggAt(previous.x + 5, previous.y, previous.frame)]);
      expect(shown.draw()).toEqual(drawn);
      expect(shown.run(1)).toEqual([]);
      expect(shown.target().alive).toBe(false);
      expect(shown.target().x).toBe(previous.x + 5);
    } finally { shown.view.dispose(); }
  });
}
