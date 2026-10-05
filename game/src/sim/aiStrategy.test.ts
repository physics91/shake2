import { describe, expect, it } from "vitest";
import { AiController } from "./ai.ts";
import { step } from "./match.ts";
import { playingMatch } from "./testing.ts";
import { CellKind, Dir, ItemKind } from "./types.ts";

describe("AI opening choices", () => {
  it("opens nearby bricks before chasing a distant opponent along an open lane", () => {
    const state = playingMatch(["1.......2", ".........", ".........", "BB.......", "........."], 2);
    const ai = new AiController(1);
    expect(ai.sample(state)).toEqual({ dir: Dir.Down, bomb: false });
    for (let tick = 0; tick < 110 && state.phase === "playing"; tick++) step(state, { 1: ai.sample(state) });
    expect(state.grid[27]).toBe(CellKind.Empty);
    expect(state.players[0].alive).toBe(true);
    // Once that development opportunity is spent, pressure resumes.
    for (let tick = 0; tick < 150 && state.phase === "playing"; tick++) step(state, { 1: ai.sample(state) });
    expect(state.players[0].x).toBeGreaterThan(120);
  });

  it("keeps collecting an off-lane upgrade while a distant opponent reverses direction", () => {
    const state = playingMatch(["1.......2", ".........", ".........", ".........", "........."], 2);
    state.items.push({ cell: 36, kind: ItemKind.Speed, sub: 0, tick: 0, dropped: false });
    const ai = new AiController(1);
    expect(ai.sample(state)).toEqual({ dir: Dir.Down, bomb: false });
    for (let tick = 0; tick < 65 && state.players[0].speed === 5; tick++) {
      step(state, { 1: ai.sample(state), 2: { dir: tick % 30 < 15 ? Dir.Left : Dir.Right, bomb: false } });
    }
    expect(state.players[0].speed).toBe(6);
    expect(state.players[0].alive).toBe(true);
  });

  it("still takes a safe immediate attack when the opponent is close", () => {
    const state = playingMatch(["1.2......", ".........", ".........", "BB.......", "........."], 2);
    const ai = new AiController(1);
    const input = ai.sample(state);
    expect(input.bomb).toBe(true);
    step(state, { 1: input });
    for (let tick = 0; tick < 100 && state.phase === "playing"; tick++) step(state, { 1: ai.sample(state) });
    expect(state.players[0].alive).toBe(true);
    expect(state.players[1].alive).toBe(false);
  });

  it("pursues immediately when there is no reachable development opportunity", () => {
    const state = playingMatch(["1.......2", "#########", "BB#######"], 2);
    expect(new AiController(1).sample(state)).toEqual({ dir: Dir.Right, bomb: false });
  });

  it("does not delay pressure for an upgrade it no longer needs", () => {
    const state = playingMatch(["1.......2", ".........", ".........", ".........", "........."], 2);
    const player = state.players[0];
    player.speed = 10;
    player.bombCapacity = 3;
    player.firePower = 4;
    state.items.push({ cell: 36, kind: ItemKind.Speed, sub: 0, tick: 0, dropped: false });
    expect(new AiController(1).sample(state)).toEqual({ dir: Dir.Right, bomb: false });
  });
});
