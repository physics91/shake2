import { describe, expect, it } from "vitest";

import {
  ACCOUNT_ROWS,
  clampKnob,
  dragKnob,
  faceCell,
  guildOfRow,
  guildRowAt,
  levelTitleAt,
  newGuildScroll,
  padNumber,
  scrollDown,
  scrollUp,
  showGuildRow,
  STATUS_BUTTONS,
  hueBox,
  hueFromKnob,
  stepStatusCharacter,
} from "./statusLayout.ts";

describe("scene 5 layout", () => {
  it("hover art is the size of each bottom button", () => {
    for (const { hit, hover } of Object.values(STATUS_BUTTONS)) {
      expect(hover[2] - hover[0]).toBe(hit[2] - hit[0]);
      expect(hover[3] - hover[1]).toBe(hit[3] - hit[1]);
    }
  });

  it("takes faces 0–9 from Wg_char's top row and 10–19 from the next", () => {
    expect(faceCell(0)).toEqual([0, 0, 70, 70]);
    expect(faceCell(9)).toEqual([630, 0, 700, 70]);
    expect(faceCell(10)).toEqual([0, 70, 70, 140]);
    expect(faceCell(17)).toEqual([490, 70, 560, 140]);
  });

  it("wraps ▲ from 0 to 17 and ▼ from 17 to 0", () => {
    expect(stepStatusCharacter(0, -1)).toBe(17);
    expect(stepStatusCharacter(17, 1)).toBe(0);
    expect(stepStatusCharacter(5, 1)).toBe(6);
    // A saved 한복두나 (18) steps on to 19 as 0311 does, then back to 0.
    expect(stepStatusCharacter(18, 1)).toBe(19);
    expect(stepStatusCharacter(19, 1)).toBe(0);
    expect(stepStatusCharacter(18, -1)).toBe(17);
  });
});

describe("the hue box (0x41d7c0, 0x458e22)", () => {
  it("moves down a pixel each 10 of hue, as C divides", () => {
    expect(hueBox(0)).toEqual({ fill: [489, 153, 35, 13], hit: [489, 153, 524, 166], text: { x: 505, y: 152 } });
    expect(hueBox(-15).fill[1]).toBe(152);
    expect(hueBox(-9).fill[1]).toBe(153);
    expect(hueBox(180).hit).toEqual([489, 171, 524, 184]);
  });

  it("takes the held knob's hue from the mouse's y, ten a pixel, clamped", () => {
    expect(hueFromKnob(159)).toBe(0);
    expect(hueFromKnob(160)).toBe(10);
    expect(hueFromKnob(150)).toBe(-90);
    expect(hueFromKnob(300)).toBe(180);
    expect(hueFromKnob(0)).toBe(-180);
  });
});

describe("guild list", () => {
  it("stands a row for guild.dat's line, the mark by the name, and 없음 for leaving (R)", () => {
    expect(guildOfRow(0)).toBe(-1);
    expect(guildOfRow(1)).toBe(1);
    expect(guildOfRow(264)).toBe(264);
  });

  it("picks the row under a click among the ten shown, below the count", () => {
    expect(guildRowAt(140, 274, 0, 265)).toBe(0);
    expect(guildRowAt(140, 290, 0, 265)).toBe(0);
    expect(guildRowAt(140, 291, 0, 265)).toBe(1);
    expect(guildRowAt(299, 440, 20, 265)).toBe(29);
    // The box's last pixels would be an eleventh row, which is not drawn.
    expect(guildRowAt(140, 444, 0, 265)).toBeNull();
    expect(guildRowAt(134, 300, 0, 265)).toBeNull();
    expect(guildRowAt(140, 300, 259, 265)).toBe(260);
    expect(guildRowAt(140, 400, 259, 265)).toBeNull();
  });

  it("brings a row stepped to from the keyboard into view with a knob that gives the same top again", () => {
    const scroll = newGuildScroll();
    clampKnob(scroll);
    showGuildRow(scroll, 5, 265);
    expect(scroll).toMatchObject({ top: 0, knob: 303 });
    // A pixel of the knob is 260 / 115 rows: the first top past 0 is 2.
    showGuildRow(scroll, 10, 265);
    expect(scroll).toMatchObject({ top: 2, knob: 304 });
    for (const row of [40, 264, 100, 3, 0]) {
      showGuildRow(scroll, row, 265);
      expect(row).toBeGreaterThanOrEqual(scroll.top);
      expect(row).toBeLessThanOrEqual(scroll.top + 9);
      expect(scroll.knob).toBeGreaterThanOrEqual(303);
      expect(scroll.knob).toBeLessThanOrEqual(418);
      // The wheel's next notch reads the top from the knob: it must be the one shown.
      const next = { ...scroll };
      scrollDown(next, 265, 5);
      expect(next.top).toBe(scroll.top);
    }
    const short = newGuildScroll();
    showGuildRow(short, 8, 9);
    expect(short).toMatchObject({ top: 0 });
  });

  it("right-aligns the numbers as Shake1's %15d and %12d do, all ending at x 506", () => {
    expect(padNumber(42, 15)).toBe(`${" ".repeat(13)}42`);
    expect(padNumber(0, 12)).toHaveLength(12);
    for (const row of [ACCOUNT_ROWS.rank, ACCOUNT_ROWS.cell, ACCOUNT_ROWS.wins]) expect(row.x + 7 * row.width).toBe(506);
  });

  it("puts the level's title at 508 − 7·strlen and its badge 18 px before it", () => {
    expect(levelTitleAt("쉐이크 마스터")).toEqual({ title: { x: 417, y: 299 }, badge: { x: 399, y: 299 } });
    expect(levelTitleAt("루 키 ")).toEqual({ title: { x: 466, y: 299 }, badge: { x: 448, y: 299 } });
  });

  it("scrolls from the knob's last place, 2 px a held frame", () => {
    const scroll = newGuildScroll();
    expect(clampKnob(scroll)).toBe(303);
    scrollDown(scroll, 265, 2);
    // The first step moves the knob only: its old place was the top.
    expect(scroll).toMatchObject({ top: 0, knob: 305 });
    scrollDown(scroll, 265, 2);
    // (305 − 303) / 115 of 260 rows, times 100.0f · 0.01f: 4.52 → 4.
    expect(scroll).toMatchObject({ top: 4, knob: 307 });
    scrollUp(scroll, 265, 2);
    expect(scroll).toMatchObject({ top: 9, knob: 305 });
  });

  it("stops at the bottom one row short of count − 5, as 0.01f makes the ratio a hair under 1", () => {
    const scroll = newGuildScroll();
    scroll.knob = 418;
    scrollDown(scroll, 265, 2);
    expect(scroll.top).toBe(259);
    expect(clampKnob(scroll)).toBe(418);
    // The wheel does not go past 418.
    scroll.knob = 419;
    scrollDown(scroll, 265, 5);
    expect(scroll.knob).toBe(419);
  });

  it("drags with the mouse above y 419 and resets at or above 303", () => {
    const scroll = newGuildScroll();
    scroll.knob = 303;
    dragKnob(scroll, 265, 360);
    expect(scroll).toMatchObject({ top: 0, knob: 360 });
    dragKnob(scroll, 265, 419);
    expect(scroll.knob).toBe(360);
    dragKnob(scroll, 265, 300);
    expect(scroll).toMatchObject({ top: 0, knob: 303 });
  });

  it("keeps a short list at the top", () => {
    const scroll = newGuildScroll();
    scroll.knob = 350;
    scrollDown(scroll, 9, 2);
    expect(scroll).toMatchObject({ top: 0, knob: 303 });
  });
});
