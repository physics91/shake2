// The bombs only practice.MAP hands out: 지뢰탄, 호박탄 and the 물/똥/사과/팬더 family.
import { describe, expect, it } from "vitest";

import { FUSE_MS, nowMs } from "./constants.ts";
import { applyPickup } from "./pickup.ts";
import { CURSE_MS } from "./status.ts";
import { addBomb, cellAt, playingMatch, PRACTICE, run, runUntil } from "./testing.ts";
import type { InputFrame, MatchState, PlayerState } from "./types.ts";
import { Anim, BombKind, Dir, ItemKind } from "./types.ts";

const SPACE: InputFrame = { dir: null, bomb: true };
const CTRL: InputFrame = { dir: null, bomb: false, attack: true };

function face(player: PlayerState, dir: Dir): void {
  player.dir = dir;
  player.anim = Anim.Stand + dir;
}

function removePlayers(state: MatchState): void {
  for (const p of state.players) {
    p.alive = false;
    p.gone = true;
  }
}

describe("practice bomb pickups (0x4514c0-0x451597)", () => {
  it("stocks mines up to the bomb count, and mines and the other special bombs clear each other", () => {
    const state = playingMatch(["1...."], 1, PRACTICE);
    const p = state.players[0];
    p.bombCapacity = 3;
    p.inv.timer = 2;
    applyPickup(state, p, ItemKind.Mine);
    expect(p.inv).toMatchObject({ mine: 3, timer: 0 });
    applyPickup(state, p, ItemKind.Tnt);
    expect(p.inv).toMatchObject({ mine: 0, tnt: 1 });
  });

  it("stocks one pumpkin at a time, and pumpkin and double clear each other", () => {
    const state = playingMatch(["1...."], 1, PRACTICE);
    const p = state.players[0];
    p.bombCapacity = 1;
    applyPickup(state, p, ItemKind.Double);
    applyPickup(state, p, ItemKind.Pumpkin);
    applyPickup(state, p, ItemKind.Pumpkin);
    expect(p.inv).toMatchObject({ double: 0, pumpkin: 1 });
    applyPickup(state, p, ItemKind.Double);
    expect(p.inv).toMatchObject({ double: 1, pumpkin: 0 });
  });

  it("fills one of water, poop, apple or panda to the bomb count and empties the other three", () => {
    const state = playingMatch(["1...."], 1, PRACTICE);
    const p = state.players[0];
    p.bombCapacity = 2;
    applyPickup(state, p, ItemKind.Poop);
    expect(p.inv).toMatchObject({ water: 0, poop: 2, apple: 0, panda: 0 });
    applyPickup(state, p, ItemKind.Panda);
    expect(p.inv).toMatchObject({ poop: 0, panda: 2 });
    p.inv.missile = 1;
    applyPickup(state, p, ItemKind.Apple);
    expect(p.inv).toMatchObject({ panda: 0, apple: 2, missile: 1 });
  });
});

describe("practice bomb placement (0x457ed0)", () => {
  it("lays a mine of power 1 from one charge, which never goes off by its fuse", () => {
    const state = playingMatch(["1......"], 1, PRACTICE);
    const p = state.players[0];
    p.inv.mine = 2;
    run(state, 1, { 1: SPACE });
    expect(state.bombs[0]).toMatchObject({ kind: BombKind.Mine, anim: 8, power: 1 });
    expect(p.inv.mine).toBe(1);
    run(state, Math.ceil((FUSE_MS * 3 * 30) / 1000));
    expect(state.bombs[0].exploded).toBe(false);
  });

  it("puts the water family before a held nuke, and a pumpkin before both", () => {
    const state = playingMatch(["1......"], 1, PRACTICE);
    const p = state.players[0];
    p.inv.nuke = 1;
    p.inv.pumpkin = 1;
    p.inv.water = 1;
    p.inv.apple = 1;
    run(state, 1, { 1: SPACE });
    expect(state.bombs[0]).toMatchObject({ kind: BombKind.Water, anim: 12, pumpkin: true, power: p.firePower });
    expect(p.inv).toMatchObject({ nuke: 1, pumpkin: 0, water: 0, apple: 1 });
  });

  it("gives a mine in a line of bombs the rolling-mine animation, which becomes the plain mine once it stops", () => {
    const state = playingMatch(["1......"], 1, PRACTICE);
    const p = state.players[0];
    p.bombCapacity = 3;
    p.inv.line = true;
    p.inv.mine = 3;
    face(p, Dir.Right);
    addBomb(state, cellAt(state, 0, 0), { owner: p.id, placedMs: Infinity });
    run(state, 1, { 1: SPACE });
    const mines = state.bombs.filter((b) => b.kind === BombKind.Mine);
    expect(mines.map((b) => b.anim)).toEqual([9, 9]);
  });
});

describe("mines go off when the local player steps toward them (0x4506f9)", () => {
  it("sets off a mine in the cell the player tries to enter, its own owner included", () => {
    const state = playingMatch(["1.#"], 1, PRACTICE);
    const p = state.players[0];
    const mine = addBomb(state, cellAt(state, 1, 0), { owner: p.id, kind: BombKind.Mine, anim: 8 });
    run(state, 1, { 1: { dir: Dir.Right, bomb: false } });
    expect(mine.triggered).toBe(false); // the centre is still in its own cell
    runUntil(state, () => mine.triggered, 10, { 1: { dir: Dir.Right, bomb: false } });
    run(state, 1);
    expect(mine.exploded).toBe(true);
  });

  it("is left alone by a dummy standing next to it", () => {
    const state = playingMatch(["1.2"], 2, PRACTICE);
    state.players[0].dummy = true;
    const mine = addBomb(state, cellAt(state, 1, 0), { owner: 2, kind: BombKind.Mine, anim: 8 });
    run(state, 10, { 1: { dir: Dir.Right, bomb: false } });
    expect(mine.triggered).toBe(false);
  });

  it("is not set off by Left Ctrl, which detonates the player's timer and water-family bombs", () => {
    const state = playingMatch(["1......"], 1, PRACTICE);
    const p = state.players[0];
    const mine = addBomb(state, cellAt(state, 3, 0), { owner: p.id, kind: BombKind.Mine, anim: 8 });
    const poop = addBomb(state, cellAt(state, 5, 0), { owner: p.id, kind: BombKind.Poop, anim: 14 });
    const others = addBomb(state, cellAt(state, 6, 0), { owner: 99, kind: BombKind.Poop, anim: 14 });
    run(state, 1, { 1: CTRL });
    expect([mine.triggered, poop.triggered, others.triggered]).toEqual([false, true, false]);
  });

  it("detonates instead of firing a missile while a water-family charge is held (0x45c2cf)", () => {
    const state = playingMatch(["1......"], 1, PRACTICE);
    const p = state.players[0];
    p.inv.missile = 1;
    p.inv.panda = 1;
    run(state, 1, { 1: CTRL });
    expect(state.bombs).toEqual([]);
    expect(p.inv.missile).toBe(1);
  });
});

describe("water-family flames (0x40da60, 0x407d0b)", () => {
  function burnWith(kind: BombKind): { state: MatchState; p: PlayerState } {
    const state = playingMatch(["1.2"], 2, PRACTICE);
    const p = state.players[0];
    addBomb(state, cellAt(state, 1, 0), { kind, anim: kind, placedMs: -FUSE_MS });
    run(state, 2);
    return { state, p };
  }

  it("writes the family's flame kind, draws the special fire and hurts nobody", () => {
    const { state, p } = burnWith(BombKind.Poop);
    expect(state.flame.slice(0, 3)).toEqual([3, 3, 3]);
    expect(state.bombSprites).toContainEqual(expect.objectContaining({ type: "fire", anim: 1 }));
    expect(p.alive).toBe(true);
    expect(state.players[1].alive).toBe(true);
  });

  it("resets a player's items in water flame", () => {
    const state = playingMatch(["1.2"], 2, PRACTICE);
    const p = state.players[0];
    p.bombCapacity = 4;
    p.inv.kick = true;
    addBomb(state, cellAt(state, 1, 0), { kind: BombKind.Water, anim: 12, placedMs: -FUSE_MS });
    run(state, 2);
    expect(p.bombCapacity).toBe(1);
    expect(p.inv.kick).toBe(false);
  });

  it("slows, blinds or reverses every update the player stands in it, dummies too", () => {
    for (const [kind, status] of [
      [BombKind.Poop, "slow"],
      [BombKind.Apple, "blind"],
      [BombKind.Panda, "reverse"],
    ] as const) {
      const { state, p } = burnWith(kind);
      state.players[1].dummy = true;
      run(state, 1);
      expect(p.status[status]).toBe(nowMs(state.tick));
      expect(state.players[1].status[status]).toBe(nowMs(state.tick));
    }
  });

  it("keeps the player blind for 10 s after the last flame update", () => {
    const { state, p } = burnWith(BombKind.Apple);
    runUntil(state, () => state.bombs.length === 0);
    const last = p.status.blind ?? 0;
    runUntil(state, () => p.status.blind === null);
    expect(nowMs(state.tick) - last).toBeGreaterThan(CURSE_MS);
    expect(nowMs(state.tick) - last).toBeLessThan(CURSE_MS + 40);
  });

  it("chains other bombs like any fire", () => {
    const state = playingMatch(["1....."], 1, PRACTICE);
    removePlayers(state);
    addBomb(state, cellAt(state, 1, 0), { kind: BombKind.Panda, anim: 18, placedMs: -FUSE_MS });
    const next = addBomb(state, cellAt(state, 2, 0));
    run(state, 2);
    expect(next.triggered).toBe(true);
  });
});

describe("pumpkin fire (0x406fe2)", () => {
  it("keeps burning the same cells for 2.5 s after the blast, then one more cycle", () => {
    const state = playingMatch(["1....."], 1, PRACTICE);
    removePlayers(state);
    const bomb = addBomb(state, cellAt(state, 3, 0), { pumpkin: true, placedMs: -FUSE_MS });
    run(state, 1);
    const blast = nowMs(state.tick);
    runUntil(state, () => !state.bombs.includes(bomb));
    const lasted = nowMs(state.tick) - blast;
    // A cycle is 7 advances of more than 66 ms at 30 Hz: 7 x 100 ms.
    expect(lasted).toBeGreaterThan(2500);
    expect(lasted).toBeLessThanOrEqual(2500 + 2 * 700 + 100);
    expect(bomb.pumpkin).toBe(false);
  });
});
