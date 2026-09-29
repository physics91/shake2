import { describe, expect, it } from "vitest";

import { itemWord, rollBrickItem } from "./items.ts";
import { createMatch } from "./match.ts";
import { layoutFromAscii, setups, VERSUS } from "./testing.ts";
import type { GameMode, ItemWord } from "./types.ts";
import { ItemKind } from "./types.ts";

function scripted(values: number[]): () => number {
  return () => {
    const next = values.shift();
    if (next === undefined) throw new Error("rand() called more often than scripted");
    return next;
  };
}

const fresh = () => ({ switch: true, shake: true, candy: true });

describe("hidden brick roll (0x44e2ed)", () => {
  it.each([
    ["0-39: bomb, fire or speed by a second rand() % 3", [10, 7], ItemKind.Fire],
    ["40-69: glove, jump, teleport, timer or burrow by rand() % 5", [45, 2], ItemKind.Teleport],
    ["40-69, last entry", [69, 4], ItemKind.Burrow],
    ["70-94: nine entries by rand() % 9, missile twice", [80, 6], ItemKind.Missile],
    ["70-94, first entry", [70, 9], ItemKind.Kick],
    ["95-99: question mark with its sub value rand() % 39 in the high byte", [396, 38], itemWord(ItemKind.Mystery, 38)],
    ["111 and above: nothing, with a single rand()", [111], null],
  ])("%s", (_label, rolls, expected) => {
    const rand = scripted(rolls as number[]);
    expect(rollBrickItem(rand, fresh())).toBe(expected);
  });

  it("gives the bomb switch, the shake and the candy once per roll, then their stand-ins", () => {
    const once = fresh();
    const roll = (...values: number[]) => rollBrickItem(scripted(values), once);

    expect(roll(100, 0)).toBe(ItemKind.Switch);
    expect(roll(100, 2)).toBe(ItemKind.Power);
    expect(roll(105, 1)).toBe(ItemKind.Shake);
    expect(roll(105, 3)).toBe(ItemKind.Bomb);
    expect(roll(106)).toBe(ItemKind.Candy);
    expect(roll(110)).toBeNull();
  });
});

describe("hidden brick roll in the 화력 modes 3-5 (0x44e47f-0x44e5fb)", () => {
  /** Rolls one brick, failing unless exactly the scripted rand() calls were made. */
  function rollFire(values: number[], once = fresh()): ItemWord | null {
    const item = rollBrickItem(scripted(values), once, true);
    expect(values).toEqual([]);
    return item;
  }

  it.each([
    ["0-39 as in the other modes", [10, 7], ItemKind.Fire],
    ["40-69: glove becomes nothing", [45, 0], null],
    ["40-69: jump stays", [45, 1], ItemKind.Jump],
    ["40-69: teleport stays", [45, 2], ItemKind.Teleport],
    ["40-69: timer becomes nothing", [45, 3], null],
    ["40-69: burrow stays", [45, 4], ItemKind.Burrow],
    ["70-94: power on entry 1", [80, 1], ItemKind.Power],
    ["70-94: nothing on the other entries", [80, 0], null],
    ["70-94: not even the second missile", [80, 6], null],
    ["95-99: nothing, without the sub roll", [396], null],
    ["100-105: nothing, without the coin", [100], null],
  ])("%s", (_label, rolls, expected) => {
    expect(rollFire([...(rolls as number[])])).toBe(expected);
  });

  it("keeps the one-time candy, and leaves the switch and the shake untouched", () => {
    const once = fresh();
    expect(rollFire([105], once)).toBeNull();
    expect(once).toEqual({ switch: true, shake: true, candy: true });
    expect(rollFire([106], once)).toBe(ItemKind.Candy);
    expect(rollFire([107], once)).toBeNull();
  });

  it("rolls the whole map from the 화력 table in modes 3-5 only", () => {
    const bricks = Array.from({ length: 13 }, () => "B".repeat(15));
    const allowed: number[] = [ItemKind.Bomb, ItemKind.Fire, ItemKind.Speed, ItemKind.Jump, ItemKind.Teleport, ItemKind.Burrow, ItemKind.Power, ItemKind.Candy];
    const kinds = (mode: GameMode) => {
      const state = createMatch(layoutFromAscii(["1" + bricks[0].slice(1), ...bricks.slice(1)]), setups(1), { ...VERSUS, mode }, 3);
      return state.hidden.flatMap((word) => (word === null ? [] : [word & 0xff]));
    };
    for (const mode of [3, 4, 5] as const) expect(kinds(mode).every((kind) => allowed.includes(kind))).toBe(true);
    for (const mode of [0, 6] as const) expect(kinds(mode).some((kind) => !allowed.includes(kind))).toBe(true);
  });
});
