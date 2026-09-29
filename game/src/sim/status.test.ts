import { describe, expect, it } from "vitest";

import { nowMs, START_SPEED } from "./constants.ts";
import { applyPickup } from "./pickup.ts";
import { CURSE_MS, FREEZE_MS, RESET_ICON_MS, SLOW_SPEED } from "./status.ts";
import { playingMatch, run, runUntil } from "./testing.ts";
import type { InputFrame } from "./types.ts";
import { Dir, ItemKind } from "./types.ts";

const walk = (dir: Dir): InputFrame => ({ dir, bomb: false });

/** Ticks until `ms` of tick-time has gone by past `start`, i.e. the first tick where `now - start > ms`. */
function ticksPast(start: number, ms: number): number {
  let tick = 0;
  while (nowMs(tick) - start <= ms) tick++;
  return tick;
}

describe("slow curse (0x453110, 0x452651)", () => {
  it("walks 2 px an update for 10 s, then gives back the speed from before", () => {
    const state = playingMatch([".........", "....1....", "........."]);
    const player = state.players[0];
    player.speed = 7;
    applyPickup(state, player, ItemKind.Mystery, 33);
    expect(player.savedSpeed).toBe(7);
    expect(player.badState).toEqual({ start: nowMs(state.tick), length: CURSE_MS });

    const x = player.x;
    run(state, 1, { 1: walk(Dir.Right) });
    expect(player.speed).toBe(SLOW_SPEED);
    expect(player.x).toBe(x + SLOW_SPEED);

    const start = player.status.slow!;
    run(state, ticksPast(start, CURSE_MS) - state.tick - 1);
    expect(player.status.slow).toBe(start);
    run(state, 1);
    expect(player.status.slow).toBeNull();
    expect(player.speed).toBe(7);
    expect(player.badState).toBeNull();
  });

  it("loses a speed item picked up while slowed", () => {
    const state = playingMatch(["1...."]);
    const player = state.players[0];
    applyPickup(state, player, ItemKind.Mystery, 33);
    run(state, 1);
    applyPickup(state, player, ItemKind.Speed);
    runUntil(state, () => player.status.slow === null);
    expect(player.speed).toBe(START_SPEED);
  });
});

describe("reversed controls (0x453200, tables 0x45d0e4/0x45d0f4)", () => {
  it.each([
    [Dir.Up, Dir.Down],
    [Dir.Down, Dir.Up],
    [Dir.Left, Dir.Right],
    [Dir.Right, Dir.Left],
  ])("turns key %i into direction %i for 10 s", (key, moved) => {
    const state = playingMatch([".........", "....1....", "........."]);
    const player = state.players[0];
    applyPickup(state, player, ItemKind.Mystery, 36);
    run(state, 1, { 1: walk(key) });
    expect(player.dir).toBe(moved);

    runUntil(state, () => player.status.reverse === null);
    run(state, 1, { 1: walk(key) });
    expect(player.dir).toBe(key);
  });
});

describe("bomb switch freeze (0x4517a0)", () => {
  it("lets the player walk again after 5 s", () => {
    const state = playingMatch([".........", "....1....", "........."]);
    const player = state.players[0];
    run(state, 1, { 1: walk(Dir.Right) });
    const start = nowMs(state.tick);
    applyPickup(state, player, ItemKind.Switch);
    expect(player.badState).toEqual({ start, length: FREEZE_MS });

    const x = player.x;
    run(state, ticksPast(start, FREEZE_MS) - state.tick - 1, { 1: walk(Dir.Right) });
    expect(player.x).toBe(x);
    run(state, 2, { 1: walk(Dir.Right) });
    expect(player.status.frozen).toBeNull();
    expect(player.x).toBeGreaterThan(x);
  });
});

describe("reset (0x40cea0)", () => {
  it("keeps a teleport charge and the running curses, with stars for 1.5 s", () => {
    const state = playingMatch(["1...."]);
    const player = state.players[0];
    applyPickup(state, player, ItemKind.Teleport);
    applyPickup(state, player, ItemKind.Mystery, 36);
    const teleport = player.inv.teleport;
    expect(teleport).toBeGreaterThan(0);

    applyPickup(state, player, ItemKind.Mystery, 34);
    expect(player.inv.teleport).toBe(teleport);
    expect(player.status.reverse).not.toBeNull();
    expect(player.badState).toEqual({ start: nowMs(state.tick), length: RESET_ICON_MS });

    runUntil(state, () => player.badState === null);
    expect(player.status.reverse).not.toBeNull();
  });
});
