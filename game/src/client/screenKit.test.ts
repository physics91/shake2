import { describe, expect, it } from "vitest";
import type { SheetMeta } from "../assets/types.ts";
import { CursorAnim, Fade } from "./screenKit.ts";
import { FRAME_MS } from "./startLayout.ts";

/** A moment inside frame `frame` of a fade that started at `start`. */
const inFrame = (start: number, frame: number) => start + frame * FRAME_MS + 1;

describe("Fade", () => {
  it("darkens the frozen frame 10 % a 30 fps frame from its first frame, the 11th black (0x4130f0)", () => {
    const fade = new Fade("out", 500, FRAME_MS);
    expect(fade.darkness(500)).toBe(0.1);
    expect(Array.from({ length: 11 }, (_, i) => fade.darkness(inFrame(500, i)))).toEqual([
      0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1, 1,
    ]);
  });

  it("lightens the new scene from 90 % dark to none", () => {
    const fade = new Fade("in", 0, FRAME_MS);
    expect(Array.from({ length: 11 }, (_, i) => fade.darkness(inFrame(0, i)))).toEqual([
      0.9, 0.8, 0.7, 0.6, 0.5, 0.4, 0.3, 0.2, 0.1, 0, 0,
    ]);
  });

  it("ends after 11 frames each way, 22 frames (~733 ms) in all", () => {
    const out = new Fade("out", 0, FRAME_MS);
    expect(out.done(inFrame(0, 10))).toBe(false);
    expect(out.done(11 * FRAME_MS)).toBe(true);
    const into = new Fade("in", 11 * FRAME_MS, FRAME_MS);
    expect(into.done(inFrame(11 * FRAME_MS, 10))).toBe(false);
    expect(into.done(22 * FRAME_MS)).toBe(true);
    expect(Math.round(22 * FRAME_MS)).toBe(733);
  });

  it("counts a clock read before the start as the first frame", () => {
    expect(new Fade("out", 1000, FRAME_MS).darkness(990)).toBe(0.1);
  });
});

/** cursor.spr's shape: anims 0 and 1 of 4 frames at 5 fps (a frame is due after 200 ms). */
const CURSOR_META = {
  animations: [0, 1].map(() => ({ name: "", unknown_u16: 5, frames: Array.from({ length: 4 }, () => ({ rect: [0, 0, 1, 1] })) })),
} as unknown as SheetMeta;

describe("CursorAnim", () => {
  it("restarts the frames on busy but keeps the frame clock (0x43f0b0 → 0x461ff0; +0x154 kept)", () => {
    const cursor = new CursorAnim();
    expect(cursor.advance(0, CURSOR_META)).toEqual({ anim: 0, frame: 1 });
    expect(cursor.advance(150, CURSOR_META)).toEqual({ anim: 0, frame: 1 });
    cursor.set(true);
    expect(cursor.advance(150, CURSOR_META)).toEqual({ anim: 1, frame: 0 });
    // Due 200 ms after the pointer's last frame, not after the switch.
    expect(cursor.advance(201, CURSOR_META)).toEqual({ anim: 1, frame: 1 });
  });

  it("restarts the pointer's frames when told it is not busy while it already is not", () => {
    const cursor = new CursorAnim();
    cursor.advance(0, CURSOR_META);
    expect(cursor.advance(201, CURSOR_META)).toEqual({ anim: 0, frame: 2 });
    cursor.set(false);
    expect(cursor.advance(202, CURSOR_META)).toEqual({ anim: 0, frame: 0 });
  });
});
