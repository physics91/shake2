import { describe, expect, it } from "vitest";

import { FADE_OUT_FRAMES, nowMs } from "./constants.ts";
import { explode } from "./fire.ts";
import { isFree } from "./grid.ts";
import { generatorItem } from "./mapObjects.ts";
import { createMatch } from "./match.ts";
import { addBomb, burning, cellAt, IDLE, layoutFromAscii, playingMatch, run, runUntil, setups, VERSUS } from "./testing.ts";
import { msvcRand } from "./rng.ts";
import { objectIndex, PAD_BITS, tileB, WARP_BITS } from "./tiles.ts";
import type { InputFrame, MatchState } from "./types.ts";
import { Anim, BombKind, Dir, ItemKind } from "./types.ts";
import { applySuddenDeath } from "./world.ts";

const DOWN: InputFrame = { dir: Dir.Down, bomb: false };
const RIGHT: InputFrame = { dir: Dir.Right, bomb: false };

function player(state: MatchState) {
  return state.players[0];
}

/** Hold `input` until the player leaves the walk and stand states, then let go until it stands again. */
function walkInto(state: MatchState, input: InputFrame): void {
  runUntil(state, () => player(state).anim >= Anim.Jump, 200, { 1: input });
  runUntil(state, () => player(state).anim < Anim.Jump, 200, { 1: IDLE });
}

describe("object animation (0x411700)", () => {
  it("loops a gate one frame per >142 ms (7 fps)", () => {
    const state = playingMatch(["#1r#"]);
    const frames: number[] = [];
    for (let i = 0; i < 30; i++) {
      run(state, 1);
      frames.push(state.objects[0].frame);
    }
    expect(new Set(frames)).toEqual(new Set([0, 1, 2, 3]));
    const changes = frames.filter((f, i) => i > 0 && f !== frames[i - 1]).length;
    expect(changes).toBeGreaterThanOrEqual(5);
    expect(changes).toBeLessThanOrEqual(7);
  });

  it("holds a jump pad's arrow still until it fires, then plays it once", () => {
    const state = playingMatch(["######", "#1v..#", "##...#", "##...#", "######"]);
    run(state, 20);
    expect(state.objects[0].frame).toBe(0);
    runUntil(state, () => player(state).anim >= Anim.Jump, 200, { 1: RIGHT });
    expect(state.objects[0].play).toBe(true);
    const frames: number[] = [];
    runUntil(
      state,
      () => {
        frames.push(state.objects[0].frame);
        return !state.objects[0].play;
      },
      100,
    );
    expect(frames.filter((f, i) => i === 0 || f !== frames[i - 1])).toEqual([0, 1, 2, 3, 0]);
  });
});

describe("warp gates (0x4522c0)", () => {
  const corridor = [
    "#########",
    "#1###.###",
    "#.###.###",
    "#r##.r.##",
    "#.###.###",
    "#.###.###",
    "#.###.###",
    "#########",
  ];

  it("sends a player walking into a gate to 32 px past its partner, jumping on from frame 4", () => {
    const state = playingMatch(corridor);
    runUntil(state, () => player(state).anim >= Anim.Jump, 200, { 1: DOWN });
    expect(state.events).toContainEqual({ type: "warped", playerId: 1 });
    expect(player(state)).toMatchObject({ x: 220, y: 144, anim: Anim.Jump + Dir.Down, frame: 4 });
    runUntil(state, () => player(state).anim < Anim.Jump, 200, { 1: IDLE });
    // Eight 5 px steps: frames 5-11 and the wrap.
    expect(player(state)).toMatchObject({ x: 220, y: 184, anim: Anim.Stand + Dir.Down });
  });

  it("turns the exit down → left → up → right while the cell 32 px out is a wall", () => {
    const rows = corridor.slice();
    rows[4] = "#.#######";
    const state = playingMatch(rows);
    runUntil(state, () => player(state).anim >= Anim.Jump, 200, { 1: DOWN });
    expect(player(state)).toMatchObject({ x: 188, y: 112, anim: Anim.Jump + Dir.Left, frame: 4 });
  });

  it("bounces a player back from a gate without a partner", () => {
    const rows = corridor.slice();
    rows[3] = "#r##...##";
    const state = playingMatch(rows);
    runUntil(state, () => player(state).anim >= Anim.Jump, 200, { 1: DOWN });
    expect(state.events).toContainEqual({ type: "warped", playerId: 1 });
    expect(player(state)).toMatchObject({ x: 60, y: 88, anim: Anim.Jump + Dir.Up, frame: 4 });
    runUntil(state, () => player(state).anim < Anim.Jump, 200, { 1: IDLE });
    expect(player(state).y).toBe(48);
  });

  it("stops fire before the gate and leaves it unburnt", () => {
    const state = playingMatch(corridor);
    const bomb = addBomb(state, cellAt(state, 1, 2), { power: 3 });
    explode(state, bomb);
    expect(bomb.fireCells).toEqual([cellAt(state, 1, 2), cellAt(state, 1, 1)]);
  });
});

describe("jump pads (0x451e50)", () => {
  it("launches a player whose centre enters the pad from its centre, two cells on", () => {
    const state = playingMatch(["######", "#1v..#", "##...#", "##...#", "######"]);
    runUntil(state, () => player(state).anim >= Anim.Jump, 200, { 1: RIGHT });
    expect(state.events).toContainEqual({ type: "pad-jumped", playerId: 1 });
    expect(player(state)).toMatchObject({ x: 100, y: 48, anim: Anim.Jump + Dir.Down, frame: 0 });
    runUntil(state, () => player(state).anim < Anim.Jump, 200, { 1: IDLE });
    // Twelve 5 px steps.
    expect(player(state)).toMatchObject({ x: 100, y: 108, anim: Anim.Stand + Dir.Down });
  });

  it("puts a player on a right pad 5 px right of centre (0x452050)", () => {
    const state = playingMatch(["#######", "#1>...#", "#######"]);
    runUntil(state, () => player(state).anim >= Anim.Jump, 200, { 1: RIGHT });
    expect(player(state)).toMatchObject({ x: 105, y: 48, anim: Anim.Jump + Dir.Right });
    runUntil(state, () => player(state).anim < Anim.Jump, 200, { 1: IDLE });
    expect(player(state).x).toBe(177);
  });

  it("chains when a jump lands on another pad", () => {
    const state = playingMatch(["######", "#1v..#", "##...#", "##>..#", "##...#", "######"]);
    runUntil(state, () => player(state).anim >= Anim.Jump, 200, { 1: RIGHT });
    runUntil(state, () => player(state).anim === Anim.Jump + Dir.Right, 200, { 1: IDLE });
    expect(player(state)).toMatchObject({ x: 105, y: 112 });
    expect(state.events).toContainEqual({ type: "pad-jumped", playerId: 1 });
  });

  it("jumps a 점프대 on in the facing, or back when the next cell is a wall", () => {
    const on = playingMatch(["######", "#1f..#", "######"]);
    walkInto(on, RIGHT);
    expect(player(on)).toMatchObject({ x: 172, anim: Anim.Stand + Dir.Right });

    const back = playingMatch(["######", "#1f#.#", "######"]);
    runUntil(back, () => player(back).anim >= Anim.Jump, 200, { 1: RIGHT });
    expect(player(back)).toMatchObject({ x: 100, anim: Anim.Jump + Dir.Left });
    runUntil(back, () => player(back).anim < Anim.Jump, 200, { 1: IDLE });
    // Blocked by the wall after seven 6 px steps.
    expect(player(back).x).toBe(58);
  });

  it("refuses Space on a directional pad but not on a 점프대 (0x45b668)", () => {
    for (const [row, bombs] of [["#1v.#", 0], ["#1f.#", 1]] as const) {
      const state = playingMatch(["#####", row, "#####"]);
      Object.assign(player(state), { x: 100, y: 48 });
      run(state, 1, { 1: { dir: null, bomb: true } });
      expect([row, state.bombs.length]).toEqual([row, bombs]);
    }
  });
});

describe("gates and pads as obstacles", () => {
  it("are not free cells for bombs, items and landings (0x410920), except the 점프대", () => {
    const state = playingMatch(["#1r^f#"]);
    expect([2, 3, 4].map((col) => isFree(state, cellAt(state, col, 0)))).toEqual([false, false, true]);
  });

  it("stop a TNT's moves (0x4177d0)", () => {
    const state = playingMatch(["#1.^..#"]);
    const tnt = addBomb(state, cellAt(state, 2, 0), { kind: 10, anim: 10, tntLeft: 3, tntDir: Dir.Right, fuseMs: 0 });
    runUntil(state, () => !state.bombs.includes(tnt), 200);
    expect(burning(state)).toEqual([]);
    expect(tnt.cell).toBe(cellAt(state, 2, 0));
  });
});

describe("폭발증폭 (0x41720a, 0x457bdc)", () => {
  it("gives a bomb exploding there the map width", () => {
    const state = playingMatch(["#1p....#"]);
    const bomb = addBomb(state, cellAt(state, 2, 0));
    explode(state, bomb);
    expect(bomb.power).toBe(8);
    expect(bomb.fireCells).toContain(cellAt(state, 6, 0));
  });

  it("leaves an X bomb's diagonals at 2: X and nuke branch off before the test (0x4171bf)", () => {
    const state = playingMatch([".......", ".......", ".......", "...p...", ".......", ".......", "1......"]);
    const bomb = addBomb(state, cellAt(state, 3, 3), { kind: BombKind.X, anim: BombKind.X, power: 2 });
    explode(state, bomb);
    expect(bomb.power).toBe(2);
    expect(bomb.fireCells).toHaveLength(1 + 4 * 2);
    expect(bomb.fireCells).not.toContain(cellAt(state, 0, 0));
  });

  it("gives a bomb placed there the map width", () => {
    const state = playingMatch(["#1p....#"]);
    Object.assign(player(state), { x: 100 });
    run(state, 1, { 1: { dir: null, bomb: true } });
    expect(state.bombs[0].power).toBe(8);
  });
});

describe("blast zone (0x417860, 0x417c80)", () => {
  const ring = ["...............", ".zzz...........", ".z.z...........", ".zzz...........", "1.............."];
  const ringCells = [16, 17, 18, 31, 33, 46, 47, 48];

  /** Past the round-start blast every zone plays once. */
  function quietRing(): MatchState {
    const state = playingMatch(ring);
    run(state, 60);
    return state;
  }

  it("sets off every connected zone cell in the explosion's update, letting the fire through", () => {
    const state = quietRing();
    const bomb = addBomb(state, 15, { power: 2, fuseMs: 0 });
    run(state, 1);
    expect(bomb.exploded).toBe(true);
    expect(ringCells.every((cell) => state.flame[cell] === 1)).toBe(true);
    expect(state.objects.every((o) => o.active && o.frame === 1)).toBe(true);
    expect(bomb.fireCells).toContain(17);
  });

  it("keeps the chained cells burning until the animation ends, with bomb8 at frame 2", () => {
    const state = quietRing();
    addBomb(state, 15, { fuseMs: 0 });
    run(state, 1);
    const start = nowMs(state.tick);
    let blastMs = -1;
    runUntil(state, () => {
      if (state.events.some((e) => e.type === "zone-blast")) blastMs = nowMs(state.tick) - start;
      return state.flame[48] === 0;
    });
    expect(state.objects.every((o) => !o.active && o.frame === 0)).toBe(true);
    // Five advances of > 200 ms; bomb8 on the first.
    const burnMs = nowMs(state.tick) - start;
    expect(burnMs).toBeGreaterThan(800);
    expect(burnMs).toBeLessThanOrEqual(1200);
    expect(blastMs).toBeGreaterThan(0);
    expect(blastMs).toBeLessThanOrEqual(240);
  });

  it("kills a player and sets off a bomb on a chained cell", () => {
    const state = quietRing();
    Object.assign(player(state), { x: 140, y: 112 });
    const other = addBomb(state, 47, { fuseMs: 60_000 });
    addBomb(state, 15, { fuseMs: 0 });
    run(state, 3);
    expect(player(state).alive).toBe(false);
    expect(other.exploded).toBe(true);
  });

  it("goes off harmlessly once at every round start, under the countdown", () => {
    const state = createMatch(layoutFromAscii(ring), setups(1), VERSUS, 1);
    const blasts: string[] = [];
    runUntil(state, () => {
      if (state.events.some((e) => e.type === "zone-blast")) blasts.push(state.phase);
      expect(burning(state)).toEqual([]);
      return state.phase === "playing";
    });
    expect(blasts).toEqual(["countdown"]);
    expect(state.objects.every((o) => !o.active)).toBe(true);
  });

  it("holds the ring through the countdown's fade out and starts it on the next frame (0x405e08)", () => {
    const state = createMatch(layoutFromAscii(ring), setups(1), VERSUS, 1);
    runUntil(state, () => state.phase === "countdown");
    const frames = () => state.objects.map((o) => o.frame).join();
    const still = frames();
    // The switch's frame and the next ten darken (0x4130f0); the eleventh after it brightens.
    run(state, FADE_OUT_FRAMES - 1);
    expect(frames()).toBe(still);
    run(state, 1);
    expect(frames()).not.toBe(still);
  });
});

describe("generator (0x417f00)", () => {
  it("rolls the individual-mode table", () => {
    const roll = (...values: number[]) => generatorItem(() => values.shift() as number);
    expect(roll(100)).toBe(null);
    expect(roll(19, 2)).toBe(ItemKind.Speed);
    expect(roll(20, 4)).toBe(null);
    expect(roll(44, 5)).toBe(ItemKind.Tnt);
    expect(roll(45, 2)).toBe(ItemKind.Line);
    expect(roll(60, 1)).toBe(ItemKind.Teleport);
    expect(roll(84, 0)).toBe(ItemKind.Power);
    expect(roll(85, 7)).toBe(ItemKind.Glove);
    expect(roll(99, 5)).toBe(null);
  });

  it("rolls the 화력 table with a single rand() in modes 3-5", () => {
    const roll = (value: number) => {
      const values = [value];
      const kind = generatorItem(() => values.shift() as number, true);
      expect(values).toEqual([]);
      return kind;
    };
    expect([0, 19, 20, 39, 40, 49, 50, 59, 60, 69, 70, 79, 80, 84, 85, 99, 100].map(roll)).toEqual([
      ItemKind.Fire,
      ItemKind.Fire,
      ItemKind.Bomb,
      ItemKind.Bomb,
      ItemKind.Speed,
      ItemKind.Speed,
      ItemKind.Jump,
      ItemKind.Jump,
      ItemKind.Teleport,
      ItemKind.Teleport,
      ItemKind.Burrow,
      ItemKind.Burrow,
      ItemKind.Power,
      ItemKind.Power,
      null,
      null,
      null,
    ]);
  });

  it("uses the 화력 table in a 화력 match", () => {
    // Seed 7: rand() % 200 = 61, teleport in the 화력 table too, but with no second rand().
    const state = playingMatch(["#1g..#"], 1, { ...VERSUS, mode: 4 }, 7);
    const bomb = addBomb(state, 2, { owner: 1, fuseMs: 0 });
    runUntil(state, () => !state.bombs.includes(bomb));
    expect(state.items).toMatchObject([{ cell: 2, kind: ItemKind.Teleport }]);
    const once = { rng: 7 };
    msvcRand(once);
    expect(state.rng).toBe(once.rng);
  });

  it("drops the roll on the cell when its owner's fire there ends", () => {
    // Seed 7: rand() % 200 = 61, then rand() % 3 = 1.
    const state = playingMatch(["#1g..#"], 1, VERSUS, 7);
    const bomb = addBomb(state, 2, { owner: 1, fuseMs: 0 });
    runUntil(state, () => !state.bombs.includes(bomb));
    expect(state.items).toMatchObject([{ cell: 2, kind: ItemKind.Teleport, dropped: false }]);
  });

  it("does not roll for a bomb of nobody in the match or on a cell with an item", () => {
    const state = playingMatch(["#1g..#"], 1, VERSUS, 7);
    const bomb = addBomb(state, 2, { fuseMs: 0 });
    runUntil(state, () => !state.bombs.includes(bomb));
    expect(state.items).toEqual([]);
    expect(state.rng).toBe(7);
  });
});

describe("sudden death on object cells (0x4014c0)", () => {
  it("takes the object and the jump pad off the cell, but not a gate's bits", () => {
    const state = playingMatch(["#vr....", "1......", "......."]);
    state.suddenDeath.placed = 3;
    applySuddenDeath(state);
    expect(state.objects.map((o) => o.cell)).toEqual([-1, -1]);
    expect(objectIndex(state, 1)).toBe(-1);
    expect(tileB(state, 1) & PAD_BITS).toBe(0);
    expect(tileB(state, 2) & WARP_BITS).toBe(0x400);
  });
});
