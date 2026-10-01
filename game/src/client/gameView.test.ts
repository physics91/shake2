import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { createMatch, removePlayer, step } from "../sim/match.ts";
import { layoutFromAscii, setups, VERSUS } from "../sim/testing.ts";
import type { MatchState, SimEvent } from "../sim/types.ts";
import type { SoundBank } from "./audio.ts";
import type { GameView as View } from "./gameView.ts";

let GameView: typeof View;

beforeAll(async () => {
  const canvas = () => ({ width: 0, height: 0, getContext: () => ({ fillStyle: "", fillRect() {} }) });
  vi.stubGlobal("document", { createElement: canvas });
  ({ GameView } = await import("./gameView.ts"));
});

afterAll(() => {
  vi.unstubAllGlobals();
});

function ringingSounds() {
  const ringing = new Set<string>();
  const bank = {
    play: (name: string) => ringing.add(name),
    stop: (name: string) => ringing.delete(name),
    playMusic() {},
    stopMusic() {},
  };
  return { bank: bank as unknown as SoundBank, ringing };
}

/** A view whose match ended (the other player left in play), so endsig rings. */
function finalResult() {
  const sounds = ringingSounds();
  const ctx = { canvas: { addEventListener() {}, removeEventListener() {} } } as unknown as CanvasRenderingContext2D;
  const view = new GameView(ctx, {} as never, sounds.bank, { localPlayerIds: [1], hostId: 1, music: null });
  const state = createMatch(layoutFromAscii(["1....", ".....", "....2"]), setups(2), VERSUS, 1);
  while (state.phase !== "playing") step(state, {});
  removePlayer(state, 2);
  view.ingest(state, state.events);
  expect(sounds.ringing.has("endsig")).toBe(true);
  return { view, ringing: sounds.ringing };
}

/** A view whose round ended (player 1 burned), so end rings. */
function roundResult() {
  const sounds = ringingSounds();
  const ctx = { canvas: { addEventListener() {}, removeEventListener() {} } } as unknown as CanvasRenderingContext2D;
  const view = new GameView(ctx, {} as never, sounds.bank, { localPlayerIds: [1], hostId: 1, music: null });
  const state = createMatch(layoutFromAscii(["1....", ".....", "....2"]), setups(2), VERSUS, 1);
  while (state.phase !== "playing") step(state, {});
  state.flame[0] = 1;
  while (state.phase === "playing") {
    step(state, {});
    view.ingest(state, state.events);
  }
  expect(sounds.ringing.has("end")).toBe(true);
  return { view, ringing: sounds.ringing };
}

describe("GameView.dispose", () => {
  it("stops endsig on the way out, the tune kept or not (EXITGAME 0x44f6f1, 0x44f4e0)", () => {
    for (const keepMusic of [false, true]) {
      const { view, ringing } = finalResult();
      view.dispose(keepMusic);
      expect(ringing.has("endsig")).toBe(false);
    }
  });

  it("leaves end ringing: only the next round's preparation stops it (0x41014e)", () => {
    for (const keepMusic of [false, true]) {
      const { view, ringing } = roundResult();
      view.dispose(keepMusic);
      expect(ringing.has("end")).toBe(true);
    }
  });
});

describe("GameView.catchUp", () => {
  it("follows the snapshots that came before the pictures without sounding their cues", () => {
    const calls: string[] = [];
    const bank = {
      play: (name: string) => calls.push(`play:${name}`),
      stop: (name: string) => calls.push(`stop:${name}`),
      playMusic: () => calls.push("playMusic"),
      stopMusic: () => calls.push("stopMusic"),
    } as unknown as SoundBank;
    const state = createMatch(layoutFromAscii(["1....", ".....", "....2"]), setups(2), VERSUS, 1);
    const batches: { state: MatchState; events: SimEvent[] }[] = [];
    const record = () => batches.push({ state: structuredClone(state), events: [...state.events] });
    while (state.phase !== "playing") (step(state, {}), record());
    // Hurry, then time up: round 1 is a DRAW, and round 2's wait screen is up when the pictures come.
    state.timerSeconds = 2;
    state.suddenDeath.lastMs = Infinity; // below 60 s it would close the arena first
    const roundTwoWaiting = () => state.phase === "waiting" && state.round === 2;
    while (!roundTwoWaiting()) (step(state, {}), record());
    const cued = new Set(batches.flatMap((b) => b.events.map((e) => e.type)));
    expect(["start-shown", "go", "hurry", "round-over", "round-start"].every((type) => cued.has(type as SimEvent["type"]))).toBe(true);

    const ctx = { canvas: { addEventListener() {}, removeEventListener() {} } } as unknown as CanvasRenderingContext2D;
    const view = new GameView(ctx, {} as never, bank, { localPlayerIds: [1], hostId: 1, music: { file: "x.mid" } as never });
    calls.length = 0;
    view.catchUp(batches);
    expect(calls).toEqual([]);
    expect((view as unknown as { lastRoundDraw: boolean }).lastRoundDraw).toBe(true);
  });
});
