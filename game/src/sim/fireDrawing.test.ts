import { describe, expect, it } from "vitest";

import { FIRE_FRAMES } from "./constants.ts";
import { burnFire, explode } from "./fire.ts";
import { addBomb, playingMatch } from "./testing.ts";
import { BombKind, Dir } from "./types.ts";

const FIELD = [".....", ".....", ".....", ".....", "....."];

describe("fire draw order from the 0311 bomb loop", () => {
  it.each([BombKind.Normal, BombKind.Water])("draws the upper arm before the centre for kind %i", (kind) => {
    const state = playingMatch(FIELD, 0);
    const bomb = addBomb(state, 12, { kind, power: 2 });
    explode(state, bomb);
    bomb.fireFrame = 6;
    const geometry = [...bomb.fireCells];

    burnFire(state, bomb, 0);

    // 0x406aa5-0x406c3e: up far-to-near, centre, left/down/right near-to-far.
    // Frame 6 is taller than a cell, so centre-first changes the colours where sprites overlap.
    expect(state.bombSprites).toEqual([
      { type: "fire", cells: [2, 7, 12, 11, 10, 17, 22, 13, 14], anim: kind === BombKind.Water ? 1 : 0, frame: 6 },
    ]);
    expect(bomb.fireCells).toEqual(geometry);
    expect(geometry).toEqual([12, 7, 2, 11, 10, 17, 22, 13, 14]);
    expect(geometry.every((cell) => state.flame[cell] === (kind === BombKind.Water ? 2 : 1))).toBe(true);
  });

  it("draws both left diagonals and the upper-right diagonal from their far ends", () => {
    const state = playingMatch(FIELD, 0);
    const bomb = addBomb(state, 12, { kind: BombKind.X, power: 2 });
    explode(state, bomb);

    burnFire(state, bomb, 0);

    // 0x406c92-0x406e8e (also 0x409b16-0x409d06): UL, centre, DL, DR, UR.
    expect(state.bombSprites[0]).toMatchObject({ cells: [0, 6, 12, 20, 16, 18, 24, 4, 8] });
    expect(bomb.fireCells).toEqual([12, 6, 0, 16, 20, 18, 24, 8, 4]);
  });

  it("keeps a nuke's row-major draw order while skipping walls", () => {
    const state = playingMatch(["#....", ".....", ".....", ".....", "....#"], 0);
    const bomb = addBomb(state, 12, { kind: BombKind.Nuke });
    explode(state, bomb);

    burnFire(state, bomb, 0);

    expect(state.bombSprites[0]).toMatchObject({ cells: Array.from({ length: 23 }, (_, i) => i + 1) });
    expect(bomb.fireCells).toEqual(Array.from({ length: 23 }, (_, i) => i + 1));
  });

  it("draws a TNT's ending fire before it moves and creates its next fire", () => {
    const state = playingMatch(FIELD, 0);
    const bomb = addBomb(state, 12, { kind: BombKind.Tnt, tntDir: Dir.Down, tntLeft: 3 });
    explode(state, bomb);
    bomb.fireFrame = FIRE_FRAMES - 1;
    bomb.fireMs = 0;

    burnFire(state, bomb, 100);

    expect(state.bombSprites[0]).toMatchObject({ cells: [7, 12, 11, 17, 13], frame: 7 });
    expect(bomb).toMatchObject({ cell: 17, fireCells: [17, 12, 16, 22, 18], fireFrame: 1, tntLeft: 2 });
    expect(state.flame.every((kind) => kind === 0)).toBe(true);
  });
});
