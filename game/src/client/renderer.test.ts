import { describe, expect, it } from "vitest";

import type { PlayerState } from "../sim/types.ts";
import type { Sheet } from "./assets.ts";
import { PanelFaces } from "./renderer.ts";

/** A face sheet of four 2-frame animations at 10 fps (a frame each 100 ms). */
const SHEET = {
  meta: { animations: Array.from({ length: 4 }, () => ({ name: "", unknown_u16: 10, frames: [{}, {}] })) },
} as unknown as Sheet;

function player(alive: boolean): PlayerState {
  return { id: 1, alive } as PlayerState;
}

function sequence(...values: number[]): () => number {
  let i = 0;
  return () => values[i++ % values.length];
}

describe("panel faces", () => {
  it("start on anim 1 and re-pick every game frame while on frame 0, keeping the frame timer", () => {
    const faces = new PanelFaces(sequence(0.3, 0.6, 0.9));
    const at = (now: number) => faces.update(player(true), SHEET, now);
    expect(at(0)).toEqual({ anim: 1, frame: 0 }); // the timer starts long ago: frame 1 is due at once
    expect(at(33)).toEqual({ anim: 1, frame: 1 });
    expect(at(133)).toEqual({ anim: 1, frame: 1 }); // wraps to frame 0 and picks anim 1 (0.3 · 4)
    expect(at(166)).toEqual({ anim: 1, frame: 0 }); // picks anim 2
    expect(at(200)).toEqual({ anim: 2, frame: 0 }); // picks anim 3
    expect(at(266)).toEqual({ anim: 3, frame: 0 }); // frame 1 is due: no pick
    expect(at(300)).toEqual({ anim: 3, frame: 1 });
  });

  it("draws one face per game frame however often it is rendered", () => {
    const faces = new PanelFaces(() => 0.6);
    faces.update(player(true), SHEET, 0);
    expect(faces.update(player(true), SHEET, 33)).toEqual(faces.update(player(true), SHEET, 33));
  });

  it("turns grey (anim 0) on death and never re-picks it", () => {
    const faces = new PanelFaces(() => 0.5);
    faces.update(player(true), SHEET, 0);
    expect(faces.update(player(false), SHEET, 50)).toEqual({ anim: 0, frame: 0 });
    for (const now of [200, 400, 600]) expect(faces.update(player(false), SHEET, now).anim).toBe(0);
  });

  it("gives practice's own face anim 1 on death, which keeps idling (0x408304)", () => {
    const faces = new PanelFaces(() => 0.9);
    faces.update(player(true), SHEET, 0);
    expect(faces.update(player(false), SHEET, 50, 1)).toEqual({ anim: 1, frame: 0 });
    expect(faces.update(player(false), SHEET, 83, 1)).toEqual({ anim: 3, frame: 0 });
  });

  it("rebuilds the faces on anim 1 when a round starts", () => {
    const faces = new PanelFaces(() => 0.9);
    faces.update(player(false), SHEET, 0);
    faces.reset();
    expect(faces.update(player(true), SHEET, 1000)).toEqual({ anim: 1, frame: 0 });
  });
});
