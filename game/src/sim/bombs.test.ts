import { describe, expect, it } from "vitest";

import { FIRE_FRAMES, FUSE_MS, nowMs, START_BOMBS, START_FIRE } from "./constants.ts";
import { addBomb, burning, cellAt, cellCenter, IDLE, playingMatch, run, runUntil } from "./testing.ts";
import type { BombState, MatchState } from "./types.ts";
import { CellKind, Dir, ItemKind } from "./types.ts";
import { rollHiddenItems, startBreaking, suddenDeathOrder } from "./world.ts";

const press = { 1: { dir: null, bomb: true } };

/** A bomb owned by nobody on the field whose fuse has already run out. */
function expiredBomb(state: MatchState, cell: number, power: number): BombState {
  return addBomb(state, cell, { power, placedMs: -1_000_000 });
}

function removePlayers(state: MatchState): void {
  for (const p of state.players) {
    p.alive = false;
    p.gone = true;
  }
}

describe("bombs", () => {
  it("places one bomb per press at the player's cell and lets the player stand on it", () => {
    const state = playingMatch(["1...."]);
    state.players[0].bombCapacity = 3;

    run(state, 1, press);
    expect(state.events).toContainEqual({ type: "bomb-placed", cell: cellAt(state, 0, 0), owner: 1 });
    run(state, 4, press);

    expect(state.bombs).toHaveLength(1);
    expect(state.bombs[0]).toMatchObject({ cell: cellAt(state, 0, 0), owner: 1, power: START_FIRE });
    expect(state.players[0].bombPass).toBe(true);
  });

  it("explodes exactly 2000 ms after it was placed", () => {
    const state = playingMatch(["1.....", "..#...", "......"]);
    state.players[0].x = cellCenter(state, 2, 0).x;
    state.players[0].firePower = 3;
    run(state, 1, press);
    const bomb = state.bombs[0];
    state.players[0].gone = true;
    state.players[0].alive = false;

    run(state, 59);
    expect(bomb.exploded).toBe(false);
    run(state, 1);

    expect(bomb.exploded).toBe(true);
    expect(state.events).toContainEqual({ type: "explode", cell: cellAt(state, 2, 0) });
    // Centre, then the arms up, left, down, right; the wall below stops that arm.
    expect(bomb.fireCells).toEqual([2, 1, 0, 3, 4, 5].map((c) => cellAt(state, c, 0)));
    // Flame kinds are written by the fire draw, from the next update on (0x406a6b).
    expect(burning(state)).toEqual([]);
    run(state, 1);
    expect(burning(state)).toEqual([0, 1, 2, 3, 4, 5].map((c) => cellAt(state, c, 0)));
  });

  it("counts an exploded bomb against the capacity until its fire ends", () => {
    const state = playingMatch(["1....."]);
    expect(state.players[0].bombCapacity).toBe(START_BOMBS);
    state.players[0].firePower = 1;
    run(state, 1, press);
    run(state, 30, { 1: { dir: Dir.Right, bomb: false } });
    runUntil(state, () => state.bombs[0].exploded, 100, { 1: IDLE });

    run(state, 1, press);
    expect(state.bombs).toHaveLength(1);

    runUntil(state, () => state.bombs.length === 0);
    run(state, 1, { 1: IDLE });
    run(state, 1, press);
    expect(state.bombs).toHaveLength(1);
  });

  it("burns for 8 fire frames: the first update, then one each after more than 66 ms", () => {
    const state = playingMatch(["....1"]);
    removePlayers(state);
    expiredBomb(state, 0, 1);
    run(state, 1);
    const bomb = state.bombs[0];
    expect(state.bombSprites).toEqual([]);

    // The fire timer is still at its constructor value, so frame 1 follows the first draw.
    run(state, 1);
    expect(state.bombSprites).toEqual([{ type: "fire", cells: [0, 1], anim: 0, frame: 0 }]);
    expect(bomb.fireFrame).toBe(1);
    const lasted = runUntil(state, () => !state.bombs.includes(bomb));

    // Frames 2-8 at 133, 200, 300, 400, 500, 600, 700 ms of logic time.
    expect(lasted).toBe(FIRE_FRAMES * 2 + 3);
    expect(burning(state)).toEqual([]);
  });

  it("passes through bombs and sets them off once its flame is drawn", () => {
    const state = playingMatch(["......1"]);
    removePlayers(state);
    expiredBomb(state, 0, 3);
    expiredBomb(state, 2, 1);
    state.bombs[1].placedMs = 0;

    run(state, 1);
    expect(state.bombs[0].fireCells).toEqual([0, 1, 2, 3]);
    expect(state.bombs[1]).toMatchObject({ exploded: false, triggered: false });

    run(state, 1);
    expect(burning(state)).toEqual([0, 1, 2, 3]);
    expect(state.bombs[1]).toMatchObject({ exploded: false, triggered: true });

    run(state, 1);
    expect(state.bombs[1].exploded).toBe(true);
  });

  it("lets a bomb earlier in the list wait one more update before it is triggered", () => {
    const state = playingMatch(["......1"]);
    removePlayers(state);
    expiredBomb(state, 2, 1);
    state.bombs[0].placedMs = 0;
    expiredBomb(state, 0, 3);

    run(state, 2);
    expect(state.bombs[0].triggered).toBe(false);
    run(state, 1);
    expect(state.bombs[0].triggered).toBe(true);
    run(state, 1);
    expect(state.bombs[0].exploded).toBe(true);
  });

  it("burns the first brick in a direction, opens it at once and reveals its item when it crumbles", () => {
    const state = playingMatch(["1.....", "..BB.."]);
    removePlayers(state);
    state.hidden[cellAt(state, 2, 1)] = ItemKind.Speed;
    expiredBomb(state, cellAt(state, 0, 1), 4);

    run(state, 1);
    const brick = cellAt(state, 2, 1);
    expect(state.bombs[0].fireCells).toContain(brick);
    expect(state.bombs[0].fireCells).not.toContain(cellAt(state, 3, 1));
    expect(state.grid[brick]).toBe(CellKind.Empty);
    expect(state.grid[cellAt(state, 3, 1)]).toBe(CellKind.Brick);
    expect(state.breaking).toMatchObject([{ cell: brick, frame: 1 }]);

    // b1 crumbles in 6 frames at 5 fps: frame 2 on the next update, then one per 7 updates.
    run(state, 1);
    expect(state.breaking[0].frame).toBe(2);
    run(state, 27);
    expect(state.breaking).toHaveLength(1);
    run(state, 1);
    expect(state.breaking).toEqual([]);
    expect(state.items).toMatchObject([{ cell: brick, kind: ItemKind.Speed }]);
  });

  it("lets a second fire pass through a crumbling brick", () => {
    const state = playingMatch(["1.....", "..BB.."]);
    removePlayers(state);
    expiredBomb(state, cellAt(state, 0, 1), 4);
    run(state, 1);
    runUntil(state, () => state.bombs.length === 0);

    expiredBomb(state, cellAt(state, 0, 1), 4);
    run(state, 2);

    expect(burning(state)).toContain(cellAt(state, 3, 1));
    expect(state.grid[cellAt(state, 3, 1)]).toBe(CellKind.Empty);
  });

  it("puts out all of a fire's cells when it ends; a later fire on the list draws its own again", () => {
    const state = playingMatch([".....1"]);
    removePlayers(state);
    expiredBomb(state, 0, 2);
    run(state, 5);
    expiredBomb(state, 4, 2);
    run(state, 2);
    expect(burning(state)).toEqual([0, 1, 2, 3, 4, 5]);

    runUntil(state, () => state.bombs.length === 1);

    expect(state.bombs[0].fireCells).toEqual([4, 3, 2, 5]);
    expect(burning(state)).toEqual([2, 3, 4, 5]);
  });

  it("puts out a cell for an update when a fire later on the list ends there first", () => {
    const state = playingMatch([".....1"]);
    removePlayers(state);
    const later = addBomb(state, 0, { power: 2, placedMs: nowMs(5) - FUSE_MS });
    expiredBomb(state, 4, 2);
    run(state, 5);
    expect(later.exploded).toBe(true);

    runUntil(state, () => state.bombs.length === 1);

    expect(burning(state)).toEqual([0, 1]);
    run(state, 1);
    expect(burning(state)).toEqual([0, 1, 2]);
  });

  it("kills players standing in the flame", () => {
    const state = playingMatch(["1....", "....2"], 2);
    run(state, 1, press);

    run(state, 60);
    expect(state.bombs[0].exploded).toBe(true);
    expect(state.players[0].alive).toBe(true);
    run(state, 1);

    expect(state.players[0]).toMatchObject({ alive: false, anim: 20, frame: 0 });
    expect(state.events).toContainEqual({ type: "death", playerId: 1 });
    expect(state.players[1].alive).toBe(true);
  });

  it("applies item effects on pickup up to the caps", () => {
    const state = playingMatch(["1....."]);
    state.items.push({ cell: cellAt(state, 1, 0), kind: ItemKind.Fire, tick: 0, dropped: false });
    state.items.push({ cell: cellAt(state, 2, 0), kind: ItemKind.Speed, tick: 0, dropped: false });
    state.players[0].speed = 10;

    run(state, 20, { 1: { dir: Dir.Right, bomb: false } });

    expect(state.players[0].firePower).toBe(START_FIRE + 1);
    expect(state.players[0].speed).toBe(10);
    expect(state.items).toEqual([]);
  });

  it("burns an item in the path and stops there", () => {
    const state = playingMatch([".....1"]);
    removePlayers(state);
    state.items.push({ cell: 2, kind: ItemKind.Speed, tick: 0, dropped: false });
    expiredBomb(state, 0, 4);

    run(state, 1);

    expect(state.items).toEqual([]);
    expect(state.bombs[0].fireCells).toEqual([0, 1, 2]);
  });

  it("hides an item in about 106 of 300 bricks, the switch, shake and candy at most once", () => {
    const state = playingMatch(["1" + "B".repeat(3999)]);
    state.grid = state.layout.kinds.slice();
    rollHiddenItems(state);

    const items = state.hidden.filter((h) => h !== null);
    expect(items.length / 3999).toBeGreaterThan(0.33);
    expect(items.length / 3999).toBeLessThan(0.38);
    const basic = items.filter((h) => h <= ItemKind.Speed).length;
    expect(basic / 3999).toBeGreaterThan(0.12);
    for (const once of [ItemKind.Switch, ItemKind.Shake, ItemKind.Candy]) {
      expect(items.filter((h) => h === once)).toHaveLength(1);
    }
  });
});

describe("death drops", () => {
  it("drops one item per raised stat into the first free neighbours after the death animation", () => {
    const state = playingMatch(["....", ".1..", "...."]);
    const player = state.players[0];
    Object.assign(player, { bombCapacity: 3, firePower: 4, speed: 7 });
    state.flame[cellAt(state, 1, 1)] = 1;

    runUntil(state, () => state.phase !== "playing");

    expect(player.gone).toBe(true);
    expect(state.items.map((i) => [i.cell, i.kind])).toEqual([
      [cellAt(state, 0, 1), ItemKind.Bomb],
      [cellAt(state, 0, 0), ItemKind.Fire],
      [cellAt(state, 1, 0), ItemKind.Speed],
    ]);
  });

  it("drops 손, 발 and 점프 after the stats (0x4534f4, 0x45357c, 0x453604)", () => {
    const state = playingMatch(["....", ".1..", "...."]);
    const player = state.players[0];
    Object.assign(player, { speed: 7 });
    Object.assign(player.inv, { glove: true, kick: true, jump: 1 });
    state.flame[cellAt(state, 1, 1)] = 1;

    runUntil(state, () => player.gone);

    expect(state.items.map((i) => [i.cell, i.kind])).toEqual([
      [cellAt(state, 0, 1), ItemKind.Speed],
      [cellAt(state, 0, 0), ItemKind.Glove],
      [cellAt(state, 1, 0), ItemKind.Kick],
      [cellAt(state, 2, 0), ItemKind.Jump],
    ]);
  });
});

describe("sudden death", () => {
  it("spirals inward over 200 cells and leaves the centre 5x5 open", () => {
    const order = suddenDeathOrder(15);

    expect(order).toHaveLength(200);
    expect(new Set(order).size).toBe(200);
    expect(order.slice(0, 16)).toEqual([...Array.from({ length: 15 }, (_, i) => i), 29]);
    const centre = order.filter((c) => c % 15 >= 5 && c % 15 < 10 && Math.floor(c / 15) >= 5 && Math.floor(c / 15) < 10);
    expect(centre).toEqual([]);
  });

  it("starts once the clock is at 60 s and closes one cell per 7 updates, killing and clearing what is there", () => {
    const rows = Array.from({ length: 15 }, () => ".".repeat(15));
    rows[0] = ".#.1...........";
    const state = playingMatch(rows);
    state.items.push({ cell: 2, kind: ItemKind.Bomb, tick: 0, dropped: false });
    state.timerSeconds = 62;

    runUntil(state, () => state.timerSeconds === 60);
    expect(state.suddenDeath.placed).toBe(0);
    runUntil(state, () => state.suddenDeath.placed === 1);
    expect(state.events).toContainEqual({ type: "sudden-death" });
    expect(state.grid[0]).toBe(CellKind.Fixed);
    expect(state.flame[0]).toBe(1);

    run(state, 7);
    expect(state.suddenDeath.placed).toBe(2);
    expect(state.flame[1]).toBe(0);
    run(state, 7);
    expect(state.items).toEqual([]);
    expect(state.grid[2]).toBe(CellKind.Fixed);
    expect(state.players[0].alive).toBe(true);
    run(state, 7);
    expect(state.players[0].alive).toBe(false);
  });

  function closedOverBrick(breaking: boolean): MatchState {
    const rows = Array.from({ length: 15 }, () => ".".repeat(15));
    rows[0] = "B......1.......";
    const state = playingMatch(rows);
    state.hidden[0] = ItemKind.Speed;
    if (breaking) startBreaking(state, 0);
    state.suddenDeath = { placed: 1, active: true, lastMs: Infinity };
    run(state, 1);
    expect(state.grid[0]).toBe(CellKind.Fixed);
    return state;
  }

  it("an intact brick under a closed cell never crumbles, so its item never shows (0x401593)", () => {
    const state = closedOverBrick(false);
    expect(state.breaking).toEqual([]);
    run(state, 60);
    expect(state.items).toEqual([]);
  });

  it("a crumbling brick crumbles on over the block; its item shows for one update and is cleared the next (0x401890, 0x4016c7)", () => {
    const state = closedOverBrick(true);
    expect(state.breaking.map((b) => b.cell)).toEqual([0]);

    runUntil(state, () => state.breaking.length === 0);
    expect(state.items.map((i) => [i.cell, i.kind])).toEqual([[0, ItemKind.Speed]]);
    run(state, 1);
    expect(state.items).toEqual([]);
  });
});
