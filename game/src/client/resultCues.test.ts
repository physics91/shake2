import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { Room } from "../server/room.ts";
import { fromWireState, userCard } from "../server/protocol.ts";
import type { ServerMessage } from "../server/protocol.ts";
import { layoutFromAscii, VERSUS } from "../sim/testing.ts";
import type { GameMode, MatchState } from "../sim/types.ts";
import type { SoundBank } from "./audio.ts";
import { GameView } from "./gameView.ts";
import type { SceneAssets } from "./scene.ts";

let now = 0;
const rendered: { tick: number; phase: MatchState["phase"] }[] = [];
vi.mock("./renderer.ts", async (original) => ({
  ...await original<typeof import("./renderer.ts")>(),
  renderScreen(_ctx: CanvasRenderingContext2D, _assets: SceneAssets, state: MatchState) {
    rendered.push({ tick: state.tick, phase: state.phase });
    return null;
  },
}));

function canvas() {
  const element = Object.assign(new EventTarget(), { width: 800, height: 600 });
  const ctx = { canvas: element, fillStyle: "", globalAlpha: 1, darkness: 0,
    fillRect() { this.darkness = this.globalAlpha; }, drawImage() {},
    save() {}, restore() { this.globalAlpha = 1; },
  };
  return Object.assign(element, { getContext: () => ctx });
}

beforeAll(() => {
  vi.stubGlobal("document", { createElement: canvas });
  vi.stubGlobal("window", new EventTarget());
  vi.spyOn(performance, "now").mockImplementation(() => now);
});
afterAll(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function fixture(mode: GameMode, origin = 0) {
  const layout = layoutFromAscii(Array.from({ length: 15 }, (_, y) => y === 1 ? ".1.....2.....3." : ".".repeat(15)));
  let packet: Extract<ServerMessage, { type: "snapshot" }> | undefined, clock = 23_000;
  const peers = [1, 2, 3].map((id) => ({ id, send(message: ServerMessage) {
    if (id === 3 && message.type === "snapshot") packet = JSON.parse(JSON.stringify(message));
  } }));
  const profile = (id: number) => {
    const name = `P${id}`;
    return { name, nick: name, useId: true, character: "rookie", hue: 0,
      card: userCard({ id: name, nick: name, greeting: "", character: "rookie", hue: 0, useId: true,
        wins: 0, losses: 0, cell: 0, level: 12, guild: -1, rank: 0, gender: 0, manner: 0,
        exp: 0, candy: 0, items: [0], pairs: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9] }),
    };
  };
  const room = new Room({ code: "TEST", number: 1, title: "TEST", password: "" }, peers[0], profile(1), {
    maps: ["test"], layoutFor: () => layout, musicCount: 0, rules: { ...VERSUS, mode },
    now: () => clock, changed() {},
  });
  for (const peer of peers.slice(1)) expect(room.join(peer, profile(peer.id))).toBeNull();
  expect(room.setMode(1, mode)).toBeNull();
  if (mode === 7) for (const peer of peers) expect(room.setTeam(peer.id, peer.id === 3 ? 2 : 1)).toBeNull();
  for (const peer of peers.slice(1)) room.setReady(peer.id, true);
  expect(room.start(1)).toBeNull();

  const played: { tick: number; name: string; gate: string | undefined }[] = [];
  const sounds = { effects: true, play(name: string, gate?: string) { played.push({ tick: state().tick, name, gate }); },
    stop() {}, stopMusic() { played.push({ tick: state().tick, name: "music-stop", gate: undefined }); }, playMusic() {},
  } as unknown as SoundBank;
  const display = canvas().getContext();
  now = origin;
  const view = new GameView(display as unknown as CanvasRenderingContext2D,
    { cursor: { meta: { animations: [{ unknown_u16: 5, frames: [{}] }] } } } as unknown as SceneAssets,
    sounds, { localPlayerIds: [3], hostId: 1, music: null });
  function state() {
    if (!packet) throw new Error("missing Room snapshot");
    return fromWireState(packet.state, layout);
  }
  function draw() {
    rendered.length = 0; display.darkness = 0;
    view.render(state());
    return { drawn: rendered.some((p) => p.phase === state().phase), darkness: display.darkness };
  }
  function step(bomb = false, paint = true, extraFrame = false) {
    for (const peer of peers) room.input(peer.id, null, { bomb: bomb && peer.id !== 3, attack: false, evade: false });
    clock = 23_000 + Math.floor(state().tick * 1000 / 30);
    room.tick(); now = origin + state().tick * 1000 / 30;
    view.ingest(state(), packet!.events);
    if (extraFrame) {
      now -= 1000 / 60; draw(); now += 1000 / 60;
    }
    return paint ? draw() : undefined;
  }
  function win(paint = true) {
    while (state().phase !== "playing") step(false, paint);
    step(true, paint);
    for (let n = 0; state().phase === "playing" && n < 400; n++) step(false, paint);
    expect(["round-over", "match-over"]).toContain(state().phase);
  }
  view.ingest(state(), packet!.events); draw();
  return { room, view, state, step, draw, win, played };
}

describe.each([0, 7] as const)("result audio and fades through Room, mode %i", (mode) => {
  it.each([[1, 0], [1, 1_000_000_000], [3, 0], [3, 1_000_000_000]])(
    "plays the %i-win result on its first drawn frame, clock origin %i", (wins, origin) => {
      const game = fixture(mode, origin);
      try {
        for (let n = 0; n < wins; n++) game.win();
        const resultTick = game.state().tick, name = wins === 3 ? "endsig" : "end";
        const heard = () => game.played.filter((v) => v.tick >= resultTick && v.name === name);
        const stopped = () => game.played.filter((v) => v.tick >= resultTick && v.name === "music-stop");
        expect(heard()).toEqual([]);
        expect(stopped()).toEqual([]);
        // The switch's own frame is fade-out frame 0. Native 0x4130f0 finishes
        // frame 10 in black, then 0x405d30 draws the result on frame 11.
        for (let n = 1; n <= 10; n++) expect(game.step()?.drawn).toBe(false);
        const first = game.step();
        expect(first).toEqual({ drawn: true, darkness: 0.9 });
        expect(heard()).toEqual([{ tick: resultTick + 11, name, gate: "music" }]);
        expect(stopped()).toEqual([{ tick: resultTick + 11, name: "music-stop", gate: undefined }]);
        const audioOrder = game.played.filter((v) => v.tick === resultTick + 11).map((v) => v.name);
        expect(audioOrder).toEqual(wins === 3 ? ["endsig", "music-stop"] : ["music-stop", "end"]);
        const brightness = [first!.darkness];
        for (let n = 0; n < 10; n++) brightness.push(game.step()!.darkness);
        expect(brightness).toEqual([0.9, 0.8, 0.7, 0.6, 0.5, 0.4, 0.3, 0.2, 0.1, 0, 0]);
        expect(heard()).toHaveLength(1);
      } finally { game.view.dispose(); }
    },
  );

  it("discards a result cue if the next wait arrives before a result was drawn", () => {
    const game = fixture(mode);
    try {
      game.win(false);
      while (game.state().phase === "round-over") game.step(false, false);
      expect(game.state().phase).toBe("waiting");
      game.draw();
      expect(game.played.some((v) => v.name === "end")).toBe(false);
    } finally { game.view.dispose(); }
  });

  it("does not sound a pending result after the view is disposed during fade-out", () => {
    const game = fixture(mode);
    game.win(); game.view.dispose();
    expect(game.played.some((v) => v.name === "end")).toBe(false);
  });

  it("replaces an undrawn round cue when departures end the match during fade-out", () => {
    const game = fixture(mode);
    try {
      game.win(); game.room.leave(1); game.room.leave(2); game.step();
      expect(game.state().phase).toBe("match-over");
      for (let n = 0; n < 12; n++) game.step();
      expect(game.played.filter((v) => v.name === "end")).toEqual([]);
      expect(game.played.filter((v) => v.name === "endsig")).toHaveLength(1);
    } finally { game.view.dispose(); }
  });
});

describe.each([0, 7] as const)("departures during a fade through Room, mode %i", (mode) => {
  const interruptions = [
    [1, 0.9], [5, 0.9], [10, 0.9], [11, 0.9], [12, 0.8],
    [15, 0.5], [20, 0], [21, 0], [22, 0.9],
  ] as const;

  it.each(interruptions.flatMap(([delay, firstDarkness]) =>
    [0, 1_000_000_000].map((origin) => ({ delay, firstDarkness, origin }))))(
    "keeps the native fade at round-result offset $delay, clock origin $origin", ({ delay, firstDarkness, origin }) => {
      const game = fixture(mode, origin);
      try {
        game.win();
        const begin = game.state().tick;
        for (let n = 1; n < delay; n++) game.step();
        game.room.leave(1); game.room.leave(2);
        const switched = game.step();
        expect(game.state().phase).toBe("match-over");
        expect(switched).toEqual({ drawn: false, darkness: delay <= 10 ? Math.min(1, (delay + 1) / 10) : 0.1 });
        // Native fade(1) only changes the direction flag. During out it keeps
        // the old deadline; during in it darkens again, then resumes the in scalar.
        const firstTick = begin + (delay <= 10 ? 11 : delay + 11);
        while (game.state().tick < firstTick - 1) expect(game.step()?.drawn).toBe(false);
        expect(game.played.filter((v) => v.name === "endsig")).toEqual([]);
        expect(game.step()).toEqual({ drawn: true, darkness: firstDarkness });
        expect(game.played.filter((v) => v.name === "endsig"))
          .toEqual([{ tick: firstTick, name: "endsig", gate: "music" }]);
        expect(game.played.filter((v) => v.tick === firstTick).map((v) => v.name))
          .toEqual(["endsig", "music-stop"]);
        expect(game.played.filter((v) => v.name === "end")).toHaveLength(delay >= 12 ? 1 : 0);
        for (let n = 1; n <= 10; n++) {
          expect(game.step()).toEqual({ drawn: true, darkness: Math.max(0, Math.round(firstDarkness * 10 - n) / 10) });
        }
        expect(game.played.filter((v) => v.name === "endsig")).toHaveLength(1);
      } finally { game.view.dispose(); }
    },
  );

  it.each([1, 5, 10].flatMap((delay) => [0, 1_000_000_000].map((origin) => ({ delay, origin }))))(
    "keeps countdown fade-out at departure offset $delay, clock origin $origin", ({ delay, origin }) => {
      const game = fixture(mode, origin);
      try {
        while (game.state().phase === "waiting") game.step();
        expect(game.state().phase).toBe("countdown");
        const begin = game.state().tick;
        for (let n = 1; n < delay; n++) game.step();
        game.room.leave(1); game.room.leave(2);
        expect(game.step()).toEqual({ drawn: false, darkness: Math.min(1, (delay + 1) / 10) });
        expect(game.state().phase).toBe("match-over");
        while (game.state().tick < begin + 10) expect(game.step()?.drawn).toBe(false);
        expect(game.step()).toEqual({ drawn: true, darkness: 0.9 });
        expect(game.played.filter((v) => v.name === "endsig"))
          .toEqual([{ tick: begin + 11, name: "endsig", gate: "music" }]);
      } finally { game.view.dispose(); }
    },
  );

  it.each([12, 15].flatMap((delay) => [0, 1_000_000_000].map((origin) => ({ delay, origin }))))(
    "resumes the last drawn in scalar with an extra 60 Hz frame, offset $delay, origin $origin", ({ delay, origin }) => {
      const game = fixture(mode, origin);
      try {
        game.win();
        const begin = game.state().tick;
        for (let n = 1; n < delay; n++) game.step();
        game.room.leave(1); game.room.leave(2);
        expect(game.step(false, true, true)).toEqual({ drawn: false, darkness: 0.1 });
        const firstTick = begin + delay + 11;
        while (game.state().tick < firstTick - 1) expect(game.step()?.drawn).toBe(false);
        expect(game.step()).toEqual({ drawn: true, darkness: delay === 12 ? 0.8 : 0.5 });
        expect(game.played.filter((v) => v.name === "endsig"))
          .toEqual([{ tick: firstTick, name: "endsig", gate: "music" }]);
      } finally { game.view.dispose(); }
    },
  );
});
