import { describe, expect, it } from "vitest";

import { playerCell } from "./grid.ts";
import { movePlayer, probes } from "./movement.ts";
import { addBomb, cellAt, IDLE, playingMatch, run } from "./testing.ts";
import type { MatchState, PlayerState } from "./types.ts";
import { Anim, Dir, ItemKind } from "./types.ts";

function walker(rows: string[], x: number, y: number, dir: Dir): { state: MatchState; player: PlayerState } {
  const state = playingMatch(rows);
  const player = state.players[0];
  Object.assign(player, { x, y, dir, anim: Anim.Walk + dir });
  player.lastCell = playerCell(state, player) ?? -1;
  return { state, player };
}

function bombAt(state: MatchState, cell: number): void {
  addBomb(state, cell, { placedMs: 1e9 });
}

describe("probe points", () => {
  it("uses the two leading corners of the x±15, y-15..+7 box and the trailing centre", () => {
    expect(probes(Dir.Down, 100, 50)).toEqual([[115, 57], [85, 57], [100, 35]]);
    expect(probes(Dir.Left, 100, 50)).toEqual([[85, 57], [85, 35], [115, 50]]);
    expect(probes(Dir.Up, 100, 50)).toEqual([[85, 35], [115, 35], [100, 57]]);
    expect(probes(Dir.Right, 100, 50)).toEqual([[115, 35], [115, 57], [85, 50]]);
  });
});

describe("walking", () => {
  it("moves speed pixels per frame in an open row", () => {
    const { state, player } = walker(["1....", "....."], 20, 16, Dir.Right);

    movePlayer(state, player, player.speed);
    movePlayer(state, player, player.speed);

    expect([player.x, player.y]).toEqual([30, 16]);
  });

  it("rejects the whole step when both leading corners are blocked, stopping short of the wall", () => {
    const { state, player } = walker(["1#..."], 20, 16, Dir.Right);

    movePlayer(state, player, player.speed);

    expect(player.x).toBe(20);
  });

  it("slides sideways toward the free corner and turns that way when one corner is blocked", () => {
    const { state, player } = walker(["1.", "#."], 30, 21, Dir.Down);

    movePlayer(state, player, player.speed);

    expect([player.x, player.y]).toEqual([35, 21]);
    expect(player.anim).toBe(Anim.Walk + Dir.Right);
    expect(player.dir).toBe(Dir.Right);
  });

  it("slides the other way when the other corner is blocked", () => {
    const { state, player } = walker(["1.", ".#"], 50, 21, Dir.Down);

    movePlayer(state, player, player.speed);

    expect([player.x, player.y]).toEqual([45, 21]);
    expect(player.anim).toBe(Anim.Walk + Dir.Left);
  });

  it("turns but stays put when the slide would carry the centre into a bomb cell", () => {
    const { state, player } = walker(["1.", "#."], 38, 21, Dir.Down);
    bombAt(state, cellAt(state, 1, 0));

    movePlayer(state, player, player.speed);

    expect([player.x, player.y]).toEqual([38, 21]);
    expect(player.anim).toBe(Anim.Walk + Dir.Right);
  });

  it("rounds a corner by sliding, then going on once the key turns it back", () => {
    const state = playingMatch(["1..", "#.#", "#.#"]);
    const player = state.players[0];
    run(state, 4, { 1: { dir: Dir.Right, bomb: false } });
    run(state, 12, { 1: { dir: Dir.Down, bomb: false } });

    expect(Math.floor(player.x / 40)).toBe(1);
    expect(player.y).toBeGreaterThan(48);
  });

  it("stops when the trailing centre point is in a wall", () => {
    const { state, player } = walker(["#1", ".."], 20, 40, Dir.Down);

    movePlayer(state, player, player.speed);

    expect([player.x, player.y]).toEqual([20, 40]);
  });

  it("puts a step over the area edge back 16, 20 or 12 px inside", () => {
    const grid = ["1....", ".....", "....."];
    const left = walker(grid, 20, 48, Dir.Left);
    movePlayer(left.state, left.player, left.player.speed);
    expect(left.player.x).toBe(16);

    const right = walker(grid, 180, 48, Dir.Right);
    movePlayer(right.state, right.player, right.player.speed);
    expect(right.player.x).toBe(184);

    const up = walker(grid, 60, 16, Dir.Up);
    movePlayer(up.state, up.player, up.player.speed);
    expect(up.player.y).toBe(20);

    const down = walker(grid, 60, 80, Dir.Down);
    movePlayer(down.state, down.player, down.player.speed);
    movePlayer(down.state, down.player, down.player.speed);
    expect(down.player.y).toBe(84);
  });

  it("pushes a standing player off a wall corner its facing side overlaps", () => {
    const state = playingMatch(["1.", ".#"]);
    const player = state.players[0];
    Object.assign(player, { x: 30, y: 26, dir: Dir.Down, anim: Anim.Stand + Dir.Down });

    movePlayer(state, player, 0);

    expect([player.x, player.y]).toEqual([25, 26]);
    expect(player.anim).toBe(Anim.Stand + Dir.Left);
  });

  it("picks up the item under the tentative position", () => {
    const { state, player } = walker(["1...."], 35, 16, Dir.Right);
    state.items.push({ cell: 1, kind: ItemKind.Bomb, tick: 0, dropped: false });

    movePlayer(state, player, player.speed);

    expect(player.bombCapacity).toBe(2);
  });
});

describe("a skipped input poll (0x458750 returning under a box, F1 or the chat line)", () => {
  it("leaves a walking player walking, where released keys would stop it", () => {
    const state = playingMatch(["1........."]);
    const player = state.players[0];
    run(state, 3, { 1: { dir: Dir.Right, bomb: false } });
    const x = player.x;
    run(state, 10, { 1: null });
    expect(player.x).toBeGreaterThan(x + 10);
    expect(player.anim).toBe(Anim.Walk + Dir.Right);
    run(state, 10, { 1: { dir: null, bomb: false } });
    expect(player.anim).toBe(Anim.Stand + Dir.Right);
  });

  it("keeps a held action latched, so the key must be released in a read frame first", () => {
    const state = playingMatch(["1....."]);
    const player = state.players[0];
    run(state, 1, { 1: { dir: null, bomb: true } });
    run(state, 5, { 1: null });
    expect(player.actionLatch).toBe(true);
    run(state, 1, { 1: IDLE });
    expect(player.actionLatch).toBe(false);
  });
});

describe("bombs in the way", () => {
  it("never lets a player walk into a bomb cell from outside, and clears the pass flag", () => {
    const { state, player } = walker(["1...."], 20, 16, Dir.Right);
    player.bombPass = true;
    bombAt(state, 1);

    run(state, 10, { 1: { dir: Dir.Right, bomb: false } });

    expect(player.x).toBeLessThan(40);
    expect(player.bombPass).toBe(false);
  });

  it("lets the bomb's placer walk out in any direction", () => {
    const state = playingMatch(["...", ".1.", "..."]);
    const player = state.players[0];
    run(state, 1, { 1: { dir: null, bomb: true } });

    run(state, 10, { 1: { dir: Dir.Down, bomb: false } });

    expect(player.y).toBeGreaterThan(64);
  });

  it("without the pass flag allows only moves toward the centre vertically and away from it horizontally", () => {
    const grid = ["1..", "...", "..."];
    const cases: [Dir, number, number, boolean][] = [
      [Dir.Down, 60, 48, false],
      [Dir.Down, 60, 40, true],
      [Dir.Up, 60, 48, false],
      [Dir.Up, 60, 58, true],
      [Dir.Left, 60, 48, true],
      [Dir.Left, 70, 48, false],
      [Dir.Right, 60, 48, true],
      [Dir.Right, 52, 48, false],
    ];
    for (const [dir, x, y, moves] of cases) {
      const { state, player } = walker(grid, x, y, dir);
      bombAt(state, cellAt(state, 1, 1));

      movePlayer(state, player, player.speed);

      expect([dir, x, y, player.x !== x || player.y !== y]).toEqual([dir, x, y, moves]);
    }
  });
});
