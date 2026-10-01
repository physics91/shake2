// The players' techniques on the operator's page (쉐이크2 기술 동영상, hanpanthe.net
// game/vod_service/vod_service.asp, 2002-03-21), then the 0칸 and 미던 families of letsgame's 2004
// technique videos, each played through the reverse-engineered rules.
import { describe, expect, it } from "vitest";

import { FUSE_MS, nowMs } from "./constants.ts";
import { addBomb, cellAt, IDLE, playingMatch, run, runUntil } from "./testing.ts";
import type { InputFrame, MatchState, PlayerState } from "./types.ts";
import { Anim, BombKind, Dir } from "./types.ts";

const SPACE: InputFrame = { dir: null, bomb: true };
const CTRL: InputFrame = { dir: null, bomb: false, attack: true };
const Z: InputFrame = { dir: null, bomb: false, evade: true };
const walk = (dir: Dir): InputFrame => ({ dir, bomb: false });

function face(player: PlayerState, dir: Dir): void {
  player.dir = dir;
  player.anim = Anim.Stand + dir;
}

/** Press once, then release. */
function tap(state: MatchState, input: InputFrame, id = 1): void {
  run(state, 1, { [id]: input });
  run(state, 1, { [id]: IDLE });
}

/**
 * Walk to within 4 px of a cell's spawn point, one axis after the other, and stop there (the
 * area's edges hold a player 4 px short of the outer cells' spawn points).
 */
function walkTo(state: MatchState, player: PlayerState, col: number, row: number): void {
  const x = col * state.layout.cellW + 20;
  const y = row * state.layout.cellH + 16;
  const id = player.id;
  if (player.x < x - 4) runUntil(state, () => player.x >= x - 4, 60, { [id]: walk(Dir.Right) });
  if (player.x > x + 4) runUntil(state, () => player.x <= x + 4, 60, { [id]: walk(Dir.Left) });
  if (player.y < y - 4) runUntil(state, () => player.y >= y - 4, 60, { [id]: walk(Dir.Down) });
  if (player.y > y + 4) runUntil(state, () => player.y <= y + 4, 60, { [id]: walk(Dir.Up) });
  run(state, 1, { [id]: IDLE });
}

/** Run `ticks` updates and collect who died, holding `input` for player 1. */
function deathsOver(state: MatchState, ticks: number, input: InputFrame = IDLE): number[] {
  const dead: number[] = [];
  for (let i = 0; i < ticks && state.phase === "playing"; i++) {
    run(state, 1, { 1: input });
    for (const e of state.events) if (e.type === "death") dead.push(e.playerId);
  }
  return dead;
}

/** A bomb that goes off in about `ms`. */
function bombDueIn(state: MatchState, cell: number, ms: number, power: number) {
  return addBomb(state, cell, { owner: 2, power, placedMs: nowMs(state.tick) - FUSE_MS + ms });
}

/**
 * 백샷 and 0칸: the shooter faces a block with `gap` free cells before it and the foe stands two
 * cells behind. `wait` idle updates before the shot shift the player's animation timer, which the
 * throw animation runs on. Left Ctrl is let go for `release` updates (or held with Z for one, when
 * `release` is 0) and Z is held from then on.
 */
function backshot(gap: number, item: "burrow" | "jump", wait = 0, release = 1): number[] {
  const lane = `#${".".repeat(gap)}1.2`.padEnd(15, ".");
  const state = playingMatch([lane, "###############"], 2);
  const player = state.players[0];
  player.inv.missile = 1;
  player.inv.power = 1;
  if (item === "burrow") player.inv.burrow = true;
  else player.inv.jump = 1;
  face(player, Dir.Left);
  run(state, wait);
  return [
    ...deathsOver(state, 1, CTRL),
    ...(release > 0 ? deathsOver(state, release) : deathsOver(state, 1, { ...CTRL, evade: true })),
    ...deathsOver(state, 60, Z),
  ];
}

const WAITS = [0, 1, 2, 3, 4, 5, 6, 7];

describe("1. 핵폭탄 드로우: a nuke thrown into a blast goes off where it lands", () => {
  it("lands in the enemy bomb's flame, explodes next update and burns its whole 5x5", () => {
    const state = playingMatch([".......", ".......", "1......", ".......", ".....2."], 2);
    const player = state.players[0];
    player.inv.glove = true;
    player.inv.nuke = 1;
    face(player, Dir.Right);
    tap(state, SPACE);
    const nuke = state.bombs[0];
    expect(nuke.kind).toBe(BombKind.Nuke);

    // The enemy bomb's down arm covers the landing cell (3, 2) as the throw starts.
    addBomb(state, cellAt(state, 3, 0), { owner: 2, power: 2, triggered: true });
    run(state, 1, { 1: SPACE });
    runUntil(state, () => nuke.motion === 0, 20);
    expect(nuke.cell).toBe(cellAt(state, 3, 2));
    run(state, 1);
    expect(nuke.exploded).toBe(true);
    // Player 2 at (5, 4) is outside the enemy cross but inside the nuke's square.
    expect(deathsOver(state, 5)).toEqual([2]);
    expect(player.alive).toBe(true);
  });
});

describe("2. 백샷: a 직격탄 into a block, the blast behind the shooter", () => {
  it("kills only the foe from three or more cells off the block (two free and up)", () => {
    for (const wait of WAITS) {
      for (const gap of [2, 3]) {
        expect(backshot(gap, "burrow", wait)).toEqual([2]);
        expect(backshot(gap, "jump", wait)).toEqual([2]);
      }
    }
    expect(backshot(5, "burrow")).toEqual([2]);
  });
});

describe("3. 핵폭탄 점프 & 버로우: a nuke set in the enemy's range, then Z", () => {
  function nukeAndEvade(item: "burrow" | "jump"): { dead: number[]; nukeWent: boolean } {
    const state = playingMatch([".......", ".......", "...1...", ".......", ".....2."], 2);
    const player = state.players[0];
    player.inv.nuke = 1;
    if (item === "burrow") player.inv.burrow = true;
    else player.inv.jump = 1;
    face(player, Dir.Up);
    // The enemy bomb at (1, 2) reaches the player's cell and goes off in about 200 ms.
    bombDueIn(state, cellAt(state, 1, 2), 200, 2);
    tap(state, SPACE);
    const nuke = state.bombs.find((b) => b.kind === BombKind.Nuke)!;
    run(state, 1, { 1: Z });
    const dead = deathsOver(state, 60);
    return { dead, nukeWent: nuke.exploded && nuke.placedMs + FUSE_MS > nowMs(nuke.explodedTick) };
  }

  it("sets the nuke off with the enemy blast; the placer lives underground or in the air", () => {
    for (const item of ["burrow", "jump"] as const) {
      const { dead, nukeWent } = nukeAndEvade(item);
      expect(nukeWent).toBe(true);
      expect(dead).toEqual([2]);
    }
  });
});

describe("4. 풍차돌리기: throwing round an unbreakable block", () => {
  it("throws bombs over the block from two sides; three are out at once", () => {
    const state = playingMatch([".......", ".1#....", ".......", ".......", "......."]);
    const player = state.players[0];
    player.inv.glove = true;
    player.bombCapacity = 3;

    face(player, Dir.Right);
    tap(state, SPACE);
    run(state, 1, { 1: SPACE });
    const first = state.bombs[0];
    runUntil(state, () => first.motion === 0, 20);
    // Over the block at (2, 1) onto (4, 1).
    expect(first.cell).toBe(cellAt(state, 4, 1));

    walkTo(state, player, 1, 0);
    walkTo(state, player, 2, 0);
    face(player, Dir.Down);
    tap(state, SPACE);
    run(state, 1, { 1: SPACE });
    const second = state.bombs[1];
    runUntil(state, () => second.motion === 0, 20);
    expect(second.cell).toBe(cellAt(state, 2, 3));

    run(state, 12);
    tap(state, SPACE);
    expect(state.bombs.filter((b) => !b.exploded)).toHaveLength(3);
  });
});

describe("5. 동서남북놓기: bombs set round an unbreakable block", () => {
  it("walks round the block setting a bomb on three sides and out of their lines; the last one's line kills", () => {
    const state = playingMatch([".......", "...1...", "...#...", "......2", "......."], 2);
    const player = state.players[0];
    player.bombCapacity = 3;
    player.inv.power = 1;

    tap(state, SPACE);
    walkTo(state, player, 4, 1);
    walkTo(state, player, 4, 2);
    tap(state, SPACE);
    walkTo(state, player, 4, 3);
    walkTo(state, player, 3, 3);
    tap(state, SPACE);
    expect(state.bombs.map((b) => b.cell)).toEqual([cellAt(state, 3, 1), cellAt(state, 4, 2), cellAt(state, 3, 3)]);

    // The block stops the three arms that point at it, so (2, 4) and row 4 west of it stay clear.
    walkTo(state, player, 2, 3);
    walkTo(state, player, 2, 4);
    walkTo(state, player, 0, 4);
    const dead = deathsOver(state, 70);
    expect(state.bombs.every((b) => b.exploded)).toBe(true);
    expect(dead).toEqual([2]);
  });
});

describe("6. 끼워놓기: a bomb set in the enemy bomb's range as it is about to go off", () => {
  it("goes off with the enemy blast and catches the enemy on the cell it fled to", () => {
    const state = playingMatch([".......", ".......", "....1..", "....2..", "......."], 2);
    const player = state.players[0];
    // The enemy set a power-1 bomb at (3, 2) and stepped to (4, 3), off its cross.
    const enemyBomb = bombDueIn(state, cellAt(state, 3, 2), 1500, 1);
    tap(state, SPACE);
    const mine = state.bombs[1];
    walkTo(state, player, 6, 2);
    walkTo(state, player, 6, 0);

    const dead = deathsOver(state, 40);
    expect(enemyBomb.exploded).toBe(true);
    expect(mine.exploded).toBe(true);
    expect(mine.explodedTick - enemyBomb.explodedTick).toBeLessThanOrEqual(2);
    expect(dead).toEqual([2]);
    expect(player.alive).toBe(true);
  });
});

describe("7. 폭주: the shield and a bomb set in the last one's flame, again and again", () => {
  function rushStart(capacity: number, shield: boolean): MatchState {
    const state = playingMatch(["1......", "......."]);
    const player = state.players[0];
    player.bombCapacity = capacity;
    if (shield) player.status.shield = nowMs(state.tick);
    tap(state, SPACE);
    walkTo(state, player, 1, 0);
    return state;
  }

  it("with three bombs: each one set in a flame goes off at once, and the shield keeps the player alive", () => {
    const state = rushStart(3, true);
    const player = state.players[0];
    const [first] = state.bombs;
    runUntil(state, () => first.exploded, 80);
    run(state, 1);

    tap(state, SPACE);
    const second = state.bombs[1];
    expect(second.cell).toBe(cellAt(state, 1, 0));
    runUntil(state, () => second.exploded, 3);

    // A burning bomb still holds its cell, so the next one goes a cell on, into the flame there.
    tap(state, SPACE);
    expect(state.bombs).toHaveLength(2);
    walkTo(state, player, 2, 0);
    tap(state, SPACE);
    const third = state.bombs[2];
    expect(third.cell).toBe(cellAt(state, 2, 0));
    runUntil(state, () => third.exploded, 3);
    expect(player.alive).toBe(true);
  });

  it("without the shield the first flame kills the player", () => {
    const state = rushStart(3, false);
    expect(deathsOver(state, 80)).toEqual([1]);
  });

  it("with two bombs the third fits only between the first fire's end and the second's", () => {
    const state = rushStart(2, true);
    const player = state.players[0];
    const [first] = state.bombs;
    runUntil(state, () => first.exploded, 80);
    run(state, 6);
    tap(state, SPACE);
    const second = state.bombs[1];
    runUntil(state, () => second.exploded, 3);
    walkTo(state, player, 2, 0);

    // Both still count against the capacity while the first burns.
    tap(state, SPACE);
    expect(state.bombs).toHaveLength(2);
    runUntil(state, () => !state.bombs.includes(first), 40);
    expect(state.bombs).toContain(second);
    tap(state, SPACE);
    const third = state.bombs.find((b) => b !== second)!;
    expect(third.cell).toBe(cellAt(state, 2, 0));
    runUntil(state, () => third.exploded, 3);
    expect(player.alive).toBe(true);
  });

  it("frees a burning bomb's cell when another fire over it ends, so the third goes in that cell (0x407392)", () => {
    const state = rushStart(2, true);
    const [first] = state.bombs;
    runUntil(state, () => first.exploded, 80);
    run(state, 6);
    tap(state, SPACE);
    const second = state.bombs[1];
    runUntil(state, () => second.exploded, 3);
    expect(first.fireCells).toContain(second.cell);

    runUntil(state, () => !state.bombs.includes(first), 40);
    expect(state.bombs).toContain(second);
    tap(state, SPACE);
    expect(state.bombs.filter((b) => b !== second).map((b) => b.cell)).toEqual([cellAt(state, 1, 0)]);
  });
});

describe("8. 맵 반대편 죽이기: a throw across the area's edge", () => {
  it("wraps a bomb thrown off the left edge onto the far side, where its fire kills", () => {
    const state = playingMatch([".......", "1.....2", "......."], 2);
    const player = state.players[0];
    player.inv.glove = true;
    player.inv.power = 1;
    face(player, Dir.Left);
    tap(state, SPACE);
    run(state, 1, { 1: SPACE });
    const bomb = state.bombs[0];
    runUntil(state, () => bomb.motion === 0, 20);
    // Three cells left of column 0 on a 7-wide map is column 4.
    expect(bomb.cell).toBe(cellAt(state, 4, 1));

    walkTo(state, player, 0, 0);
    const dead = deathsOver(state, 80);
    expect(dead).toEqual([2]);
    expect(player.alive).toBe(true);
  });
});

describe("9. 던져서 끼워넣기: a bomb thrown into the enemy bomb's range", () => {
  it("lands beside the enemy bomb, goes off with it and reaches where the enemy stands", () => {
    const state = playingMatch([".......", ".......", "1......", ".......", "...2..."], 2);
    const player = state.players[0];
    player.inv.glove = true;
    face(player, Dir.Right);
    // Over the enemy bomb at (2, 2) onto (3, 2), in its arm; its own cross misses (3, 4).
    const enemyBomb = bombDueIn(state, cellAt(state, 2, 2), 1800, 1);
    tap(state, SPACE);
    run(state, 1, { 1: SPACE });
    const mine = state.bombs[1];
    runUntil(state, () => mine.motion === 0, 20);
    expect(mine.cell).toBe(cellAt(state, 3, 2));

    walkTo(state, player, 0, 0);
    const dead = deathsOver(state, 40);
    expect(enemyBomb.exploded && mine.exploded).toBe(true);
    expect(mine.explodedTick - enemyBomb.explodedTick).toBeLessThanOrEqual(2);
    expect(dead).toEqual([2]);
    expect(player.alive).toBe(true);
  });
});

// A shot blocked at once goes off two updates after it and its flame kills from the third; each
// free cell before the block costs four more. The action keys are read during the throw
// animation (FIDELITY §8), so Z can beat the flame when Left Ctrl is let go in between.
describe("0칸 (letsgame vod_16): a 직격탄 against the block, then Z at once", () => {
  it("kills only the foe when Z comes within two updates of letting go of Left Ctrl", () => {
    for (const wait of WAITS) {
      for (const release of [1, 2]) {
        expect(backshot(0, "burrow", wait, release)).toEqual([2]);
        expect(backshot(0, "jump", wait, release)).toEqual([2]);
      }
      expect(backshot(0, "burrow", wait, 3)).toEqual([1, 2]);
      expect(backshot(0, "jump", wait, 3)).toEqual([1, 2]);
    }
  });

  it("leaves one free cell more time: Z up to five updates after letting go", () => {
    for (const wait of WAITS) {
      expect(backshot(1, "burrow", wait, 5)).toEqual([2]);
      expect(backshot(1, "jump", wait, 5)).toEqual([2]);
      expect(backshot(1, "jump", wait, 6)).toEqual([1, 2]);
    }
  });

  it("fails when Z goes down before Left Ctrl comes up (the single action latch stays set)", () => {
    for (const gap of [0, 3]) {
      expect(backshot(gap, "burrow", 0, 0)).toEqual([1, 2]);
      expect(backshot(gap, "jump", 0, 0)).toEqual([1, 2]);
    }
  });
});

describe("미던 (letsgame vod_15): a 직격탄 set off against a block, then thrown", () => {
  /** The shooter holds a 직격탄 and the glove against a block; the foe stands where it lands. */
  function missileThrow(wait: number, release: number): { state: MatchState; dead: number[] } {
    const state = playingMatch(["..........", "2...#1....", ".........."], 2);
    const player = state.players[0];
    player.inv.missile = 1;
    player.inv.glove = true;
    face(player, Dir.Left);
    run(state, wait);
    const dead = [...deathsOver(state, 1, CTRL), ...deathsOver(state, release), ...deathsOver(state, 1, SPACE)];
    return { state, dead };
  }

  it("throws the flagged 직격탄 over the block; it goes off on landing, far from the shooter", () => {
    for (const wait of WAITS) {
      const { state, dead } = missileThrow(wait, 1);
      expect(dead).toEqual([]);
      const missile = state.bombs[0];
      expect(missile.triggered).toBe(true);
      expect(missile.motion).toBe(Dir.Left + 5);
      runUntil(state, () => missile.motion === 0, 20);
      expect(missile.cell).toBe(cellAt(state, 2, 1));
      expect(missile.exploded).toBe(false);
      run(state, 1);
      expect(missile.exploded).toBe(true);
      expect(deathsOver(state, 10)).toEqual([2]);
      expect(state.players[0].alive).toBe(true);
    }
  });

  it("off the block, Space right after the shot throws the 직격탄 before it is set off: it waits out its fuse", () => {
    const state = playingMatch(["...............", "#...1.........2", "..............."], 2);
    const player = state.players[0];
    player.inv.missile = 1;
    player.inv.glove = true;
    face(player, Dir.Left);
    run(state, 1, { 1: CTRL });
    run(state, 1, { 1: IDLE });
    run(state, 1, { 1: SPACE });
    const missile = state.bombs[0];
    expect(missile.motion).toBe(Dir.Left + 5);
    expect(missile.triggered).toBe(false);
    runUntil(state, () => missile.motion === 0, 20);
    expect(missile.cell).toBe(cellAt(state, 1, 1));
    const landed = state.tick;
    runUntil(state, () => missile.exploded, 90);
    expect(state.tick - landed).toBe(60);
  });

  it("fails with Space one update later: the 직격탄 has already gone off in the shooter's cell", () => {
    for (const wait of WAITS) {
      const { state, dead } = missileThrow(wait, 2);
      expect(state.bombs[0].cell).toBe(cellAt(state, 5, 1));
      expect([...dead, ...deathsOver(state, 30)]).toEqual([1]);
    }
  });
});
