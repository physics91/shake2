import { describe, expect, it } from "vitest";

import type { FrameMeta } from "../assets/types.ts";
import { frameTopLeft, keyedPoint, orHalf } from "./sprite.ts";

const frame = (ax: number, ay: number): FrameMeta => ({ index: 1, anchor: [ax, ay], rect: [0, 0, 50, 80] });

describe("sprite placement (0x462d92, 0x4630fe)", () => {
  it("puts the anchor at the point", () => {
    expect(frameTopLeft(frame(25, 68), 100, 200)).toEqual({ x: 75, y: 132 });
  });

  it("pushes a frame that would start above or left of the screen onto it, whole", () => {
    expect(frameTopLeft(frame(25, 68), 10, 20)).toEqual({ x: 0, y: 0 });
    expect(frameTopLeft(frame(25, 68), 10, 100)).toEqual({ x: 0, y: 32 });
  });
});

describe("keyed sprite draw point (0x462b9d)", () => {
  it("draws a point past x 795 at 780 and caps y at 600, before the anchor", () => {
    expect(keyedPoint(795, 600)).toEqual({ x: 795, y: 600 });
    expect(keyedPoint(796, 601)).toEqual({ x: 780, y: 600 });
  });
});

describe("invisible player blend (0x462d38)", () => {
  const pixel = (r: number, g: number, b: number, a = 255) => new Uint8ClampedArray([r, g, b, a]);

  it("writes ((dst | src) >> 1) per 5-6-5 channel", () => {
    const dst = pixel(0, 0, 0);
    orHalf(dst, pixel(255, 255, 255));
    expect([...dst]).toEqual([123, 125, 123, 255]);

    const both = pixel(255, 255, 255);
    orHalf(both, pixel(255, 255, 255));
    expect([...both]).toEqual([123, 125, 123, 255]);

    const mixed = pixel(0b10000000, 0b01000000, 0b00001000);
    orHalf(mixed, pixel(0b01000000, 0b00000100, 0b00010000));
    // r5 16|8 = 24 → 12, g6 16|1 = 17 → 8, b5 1|2 = 3 → 1
    expect([...mixed]).toEqual([(12 << 3) | (12 >> 2), (8 << 2) | (8 >> 4), (1 << 3) | (1 >> 2), 255]);
  });

  it("leaves the colour-keyed (transparent) pixels alone", () => {
    const dst = pixel(10, 20, 30);
    orHalf(dst, pixel(255, 255, 255, 0));
    expect([...dst]).toEqual([10, 20, 30, 255]);
  });
});
