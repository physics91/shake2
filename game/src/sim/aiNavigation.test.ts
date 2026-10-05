import { describe, expect, it } from "vitest";
import { AiController } from "./ai.ts";
import { step } from "./match.ts";
import { playingMatch } from "./testing.ts";
import type { MatchState } from "./types.ts";
import { ItemKind } from "./types.ts";

function collectBomb(state: MatchState, limit = 240): void {
  const ai = new AiController(1), player = state.players[0];
  for (let tick = 0; tick < limit && player.bombCapacity === 1; tick++) {
    step(state, { 1: ai.sample(state) });
    expect(player.alive, `tick ${state.tick}`).toBe(true);
    expect(state.phase).toBe("playing");
  }
  expect(player.bombCapacity).toBe(2);
}

describe("AI navigation through ordinary movement", () => {
  it.each([
    { name: "oscillating in a straight corridor", rows: ["1#2", ".##", ".##", ".##", ".##", ".##", "..#"], goal: 19 },
    { name: "pushing into the wall at a turn", rows: ["1#2", ".##", ".##", ".##", "..#", "###"], goal: 13 },
  ])("keeps collecting after a real Speed pickup instead of $name", ({ rows, goal }) => {
    const state = playingMatch(rows, 2);
    state.players[0].speed = 9;
    state.players[1].status.invisible = 0;
    state.items.push(
      { cell: 12, kind: ItemKind.Speed, sub: 0, tick: 0, dropped: false },
      { cell: goal, kind: ItemKind.Bomb, sub: 0, tick: 0, dropped: false },
    );
    collectBomb(state, 80);
    expect(state.players[0].speed).toBe(10);
  });

  const terrains = [
    { name: "narrow turn", rows: ["#######", "#1....#", "#####.#", "#.....#", "#######", "2######"], goal: 22 },
    { name: "top edge", rows: ["1....", ".....", "....2"], goal: 4 },
    { name: "bottom edge", rows: ["2....", ".....", "....1"], goal: 10 },
    { name: "zigzag", rows: ["1....#2", "####.##", ".....##", ".######", ".....##"], goal: 32 },
    { name: "vertical corridor", rows: ["1##2", ".#.#", ".#.#", ".#.#", "...#"], goal: 18 },
    { name: "inside corner", rows: ["1....", ".###.", ".#2#.", ".###.", "....."], goal: 24 },
  ];
  const cases = terrains.flatMap((terrain) => [5, 6, 7, 8, 9, 10].flatMap((speed) =>
    [0, 1, 2, 3].map((offset) => ({ ...terrain, speed, offset }))));

  it.each(cases)("reaches the item on $name at speed $speed, offset $offset", ({ rows, goal, speed, offset }) => {
    const state = playingMatch(rows, 2);
    state.players[0].speed = speed;
    state.players[0].y += offset;
    state.players[1].status.invisible = 0;
    state.items.push({ cell: goal, kind: ItemKind.Bomb, sub: 0, tick: 0, dropped: false });
    collectBomb(state);
  });

  it("collects a useful item while no-bomb prevents attacking an aligned opponent", () => {
    const state = playingMatch(["1.2", "...", "..."], 2), player = state.players[0];
    player.status.noBomb = 0;
    state.items.push({ cell: 6, kind: ItemKind.Fire, sub: 0, tick: 0, dropped: false });
    const ai = new AiController(1);
    for (let tick = 0; tick < 60 && player.firePower === 2; tick++) {
      const input = ai.sample(state);
      expect(input.bomb).toBe(false);
      step(state, { 1: input });
    }
    expect(player.firePower).toBe(3);
    expect(player.alive).toBe(true);
  });
});
