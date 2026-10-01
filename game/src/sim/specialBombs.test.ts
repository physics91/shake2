import { describe, expect, it } from "vitest";

import { FUSE_MS, nowMs, TIMER_FUSE_MS } from "./constants.ts";
import { hasBomb } from "./grid.ts";
import { addBomb, burning, cellAt, cellCenter, IDLE, playingMatch, PRACTICE, run, runUntil, VERSUS } from "./testing.ts";
import type { InputFrame, MatchState, PlayerState } from "./types.ts";
import { Anim, BombKind, Dir, ItemKind } from "./types.ts";

const SPACE: InputFrame = { dir: null, bomb: true };
const CTRL: InputFrame = { dir: null, bomb: false, attack: true };

function removePlayers(state: MatchState): void {
  for (const p of state.players) {
    p.alive = false;
    p.gone = true;
  }
}

function face(player: PlayerState, dir: Dir): void {
  player.dir = dir;
  player.anim = Anim.Stand + dir;
}

/** Press once, then release. */
function tap(state: MatchState, input: InputFrame, id = 1): void {
  run(state, 1, { [id]: input });
  run(state, 1, { [id]: IDLE });
}

describe("bomb kinds (0x457ed0)", () => {
  it("gives the power item's bombs the map width and never uses it up", () => {
    const state = playingMatch(["1......"]);
    const player = state.players[0];
    player.inv.power = 1;
    run(state, 1, { 1: SPACE });
    expect(state.bombs[0].power).toBe(7);
    expect(player.inv.power).toBe(1);
  });

  it("makes a nuke of power 2 from the whole nuke stock", () => {
    const state = playingMatch(["1......"]);
    const player = state.players[0];
    player.inv.nuke = 3;
    run(state, 1, { 1: SPACE });
    expect(state.bombs[0]).toMatchObject({ kind: BombKind.Nuke, anim: 4, power: 2, fuseMs: FUSE_MS });
    expect(player.inv.nuke).toBe(0);
  });

  it("makes a 5000 ms timer bomb from one timer charge", () => {
    const state = playingMatch(["1......"]);
    const player = state.players[0];
    player.inv.timer = 2;
    run(state, 1, { 1: SPACE });
    expect(state.bombs[0]).toMatchObject({ kind: BombKind.Timer, anim: 2, fuseMs: TIMER_FUSE_MS });
    expect(player.inv.timer).toBe(1);
  });

  it("makes an X bomb of power 2 and a TNT of power 1 that moves on in the placer's facing", () => {
    const state = playingMatch(["1......", "......."]);
    const player = state.players[0];
    player.inv.xbomb = 1;
    run(state, 1, { 1: SPACE });
    expect(state.bombs[0]).toMatchObject({ kind: BombKind.X, power: 2 });
    expect(player.inv.xbomb).toBe(0);

    const other = playingMatch(["1......"]);
    face(other.players[0], Dir.Right);
    other.players[0].inv.tnt = 2;
    run(other, 1, { 1: SPACE });
    expect(other.bombs[0]).toMatchObject({ kind: BombKind.Tnt, power: 1, tntLeft: 3, tntDir: Dir.Right });
    expect(other.players[0].inv.tnt).toBe(0);
  });
});

describe("explosion shapes (0x417170)", () => {
  it("burns every cell of a 5x5 square around a nuke on its own: walls are left out but shadow nothing", () => {
    const state = playingMatch([".......", "...#...", "..#....", "...1...", ".......", ".....B.", "......."]);
    removePlayers(state);
    const bomb = addBomb(state, cellAt(state, 3, 3), { kind: BombKind.Nuke, anim: 4, power: 2, placedMs: -FUSE_MS });

    run(state, 1);

    const square = [1, 2, 3, 4, 5].flatMap((row) => [1, 2, 3, 4, 5].map((col) => cellAt(state, col, row)));
    const walls = [cellAt(state, 3, 1), cellAt(state, 2, 2)];
    expect(bomb.fireCells).toEqual(square.filter((c) => !walls.includes(c)));
    expect(state.breaking.map((b) => b.cell)).toEqual([cellAt(state, 5, 5)]);
  });

  it("clips the nuke square at the area's edges", () => {
    const rows = [".......", ".......", ".......", ".......", ".......", ".......", "......1"];
    const corner = playingMatch(rows);
    removePlayers(corner);
    const a = addBomb(corner, cellAt(corner, 0, 0), { kind: BombKind.Nuke, power: 2, placedMs: -FUSE_MS });
    const b = addBomb(corner, cellAt(corner, 1, 1), { kind: BombKind.Nuke, power: 2, placedMs: -FUSE_MS });
    run(corner, 1);
    expect(a.fireCells).toHaveLength(9);
    expect(b.fireCells).toHaveLength(16);
    expect(b.fireCells).toContain(cellAt(corner, 3, 3));
  });

  it("burns an X bomb's four diagonals of two cells, walls stopping one", () => {
    const state = playingMatch([".......", ".......", "..#....", "...1...", ".......", ".......", "......."]);
    removePlayers(state);
    const bomb = addBomb(state, cellAt(state, 3, 3), { kind: BombKind.X, anim: 6, power: 2, placedMs: -FUSE_MS });

    run(state, 1);

    const at = (col: number, row: number) => cellAt(state, col, row);
    expect(bomb.fireCells).toEqual([at(3, 3), at(2, 4), at(1, 5), at(4, 4), at(5, 5), at(4, 2), at(5, 1)]);
  });
});

describe("fire endings", () => {
  it("replays a double bomb's fire from frame 1 without a second explosion", () => {
    const state = playingMatch(["....1"]);
    removePlayers(state);
    const bomb = addBomb(state, 0, { power: 1, double: true, placedMs: -FUSE_MS });
    run(state, 1);

    const lasted = runUntil(state, () => !state.bombs.includes(bomb));

    // 8 frames as usual (20 updates from this start), then frames 2-8 again. Each advance needs
    // more than 66 ms, which settles on every third update: 7 more advances of 3.
    expect(lasted).toBe(20 + 7 * 3);
  });

  it("moves a TNT on three times in the placer's facing, a new blast each time", () => {
    const state = playingMatch(["1......"]);
    const player = state.players[0];
    face(player, Dir.Right);
    player.inv.tnt = 1;
    run(state, 1, { 1: SPACE });
    const bomb = state.bombs[0];
    player.alive = false;
    player.gone = true;

    const blasts: number[] = [];
    runUntil(state, () => {
      for (const e of state.events) if (e.type === "explode") blasts.push(e.cell);
      return !state.bombs.includes(bomb);
    });
    expect(blasts).toEqual([0, 1, 2, 3]);
    expect(bomb.x).toBe(3 * 40 + 20);
    expect(burning(state)).toEqual([]);
  });

  it("ends a TNT at a wall", () => {
    const state = playingMatch(["1.#...."]);
    const player = state.players[0];
    face(player, Dir.Right);
    player.inv.tnt = 1;
    run(state, 1, { 1: SPACE });
    player.alive = false;
    player.gone = true;
    const blasts: number[] = [];
    runUntil(state, () => {
      for (const e of state.events) if (e.type === "explode") blasts.push(e.cell);
      return state.bombs.length === 0;
    });
    expect(blasts).toEqual([0, 1]);
  });
});

describe("kick (0x450769)", () => {
  function kicker(rows: string[], players = 1): MatchState {
    const state = playingMatch(rows, players);
    state.players[0].inv.kick = true;
    addBomb(state, cellAt(state, 1, 0), { placedMs: nowMs(0) });
    return state;
  }

  it("kicks a bomb the player walks into without moving the player; it rolls 5 cells and goes off", () => {
    const state = kicker(["1.........."]);
    const player = state.players[0];
    const bomb = state.bombs[0];
    const right = { 1: { dir: Dir.Right, bomb: false } };

    run(state, 3, right);
    expect(player.x).toBe(35);
    run(state, 1, right);

    expect(player).toMatchObject({ x: 35, anim: Anim.Kick + Dir.Right, frame: 0 });
    expect(state.events).toContainEqual({ type: "bomb-kicked", playerId: 1 });
    expect(bomb).toMatchObject({ motion: Dir.Right + 1, rollLeft: 5, kicker: 1, placedMs: nowMs(state.tick) - 500 });

    run(state, 1);
    expect(bomb).toMatchObject({ x: 65, anim: 1, frame: 0 });

    const rolled = runUntil(state, () => bomb.exploded);
    expect(rolled).toBe(40);
    expect(bomb.cell).toBe(6);
  });

  it("does not kick when a player stands beyond the bomb", () => {
    const state = kicker(["1.2......."], 2);
    const player = state.players[0];
    run(state, 6, { 1: { dir: Dir.Right, bomb: false } });
    expect(state.bombs[0].motion).toBe(0);
    expect(player.x).toBe(35);
    expect(player.anim).toBe(Anim.Walk + Dir.Right);
  });

  it("stops a kicked bomb at the centre before a wall with 1000 ms of fuse left", () => {
    const state = kicker(["1..#......"]);
    const bomb = state.bombs[0];
    run(state, 4, { 1: { dir: Dir.Right, bomb: false } });
    const kickTick = state.tick;

    // At x 80 the cell ahead (x 120) is the wall: it brakes and runs on to its centre at 100.
    run(state, 4);
    expect(bomb).toMatchObject({ x: 80, motion: Dir.Right + 1, braking: false });
    run(state, 1);
    expect(bomb).toMatchObject({ x: 85, braking: true });
    run(state, 3);
    expect(bomb).toMatchObject({ x: 100, motion: Dir.Right + 1, braking: true });
    run(state, 1);
    expect(bomb).toMatchObject({ x: 100, cell: 2, motion: 0, anim: 0, rollLeft: 5, placedMs: nowMs(kickTick + 9) - 1000 });

    const fuse = runUntil(state, () => bomb.exploded);
    expect(nowMs(state.tick) - nowMs(kickTick + 9)).toBeGreaterThanOrEqual(1000);
    expect(fuse).toBeLessThanOrEqual(31);
  });

  it("stops a kicked bomb one cell short of another player", () => {
    const state = kicker(["1...2....."], 2);
    const bomb = state.bombs[0];
    run(state, 4, { 1: { dir: Dir.Right, bomb: false } });
    runUntil(state, () => bomb.motion === 0, 60);
    expect(bomb).toMatchObject({ cell: 3, x: 140 });
  });
});

describe("glove throw", () => {
  function thrower(rows: string[], dir: Dir): MatchState {
    const state = playingMatch(rows);
    const player = state.players[0];
    player.inv.glove = true;
    face(player, dir);
    tap(state, SPACE);
    return state;
  }

  it("throws the bomb three cells in an arc; it lands centred and its fuse starts again", () => {
    const state = thrower(["........", "1.......", "........"], Dir.Right);
    const bomb = state.bombs[0];
    run(state, 1, { 1: SPACE });
    // The frame timer is not reset, so the first throw frame can pass in the same update.
    expect(state.players[0]).toMatchObject({ anim: Anim.Throw + Dir.Right, frame: 1 });
    expect(state.events).toContainEqual({ type: "bomb-thrown", playerId: 1 });
    expect(bomb).toMatchObject({ motion: Dir.Right + 5, x: 30, y: 60 - 33 });

    const heights = [bomb.y];
    runUntil(state, () => {
      heights.push(bomb.y);
      return bomb.motion === 0;
    });
    expect(heights).toEqual([27, 15, 8, 4, 1, 0, 1, 4, 8, 15, 27, 60]);
    expect(bomb).toMatchObject({ x: 140, y: 60, cell: cellAt(state, 3, 1), placedMs: nowMs(state.tick) });

    const left = runUntil(state, () => bomb.exploded);
    expect(nowMs(state.tick - left)).toBe(bomb.placedMs);
    expect(nowMs(state.tick) - nowMs(state.tick - left)).toBeGreaterThanOrEqual(FUSE_MS);
  });

  it("bounces one more cell off a brick", () => {
    const state = thrower(["........", "1..B....", "........"], Dir.Right);
    const bomb = state.bombs[0];
    run(state, 1, { 1: SPACE });
    runUntil(state, () => bomb.motion === 0);
    expect(bomb).toMatchObject({ x: 180, y: 60, cell: cellAt(state, 4, 1) });
  });

  it("wraps a throw around the area's edge", () => {
    const state = thrower([".", "1", ".", ".", "."], Dir.Up);
    const bomb = state.bombs[0];
    run(state, 1, { 1: SPACE });
    runUntil(state, () => bomb.motion === 0);
    expect(bomb).toMatchObject({ y: 3 * 32 + 28, cell: cellAt(state, 0, 3) });
  });

  it("keeps a flagged bomb in the air and sets it off after it lands", () => {
    const state = thrower(["........", "1.......", "........"], Dir.Right);
    const bomb = state.bombs[0];
    run(state, 1, { 1: SPACE });
    bomb.triggered = true;
    runUntil(state, () => bomb.motion === 0);
    expect(bomb.exploded).toBe(false);
    run(state, 1);
    expect(bomb.exploded).toBe(true);
  });

  it("takes the bomb bit off the cell, so a bomb still resting there no longer holds it (0x45b86d)", () => {
    // P1 throws T down over P2's cell A, where N rests; P2 throws T on, the first bomb listed in A.
    const state = playingMatch([".1.", ".2.", "...", "...", "...", "..."], 2);
    const [p1, p2] = state.players;
    p1.inv.glove = true;
    p2.inv.glove = true;
    run(state, 1, { 1: SPACE, 2: SPACE });
    run(state, 1, { 1: IDLE, 2: IDLE });
    run(state, 1, { 1: SPACE, 2: IDLE });
    run(state, 1, { 1: IDLE, 2: SPACE });
    const [t, n] = state.bombs;
    const a = cellAt(state, 1, 1);
    expect(t).toMatchObject({ firstFlight: true, flightLeft: 88 });
    expect(n).toMatchObject({ cell: a, motion: 0 });
    expect(hasBomb(state, a)).toBe(false);
    // So P1 walks down into A once its throw is over.
    run(state, 20, { 1: IDLE, 2: IDLE });
    run(state, 6, { 1: { dir: Dir.Down, bomb: false }, 2: IDLE });
    expect(n.exploded).toBe(false);
    expect(p1.y).toBeGreaterThanOrEqual(32);
  });

  // RECONSTRUCTION (FIDELITY §8): 0311 reads no key during the throw animation (0x4021bb); the
  // remake reads the action keys there, as the service's later builds did.
  it("reads the action keys but not the arrows during the throw animation", () => {
    const state = thrower(["........", "1.......", "........"], Dir.Right);
    const player = state.players[0];
    run(state, 1, { 1: SPACE });
    const thrown = state.bombs[0];
    // A key held from the throw keeps the latch set, so it does not act again.
    runUntil(state, () => player.anim === Anim.Stand + Dir.Right, 30, { 1: SPACE });
    expect(player.actionLatch).toBe(true);
    expect(state.bombs).toEqual([thrown]);

    const again = thrower(["........", "1.......", "........"], Dir.Right);
    const other = again.players[0];
    other.bombCapacity = 2;
    run(again, 1, { 1: SPACE });
    run(again, 1, { 1: IDLE });
    // Pressed anew mid-throw, Space sets a bomb in the cell the thrown one left; the arrow is ignored.
    run(again, 1, { 1: { dir: Dir.Down, bomb: true } });
    expect(other.anim).toBe(Anim.Throw + Dir.Right);
    expect(again.bombs).toHaveLength(2);
    expect(again.bombs[0].motion).toBe(Dir.Right + 5);
    expect(again.bombs[1].cell).toBe(cellAt(again, 0, 1));
  });
});

describe("line bomb (0x4574e0)", () => {
  it("lays bombs from the next cell in the facing direction up to the capacity, stopped by a brick", () => {
    const state = playingMatch(["1...B...."], 1, VERSUS);
    const player = state.players[0];
    player.inv.line = true;
    player.bombCapacity = 6;
    face(player, Dir.Right);
    tap(state, SPACE);
    run(state, 1, { 1: SPACE });

    expect(state.bombs.map((b) => b.cell)).toEqual([0, 1, 2, 3]);
    expect(state.events.filter((e) => e.type === "bomb-placed")).toHaveLength(1);
  });

  it("plays no sound for the row in practice", () => {
    const state = playingMatch(["1........"], 1, PRACTICE);
    const player = state.players[0];
    player.inv.line = true;
    player.bombCapacity = 3;
    face(player, Dir.Right);
    tap(state, SPACE);
    run(state, 1, { 1: SPACE });
    expect(state.bombs.map((b) => b.cell)).toEqual([0, 1, 2]);
    expect(state.events.filter((e) => e.type === "bomb-placed")).toEqual([]);
  });
});

describe("Left Ctrl (0x45c264)", () => {
  it("fires a 직격탄 that rolls 10 px an update and goes off where it stops", () => {
    const state = playingMatch(["1....#"]);
    const player = state.players[0];
    player.inv.missile = 1;
    face(player, Dir.Right);

    run(state, 1, { 1: CTRL });
    const bomb = state.bombs[0];
    expect(player).toMatchObject({ anim: Anim.Throw + Dir.Right });
    expect(player.inv.missile).toBe(0);
    expect(state.events).toContainEqual({ type: "missile-fired", playerId: 1 });
    expect(bomb).toMatchObject({ fast: true, kicker: 1, motion: Dir.Right + 1, x: 30, kind: BombKind.Normal });

    // Blocked at x 160 (the wall is 40 px ahead), it runs to 180, brakes there and goes off next update.
    runUntil(state, () => bomb.exploded, 30);
    expect(state.tick).toBe(18);
    expect(bomb.cell).toBe(4);
  });

  it("sets off only the player's own timer bombs", () => {
    const state = playingMatch(["1......"]);
    const player = state.players[0];
    player.inv.timer = 1;
    tap(state, SPACE);
    const own = state.bombs[0];
    const other = addBomb(state, 5, { kind: BombKind.Timer, anim: 2, fuseMs: TIMER_FUSE_MS });
    const plain = addBomb(state, 3, { owner: 1 });

    run(state, 1, { 1: CTRL });
    expect([own.triggered, other.triggered, plain.triggered]).toEqual([true, false, false]);
    run(state, 1);
    expect(own.exploded).toBe(true);
  });
});

describe("curses and the bomb switch", () => {
  it("swallows Space under the no-bomb curse without setting the latch", () => {
    const state = playingMatch(["1......"]);
    const player = state.players[0];
    player.status.noBomb = 0;
    run(state, 1, { 1: SPACE });
    expect(state.bombs).toEqual([]);
    expect(player.actionLatch).toBe(false);
  });

  it("sets off every bomb and freezes the picker when the bomb switch is picked up", () => {
    const state = playingMatch(["1.......", "........"], 1);
    const player = state.players[0];
    state.items.push({ cell: cellAt(state, 1, 0), kind: ItemKind.Switch, tick: 0, dropped: false });
    const far = addBomb(state, cellAt(state, 6, 1), { placedMs: nowMs(0) });

    runUntil(state, () => player.status.frozen !== null, 10, { 1: { dir: Dir.Right, bomb: false } });
    expect(far.triggered).toBe(true);
    const x = player.x;
    run(state, 5, { 1: { dir: Dir.Down, bomb: false } });
    expect(player.x).toBe(x);
    expect(player.anim).toBe(Anim.Walk + Dir.Right);
  });

  it("keeps a player behind the egg shield alive in the flame", () => {
    const state = playingMatch(["1....", "....2"], 2);
    const player = state.players[0];
    run(state, 1, { 1: SPACE });
    player.status.shield = nowMs(state.tick);
    run(state, 62);
    expect(player.alive).toBe(true);
    expect(burning(state)).toContain(0);
  });
});

describe("bomb sprites", () => {
  it("draws a bomb where it was before it moved and nothing for a bomb the update it explodes", () => {
    const state = playingMatch(["1.........."]);
    state.players[0].inv.kick = true;
    const bomb = addBomb(state, 1, { placedMs: nowMs(0) });
    run(state, 4, { 1: { dir: Dir.Right, bomb: false } });
    run(state, 1);
    expect(state.bombSprites).toEqual([{ type: "bomb", owner: 99, x: 60, y: 28, anim: 0, frame: 1 }]);
    expect(bomb.x).toBe(65);

    runUntil(state, () => bomb.exploded);
    expect(state.bombSprites).toEqual([]);
    expect(cellCenter(state, 0, 0).x).toBe(20);
  });
});
