import { describe, expect, it } from "vitest";
import { AiController } from "./ai.ts";
import { nowMs } from "./constants.ts";
import { step } from "./match.ts";
import { addBomb, playingMatch } from "./testing.ts";
import { Anim, Dir, ItemKind } from "./types.ts";

describe("AI survival at movement and evasion boundaries", () => {
  it.each([5, 6, 7, 8, 9, 10])("brakes before coasting into a future blast while waiting, speed %i", (speed) => {
    const state = playingMatch(["....2", "..1..", ".....", ".....", "....."], 2);
    const player = state.players[0];
    player.speed = speed;
    player.y = 64 - Math.floor(speed / 2);
    player.dir = Dir.Down;
    player.anim = Anim.Walk + Dir.Down;
    player.animMs = nowMs(state.tick);
    state.players[1].status.invisible = 0;
    state.items.push({ cell: 17, kind: ItemKind.Speed, sub: 0, tick: 0, dropped: false });
    addBomb(state, 10, { power: 4, fuseMs: 133 });
    const ai = new AiController(1);
    expect(ai.sample(state).dir).toBe(Dir.Up);
    for (let tick = 0; tick < 90 && player.speed === speed; tick++) {
      step(state, { 1: ai.sample(state) });
      expect(player.alive, `tick ${state.tick}`).toBe(true);
    }
    if (speed < 10) expect(player.speed).toBe(speed + 1);
  });

  it("changes the first escape leg when a counter-bomb disconnects it from the refuge", () => {
    const state = playingMatch([
      ".......", ".......", "#.#2###", "#.#.###", "#.#.###", "...1B..", "#.#.###", ".......", "#######",
    ], 2);
    const ai = new AiController(1);
    expect(ai.sample(state).bomb).toBe(true);
    step(state, { 1: ai.sample(state) });
    step(state, { 1: ai.sample(state), 2: { dir: null, bomb: true } });
    expect([Dir.Left, Dir.Down]).toContain(ai.sample(state).dir);
    for (let tick = 0; tick < 110 && state.phase === "playing"; tick++) step(state, { 1: ai.sample(state) });
    expect(state.players[0].alive).toBe(true);
  });

  it.each([false, true])("chooses a jump whose landing survives the fire, reversed controls %s", (reverse) => {
    const state = playingMatch([".....", "..1..", ".....", ".....", "....2"], 2);
    const player = state.players[0];
    player.inv.jump = 1;
    if (reverse) player.status.reverse = 0;
    state.players[1].status.invisible = 0;
    const fireCells = [0, 5, 10, 15, 16, 17, 18, 19, 20];
    addBomb(state, 15, { exploded: true, pumpkin: true, fireCells, power: 4, fireMs: nowMs(state.tick) });
    for (const cell of fireCells) state.flame[cell] = 1;
    addBomb(state, 5, { power: 4, fuseMs: 1 });
    const ai = new AiController(1), jump = ai.sample(state);
    expect(jump.evade).toBe(true);
    expect(jump.dir).toBe(reverse ? Dir.Down : Dir.Up);
    step(state, { 1: jump });
    expect(player.anim).toBe(Anim.Jump + Dir.Up);
    for (let tick = 0; tick < 110 && state.phase === "playing"; tick++) step(state, { 1: ai.sample(state) });
    expect(player.alive).toBe(true);
  });

  it("waits to burrow until emergence will be clear of its own bomb's fire", () => {
    const state = playingMatch(["1#", "##", "2#"], 2);
    const player = state.players[0];
    player.inv.burrow = true;
    step(state, { 1: { dir: null, bomb: true } });
    step(state, { 1: { dir: null, bomb: false } });
    const ai = new AiController(1);
    expect(ai.sample(state).evade).not.toBe(true);
    let burrowed = false;
    for (let tick = 0; tick < 120; tick++) {
      const input = ai.sample(state);
      burrowed ||= !!input.evade;
      step(state, { 1: input });
      expect(player.alive, `tick ${state.tick}`).toBe(true);
    }
    expect(burrowed).toBe(true);
    expect(player.inv.burrow).toBe(false);
  });
});
