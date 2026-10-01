import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { createMatch, removePlayer, step } from "../sim/match.ts";
import { layoutFromAscii, setups, VERSUS } from "../sim/testing.ts";
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
