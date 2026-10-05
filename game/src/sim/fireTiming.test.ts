import { describe, expect, it } from "vitest";

import { nowMs } from "./constants.ts";
import { createMatch, step } from "./match.ts";
import { layoutFromAscii, run, runUntil, setups, VERSUS } from "./testing.ts";
import type { GameMode } from "./types.ts";
import { Anim, Dir, ItemKind } from "./types.ts";

function match(mode: GameMode) {
  const rows = Array.from({ length: 15 }, () => Array<string>(15).fill("."));
  rows[5][5] = "1";
  rows[13][1] = "2";
  rows[13][13] = "3";
  const players = setups(3).map((player) => ({
    ...player,
    character: "shaky",
    team: player.id === 3 ? 2 : 1,
  }));
  const state = createMatch(layoutFromAscii(rows.map((row) => row.join(""))), players, { ...VERSUS, mode }, 10);
  run(state, 150);
  return state;
}

describe("network fire timing (0x40af9b before 0x40b1ce)", () => {
  for (const mode of [0, 6, 7] as const) {
    it.each([Dir.Down, Dir.Left, Dir.Up, Dir.Right])(`dies before moving away from an active flame in mode ${mode}, direction %i`, (dir) => {
      const state = match(mode);
      const player = state.players[0];
      step(state, { [player.id]: { dir: null, bomb: true } });
      run(state, 60);
      expect(state.bombs[0].exploded).toBe(true);
      expect(player.alive).toBe(true);
      const position = { x: player.x, y: player.y };

      step(state, { [player.id]: { dir, bomb: false } });

      expect(state.events).toContainEqual({ type: "death", playerId: player.id });
      expect(player).toMatchObject({ ...position, alive: false, gone: false, anim: Anim.Death });
    });
  }

  it.each([6, 7] as const)("uses the death frame rate on the death-start tick and drops the capsule at the original tick in mode %i", (mode) => {
    const state = match(mode);
    const player = state.players[0];
    run(state, 4);
    step(state, { [player.id]: { dir: null, bomb: true } });
    run(state, 60);
    expect(state.tick).toBe(215);
    expect(player.alive).toBe(true);
    const animMs = player.animMs;
    expect(nowMs(state.tick + 1) - animMs).toBe(167);

    step(state, {});

    // 167 ms advances Shaky's standing animation, but not its 5 fps death animation.
    expect(player).toMatchObject({ alive: false, anim: Anim.Death, frame: 0, animMs });
    runUntil(state, () => player.gone, 100);
    expect(state.tick).toBe(267);
    expect(state.items).toContainEqual({ cell: 80, kind: ItemKind.Capsule, tick: 267, dropped: true });
  });
});
