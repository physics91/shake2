import { describe, expect, it } from "vitest";
import { AiController } from "./ai.ts";
import { playerCell } from "./grid.ts";
import { step } from "./match.ts";
import { addBomb, playingMatch } from "./testing.ts";
import { CellKind, Dir, ItemKind } from "./types.ts";

describe("AI tactical decisions through ordinary inputs", () => {
  it("follows a long detour to an opponent instead of waiting against the separating wall", () => {
    const state = playingMatch([
      "#######", "#2#1###", ...Array.from({ length: 11 }, () => "#.#.###"), "#...###", "#######",
    ], 2);
    const ai = new AiController(1), player = state.players[0];
    expect(ai.sample(state)).toEqual({ dir: Dir.Down, bomb: false });
    let furthest = player.y;
    for (let tick = 0; tick < 500 && state.phase === "playing"; tick++) {
      step(state, { 1: ai.sample(state) });
      furthest = Math.max(furthest, player.y);
    }
    expect(furthest).toBeGreaterThan(400);
    expect(player.alive).toBe(true);
    expect(state.players[1].alive).toBe(false);
  });

  it("collects the upgrade it can win rather than racing a faster opponent to an already lost pickup", () => {
    const state = playingMatch(["1........2...", ...Array.from({ length: 8 }, () => ".".repeat(13))], 2);
    state.players[1].speed = 10;
    state.items.push(
      { cell: 7, kind: ItemKind.Missile, sub: 0, tick: 0, dropped: false },
      { cell: 91, kind: ItemKind.Bomb, sub: 0, tick: 0, dropped: false },
    );
    const ai = new AiController(1);
    expect(ai.sample(state)).toEqual({ dir: Dir.Down, bomb: false });
    for (let tick = 0; tick < 90 && state.players[0].bombCapacity === 1; tick++) {
      step(state, { 1: ai.sample(state), 2: { dir: tick < 8 ? Dir.Left : null, bomb: false } });
    }
    expect(state.players[0].bombCapacity).toBe(2);
    expect(state.players[0].inv.missile).toBe(0);
    expect(state.players[1].inv.missile).toBe(1);
    expect(state.players[0].alive).toBe(true);
  });

  it("wins the pickup race when the faster opponent is visibly frozen", () => {
    const state = playingMatch(["1........2...", ...Array.from({ length: 8 }, () => ".".repeat(13))], 2);
    const player = state.players[0];
    state.players[1].speed = 10;
    state.players[1].status.frozen = 0;
    state.items.push(
      { cell: 7, kind: ItemKind.Missile, sub: 0, tick: 0, dropped: false },
      { cell: 91, kind: ItemKind.Bomb, sub: 0, tick: 0, dropped: false },
    );
    const ai = new AiController(1);
    expect(ai.sample(state)).toEqual({ dir: Dir.Right, bomb: false });
    for (let tick = 0; tick < 70 && player.inv.missile === 0; tick++) {
      step(state, { 1: ai.sample(state), 2: { dir: Dir.Left, bomb: false } });
    }
    expect(player.inv.missile).toBe(1);
    expect(state.players[1].inv.missile).toBe(0);
    expect(player.alive).toBe(true);
  });

  it("saves its free bomb slot when an existing bomb will already clear the same brick", () => {
    const state = playingMatch(["1.B...2", ".......", "......."], 2);
    state.players[0].bombCapacity = 2;
    state.players[1].status.invisible = 0;
    addBomb(state, 9, { owner: 1, fuseMs: 400 });
    const ai = new AiController(1);
    for (let tick = 0; tick < 90; tick++) {
      const input = ai.sample(state);
      expect(input.bomb).toBe(false);
      step(state, { 1: input });
      expect(state.players[0].alive).toBe(true);
    }
    expect(state.grid[2]).toBe(CellKind.Empty);
  });

  it("closes in before bombing when only distant retreats would be cut off", () => {
    const state = playingMatch(["2", ".", ".", ".", ".", "1", ...Array.from({ length: 8 }, () => ".")], 2);
    const ai = new AiController(1);
    expect(ai.sample(state).bomb).toBe(false);
    let firstBomb: number | null = null;
    for (let tick = 0; tick < 240 && state.phase === "playing"; tick++) {
      const input = ai.sample(state);
      if (input.bomb && firstBomb === null) firstBomb = playerCell(state, state.players[0]);
      step(state, { 1: input });
    }
    expect(firstBomb).not.toBeNull();
    expect(firstBomb).toBeLessThanOrEqual(2);
    expect(state.players[0].alive).toBe(true);
    expect(state.players[1].alive).toBe(false);
  });

  it("keeps its ammunition and develops while the opponent's shield outlasts the fire", () => {
    const state = playingMatch(["1.2......", ".........", "........."], 2);
    state.players[0].inv.missile = 1;
    state.players[1].status.shield = 0;
    state.items.push({ cell: 18, kind: ItemKind.Fire, sub: 0, tick: 0, dropped: false });
    const ai = new AiController(1);
    for (let tick = 0; tick < 100; tick++) {
      const input = ai.sample(state);
      expect(input.bomb).toBe(false);
      expect(input.attack).not.toBe(true);
      step(state, { 1: input });
    }
    expect(state.players[0].firePower).toBe(3);
    expect(state.players[0].inv.missile).toBe(1);
    expect(state.players.every((player) => player.alive)).toBe(true);
  });

  it.each([-9600, -7500])("times fire against a shield started at %i ms, including expiry during the fire", (shieldStart) => {
    const state = playingMatch(["1.2......", ".........", "........."], 2);
    state.players[1].status.shield = shieldStart;
    const ai = new AiController(1);
    expect(ai.sample(state).bomb).toBe(true);
    for (let tick = 0; tick < 100 && state.phase === "playing"; tick++) step(state, { 1: ai.sample(state) });
    expect(state.players[0].alive).toBe(true);
    expect(state.players[1].alive).toBe(false);
  });

  it("backs out of close combat with a shielded opponent instead of waiting beside them", () => {
    const state = playingMatch(["1.2......", ...Array.from({ length: 6 }, () => ".".repeat(9))], 2);
    state.players[1].status.shield = 0;
    const ai = new AiController(1), player = state.players[0];
    for (let tick = 0; tick < 65; tick++) {
      const input = ai.sample(state);
      expect(input.bomb).toBe(false);
      step(state, { 1: input });
    }
    const cell = playerCell(state, player)!;
    expect(Math.abs(cell % 9 - 2) + Math.floor(cell / 9)).toBeGreaterThanOrEqual(5);
    expect(player.alive).toBe(true);
  });
});
