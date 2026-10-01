import { describe, expect, it } from "vitest";

import { blendBlindFilter, blindWindow, blindWindowAt, punchKey, resetBlindCentre } from "./blind.ts";

/** A 200x160 filter: key where `key` holds, else the grey `level`. */
function filter(key: (x: number, y: number) => boolean, level = 0): Uint8ClampedArray {
  const pixels = new Uint8ClampedArray(200 * 160 * 4);
  for (let y = 0; y < 160; y++) {
    for (let x = 0; x < 200; x++) {
      const at = (y * 200 + x) * 4;
      pixels.set(key(x, y) ? [255, 0, 255, 0] : [level, level, level, 255], at);
    }
  }
  return pixels;
}

describe("apple blindness (0x406111, 0x412e20)", () => {
  it("opens a 200x160 window around the player's point", () => {
    expect(blindWindow(400, 300)).toEqual({ left: 300, top: 220, width: 200, height: 160, sx: 0, sy: 0 });
  });

  it("clips the window to the screen, reading the filter's far part when cut on the left or top", () => {
    expect(blindWindow(30, 20)).toEqual({ left: 0, top: 0, width: 130, height: 100, sx: 70, sy: 60 });
    expect(blindWindow(760, 590)).toEqual({ left: 660, top: 510, width: 140, height: 90, sx: 0, sy: 0 });
  });

  it("keeps the brighter of frame and filter per channel and writes the key through", () => {
    const win = { left: 0, top: 0, width: 2, height: 1, sx: 0, sy: 0 };
    const frame = new Uint8ClampedArray([10, 200, 90, 255, 1, 2, 3, 255]);
    blendBlindFilter(frame, filter((x) => x === 1, 100), win);
    expect([...frame]).toEqual([100, 200, 100, 255, 255, 0, 255, 255]);
  });

  it("reads the filter from the window's offset", () => {
    const win = { left: 0, top: 0, width: 1, height: 1, sx: 199, sy: 159 };
    const frame = new Uint8ClampedArray([0, 0, 0, 255]);
    blendBlindFilter(frame, filter((x, y) => x === 199 && y === 159), win);
    expect([...frame]).toEqual([255, 0, 255, 255]);
  });

  it("lets apple.shk through only where the key colour is", () => {
    const frame = new Uint8ClampedArray([255, 0, 255, 255, 255, 0, 254, 255]);
    punchKey(frame);
    expect([frame[3], frame[7]]).toEqual([0, 255]);
  });
});

describe("the window's centre [0x471878] under the F1 help (0x4060c6, 0x408f07)", () => {
  it("stays where the last frame without the help put it, (0,0) in a new program (0x4026d0)", () => {
    resetBlindCentre();
    expect(blindWindowAt(250, 179, true)).toEqual(blindWindow(0, 0));
    expect(blindWindowAt(270, 200, false)).toEqual(blindWindow(270, 200));
    expect(blindWindowAt(170, 200, true)).toEqual(blindWindow(270, 200));
    resetBlindCentre();
    expect(blindWindowAt(170, 200, true)).toEqual(blindWindow(0, 0));
  });
});
