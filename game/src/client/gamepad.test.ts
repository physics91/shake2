import { describe, expect, it } from "vitest";

import { Dir } from "../sim/types.ts";
import { axisValue, firstPad, padFrame } from "./gamepad.ts";

const pad = (axes: number[], pressed: number[] = []) => ({
  axes,
  buttons: Array.from({ length: 4 }, (_, i) => ({ pressed: pressed.includes(i) })),
});

describe("joystick (0x402520)", () => {
  it("reports 0 in the 10 % dead zone and scales the rest over -10..10", () => {
    expect(axisValue(0.05)).toBe(0);
    expect(axisValue(1)).toBe(10);
    expect(axisValue(-1)).toBe(-10);
    expect(axisValue(0.55)).toBeCloseTo(5);
  });

  it("takes a direction past half way, up before down before left before right", () => {
    expect(padFrame(pad([0, -1])).dir).toBe(Dir.Up);
    expect(padFrame(pad([0, 1])).dir).toBe(Dir.Down);
    expect(padFrame(pad([-1, 0])).dir).toBe(Dir.Left);
    expect(padFrame(pad([1, 0])).dir).toBe(Dir.Right);
    expect(padFrame(pad([1, -1])).dir).toBe(Dir.Up);
    expect(padFrame(pad([0.5, 0.5])).dir).toBeNull();
  });

  it("reads button 0 as bombs, 2 as attack items and 1 as evasion items", () => {
    expect(padFrame(pad([0, 0], [0]))).toMatchObject({ bomb: true, attack: false, evade: false });
    expect(padFrame(pad([0, 0], [2]))).toMatchObject({ bomb: false, attack: true, evade: false });
    expect(padFrame(pad([0, 0], [1, 3]))).toMatchObject({ bomb: false, attack: false, evade: true });
  });

  it("uses the first connected pad", () => {
    const second = pad([0, 0]);
    expect(firstPad([null, second])).toBe(second);
    expect(firstPad([null, null])).toBeNull();
  });
});
