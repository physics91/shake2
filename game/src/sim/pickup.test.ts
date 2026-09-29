import { describe, expect, it } from "vitest";

import { MAX_BOMBS, START_BOMBS, START_FIRE, START_SPEED } from "./constants.ts";
import { emptyInventory } from "./pickup.ts";
import { applyPickup } from "./pickup.ts";
import { playingMatch } from "./testing.ts";
import type { PlayerState } from "./types.ts";
import { ItemKind } from "./types.ts";

function player(bombs = 3): { state: ReturnType<typeof playingMatch>; p: PlayerState } {
  const state = playingMatch(["1...."]);
  const p = state.players[0];
  p.bombCapacity = bombs;
  return { state, p };
}

describe("pickup (0x451100, table 0x451618)", () => {
  it("raises bombs, fire and speed up to their caps", () => {
    const { state, p } = player(MAX_BOMBS);
    applyPickup(state, p, ItemKind.Bomb);
    applyPickup(state, p, ItemKind.Fire);
    applyPickup(state, p, ItemKind.Speed);
    expect([p.bombCapacity, p.firePower, p.speed]).toEqual([MAX_BOMBS, START_FIRE + 1, START_SPEED + 1]);
  });

  it("keeps one special bomb kind: nuke, missile, timer, X and TNT replace each other", () => {
    const { state, p } = player(3);
    applyPickup(state, p, ItemKind.Timer);
    expect(p.inv.timer).toBe(3);
    applyPickup(state, p, ItemKind.Nuke);
    applyPickup(state, p, ItemKind.Nuke);
    expect(p.inv).toMatchObject({ timer: 0, nuke: 2 });
    applyPickup(state, p, ItemKind.Tnt);
    applyPickup(state, p, ItemKind.Tnt);
    applyPickup(state, p, ItemKind.Tnt);
    applyPickup(state, p, ItemKind.Tnt);
    expect(p.inv).toMatchObject({ nuke: 0, tnt: 3 });
    applyPickup(state, p, ItemKind.XBomb);
    expect(p.inv).toMatchObject({ tnt: 0, xbomb: 3 });
    applyPickup(state, p, ItemKind.Missile);
    applyPickup(state, p, ItemKind.Missile);
    expect(p.inv).toMatchObject({ xbomb: 0, missile: 1 });
  });

  it("caps nukes at three and fills power bombs up to the bomb count, apart from the group", () => {
    const { state, p } = player(2);
    for (let i = 0; i < 4; i++) applyPickup(state, p, ItemKind.Nuke);
    applyPickup(state, p, ItemKind.Power);
    expect(p.inv).toMatchObject({ nuke: 3, power: 2 });
  });

  it("swaps glove and line bomb, and keeps one of jump, teleport and burrow", () => {
    const { state, p } = player();
    applyPickup(state, p, ItemKind.Glove);
    applyPickup(state, p, ItemKind.Line);
    expect(p.inv).toMatchObject({ glove: false, line: true });
    applyPickup(state, p, ItemKind.Glove);
    expect(p.inv).toMatchObject({ glove: true, line: false });

    applyPickup(state, p, ItemKind.Burrow);
    applyPickup(state, p, ItemKind.Jump);
    expect(p.inv).toMatchObject({ burrow: false, jump: 1 });
    applyPickup(state, p, ItemKind.Teleport);
    expect(p.inv).toMatchObject({ jump: 0, teleport: 1 });
    applyPickup(state, p, ItemKind.Kick);
    applyPickup(state, p, ItemKind.Double);
    expect(p.inv).toMatchObject({ teleport: 1, kick: true, double: 1 });
  });

  it("counts candy", () => {
    const { state, p } = player();
    applyPickup(state, p, ItemKind.Candy);
    expect(p.candy).toBe(1);
  });
});

describe("question mark subs (0x451a50)", () => {
  it("gives a jump without dropping a burrow, unlike the jump item", () => {
    const { state, p } = player();
    applyPickup(state, p, ItemKind.Burrow);
    applyPickup(state, p, ItemKind.Mystery, 5);
    expect(p.inv).toMatchObject({ burrow: true, jump: 1 });
  });

  it("takes power bombs (31) and the missile (32) away", () => {
    const { state, p } = player();
    applyPickup(state, p, ItemKind.Power);
    applyPickup(state, p, ItemKind.Missile);
    applyPickup(state, p, ItemKind.Mystery, 31);
    applyPickup(state, p, ItemKind.Mystery, 32);
    expect(p.inv).toMatchObject({ power: 0, missile: 0 });
  });

  it("resets stats and every special item on 34", () => {
    const { state, p } = player(5);
    p.firePower = 6;
    p.speed = 8;
    applyPickup(state, p, ItemKind.Kick);
    applyPickup(state, p, ItemKind.Timer);
    applyPickup(state, p, ItemKind.Mystery, 34);
    expect([p.bombCapacity, p.firePower, p.speed]).toEqual([START_BOMBS, START_FIRE, START_SPEED]);
    expect(p.inv).toEqual(emptyInventory());
  });

  it.each([
    [0, "bombCapacity", 4],
    [26, "bombCapacity", 4],
    [22, "firePower", START_FIRE + 1],
    [2, "speed", START_SPEED + 1],
  ] as const)("sub %i raises %s", (sub, field, value) => {
    const { state, p } = player(3);
    applyPickup(state, p, ItemKind.Mystery, sub);
    expect(p[field]).toBe(value);
  });

  it.each([11, 13, 16, 18, 19, 24, 25, 27])("sub %i does nothing", (sub) => {
    const { state, p } = player(3);
    const before = structuredClone(p);
    applyPickup(state, p, ItemKind.Mystery, sub);
    expect(p).toEqual(before);
  });
});
