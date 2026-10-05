import { readFileSync } from "node:fs";
import { afterAll, beforeAll, expect, it, vi } from "vitest";

import type { LevelAssets, Sheet } from "./assets.ts";
import type { SoundBank } from "./audio.ts";
import { drawFrameOrHalf } from "./sprite.ts";
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
    if (dir === "character") {
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

async function fixture(mode: GameMode, localId = 2, mate = false, jsonRoundTrip = false, earlyPickup = false) {
  const order = earlyPickup ? [2, 1, 3] : [1, 2, 3];
  const layout = layoutFromAscii([earlyPickup ? "2B1.3" : "1B2.3", "....."]);
  const seed = 1948; // The actual first brick roll is a question mark with invisible sub38.
  let packet: Snapshot | null = null;
  let clock = seed * 1000;
  function snapshot(): Snapshot {
    if (!packet) throw new Error("Room did not send a snapshot");
    return packet;
  }
  const peers = order.map((id) => ({ id, send(message: ServerMessage) {
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
  const hostId = order[0];
  const room = new Room({ code: "TEST", number: 1, title: "TEST", password: "" }, peers[0], profile(hostId), {
    maps: ["test"], layoutFor: () => layout, musicCount: 0, rules: VERSUS, now: () => clock, changed() {},
  });
  for (const peer of peers.slice(1)) expect(room.join(peer, profile(peer.id))).toBeNull();
  expect(room.setMode(hostId, mode)).toBeNull();
  if (mode !== 0) for (const id of order) expect(room.setTeam(id, mate ? id === 3 ? 2 : 1 : id)).toBeNull();
  for (const id of order) if (id !== hostId) room.setReady(id, true);
  expect(room.start(hostId)).toBeNull();
  const assets = await loadSceneAssets("test", ["shaky"]);
  const sounds = { effects: true, stopMusic() {}, playMusic() {}, play() {}, stop() {} } as unknown as SoundBank;
  const surface = canvas();
  const view = new GameView(surface.getContext(), assets, sounds, { localPlayerIds: [localId], hostId, music: null });
  const composition = contexts.at(-1)!;
  function state() { return fromWireState(snapshot().state, layout); }
  function target() { return state().players.find((player) => player.id === 1)!; }
  function draw() {
    const current = state();
    const shown = jsonRoundTrip ? fromWireState(JSON.parse(JSON.stringify(toWireState(current))), layout) : current;
    vi.mocked(composition.drawImage).mockClear();
    vi.mocked(drawFrameOrHalf).mockClear();
    view.render(shown, { chat: { balloons: [], line: null, typing: snapshot().typing.filter((id) => id !== localId) } });
    const p = target();
    const half = vi.mocked(drawFrameOrHalf).mock.calls.filter(([, sheet, , , x, y]) =>
      sheet === assets.characters.get("shaky")!.body && x === 50 + p.x && y === 50 + p.y).length;
    const mark = vi.mocked(composition.drawImage).mock.calls.filter(([source, left, top, width, height]) =>
      source === assets.hud.mark && left === 123 && top === 33 && width === 30 && height === 16).length;
    return { half, mark };
  }
  function run(n: number, inputs: InputMap = {}, typing?: boolean) {
    for (const id of order) {
      const input = inputs[id];
      room.input(id, input?.dir ?? null, { bomb: input?.bomb ?? false, attack: false, evade: false });
    }
    if (typing !== undefined) room.typing(1, typing);
    let drawn = { half: 0, mark: 0 };
    for (let i = 0; i < n; i++) {
      clock = seed * 1000 + Math.floor(snapshot().state.tick * 1000 / 30);
      room.tick();
      drawn = state().phase === "playing" || state().phase === "countdown" ? draw() : { half: 0, mark: 0 };
    }
    return drawn;
  }
  function invisible() {
    run(150);
    run(1, { 1: { dir: null, bomb: true } });
    run(4, { 1: { dir: Dir.Down, bomb: false } });
    run(6, { 1: { dir: Dir.Right, bomb: false } });
    run(75);
    const drawn = run(4, { 1: { dir: Dir.Up, bomb: false } });
    expect(state().tick).toBe(240);
    expect(target().status.invisible).toBe(8000);
    expect(snapshot().events.some((event) => event.type === "item-picked" && event.playerId === 1)).toBe(true);
    return drawn;
  }
  function bomb() { run(1, { 1: { dir: null, bomb: true } }); }
  function approachCapsule() {
    invisible();
    bomb();
    run(4, { 2: { dir: Dir.Down, bomb: false } }, true);
    for (let i = 0; i < 140 && !target().gone; i++) run(1);
    expect(target().gone).toBe(true);
    expect(target().status.invisible).toBe(8000);
    expect(state().players.find((player) => player.id === 2)!.alive).toBe(true);
    run(4, { 2: { dir: Dir.Up, bomb: false } });
  }
  function revive() {
    let drawn = { half: 0, mark: 0 };
    for (let i = 0; i < 20 && !target().alive; i++) drawn = run(1, { 2: { dir: Dir.Left, bomb: false } });
    expect(target().alive).toBe(true);
    expect(target().status.invisible).toBe(8000);
    expect(snapshot().events.some((event) => event.type === "revived")).toBe(true);
    return drawn;
  }
  return { view, state, target, snapshot, run, draw, invisible, bomb, approachCapsule, revive };
}

for (const mode of [0, 1, 2, 6, 7] as const) {
  it.each([false, true])(`shows an invisible enemy's dying body after the alive pass in mode${mode} (JSON round trip=%s)`, async (jsonRoundTrip) => {
    const shown = await fixture(mode, 2, false, jsonRoundTrip);
    try {
      expect(shown.invisible().half).toBe(0);
      shown.bomb();
      expect(shown.run(60).half).toBe(0);
      expect(shown.target().alive).toBe(true);
      expect(shown.run(1).half).toBe(0); // 0x40abaf still checks invisibility on the first death tick.
      expect(shown.target().alive).toBe(false);
      expect(shown.run(1).half).toBe(1); // 0x40ad7b skips that check in the death branch.
      expect(shown.draw().half).toBe(1);
      for (let i = 0; i < 90 && !shown.target().gone; i++) shown.run(1);
      expect(shown.target().gone).toBe(true);
      expect(shown.run(1).half).toBe(0);
    } finally { shown.view.dispose(); }
  });
}

for (const mode of [6, 7] as const) {
  it.each([false, true])(`keeps an invisible teammate's body through the first death tick in mode${mode} (JSON round trip=%s)`, async (jsonRoundTrip) => {
    const shown = await fixture(mode, 2, true, jsonRoundTrip);
    try {
      expect(shown.invisible().half).toBe(1);
      shown.bomb();
      expect(shown.run(61).half).toBe(1);
      expect(shown.target().alive).toBe(false);
      expect(shown.run(1).half).toBe(1);
    } finally { shown.view.dispose(); }
  });
  for (const localId of [2, 3]) {
    it.each([false, true])(`uses the alive visibility check after an earlier pickup for viewer${localId} in mode${mode} (JSON round trip=%s)`, async (jsonRoundTrip) => {
      const shown = await fixture(mode, localId, true, jsonRoundTrip, true);
      try {
        shown.approachCapsule();
        expect(shown.revive().half).toBe(localId === 2 ? 1 : 0);
        expect(shown.draw().half).toBe(localId === 2 ? 1 : 0);
        expect(shown.run(1).half).toBe(localId === 2 ? 1 : 0);
      } finally { shown.view.dispose(); }
    });
  }
  for (const localId of [1, 2, 3]) {
    it.each([false, true])(`keeps the late invisible revival's body and typing mark separate for viewer${localId} in mode${mode} (JSON round trip=%s)`, async (jsonRoundTrip) => {
      const shown = await fixture(mode, localId, true, jsonRoundTrip);
      try {
        shown.approachCapsule();
        expect(shown.revive().half).toBe(localId === 1 ? 1 : 0);
        expect(shown.draw().half).toBe(localId === 1 ? 1 : 0);
        const next = shown.run(1);
        expect(next.half).toBe(localId === 3 ? 0 : 1);
        expect(next.mark).toBe(localId === 1 ? 0 : 1);
      } finally { shown.view.dispose(); }
    });
  }
}

it.each([false, true])("keeps the invisible local body on its first death tick (JSON round trip=%s)", async (jsonRoundTrip) => {
  const shown = await fixture(0, 1, false, jsonRoundTrip);
  try {
    expect(shown.invisible().half).toBe(1);
    shown.bomb();
    expect(shown.run(61).half).toBe(1);
    expect(shown.target().alive).toBe(false);
    expect(shown.run(1).half).toBe(1);
  } finally { shown.view.dispose(); }
});

it.each([false, true])("returns the dying body to the ordinary copy when invisibility expires (JSON round trip=%s)", async (jsonRoundTrip) => {
  const shown = await fixture(0, 2, false, jsonRoundTrip);
  try {
    shown.invisible();
    shown.run(200);
    shown.bomb();
    expect(shown.run(62).half).toBe(1);
    expect(shown.target().alive).toBe(false);
    expect(shown.run(37).half).toBe(1);
    expect(shown.target().status.invisible).toBe(8000);
    expect(shown.run(1).half).toBe(0);
    expect(shown.target().status.invisible).toBeNull();
    expect(shown.target().gone).toBe(false);
  } finally { shown.view.dispose(); }
});
