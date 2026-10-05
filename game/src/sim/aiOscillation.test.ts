import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { AiController } from "./ai.ts";
import { layoutFromLevel } from "./level.ts";
import { createMatch, step } from "./match.ts";
import { addBomb, playingMatch, PRACTICE, setups, VERSUS } from "./testing.ts";
import type { InputFrame } from "./types.ts";
import { Anim, Dir, ItemKind } from "./types.ts";

function reversals(inputs: InputFrame[]): number {
  let previous: Dir | null = null, count = 0;
  for (const { dir } of inputs) {
    if (dir === null) continue;
    if (previous !== null && (previous + 2) % 4 === dir) count++;
    previous = dir;
  }
  return count;
}

describe("AI stops repeated direction changes during play", () => {
  const corridors = [
    { name: "left", rows: ["..1", "..."], item: 0, bomb: 4 },
    { name: "right", rows: ["1..", "..."], item: 2, bomb: 4 },
    { name: "up", rows: ["..", "..", "1."], item: 0, bomb: 3 },
  ];

  it.each(corridors.flatMap((corridor) => [5, 6, 7, 8, 9, 10].map((speed) => ({ ...corridor, speed }))))(
    "crosses the future blast lane toward $name at speed $speed without bouncing back",
    ({ rows, item, bomb, speed }) => {
      const state = playingMatch(rows, 1, PRACTICE), player = state.players[0];
      player.speed = speed;
      state.items.push({ cell: item, kind: ItemKind.Jump, sub: 0, tick: 0, dropped: false });
      addBomb(state, bomb, { owner: player.id, power: 1 });
      const ai = new AiController(player.id), inputs: InputFrame[] = [];
      for (let tick = 0; tick < 40; tick++) {
        expect(state.flame.every((f) => f === 0)).toBe(true);
        const input = ai.sample(state);
        inputs.push(input);
        step(state, { [player.id]: input });
        expect(player.alive).toBe(true);
      }
      expect(player.inv.jump).toBe(1);
      expect(reversals(inputs)).toBeLessThanOrEqual(2);
      for (let tick = 0; tick < 60; tick++) {
        step(state, { [player.id]: ai.sample(state) });
        expect(player.alive, `tick ${state.tick}`).toBe(true);
      }
    },
  );

  it("waits out an imminent blast instead of insisting on the item route", () => {
    const state = playingMatch(["..1", "..."], 1, PRACTICE), player = state.players[0];
    player.speed = 7;
    state.items.push({ cell: 0, kind: ItemKind.Jump, sub: 0, tick: 0, dropped: false });
    addBomb(state, 4, { owner: player.id, power: 1, fuseMs: 100 });
    const ai = new AiController(player.id);
    for (let tick = 0; tick < 100; tick++) {
      step(state, { [player.id]: ai.sample(state) });
      expect(player.alive, `tick ${state.tick}`).toBe(true);
    }
    expect(player.inv.jump).toBe(1);
  });

  it("abandons the committed item route when a new bomb makes its destination unsafe", () => {
    const state = playingMatch(["..1", "..."], 1, PRACTICE), player = state.players[0];
    player.speed = 7;
    state.items.push({ cell: 0, kind: ItemKind.Jump, sub: 0, tick: 0, dropped: false });
    addBomb(state, 4, { owner: player.id, power: 1 });
    const ai = new AiController(player.id);
    step(state, { [player.id]: ai.sample(state) });
    addBomb(state, 0, { owner: 99, power: 1, fuseMs: 200 });
    for (let tick = 0; tick < 100; tick++) {
      step(state, { [player.id]: ai.sample(state) });
      expect(player.alive, `tick ${state.tick}`).toBe(true);
    }
  });

  it("keeps a safe refuge when the opponent alternates its visible walking direction", () => {
    const state = playingMatch([".....", ".#.#.", "2.1..", ".#.#.", "....."], 2);
    const player = state.players[0], opponent = state.players[1];
    player.speed = 10;
    opponent.dir = Dir.Up;
    opponent.anim = Anim.Walk + Dir.Up;
    addBomb(state, 10, { owner: opponent.id, power: 4 });
    const ai = new AiController(player.id), inputs: InputFrame[] = [];
    for (let tick = 0; tick < 6; tick++) {
      const input = ai.sample(state);
      inputs.push(input);
      step(state, { [player.id]: input, [opponent.id]: { dir: tick % 2 === 0 ? Dir.Down : Dir.Up, bomb: false } });
      expect(player.alive).toBe(true);
    }
    expect(reversals(inputs)).toBe(0);
    expect(player.y).toBeGreaterThanOrEqual(128);
    for (let tick = 0; tick < 94; tick++) {
      step(state, { [player.id]: ai.sample(state) });
      expect(player.alive, `tick ${state.tick}`).toBe(true);
    }
  });

  it("changes its chosen refuge when a new bomb blocks that escape", () => {
    const state = playingMatch([".....", ".#.#.", "2.1..", ".#.#.", "....."], 2);
    const player = state.players[0], opponent = state.players[1];
    player.speed = 10;
    opponent.dir = Dir.Up;
    opponent.anim = Anim.Walk + Dir.Up;
    addBomb(state, 10, { owner: opponent.id, power: 4 });
    const ai = new AiController(player.id);
    expect(ai.sample(state).dir).toBe(Dir.Down);
    step(state, { [player.id]: ai.sample(state) });
    addBomb(state, 22, { owner: 99, power: 1, fuseMs: 500 });
    let sideways = 0;
    for (let tick = 0; tick < 100; tick++) {
      step(state, { [player.id]: ai.sample(state) });
      sideways = Math.max(sideways, Math.abs(player.x - 100));
      expect(player.alive, `tick ${state.tick}`).toBe(true);
    }
    expect(sideways).toBeGreaterThan(20);
  });

  it("finishes a safe detour leg when forecast waits change the fastest route to the same destination", () => {
    const state = playingMatch(["#.#.#.#", ".......", "#.#.#B#", ".1.....", "#.#.#B#", "......."], 1, PRACTICE);
    const player = state.players[0];
    player.speed = 6;
    player.x += 3;
    player.y -= 2;
    const ai = new AiController(player.id), inputs: InputFrame[] = [];
    step(state, { [player.id]: ai.sample(state) });
    addBomb(state, 24, { owner: 99, power: 15, fuseMs: 1_000 });
    for (let tick = 0; tick < 25; tick++) {
      expect(state.flame.every((f) => f === 0)).toBe(true);
      const input = ai.sample(state);
      inputs.push(input);
      step(state, { [player.id]: input });
      expect(player.alive).toBe(true);
    }
    expect(reversals(inputs)).toBeLessThanOrEqual(2);
    for (let tick = 0; tick < 100; tick++) {
      step(state, { [player.id]: ai.sample(state) });
      expect(player.alive, `tick ${state.tick}`).toBe(true);
    }
    expect(player.x).toBeGreaterThan(90);
  });

  it("settles at a reached firing cell while all its bombs are still on the field", () => {
    const state = playingMatch(["...1.B", "......"], 1, PRACTICE), player = state.players[0];
    player.speed = 7;
    player.x = 149;
    player.dir = Dir.Left;
    player.anim = Anim.Walk + Dir.Left;
    addBomb(state, 10, { owner: player.id, power: 1 });
    const ai = new AiController(player.id), inputs: InputFrame[] = [], positions: number[] = [];
    for (let tick = 0; tick < 40; tick++) {
      const input = ai.sample(state);
      inputs.push(input);
      step(state, { [player.id]: input });
      positions.push(player.x);
      expect(player.alive).toBe(true);
    }
    expect(reversals(inputs)).toBeLessThanOrEqual(1);
    expect(new Set(positions.slice(-12)).size).toBe(1);
    expect(player.anim).toBeGreaterThanOrEqual(Anim.Stand);
  });

  it("uses a reached firing cell after stopping slightly off centre instead of continually realigning", () => {
    const state = playingMatch(["...1.B", "......"], 1, PRACTICE), player = state.players[0];
    player.speed = 7;
    player.x = 149;
    player.dir = Dir.Left;
    player.anim = Anim.Walk + Dir.Left;
    const ai = new AiController(player.id);
    let placed = false;
    for (let tick = 0; tick < 100; tick++) {
      step(state, { [player.id]: ai.sample(state) });
      placed ||= state.events.some((e) => e.type === "bomb-placed" && e.owner === player.id);
      expect(player.alive, `tick ${state.tick}`).toBe(true);
    }
    expect(placed).toBe(true);
  });

  it("does not develop a stationary oscillation in the recorded mizar01 match", () => {
    const source = JSON.parse(readFileSync(new URL("../../public/assets/maps/mizar01.json", import.meta.url), "utf8"));
    const state = createMatch(layoutFromLevel("mizar01", source), setups(2), VERSUS, 509);
    const controllers = [new AiController(1), new AiController(2)];
    const history: { x: number; y: number; input: InputFrame }[][] = [[], []];
    for (let tick = 0; tick < 1_200 && state.phase !== "match-over"; tick++) {
      const inputs = Object.fromEntries(controllers.map((ai, index) => [index + 1, ai.sample(state)]));
      for (const [index, player] of state.players.entries()) {
        const frames = history[index];
        if (state.phase !== "playing" || !player.alive || player.anim >= Anim.Jump) { frames.length = 0; continue; }
        frames.push({ x: player.x, y: player.y, input: inputs[player.id] });
        if (frames.length > 40) frames.shift();
        if (frames.length < 40 || frames.some(({ input }) => input.bomb || input.attack || input.evade)) continue;
        const spanX = Math.max(...frames.map((f) => f.x)) - Math.min(...frames.map((f) => f.x));
        const spanY = Math.max(...frames.map((f) => f.y)) - Math.min(...frames.map((f) => f.y));
        if (spanX <= 40 && spanY <= 16) {
          expect(reversals(frames.map((f) => f.input)), `player ${player.id}, tick ${state.tick}`).toBeLessThan(10);
        }
      }
      step(state, inputs);
    }
  }, 15_000);
});
