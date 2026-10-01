import { describe, expect, it } from "vitest";

import { nowMs } from "./constants.ts";
import { BURROW_MS } from "./evade.ts";
import { playerCell } from "./grid.ts";
import { applyPickup } from "./pickup.ts";
import { addBomb, cellAt, IDLE, playingMatch, run, runUntil, VERSUS } from "./testing.ts";
import type { InputFrame, MatchState, PlayerState } from "./types.ts";
import { Anim, CellKind, Dir, ItemKind } from "./types.ts";

const Z: InputFrame = { dir: null, bomb: false, evade: true };
const walk = (dir: Dir): InputFrame => ({ dir, bomb: false });

function face(player: PlayerState, dir: Dir): void {
  player.dir = dir;
  player.anim = Anim.Stand + dir;
}

/** Jump from standing, facing `dir`; returns the updates until the player stands again. */
function jump(state: MatchState, dir: Dir): number {
  const player = state.players[0];
  player.inv.jump = 1;
  face(player, dir);
  run(state, 1, { 1: Z });
  return runUntil(state, () => player.anim < Anim.Jump);
}

describe("jump (item 5)", () => {
  it("takes the charge and jumps in the facing with jump1", () => {
    const state = playingMatch([".......", "...1...", "......."]);
    const player = state.players[0];
    player.inv.jump = 1;
    face(player, Dir.Right);
    run(state, 1, { 1: Z });
    expect(player.inv.jump).toBe(0);
    expect(player.anim).toBe(Anim.Jump + Dir.Right);
    expect(state.events).toContainEqual({ type: "jumped", playerId: 1 });
  });

  it.each([
    [Dir.Right, 72, 0],
    [Dir.Left, -72, 0],
    [Dir.Down, 0, 60],
    [Dir.Up, 0, -60],
  ])("moves 12 steps of 6 px across or 5 px along (facing %i)", (dir, dx, dy) => {
    const state = playingMatch([".......", ".......", ".......", "...1...", ".......", ".......", "......."]);
    const player = state.players[0];
    const { x, y } = player;
    jump(state, dir);
    expect([player.x - x, player.y - y]).toEqual([dx, dy]);
    expect(player.anim).toBe(Anim.Stand + dir);
  });

  it("passes over a bomb without kicking it", () => {
    const state = playingMatch(["1......"]);
    const player = state.players[0];
    player.inv.kick = true;
    const bomb = addBomb(state, 1, { placedMs: 1e9 });
    jump(state, Dir.Right);
    expect(player.x).toBe(20 + 72);
    expect(bomb.motion).toBe(0);
  });

  it("leaves an item it flies over and picks up one where it lands", () => {
    const state = playingMatch(["1......"]);
    state.items.push({ cell: 1, kind: ItemKind.Fire, tick: 0, dropped: false });
    state.items.push({ cell: 2, kind: ItemKind.Bomb, tick: 0, dropped: false });
    jump(state, Dir.Right);
    expect(state.items.map((i) => i.cell)).toEqual([1]);
  });

  it("hops in place against a wall", () => {
    const state = playingMatch(["1#....."]);
    const player = state.players[0];
    const x = player.x;
    jump(state, Dir.Right);
    expect(player.x).toBe(x);
  });

  it("ignores the keys in the air and survives fire under it", () => {
    const state = playingMatch([".......", "...1...", "......."]);
    const player = state.players[0];
    player.inv.jump = 1;
    face(player, Dir.Right);
    run(state, 1, { 1: Z });
    run(state, 3, { 1: walk(Dir.Up) });
    expect(player.anim).toBe(Anim.Jump + Dir.Right);
    state.flame.fill(1);
    run(state, 1);
    expect(player.alive).toBe(true);
    runUntil(state, () => player.anim < Anim.Jump || !player.alive);
    expect(player.alive).toBe(false);
  });
});

describe("burrow (item 17)", () => {
  it("goes underground with dust, comes up after more than 2 s facing down, and only then uses the item", () => {
    const state = playingMatch([".......", "...1...", "......."]);
    const player = state.players[0];
    player.inv.burrow = true;
    face(player, Dir.Right);
    run(state, 1, { 1: Z });
    const start = nowMs(state.tick);
    expect(player).toMatchObject({ anim: Anim.Burrow, frame: 0, burrowMs: start });
    expect(state.effectSprites).toEqual([{ kind: "ground", x: player.x, y: player.y, frame: 0 }]);

    const x = player.x;
    run(state, 12, { 1: walk(Dir.Left) });
    expect(player).toMatchObject({ x, anim: Anim.Burrow, frame: 3 });
    state.flame.fill(1);
    run(state, 1);
    expect(player.alive).toBe(true);
    state.flame.fill(0);

    runUntil(state, () => player.anim === Anim.Emerge);
    expect(nowMs(state.tick) - start).toBeGreaterThan(BURROW_MS);
    expect(nowMs(state.tick - 1) - start).toBeLessThanOrEqual(BURROW_MS);
    expect(player.inv.burrow).toBe(true);
    expect(state.effects.filter((e) => e.kind === "ground" && e.alive)).toHaveLength(1);

    runUntil(state, () => player.anim !== Anim.Emerge);
    expect(player.anim).toBe(Anim.Stand + Dir.Down);
    expect(player.inv.burrow).toBe(false);
  });

  it("comes up facing up when the arrow was let go as it went down: the stop takes the update's start direction (0x4528a8)", () => {
    const state = playingMatch([".......", "...1...", "......."]);
    const player = state.players[0];
    player.inv.burrow = true;
    run(state, 3, { 1: walk(Dir.Right) });
    run(state, 1, { 1: Z });
    expect(player).toMatchObject({ anim: Anim.Burrow, stopRequested: true });

    runUntil(state, () => player.anim === Anim.Emerge);
    runUntil(state, () => player.anim !== Anim.Emerge);

    expect(player).toMatchObject({ anim: Anim.Stand + Dir.Up, stopRequested: false });
  });

  it("shows the dust's 9 frames two updates each, the first also in the update it appears", () => {
    const state = playingMatch(["1......"]);
    const player = state.players[0];
    player.inv.burrow = true;
    run(state, 1, { 1: Z });
    const frames = [state.effectSprites[0].frame];
    while (state.effectSprites.length > 0) {
      run(state, 1);
      if (state.effectSprites.length > 0) frames.push(state.effectSprites[0].frame);
    }
    expect(frames).toEqual([0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8]);
  });
});

describe("teleport (item 14)", () => {
  function room(): MatchState {
    const state = playingMatch([".....", "1....", ".....", ".....", "....2"], 2, VERSUS);
    state.players[0].inv.teleport = 1;
    return state;
  }

  it("flies up 40 px an update past the top, then down onto the other player's cell", () => {
    const state = room();
    const [player, other] = state.players;
    const y0 = player.y;
    run(state, 1, { 1: Z });
    expect(state.events).toContainEqual({ type: "teleported", playerId: 1 });
    expect(player.inv.teleport).toBe(0);
    expect(player.y).toBe(y0 - 40);

    const target = { x: 4 * 40 + 20, y: 4 * 32 + 16 };
    expect(player.flight).toEqual({ phase: 1, ...target });
    run(state, 1);
    expect(player).toMatchObject({ x: target.x, y: 40, flight: { phase: 2 } });
    const ys: number[] = [];
    runUntil(state, () => {
      ys.push(player.y);
      return player.flight === null;
    });
    expect(ys).toEqual([80, 120, target.y]);
    expect(other.alive).toBe(true);
  });

  /** A 15x15 room (the size of every map) with player 2 at column 4, row 13. */
  function wideRoom(): MatchState {
    const rows = Array.from({ length: 15 }, () => ".".repeat(15));
    rows[1] = "1" + rows[1].slice(1);
    rows[13] = "....2" + rows[13].slice(5);
    const state = playingMatch(rows, 2, VERSUS);
    state.players[0].inv.teleport = 1;
    return state;
  }

  it("walks 15 cells at a time down the column past blocked cells, wrapping to cell 0 past 254", () => {
    const state = wideRoom();
    const [player] = state.players;
    state.grid[cellAt(state, 4, 13)] = CellKind.Fixed;
    state.grid[cellAt(state, 4, 14)] = CellKind.Brick;
    run(state, 1, { 1: Z });
    // 199 and 214 are blocked, 229 and 244 lie past the grid, then 259 wraps to cell 0.
    expect(player.flight).toMatchObject({ x: 20, y: 16 });
  });

  it("lands on the target's own position + (20, 16) when all 15 probes fail", () => {
    const state = wideRoom();
    const [player, other] = state.players;
    state.grid.fill(CellKind.Fixed);
    run(state, 1, { 1: Z });
    expect(player.flight).toMatchObject({ x: other.x + 20, y: other.y + 16 });
  });

  it("is immune and deaf to keys in flight", () => {
    const state = room();
    const [player] = state.players;
    run(state, 1, { 1: Z });
    state.flame.fill(1);
    run(state, 1, { 1: walk(Dir.Left) });
    expect(player.alive).toBe(true);
    expect(player.dir).toBe(Dir.Down);
  });

  it("does nothing and keeps the charge with one player in the room", () => {
    const state = playingMatch(["1...."], 1, VERSUS);
    const player = state.players[0];
    player.inv.teleport = 1;
    run(state, 1, { 1: Z });
    expect(player.flight).toBeNull();
    expect(player.inv.teleport).toBe(1);
    expect(player.actionLatch).toBe(true);
  });

  describe("landing on a bomb: +0x184 still holds the cell before the flight (0x452a93 skips 0x452b93)", () => {
    // A 15x15 room like the shipped ones: the lander at column 0 row 1, the bomb layer at column 2 row 2.
    const ROWS = Array.from({ length: 15 }, (_, row) => (row === 1 ? "1" + ".".repeat(14) : row === 2 ? "..2" + ".".repeat(12) : ".".repeat(15)));
    const SPACE: InputFrame = { dir: null, bomb: true };
    const BOMB_CELL = 2 * 15 + 2;

    function landOnBomb(kick: boolean): MatchState {
      const state = playingMatch(ROWS, 2, VERSUS);
      const [lander] = state.players;
      lander.inv.teleport = 1;
      lander.inv.kick = kick;
      run(state, 1, { 1: kick ? IDLE : SPACE, 2: SPACE });
      run(state, 1);
      run(state, 1, { 1: Z });
      runUntil(state, () => lander.flight === null, 50);
      expect(playerCell(state, lander)).toBe(BOMB_CELL);
      return state;
    }

    it("kicks the bomb under the lander on the first update, as one in another cell (0x450791)", () => {
      const state = landOnBomb(true);
      const [lander] = state.players;
      run(state, 1);
      expect(lander.anim).toBe(Anim.Kick + Dir.Down);
      expect(state.bombs.find((b) => b.cell === BOMB_CELL)?.motion).toBe(Dir.Down + 1);
    });

    it("without the kick shoe blocks the first move and clears the pass flag (0x450cdd)", () => {
      const state = landOnBomb(false);
      const [lander] = state.players;
      expect(lander.bombPass).toBe(true);
      const landed = { x: lander.x, y: lander.y };
      run(state, 1, { 1: walk(Dir.Down) });
      expect(lander.bombPass).toBe(false);
      expect({ x: lander.x, y: lander.y }).toEqual(landed);
      run(state, 5, { 1: walk(Dir.Down) });
      expect(playerCell(state, lander)).toBe(BOMB_CELL);
    });
  });
});

describe("Z priority (0x45ca1e, 0x45cb0c, 0x45cb8c)", () => {
  it("uses the jump before the burrow and the burrow before the teleport", () => {
    const state = playingMatch([".......", "...1...", "......."], 1);
    const player = state.players[0];
    Object.assign(player.inv, { jump: 1, burrow: true, teleport: 1 });
    run(state, 1, { 1: Z });
    expect(player.anim).toBe(Anim.Jump + Dir.Down);
    runUntil(state, () => player.anim < Anim.Jump, 100, { 1: IDLE });
    run(state, 1, { 1: Z });
    expect(player.anim).toBe(Anim.Burrow);
    expect(player.inv.teleport).toBe(1);
  });
});

describe("egg shield (0x452cd0)", () => {
  it("adds an egg that follows the player for 10 s", () => {
    const state = playingMatch([".......", "...1...", "......."]);
    const player = state.players[0];
    applyPickup(state, player, ItemKind.Shake);
    run(state, 1, { 1: walk(Dir.Right) });
    expect(state.effectSprites).toEqual([{ kind: "egg", x: player.x, y: player.y, frame: 0 }]);
    const start = player.status.shield!;
    runUntil(state, () => state.effectSprites.length === 0);
    expect(nowMs(state.tick - 1) - start).toBeGreaterThan(10_000);
    expect(player.status.shield).toBeNull();
  });
});
