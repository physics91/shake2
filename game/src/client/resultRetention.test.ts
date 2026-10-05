import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { GameView } from "./gameView.ts";
import type { SoundBank } from "./audio.ts";
import type { SceneAssets } from "./scene.ts";
import { portraitRect, STATUS_TEXT } from "./hudLayout.ts";
import { WorkSurface } from "./tintArt.ts";
import { Room } from "../server/room.ts";
import { fromWireState, toWireState, userCard } from "../server/protocol.ts";
import type { ServerMessage } from "../server/protocol.ts";
import { layoutFromAscii, VERSUS } from "../sim/testing.ts";
import type { GameMode } from "../sim/types.ts";

interface Paint { image?: string; text?: string; x: number; y: number }
interface PaintedContext extends CanvasRenderingContext2D { painted: Paint[]; current: Paint[] }

vi.mock("./text.ts", async (original) => ({
  ...await original<typeof import("./text.ts")>(),
  outlinedText(ctx: PaintedContext, text: string, x: number, y: number) {
    const paint = { text, x, y };
    ctx.painted.push(paint);
    ctx.current.push(paint);
  },
}));

function canvas() {
  const element = Object.assign(new EventTarget(), { width: 800, height: 600, src: "" });
  const painted: Paint[] = [], current: Paint[] = [];
  const ctx = {
    canvas: element, painted, current, fillStyle: "",
    fillRect() { painted.length = 0; }, clearRect() {}, putImageData() {},
    getImageData(_x: number, _y: number, width: number, height: number) {
      return { width, height, data: new Uint8ClampedArray(width * height * 4) };
    },
    drawImage(image: HTMLImageElement, ...args: number[]) {
      // These three original screen pictures replace the whole composition. Keyed row
      // operations keep the preceding rows; this records that observable painting history.
      if (["load", "roundResult", "gameResult"].includes(image.src)) painted.length = 0;
      const [x, y] = args.length === 2 ? args : args.slice(4, 6);
      const paint = { image: image.src, x, y };
      painted.push(paint);
      current.push(paint);
    },
  } as unknown as PaintedContext;
  return Object.assign(element, { getContext: () => ctx });
}

beforeAll(() => {
  vi.stubGlobal("document", { createElement: canvas });
  vi.stubGlobal("window", new EventTarget());
  vi.spyOn(performance, "now").mockReturnValue(0);
});
afterAll(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function fixture(mode: GameMode, json = false) {
  const rows = Array.from({ length: 15 }, (_, y) => y === 1 ? ".1.....2.....3." : ".".repeat(15));
  const layout = layoutFromAscii(rows);
  let packet: Extract<ServerMessage, { type: "snapshot" }> | undefined, clock = 23_000;
  // The observer survives both a host leave and a guest leave, as an actual online client does.
  const peers = [1, 2, 3].map((id) => ({ id, send(message: ServerMessage) {
    if (id === 3 && message.type === "snapshot") packet = JSON.parse(JSON.stringify(message));
  } }));
  function profile(id: number) {
    const name = `P${id}`, character = id === 1 ? "shaky" : "rookie";
    return { name, nick: name, useId: true, character, hue: 0,
      card: userCard({ id: name, nick: name, greeting: "", character, hue: 0, useId: true,
        wins: 0, losses: 0, cell: 0, level: 12, guild: -1, rank: 0, gender: 0, manner: 0,
        exp: 0, candy: 0, items: [0], pairs: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9] }),
    };
  }
  const room = new Room({ code: "TEST", number: 1, title: "TEST", password: "" }, peers[0], profile(1), {
    maps: ["test"], layoutFor: () => layout, musicCount: 0,
    rules: { ...VERSUS, mode }, now: () => clock, changed() {},
  });
  for (const peer of peers.slice(1)) expect(room.join(peer, profile(peer.id))).toBeNull();
  expect(room.setMode(1, mode)).toBeNull();
  if (mode === 7) for (const peer of peers) expect(room.setTeam(peer.id, peer.id === 3 ? 2 : 1)).toBeNull();
  for (const peer of peers.slice(1)) room.setReady(peer.id, true);
  expect(room.start(1)).toBeNull();

  const hud = Object.fromEntries(["mark", "guild", "teambar", "sd", "portraits", "load", "roundResult", "gameResult"]
    .map((src) => [src, { src } as HTMLImageElement]));
  const heads = new Map<number, WorkSurface>();
  for (const peer of peers) {
    const head = new WorkSurface();
    head.recolour(hud.portraits, portraitRect(profile(peer.id).character), 0);
    Object.assign(head.picture, { src: `head${peer.id}` });
    heads.set(peer.id, head);
  }
  const assets = { hud, heads, cursor: { meta: { animations: [{ unknown_u16: 5, frames: [{}] }] } } } as unknown as SceneAssets;
  const sounds = { effects: true, stopMusic() {}, playMusic() {}, play() {}, stop() {} } as unknown as SoundBank;
  const surface = canvas();
  const view = new GameView(surface.getContext(), assets, sounds, { localPlayerIds: [3], hostId: 1, music: null });
  const composition = view.composition.getContext("2d") as PaintedContext;
  function state() {
    if (!packet) throw new Error("missing Room snapshot");
    const state = fromWireState(packet.state, layout);
    return json ? fromWireState(JSON.parse(JSON.stringify(toWireState(state))), layout) : state;
  }
  function run(n: number, bombers: number[] = []) {
    for (const peer of peers) room.input(peer.id, null, { bomb: bombers.includes(peer.id), attack: false, evade: false });
    for (let i = 0; i < n; i++) {
      clock = 23_000 + Math.floor(state().tick * 1000 / 30);
      room.tick();
    }
  }
  function draw() {
    composition.current.length = 0;
    view.setHost(room.hostId);
    view.ingest(state(), packet!.events);
    view.render(state());
    return composition.painted;
  }
  function winRound(bombers: number[] = [1, 2]) {
    run(1, bombers);
    for (let i = 0; state().phase === "playing" && i < 400; i++) run(1);
    expect(state().phase).toBe("round-over");
  }
  function nextWait() {
    for (let i = 0; state().phase === "round-over" && i < 50; i++) run(1);
    expect(state()).toMatchObject({ phase: "waiting", round: 2 });
  }
  return { room, view, state, run, draw, winRound, nextWait, composition };
}

describe.each([0, 7] as const)("retained Room results, mode %i", (mode) => {
  it.each([[1, false], [1, true], [2, false], [2, true]] as const)(
    "keeps the painted row after player %i leaves the later wait, JSON=%s", (leaver, json) => {
      const game = fixture(mode, json);
      try {
        game.draw(); game.run(150); game.winRound(); game.draw(); game.nextWait(); game.draw();
        game.room.leave(leaver); game.run(2);
        const painted = game.draw();
        expect(game.state().players.some((p) => p.id === leaver)).toBe(false);
        expect(painted.some((p) => p.image === `head${leaver}`)).toBe(true);
        expect(painted.some((p) => p.text === `P${leaver}`)).toBe(true);
        expect(game.composition.current.some((p) => p.image === "roundResult")).toBe(false);
        if (leaver === 1) {
          const status = painted.filter((p) => p.x === 339 && p.y === 245).map((p) => p.text);
          expect(status).toContain(STATUS_TEXT.waiting);
          expect(status).toContain(STATUS_TEXT.ready);
          expect(status).toContain(STATUS_TEXT.host);
        }
        // The next round result really replaces the picture: the departed row must then go.
        game.run(150); game.winRound([leaver === 1 ? 2 : 1]);
        expect(game.draw().some((p) => p.image === `head${leaver}`)).toBe(false);
      } finally { game.view.dispose(); }
    },
  );

  it.each([1, 2])("clears player %i on the first wait, which redraws new_load", (leaver) => {
    const game = fixture(mode, true);
    try {
      game.draw(); game.room.leave(leaver); game.run(2);
      expect(game.draw().some((p) => p.image === `head${leaver}`)).toBe(false);
      expect(game.composition.current.some((p) => p.image === "load")).toBe(true);
    } finally { game.view.dispose(); }
  });

  it.each([1, 2])("clears player %i when the round result is redrawn", (leaver) => {
    const game = fixture(mode, true);
    try {
      game.draw(); game.run(150); game.winRound(); game.draw();
      game.room.leave(leaver); game.run(2);
      expect(game.draw().some((p) => p.image === `head${leaver}`)).toBe(false);
      expect(game.composition.current.some((p) => p.image === "roundResult")).toBe(true);
    } finally { game.view.dispose(); }
  });

  it("draws the result backdrop if loading skipped its rendered frame", () => {
    const game = fixture(mode, true);
    try {
      game.run(150); game.winRound(); game.nextWait();
      const painted = game.draw();
      expect(painted.some((p) => p.image === "roundResult")).toBe(true);
      for (const id of [1, 2, 3]) expect(painted.some((p) => p.image === `head${id}`)).toBe(true);
    } finally { game.view.dispose(); }
  });
});
