import { describe, expect, it } from "vitest";

import { cp949Bytes } from "../server/cp949.ts";
import { emptyInventory } from "../sim/pickup.ts";
import {
  FINAL_ROW,
  RESULT_ROW,
  STATUS_TEXT,
  teambarRect,
  teamColor,
  bombColor,
  candyCountX,
  characterIndex,
  countdownBlit,
  finalRowTop,
  countBlits,
  itemGrid,
  panelTop,
  portraitRect,
  resultRowBase,
  roundDigitBlits,
  timerGlyphs,
} from "./hudLayout.ts";

describe("in-game HUD", () => {
  it("draws 2:30 as minutes ones, colon and two second digits, never a minutes tens digit", () => {
    expect(timerGlyphs(150)).toEqual([
      { digit: 2, x: 331, y: 14 },
      { digit: null, x: 345, y: 16 },
      { digit: 3, x: 352, y: 14 },
      { digit: 0, x: 365, y: 14 },
    ]);
    expect(timerGlyphs(69).map((g) => g.digit)).toEqual([1, null, 0, 9]);
  });

  it("stacks the right panel 63 px per room slot from y 44", () => {
    expect([0, 1, 5].map(panelTop)).toEqual([44, 107, 359]);
  });

  it("shows bombs and fire in the first column and speed minus 4 in the second", () => {
    expect(itemGrid({ bombCapacity: 1, firePower: 2, speed: 5, inv: emptyInventory() })).toEqual([
      { icon: 0, count: 1, x: 690, y: 432 },
      { icon: 3, count: 2, x: 690, y: 462 },
      { icon: 1, count: 1, x: 726, y: 432 },
    ]);
  });

  it("puts the special items in their slots, the first held of each group", () => {
    const inv = { ...emptyInventory(), power: 2, teleport: 1, burrow: true, line: true, nuke: 3, timer: 3, double: 1, kick: true };
    expect(itemGrid({ bombCapacity: 3, firePower: 2, speed: 5, inv }).map(({ icon, count, x, y }) => [icon, count, x, y])).toEqual([
      [0, 3, 690, 432],
      [5, 2, 690, 462],
      [8, 1, 690, 492],
      [4, 1, 690, 522],
      [1, 1, 726, 432],
      [0xc, 1, 726, 462],
      [0x12, 1, 726, 492],
      [6, 1, 762, 432],
    ]);
  });

  it("shows practice's mine, pumpkin and water family, which the network grid leaves out (0x4086a0-0x408761)", () => {
    const inv = { ...emptyInventory(), mine: 2, pumpkin: 1, poop: 2, apple: 2 };
    const player = { bombCapacity: 2, firePower: 2, speed: 5, inv };
    expect(itemGrid(player, true).slice(3).map(({ icon, count, x, y }) => [icon, count, x, y])).toEqual([
      [0x10, 2, 726, 462],
      [0x11, 1, 726, 492],
      [0x1a, 2, 726, 522],
    ]);
    expect(itemGrid(player)).toHaveLength(3);
  });

  it("right-aligns the candy count: 1 to 4 digits start at x 753, 745, 737, 729", () => {
    expect([1, 2, 3, 4].map(candyCountX)).toEqual([753, 745, 737, 729]);
  });

  it("draws no count at 0 or below, ∞ for the power bomb and the units of a two-digit count", () => {
    const cell = (icon: number, count: number) => ({ icon, count, x: 0, y: 0 });
    expect(countBlits(cell(1, -2))).toEqual([]);
    expect(countBlits(cell(5, 3))).toEqual([{ src: [35, 13, 45, 17], x: 19, y: 17 }]);
    expect(countBlits(cell(3, 7))).toEqual([{ src: [70, 2, 75, 12], x: 24, y: 11 }]);
    expect(countBlits(cell(3, 10)).at(-1)).toEqual({ src: [35, 2, 40, 12], x: 24, y: 11 });
  });

  it("counts down with the sd digits and then START", () => {
    expect(countdownBlit(3)).toEqual({ src: [112, 1, 168, 68], x: 320, y: 254 });
    expect(countdownBlit(1)).toEqual({ src: [0, 1, 56, 68], x: 320, y: 254 });
    expect(countdownBlit(0)).toEqual({ src: [2, 69, 242, 139], x: 234, y: 254 });
  });
});

describe("characters", () => {
  it("indexes portraits in shake.exe's order, 15 to a row, with w-doomy as doomy", () => {
    expect(characterIndex("rookie")).toBe(0);
    expect(characterIndex("w-doomy")).toBe(characterIndex("doomy"));
    expect(portraitRect("milky")).toEqual([644, 279, 690, 319]);
    expect(portraitRect("shaky")).toEqual([0, 320, 46, 360]);
  });

  it("gives each character its bomb colour", () => {
    expect(["rookie", "tofi", "imp", "doona", "bobo", "red", "w-doomy"].map(bombColor)).toEqual([
      "beige",
      "blue",
      "green",
      "yellow",
      "pink",
      "red",
      "blue",
    ]);
  });
});

describe("result screens", () => {
  it("places rows 67 px apart", () => {
    expect([0, 5].map(resultRowBase)).toEqual([157, 492]);
    expect([0, 5].map(finalRowTop)).toEqual([147, 482]);
  });

  it("draws the round number with 26 px glyphs, shifted left for two digits", () => {
    expect(roundDigitBlits(2)).toEqual([{ src: [52, 91, 78, 126], x: 167, y: 23 }]);
    expect(roundDigitBlits(10).map((b) => b.x)).toEqual([157, 183]);
  });
});

describe("team colours and bars", () => {
  it("reads the COLORREF table 0x48be40 (0x00BBGGRR) for teams 1..6, black for none", () => {
    expect([0, 1, 2, 3, 4, 5, 6].map(teamColor)).toEqual([
      "#000000",
      "#bf85ff",
      "#9cc3fd",
      "#62ef7f",
      "#ff91cf",
      "#ff003c",
      "#fee220",
    ]);
  });

  it("cuts new_teambar row team-1 at pitch 22 (0x442580)", () => {
    expect(teambarRect(1)).toEqual([1, 1, 138, 22]);
    expect(teambarRect(6)).toEqual([1, 111, 138, 132]);
  });

  it("puts the bar at (314, base-4) on the round and wait rows and (278, y-1) on the final rows", () => {
    expect(RESULT_ROW.teambar).toEqual({ x: 314, dy: -4 });
    expect(FINAL_ROW.teambar).toEqual({ x: 278, dy: -1 });
  });

  it("keeps the status strings byte for byte (0x46af48, 0x46af3c, 0x46af54)", () => {
    expect(STATUS_TEXT).toEqual({ host: "방       장", waiting: "준 비 중 ..", ready: "준 비 완 료   " });
    expect([STATUS_TEXT.host, STATUS_TEXT.waiting, STATUS_TEXT.ready].map(cp949Bytes)).toEqual([11, 11, 14]);
    // The wait screen stamps its status where the round result left its own (0x4100e0, 0x40fd50).
    expect(RESULT_ROW.status).toEqual({ x: 339, dy: 21 });
  });
});
