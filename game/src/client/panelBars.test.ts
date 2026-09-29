import { describe, expect, it } from "vitest";

import { FPS_WINDOW_MS, FrameRate, fpsBlocks, PING_INTERVAL_MS, PingMeter, pingBlocks } from "./panelBars.ts";

describe("bar A (0x4432e0)", () => {
  it("draws one block per 5 frames up to 30, yellow from 3 blocks and red below", () => {
    expect(fpsBlocks(30)).toEqual({ count: 6, yellow: true });
    expect(fpsBlocks(45)).toEqual({ count: 6, yellow: true });
    expect(fpsBlocks(26)).toEqual({ count: 6, yellow: true });
    expect(fpsBlocks(25)).toEqual({ count: 5, yellow: true });
    expect(fpsBlocks(11)).toEqual({ count: 3, yellow: true });
    expect(fpsBlocks(10)).toEqual({ count: 2, yellow: false });
    expect(fpsBlocks(1)).toEqual({ count: 1, yellow: false });
  });

  it("draws nothing for 0 and one red block for a negative value", () => {
    expect(fpsBlocks(0).count).toBe(0);
    expect(fpsBlocks(-3)).toEqual({ count: 1, yellow: false });
  });
});

describe("bar B (0x4433c0)", () => {
  it("goes down in green to one block at 400 ms, then up in red", () => {
    const table: [number, number, boolean][] = [
      [0, 6, true],
      [100, 6, true],
      [101, 5, true],
      [150, 5, true],
      [200, 4, true],
      [250, 3, true],
      [300, 2, true],
      [301, 1, true],
      [400, 1, true],
      [401, 1, false],
      [500, 1, false],
      [501, 2, false],
      [600, 2, false],
      [700, 3, false],
      [800, 4, false],
      [900, 5, false],
      [901, 6, false],
    ];
    for (const [ping, count, green] of table) expect(pingBlocks(ping)).toEqual({ count, green });
  });

  it("draws nothing for a negative value", () => {
    expect(pingBlocks(-1).count).toBe(0);
  });
});

describe("FrameRate ([0x492af4])", () => {
  it("reads 30 until a second is up, then the new frames drawn in it", () => {
    const rate = new FrameRate();
    for (let t = 0; t < 20; t++) rate.draw(t, t * 50);
    expect(rate.value).toBe(30);
    // The pass that closes the window counts too (0x405db7 before 0x405dc7).
    rate.draw(20, FPS_WINDOW_MS);
    expect(rate.value).toBe(21);
  });

  it("counts a frame drawn twice once", () => {
    const rate = new FrameRate();
    for (let i = 0; i < 60; i++) rate.draw(Math.floor(i / 2), (i * 1000) / 60);
    rate.draw(30, FPS_WINDOW_MS);
    expect(rate.value).toBe(31);
    // A second with no new frame reads 0.
    rate.draw(30, 2 * FPS_WINDOW_MS);
    expect(rate.value).toBe(0);
  });
});

describe("PingMeter ([0x48be58], 0x44497c)", () => {
  it("sends every 5 s, takes the first trip as it is and averages the next ones toward zero", () => {
    const meter = new PingMeter();
    expect(meter.due(0)).toBe(true);
    expect(meter.due(PING_INTERVAL_MS - 1)).toBe(false);
    meter.answered(0, 81);
    expect(meter.value).toBe(81);
    meter.answered(1000, 1040);
    expect(meter.value).toBe(60);
    meter.answered(2000, 2001);
    expect(meter.value).toBe(30);
    expect(meter.due(PING_INTERVAL_MS)).toBe(true);
  });

  it("clears the value at a world load but keeps the timer", () => {
    const meter = new PingMeter();
    expect(meter.due(0)).toBe(true);
    meter.answered(0, 200);
    meter.reset();
    expect(meter.value).toBe(0);
    expect(meter.due(1)).toBe(false);
    meter.answered(10, 70);
    expect(meter.value).toBe(60);
  });
});
