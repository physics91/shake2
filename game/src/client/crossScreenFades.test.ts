import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fadeOver, freezeCanvas, registerFadeFrame } from "./screenKit.ts";
import { FRAME_MS } from "./startLayout.ts";
import { GameView } from "./gameView.ts";
import { createMatch, removePlayer, step } from "../sim/match.ts";
import { layoutFromAscii, setups, VERSUS } from "../sim/testing.ts";

vi.mock("./renderer.ts", async (original) => ({
  ...await original<typeof import("./renderer.ts")>(),
  renderScreen(ctx: Canvas["ctx"], _assets: unknown, state: { phase: string }) {
    ctx.pixel = colours[state.phase === "match-over" ? "result" : state.phase === "waiting" ? "lobby" : "room"].slice();
    ctx.alpha = 1;
    return null;
  },
}));

const colours = { lobby: [160, 120, 80], room: [40, 180, 100], result: [200, 80, 160] };
class Canvas extends EventTarget {
  width = 800;
  height = 600;
  className = "";
  removed = false;
  readonly ctx = {
    canvas: this, fillStyle: "#000", globalAlpha: 1, pixel: [0, 0, 0], alpha: 0,
    drawImage: (from: Canvas) => {
      this.ctx.pixel = from.ctx.pixel.slice(); this.ctx.alpha = from.ctx.alpha;
    },
    fillRect: () => {
      this.ctx.pixel = this.ctx.pixel.map((v) => v * (1 - this.ctx.globalAlpha));
      this.ctx.alpha = this.ctx.globalAlpha + (1 - this.ctx.globalAlpha) * this.ctx.alpha;
    },
    clearRect: () => { this.ctx.pixel = [0, 0, 0]; this.ctx.alpha = 0; },
    save() {}, restore: () => { this.ctx.globalAlpha = 1; },
  };
  getContext() { return this.ctx; }
  setAttribute() {}
  remove() { this.removed = true; }
}

class Stage {
  readonly main = new Canvas();
  veil: Canvas | null = null;
  loading = false;
  constructor(scene: keyof typeof colours) {
    this.main.ctx.pixel = colours[scene].slice(); this.main.ctx.alpha = 1;
  }
  insertBefore(veil: Canvas) { this.veil = veil; }
  querySelector(selector: string) {
    if (selector === ".loading") return this.loading ? {} : null;
    if (selector === "canvas.game-canvas") return this.main;
    return null;
  }
  shown() {
    const v = this.veil;
    if (!v || v.removed) return this.main.ctx.pixel;
    return v.ctx.pixel.map((p, i) => p + this.main.ctx.pixel[i] * (1 - v.ctx.alpha));
  }
}

let now = 0, serial = 0;
const raf = new Map<number, FrameRequestCallback>();
beforeEach(() => {
  raf.clear(); now = 0;
  vi.stubGlobal("document", { createElement: () => new Canvas() });
  vi.stubGlobal("window", new EventTarget());
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => { raf.set(++serial, cb); return serial; });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => raf.delete(id));
  vi.spyOn(performance, "now").mockImplementation(() => now);
});

describe("game view composition carried to another screen", () => {
  it.each([0, 1_000_000_000].flatMap((origin) => [1, 5, 10, 11, 12, 15, 20, 21, 22].flatMap((delay) =>
    [false, true].map((practice) => ({ origin, delay, practice })))))(
    "retains gamma and raw pixels at offset $delay, origin $origin, practice=$practice", ({ origin, delay, practice }) => {
      now = origin;
      const old = new Stage("lobby");
      const assets = { cursor: { meta: { animations: [{ unknown_u16: 5, frames: [{}] }] } } };
      const sounds = { effects: true, play() {}, stop() {}, stopMusic() {}, playMusic() {} };
      const options = { localPlayerIds: [1], hostId: 1, music: null };
      const view = new GameView(old.main.ctx as unknown as CanvasRenderingContext2D, assets as never, sounds as never, options);
      const state = createMatch(layoutFromAscii(["1....", ".....", "....2"]), setups(2), VERSUS, 1);
      view.render(state);
      while (state.phase === "waiting") step(state, {});
      const start = origin + 1000;
      now = start; view.render(state);
      for (let n = 1; n < delay; n++) { now = start + n * FRAME_MS; view.render(state); }
      now = start + delay * FRAME_MS;
      // Practice freezes the composition before disposal. Online room:null disposes the game first.
      let from: HTMLCanvasElement;
      if (practice) { from = freezeCanvas(view.composition); view.dispose(); }
      else { view.dispose(); from = freezeCanvas(canvas(old.main)); }
      const next = new Stage(practice ? "room" : "lobby");
      const replacement = practice ? new GameView(next.main.ctx as unknown as CanvasRenderingContext2D, assets as never, sounds as never, { ...options, fadeFrom: from }) : null;
      const stop = replacement ? () => replacement.dispose() : fadeOver(stage(next), from);
      const target = practice ? "room" : "lobby";
      const draw = (n: number) => {
        now = start + n * FRAME_MS;
        if (replacement) replacement.render(state);
        else frame(now);
      };
      try {
        const firstIn = delay <= 10 ? 11 : delay + 11;
        for (let n = delay; n < firstIn; n++) {
          draw(n);
          if (delay <= 10) pixel(next, "lobby", Math.min(1, (n + 1) / 10));
          else if (delay === 11) expect(next.shown()).toEqual([0, 0, 0]);
          else pixel(next, "room", Math.min(1, (n - delay + 1) / 10));
        }
        const inFrame = delay >= 12 && delay <= 21 ? delay - 11 : 0;
        for (let n = 0; n <= 11; n++) {
          draw(firstIn + n);
          pixel(next, target, Math.max(0, (9 - inFrame - n) / 10));
        }
      } finally { stop(); }
    },
  );
});

describe("entry fade overlapping a game result", () => {
  it("holds the last black frame when the first game draw takes over just as the veil finishes out", () => {
    const oldRoom = new Stage("lobby"), game = new Stage("room");
    const stop = fadeOver(stage(game), freezeCanvas(canvas(oldRoom.main)));
    const plays: string[] = [];
    const bank = { effects: true, play(name: string) { plays.push(name); }, stop() {}, stopMusic() {}, playMusic() {} };
    const view = new GameView(game.main.ctx as unknown as CanvasRenderingContext2D,
      { cursor: { meta: { animations: [{ unknown_u16: 5, frames: [{}] }] } } } as never, bank as never,
      { localPlayerIds: [2], hostId: 1, music: null });
    const state = createMatch(layoutFromAscii(["1....", ".....", "....2"]), setups(2), VERSUS, 1);
    while (state.phase === "waiting") step(state, {});
    removePlayer(state, 1);
    view.ingest(state, state.events);
    try {
      for (let n = 1; n <= 10; n++) frame(n * FRAME_MS);
      view.render(state);
      expect(game.shown()).toEqual([0, 0, 0]);
      expect(plays).not.toContain("endsig");
      frame(11 * FRAME_MS); view.render(state);
      pixel(game, "result", 0.9);
      expect(plays.filter((name) => name === "endsig")).toHaveLength(1);
    } finally { view.dispose(); stop(); }
  });

  it.each([0, 1_000_000_000].flatMap((origin) => [1, 5, 10, 11, 12, 15, 20, 21, 22].flatMap((delay) =>
    [false, true].map((extra) => ({ origin, delay, extra })))))(
    "continues the native picture, gamma and result cue at offset $delay, origin $origin, extra=$extra", ({ origin, delay, extra }) => {
      now = origin;
      const oldRoom = new Stage("lobby"), game = new Stage("room");
      game.loading = true;
      const stop = fadeOver(stage(game), freezeCanvas(canvas(oldRoom.main)));
      const sounds: { at: number; name: string }[] = [];
      const bank = { effects: true, play(name: string) { sounds.push({ at: now, name }); }, stop() {},
        stopMusic() { sounds.push({ at: now, name: "music-stop" }); }, playMusic() {} };
      const view = new GameView(game.main.ctx as unknown as CanvasRenderingContext2D,
        { cursor: { meta: { animations: [{ unknown_u16: 5, frames: [{}] }] } } } as never, bank as never,
        { localPlayerIds: [2], hostId: 1, music: null });
      const state = createMatch(layoutFromAscii(["1....", ".....", "....2"]), setups(2), VERSUS, 1);
      while (state.phase === "waiting") step(state, {});
      // OnlineGame catches up snapshots received during asset loading, then schedules its first draw.
      view.catchUp([{ state, events: state.events }]);
      sounds.length = 0;
      game.loading = false;
      const firstResult = delay <= 10 ? 11 : delay + 11;
      try {
        for (let n = 0; n <= firstResult + 11; n++) {
          if (extra && n > 0) {
            frame(origin + (n - 0.5) * FRAME_MS);
            view.render(state);
          }
          now = origin + n * FRAME_MS;
          if (n === delay) { removePlayer(state, 1); view.ingest(state, state.events); }
          else if (n > 0) { step(state, {}); view.ingest(state, state.events); }
          // The entry veil's RAF was queued before OnlineGame's RAF.
          frame(now);
          view.render(state);
          if (n < delay) {
            if (n <= 10) pixel(game, "lobby", Math.min(1, (n + 1) / 10));
            else pixel(game, "room", Math.max(0, (20 - n) / 10));
          } else if (n < firstResult) {
            if (delay <= 10) pixel(game, "lobby", Math.min(1, (n + 1) / 10));
            else if (delay === 11) expect(game.shown()).toEqual([0, 0, 0]);
            else pixel(game, "room", Math.min(1, (n - delay + 1) / 10));
          } else {
            const carriedIn = delay >= 12 && delay <= 21 ? delay - 11 : 0;
            pixel(game, "result", Math.max(0, (9 - carriedIn - (n - firstResult)) / 10));
          }
        }
        expect(sounds.filter((v) => v.name === "endsig")).toEqual([{ at: origin + firstResult * FRAME_MS, name: "endsig" }]);
        expect(sounds.filter((v) => v.at === origin + firstResult * FRAME_MS).map((v) => v.name)).toEqual(["endsig", "music-stop"]);
      } finally { view.dispose(); stop(); }
    },
  );
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function frame(at: number) {
  now = at;
  const callbacks = [...raf.values()]; raf.clear();
  for (const cb of callbacks) cb(now);
}
function canvas(c: Canvas) { return c as unknown as HTMLCanvasElement; }
function stage(s: Stage) { return s as unknown as HTMLElement; }
function pixel(s: Stage, scene: keyof typeof colours, darkness: number) {
  s.shown().forEach((v, i) => expect(v).toBeCloseTo(colours[scene][i] * (1 - darkness), 8));
}

describe("screen replacement during fadeOver, as room -> lobby replaces its stage", () => {
  it("holds the outgoing gamma while replacement assets load, then continues the next out step", () => {
    const old = new Stage("lobby"), room = new Stage("room");
    const stopRoom = fadeOver(stage(room), freezeCanvas(canvas(old.main)));
    for (let n = 1; n < 5; n++) frame(n * FRAME_MS);
    now = 5 * FRAME_MS;
    const from = freezeCanvas(canvas(room.main)); stopRoom();
    const next = new Stage("lobby"); next.loading = true;
    const stop = fadeOver(stage(next), from);
    try {
      for (let n = 5; n < 9; n++) { frame(n * FRAME_MS); pixel(next, "lobby", 0.5); }
      next.loading = false;
      frame(9 * FRAME_MS); pixel(next, "lobby", 0.6);
      frame(14 * FRAME_MS); expect(next.shown()).toEqual([0, 0, 0]);
      frame(15 * FRAME_MS); pixel(next, "lobby", 0.9);
    } finally { stop(); }
  });

  it("continues an interrupted in step after the outgoing screen already finished its out", () => {
    const lobby = new Stage("lobby"), room = new Stage("room");
    const stopRoom = fadeOver(stage(room), freezeCanvas(canvas(lobby.main)));
    for (let n = 1; n < 15; n++) frame(n * FRAME_MS);
    now = 15 * FRAME_MS;
    const from = freezeCanvas(canvas(room.main)); stopRoom();
    const outgoing = new Stage("lobby"), stopOut = fadeOver(stage(outgoing), from);
    for (let n = 15; n <= 25; n++) frame(n * FRAME_MS);
    const black = freezeCanvas(canvas(outgoing.main)); stopOut();
    now = 26 * FRAME_MS;
    const next = new Stage("room"), stopIn = fadeOver(stage(next), black, true);
    try { pixel(next, "room", 0.5); }
    finally { stopIn(); }
  });

  it("retains the underlying composition when the view is disposed before an active veil", () => {
    const old = new Stage("lobby"), next = new Stage("room"), raw = new Stage("room");
    // The displayed canvas can be darkened independently; freezing must keep the raw composition.
    next.main.ctx.pixel = colours.room.map((v) => v / 2);
    const release = registerFadeFrame(canvas(next.main), () => ({ picture: canvas(raw.main), outFrame: 0, inFrame: 0, darkness: 0.5 }));
    const stop = fadeOver(stage(next), freezeCanvas(canvas(old.main)));
    for (let n = 1; n <= 11; n++) frame(n * FRAME_MS);
    release();
    const picture = freezeCanvas(canvas(next.main)) as unknown as Canvas;
    expect(picture.ctx.pixel).toEqual(colours.room);
    stop();
  });

  it.each([0, 1_000_000_000].flatMap((origin) => [1, 5, 10, 11, 12, 15, 20, 21, 22].map((delay) => ({ origin, delay }))))(
    "continues the picture and native counters at offset $delay, origin $origin", ({ origin, delay }) => {
      now = origin;
      const lobby = new Stage("lobby"), room = new Stage("room");
      const stopRoom = fadeOver(stage(room), freezeCanvas(canvas(lobby.main)));
      for (let n = 1; n < delay; n++) frame(origin + n * FRAME_MS);
      now = origin + delay * FRAME_MS;
      // OnlineSession snapshots the old game-canvas before disposing it and mounting the new stage.
      const from = freezeCanvas(canvas(room.main)); stopRoom();
      const next = new Stage("lobby"), stopLobby = fadeOver(stage(next), from);
      try {
        const firstIn = delay <= 10 ? 11 : delay + 11;
        for (let n = delay; n < firstIn; n++) {
          frame(origin + n * FRAME_MS);
          if (delay <= 10) pixel(next, "lobby", Math.min(1, (n + 1) / 10));
          else if (delay === 11) expect(next.shown()).toEqual([0, 0, 0]);
          else pixel(next, "room", Math.min(1, (n - delay + 1) / 10));
        }
        const inFrame = delay >= 12 && delay <= 21 ? delay - 11 : 0;
        for (let n = 0; n <= 11; n++) {
          frame(origin + (firstIn + n) * FRAME_MS);
          pixel(next, "lobby", Math.max(0, (9 - inFrame - n) / 10));
        }
      } finally { stopLobby(); }
    },
  );
});
