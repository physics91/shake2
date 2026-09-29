import { describe, expect, it } from "vitest";

import { blend565, isShown16, same16, shown5, shown6, shownRgb } from "./color16.ts";
import { HELP_BOX } from "./roomLayout.ts";
import { LOADING_BAR } from "./startLayout.ts";

const rgba = (...pixels: [number, number, number, number][]) => new Uint8ClampedArray(pixels.flat());

describe("the 16-bit screen (0x414ed0, 0x413620)", () => {
  it("cuts each channel to 5-6-5 without rounding and shows it widened", () => {
    expect(shown5(7)).toBe(0);
    expect(shown5(8)).toBe(8);
    expect(shown5(155)).toBe(156);
    expect(shown6(3)).toBe(0);
    expect(shown6(155)).toBe(154);
    expect(shown5(255)).toBe(255);
    expect(shownRgb("#ffff9b")).toEqual([255, 255, 156]);
    expect(isShown16(255, 255, 156)).toBe(true);
    expect(isShown16(255, 255, 155)).toBe(false);
  });

  it("blends each field as (dst·w + src·(256 − w)) >> 8 and skips keyed source pixels", () => {
    // A shadow (w 100, black) over white: 31·100 >> 8 = 12, 63·100 >> 8 = 24.
    const white = rgba([255, 255, 255, 255], [255, 255, 255, 255]);
    blend565(white, rgba([0, 0, 0, 255], [0, 0, 0, 0]), 100);
    expect([...white]).toEqual([99, 97, 99, 255, 255, 255, 255, 255]);
    // The candy box (w 70): 10·70 + 20·186 = 4420 >> 8 = 17 on red.
    const under = rgba([80, 0, 0, 255]);
    blend565(under, rgba([160, 0, 0, 255]), 70);
    expect(under[0]).toBe(shown5(17 << 3));
  });

  it("cuts what lies under before blending, as the screen already held it so", () => {
    const loose = rgba([7, 3, 7, 255]);
    blend565(loose, rgba([0, 0, 0, 255]), 255);
    expect([...loose]).toEqual([0, 0, 0, 255]);
  });

  it("compares colours by their 16-bit value", () => {
    expect(same16("#000000", "#070300")).toBe(true);
    expect(same16("#000000", "#080000")).toBe(false);
  });

  it("has fills that are already 16-bit values", () => {
    for (const colour of [HELP_BOX.fill, LOADING_BAR.colour]) {
      expect(isShown16(...shownRgb(colour))).toBe(true);
      expect(shownRgb(colour)).toEqual(
        colour
          .slice(1)
          .match(/../g)!
          .map((h) => Number.parseInt(h, 16)),
      );
    }
  });
});
