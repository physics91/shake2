import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

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

type Snapshot = Extract<ServerMessage, { type: "snapshot" }>;

async function fixture(mode: GameMode, order = [1, 2, 3], localId = 2, jsonRoundTrip = false) {
  const layout = layoutFromAscii(order.length === 2 ? ["1..2"] : [order[0] === 2 ? "2.1.3" : "1.2.3", "....."]);
  let packet: Snapshot | null = null;
  let clock = 1000;
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
  if (mode !== 0) for (const id of order) expect(room.setTeam(id, id === 3 ? 2 : 1)).toBeNull();
  for (const id of order) if (id !== hostId) room.setReady(id, true);
  expect(room.start(hostId)).toBeNull();
  const assets = await loadSceneAssets("test", ["shaky"]);
  const sounds = { effects: true, stopMusic() {}, playMusic() {}, play() {}, stop() {} } as unknown as SoundBank;
  const surface = canvas();
  const view = new GameView(surface.getContext(), assets, sounds, { localPlayerIds: [localId], hostId, music: null });
  const composition = contexts.at(-1)!;
  function state() { return fromWireState(snapshot().state, layout); }
  function draw() {
    const current = state();
    const shown = jsonRoundTrip ? fromWireState(JSON.parse(JSON.stringify(toWireState(current))), layout) : current;
    vi.mocked(composition.drawImage).mockClear();
    view.render(shown, { chat: { balloons: [], line: localId === 1 ? { text: "", caret: null } : null,
      typing: snapshot().typing.filter((id) => id !== localId) } });
    return vi.mocked(composition.drawImage).mock.calls.filter(([source, left, top, width, height]) =>
      source === assets.hud.mark && left === 123 && top === 33 && width === 30 && height === 16);
  }
  function run(n: number, inputs: InputMap = {}, typing?: boolean) {
    for (const [id, input] of Object.entries(inputs)) {
      if (input) room.input(Number(id), input.dir, { bomb: input.bomb, attack: false, evade: false });
    }
    if (typing !== undefined) room.typing(1, typing);
    let marks: ReturnType<typeof draw> = [];
    for (let i = 0; i < n; i++) {
      clock = 1000 + Math.floor(snapshot().state.tick * 1000 / 30);
      room.tick();
      if (state().phase === "playing" || state().phase === "countdown") marks = draw();
    }
    return marks;
  }
  function bomb() { run(150); run(1, { 1: { dir: null, bomb: true } }); }
  function approachCapsule(completion = false) {
    bomb();
    run(2, { 1: { dir: null, bomb: false }, 2: { dir: Dir.Down, bomb: false } }, true);
    run(completion ? 97 : 98, { 2: { dir: null, bomb: false } });
    run(4, { 2: { dir: Dir.Up, bomb: false } });
    expect(run(12, { 2: { dir: Dir.Left, bomb: false } })).toHaveLength(0);
    expect(state().tick).toBe(completion ? 266 : 267);
    expect(snapshot().typing).toContain(1);
  }
  function revive(completion = false) {
    const marks = run(1, { 2: { dir: Dir.Left, bomb: false } });
    expect(state().tick).toBe(completion ? 267 : 268);
    expect(state().players.find((player) => player.id === 1)!.alive).toBe(true);
    expect(snapshot().events.some((event) => event.type === "revived")).toBe(true);
    expect(snapshot().typing).toContain(1);
    return marks;
  }
  return { view, snapshot, state, draw, run, bomb, approachCapsule, revive };
}

it.each([false, true])("keeps the final remote typing mark on the first death tick (JSON round trip=%s)", async (jsonRoundTrip) => {
  const shown = await fixture(0, [1, 2], 2, jsonRoundTrip);
  try {
    shown.bomb();
    expect(shown.run(60, {}, true)).toHaveLength(1);
    expect(shown.state().tick).toBe(211);
    expect(shown.run(1)).toHaveLength(1);
    expect(shown.state().players[0].alive).toBe(false);
    expect(shown.snapshot().typing).toContain(1);
    expect(shown.draw()).toHaveLength(1);
    expect(shown.run(1)).toHaveLength(0);
    expect(shown.snapshot().typing).toContain(1);
  } finally { shown.view.dispose(); }
});

it("does not show the local typing mark after its own death starts", async () => {
  const shown = await fixture(0, [1, 2], 1);
  try {
    shown.bomb();
    expect(shown.run(60, {}, true)).toHaveLength(1);
    expect(shown.run(1)).toHaveLength(0);
    expect(shown.draw()).toHaveLength(0);
  } finally { shown.view.dispose(); }
});

it("removes a remote mark when the real typing packet closes", async () => {
  const shown = await fixture(0, [1, 2]);
  try {
    shown.bomb();
    expect(shown.run(20, {}, true)).toHaveLength(1);
    expect(shown.run(20, { 1: { dir: null, bomb: false } }, false)).toHaveLength(0);
    expect(shown.snapshot().typing).not.toContain(1);
  } finally { shown.view.dispose(); }
});

for (const mode of [6, 7] as const) {
  describe(`remote typing mark on capsule revival in mode ${mode}`, () => {
    for (const completion of [false, true]) {
      it.each([false, true])(`waits for the next player pass after a later pickup (completion=${completion}, JSON round trip=%s)`, async (jsonRoundTrip) => {
        const shown = await fixture(mode, [1, 2, 3], 2, jsonRoundTrip);
        try {
          shown.approachCapsule(completion);
          expect(shown.revive(completion)).toHaveLength(0);
          expect(shown.draw()).toHaveLength(0);
          expect(shown.run(1, { 2: { dir: null, bomb: false } })).toHaveLength(1);
        } finally { shown.view.dispose(); }
      });
    }
    it.each([false, true])("shows the mark when an earlier slot revives the remote player (JSON round trip=%s)", async (jsonRoundTrip) => {
      const shown = await fixture(mode, [2, 1, 3], 2, jsonRoundTrip);
      try {
        shown.approachCapsule();
        expect(shown.revive()).toHaveLength(1);
        expect(shown.draw()).toHaveLength(1);
        expect(shown.run(1, { 2: { dir: null, bomb: false } })).toHaveLength(1);
      } finally { shown.view.dispose(); }
    });
    it("shows the local mark immediately on its own revival", async () => {
      const shown = await fixture(mode, [1, 2, 3], 1);
      try {
        shown.approachCapsule();
        expect(shown.revive()).toHaveLength(1);
        expect(shown.draw()).toHaveLength(1);
      } finally { shown.view.dispose(); }
    });
  });
}
