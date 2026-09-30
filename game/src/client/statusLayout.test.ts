import { describe, expect, it } from "vitest";

import {
  clampKnob,
  dragKnob,
  faceCell,
  guildEntries,
  guildIcon,
  newGuildScroll,
  scrollDown,
  scrollUp,
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
  it("reads guild.dat's lines, the first without an icon", () => {
    expect(guildEntries("없음\r\nTSL\r\nswing")).toEqual([
      { id: -1, name: "없음" },
      { id: 0, name: "TSL" },
      { id: 1, name: "swing" },
    ]);
    expect(guildEntries("없음\r\nTSL\r\n")).toHaveLength(2);
    expect(guildEntries("없음\r\n\r\nTSL")[1]).toEqual({ id: 0, name: "" });
  });

  it("finds an icon by its number in rows of 15", () => {
    expect(guildIcon(-1, 225)).toBeNull();
    expect(guildIcon(0, 225)).toEqual([0, 0, 15, 13]);
    expect(guildIcon(16, 225)).toEqual([15, 13, 30, 26]);
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
