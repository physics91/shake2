import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { AiController } from "./ai.ts";
import { nowMs } from "./constants.ts";
import { playerCell } from "./grid.ts";
import { layoutFromLevel } from "./level.ts";
import { createMatch, step } from "./match.ts";
import { addBomb, playingMatch, setups, VERSUS } from "./testing.ts";
import { Anim, BombKind, CellKind, Dir, ItemKind } from "./types.ts";

describe("AI ordinary input", () => {
  it("makes a useful bomb, clears bricks and survives its own fire", () => {
    const state = playingMatch(["1....", ".#.#.", "B...2"], 2);
    const ai = new AiController(1);
    const initial = ai.sample(state);
    expect(initial.bomb).toBe(true);
    step(state, { 1: initial });
    let placed = 0;
    for (let tick = 0; tick < 95; tick++) {
      step(state, { 1: ai.sample(state) });
      placed += state.events.filter((event) => event.type === "bomb-placed").length;
      expect(state.players[0].alive, `tick ${tick}, cell ${playerCell(state, state.players[0])}`).toBe(true);
    }
    expect(placed).toBeGreaterThan(0);
    expect(state.grid[10]).toBe(CellKind.Empty);
  });

  it("refuses a bomb in a corridor with no escape", () => {
    const state = playingMatch(["1.B2"], 2);
    const ai = new AiController(1);
    for (let tick = 0; tick < 80; tick++) {
      const input = ai.sample(state);
      expect(input.bomb).toBe(false);
      step(state, { 1: input });
    }
    expect(state.players[0].alive).toBe(true);
  });

  it("walks to a visible item without reading unopened brick items or changing the live state", () => {
    const state = playingMatch(["1...2", ".....", ".....", "BBBBB"], 2);
    state.players[1].status.invisible = 0;
    state.items.push({ cell: 2, kind: ItemKind.Speed, sub: 0, tick: 0, dropped: false });
    const ai = new AiController(1);
    const before = structuredClone(state);
    const input = ai.sample(state);
    expect(state).toEqual(before);
    expect(input).toEqual({ dir: Dir.Right, bomb: false });
    step(state, { 1: input });
    for (let tick = 0; tick < 20; tick++) step(state, { 1: ai.sample(state) });
    expect(state.players[0].speed).toBe(6);
  });

  it("escapes a chain reaction rather than trusting the second bomb's long fuse", () => {
    const state = playingMatch([".....", "2.1..", ".....", ".....", "....."], 2);
    addBomb(state, 10, { power: 2, fuseMs: 400 });
    addBomb(state, 12, { power: 2, fuseMs: 5000 });
    const ai = new AiController(1);
    for (let tick = 0; tick < 90; tick++) {
      step(state, { 1: ai.sample(state) });
      expect(state.players[0].alive, `tick ${tick}`).toBe(true);
    }
    expect(state.bombs).toHaveLength(0);
  });

  it("does not enter fire that will expire before a planned arrival", () => {
    const state = playingMatch(["1...2", ".....", "....."], 2);
    state.players[1].status.invisible = 0;
    state.items.push({ cell: 2, kind: ItemKind.Speed, sub: 0, tick: 0, dropped: false });
    addBomb(state, 6, { exploded: true, fireCells: [1, 6, 11], fireFrame: 6, fireMs: nowMs(state.tick) });
    for (const cell of [1, 6, 11]) state.flame[cell] = 1;
    const ai = new AiController(1);
    const input = ai.sample(state);
    expect(input.dir).not.toBe(Dir.Right);
    step(state, { 1: input });
    for (let tick = 0; tick < 40; tick++) {
      step(state, { 1: ai.sample(state) });
      expect(state.players[0].alive).toBe(true);
    }
    expect(state.players[0].speed).toBe(6);
  });

  it("brakes a fast walk before waiting beside fire instead of coasting across the boundary", () => {
    const state = playingMatch([".....", "..1.2", ".....", "....."], 2);
    const player = state.players[0];
    player.speed = 7;
    player.y = 60;
    player.dir = Dir.Down;
    player.anim = Anim.Walk + Dir.Down;
    player.animMs = nowMs(state.tick);
    state.players[1].status.invisible = 0;
    state.items.push({ cell: 17, kind: ItemKind.Speed, sub: 0, tick: 0, dropped: false });
    const cells = [10, 11, 12, 13, 14];
    addBomb(state, 10, { exploded: true, fireCells: cells, fireFrame: 6, fireMs: nowMs(state.tick) });
    for (const cell of cells) state.flame[cell] = 1;
    const ai = new AiController(1);
    expect(ai.sample(state).dir).toBe(Dir.Up);
    for (let tick = 0; tick < 60; tick++) {
      step(state, { 1: ai.sample(state) });
      expect(player.alive, `tick ${tick}`).toBe(true);
    }
    expect(player.speed).toBe(8);
  });

  it("leaves the outer edge before the next sudden-death block", () => {
    const state = playingMatch([".1.............", ...Array.from({ length: 13 }, () => ".".repeat(15)), "..............2"], 2);
    state.suddenDeath = { placed: 1, active: true, lastMs: nowMs(state.tick) };
    const ai = new AiController(1);
    for (let tick = 0; tick < 60; tick++) {
      step(state, { 1: ai.sample(state) });
      expect(state.players[0].alive, `tick ${tick}`).toBe(true);
    }
    expect(state.grid[1]).toBe(CellKind.Fixed);
    expect(playerCell(state, state.players[0])).not.toBe(1);
  });

  it("checks the real nuke footprint and escapes it", () => {
    const state = playingMatch(["1......", ".......", "..B....", ".......", ".......", ".......", "......2"], 2);
    state.players[0].inv.nuke = 1;
    const ai = new AiController(1);
    const initial = ai.sample(state);
    expect(initial.bomb).toBe(true);
    step(state, { 1: initial });
    expect(state.bombs[0].kind).toBe(BombKind.Nuke);
    for (let tick = 0; tick < 95; tick++) {
      step(state, { 1: ai.sample(state) });
      expect(state.players[0].alive, `tick ${tick}`).toBe(true);
    }
    expect(state.grid[16]).toBe(CellKind.Empty);
  });

  it("will not use full-width power without a refuge", () => {
    const state = playingMatch(["1...B2"], 2);
    state.players[0].inv.power = 1;
    const ai = new AiController(1);
    for (let tick = 0; tick < 20; tick++) {
      const input = ai.sample(state);
      expect(input.bomb).toBe(false);
      step(state, { 1: input });
    }
  });

  it("compensates for reversed controls using an ordinary direction input", () => {
    const normal = playingMatch(["1...2", ".....", "....."], 2);
    normal.players[1].status.invisible = 0;
    normal.items.push({ cell: 2, kind: ItemKind.Fire, sub: 0, tick: 0, dropped: false });
    const reversed = structuredClone(normal);
    reversed.players[0].status.reverse = 0;
    const a = new AiController(1), b = new AiController(1);
    expect(a.sample(normal).dir).toBe(Dir.Right);
    expect(b.sample(reversed).dir).toBe(Dir.Left);
    step(normal, { 1: a.sample(normal) });
    step(reversed, { 1: b.sample(reversed) });
    expect([reversed.players[0].x, reversed.players[0].y]).toEqual([normal.players[0].x, normal.players[0].y]);
  });

  it("can detonate its timer after reaching shelter", () => {
    const state = playingMatch(["..B..", ".....", "..1.2"], 2);
    addBomb(state, 0, { kind: BombKind.Timer, owner: 1, power: 2, placedMs: -1000, fuseMs: 5000 });
    const ai = new AiController(1);
    expect(ai.sample(state).attack).toBe(true);
    step(state, { 1: ai.sample(state) });
    expect(state.bombs[0].exploded).toBe(true);
    expect(state.players[0].alive).toBe(true);
    expect(state.grid[2]).toBe(CellKind.Empty);
  });

  it("keeps pursuing an opponent beyond the forecast's walking range", () => {
    const state = playingMatch(["1...................2", ".....................", "....................."], 2);
    const ai = new AiController(1);
    expect(ai.sample(state)).toEqual({ dir: Dir.Right, bomb: false });
    for (let tick = 0; tick < 100; tick++) step(state, { 1: ai.sample(state) });
    expect(state.players[0].x).toBeGreaterThan(300);
    expect(state.players[0].alive).toBe(true);
  });

  it("leads a visible moving opponent with a missile instead of chasing the old lane", () => {
    const stationary = playingMatch(["....2.", "......", "......", "1.....", "......", "......"], 2);
    stationary.players[0].firePower = 1;
    stationary.players[0].inv.missile = 1;
    const moving = structuredClone(stationary);
    moving.players[1].dir = Dir.Down;
    moving.players[1].anim = Anim.Walk + Dir.Down;
    expect(new AiController(1).sample(stationary)).toEqual({ dir: Dir.Up, bomb: false });
    const ai = new AiController(1);
    expect(ai.sample(moving)).toEqual({ dir: Dir.Right, bomb: false, attack: true });
    let fired = 0;
    for (let tick = 0; tick < 100 && moving.phase === "playing"; tick++) {
      step(moving, { 1: ai.sample(moving), 2: { dir: tick < 18 ? Dir.Down : null, bomb: false } });
      fired += moving.events.filter((e) => e.type === "missile-fired" && e.playerId === 1).length;
    }
    expect(fired).toBe(1);
    expect(moving.players[0].inv.missile).toBe(0);
    expect(moving.players.map((p) => p.alive)).toEqual([true, false]);
  });

  it.each(["jump", "burrow"] as const)("releases a missile press before a safe %s follow-up", (item) => {
    const state = playingMatch(["#1.2...........", "###############"], 2);
    const player = state.players[0];
    player.inv.missile = 1;
    player.inv.power = 1;
    if (item === "jump") player.inv.jump = 1;
    else player.inv.burrow = true;
    player.dir = Dir.Left;
    player.anim = Anim.Stand + Dir.Left;
    const ai = new AiController(1);
    const shot = ai.sample(state);
    expect(shot.attack).toBe(true);
    // Repeated sampling of the same tick must not consume the pending release/follow-up.
    expect(ai.sample(state)).toEqual(shot);
    step(state, { 1: shot });
    expect(state.events).toContainEqual({ type: "missile-fired", playerId: 1 });
    expect(ai.sample(state)).toEqual({ dir: null, bomb: false });
    step(state, { 1: ai.sample(state) });
    expect(player.actionLatch).toBe(false);
    const evade = ai.sample(state);
    expect(evade.evade).toBe(true);
    step(state, { 1: evade });
    if (item === "jump") expect(state.events).toContainEqual({ type: "jumped", playerId: 1 });
    else expect(player.anim).toBe(Anim.Burrow);
    for (let tick = 0; tick < 110 && state.phase === "playing"; tick++) step(state, { 1: ai.sample(state) });
    expect(state.players.map((p) => p.alive)).toEqual([true, false]);
    if (item === "jump") expect(player.inv.jump).toBe(0);
  });

  it("uses a wall missile and glove follow-up to throw over the wall, then survives the landing fire", () => {
    const state = playingMatch(["...........", ".......1#2.", "..........."], 2);
    const player = state.players[0];
    player.inv.missile = 1;
    player.inv.glove = true;
    player.dir = Dir.Right;
    player.anim = Anim.Stand + Dir.Right;
    const ai = new AiController(1);
    expect(ai.sample(state)).toEqual({ dir: Dir.Right, bomb: false, attack: true });
    step(state, { 1: ai.sample(state) });
    expect(ai.sample(state)).toEqual({ dir: null, bomb: false });
    step(state, { 1: ai.sample(state) });
    expect(ai.sample(state).bomb).toBe(true);
    step(state, { 1: ai.sample(state) });
    expect(state.events).toContainEqual({ type: "bomb-thrown", playerId: 1 });
    for (let tick = 0; tick < 110 && state.phase === "playing"; tick++) step(state, { 1: ai.sample(state) });
    expect(state.players.map((p) => p.alive)).toEqual([true, false]);
  });

  it("refuses a lethal missile when no release-and-evasion sequence is available", () => {
    const state = playingMatch(["#1.2...........", "###############"], 2);
    state.players[0].inv.missile = 1;
    state.players[0].inv.power = 1;
    const ai = new AiController(1);
    for (let tick = 0; tick < 20; tick++) {
      const input = ai.sample(state);
      expect(input.attack).not.toBe(true);
      step(state, { 1: input });
    }
    expect(state.players[0].inv.missile).toBe(1);
    expect(state.players[0].alive).toBe(true);
  });

  it("aims a line of bombs at the opponent, releases Space, and escapes all three bombs", () => {
    const state = playingMatch(["........", "........", "..1...2.", "........", "........"], 2);
    const player = state.players[0];
    player.inv.line = true;
    player.bombCapacity = 3;
    const ai = new AiController(1);
    expect(ai.sample(state)).toEqual({ dir: Dir.Right, bomb: true });
    step(state, { 1: ai.sample(state) });
    expect(state.bombs).toHaveLength(1);
    expect(ai.sample(state)).toEqual({ dir: null, bomb: false });
    step(state, { 1: ai.sample(state) });
    expect(ai.sample(state).bomb).toBe(true);
    step(state, { 1: ai.sample(state) });
    expect(state.bombs.map((b) => b.cell)).toEqual([18, 19, 20]);
    for (let tick = 0; tick < 95 && state.phase === "playing"; tick++) step(state, { 1: ai.sample(state) });
    expect(state.players.map((p) => p.alive)).toEqual([true, false]);
  });

  it("does not use future loot, live RNG or an invisible opponent's coordinates", () => {
    const a = playingMatch(["1...2", ".....", ".....", "BBBBB"], 2);
    a.players[1].status.invisible = 0;
    a.items.push({ cell: 2, kind: ItemKind.Speed, sub: 0, tick: 0, dropped: false });
    const b = structuredClone(a);
    b.hidden[15] = ItemKind.Nuke;
    b.rng = 987654321;
    b.clockMs = 999999999;
    b.players[1].x = b.players[0].x;
    b.players[1].y = b.players[0].y;
    const originals = [structuredClone(a), structuredClone(b)];
    expect(new AiController(1).sample(a)).toEqual(new AiController(1).sample(b));
    expect([a, b]).toEqual(originals);
  });

  it("can still plan its own missile when its own character is invisible", () => {
    const state = playingMatch(["1...2", ".....", "....."], 2);
    state.players[0].status.invisible = 0;
    state.players[0].inv.missile = 1;
    const ai = new AiController(1);
    expect(ai.sample(state).attack).toBe(true);
    step(state, { 1: ai.sample(state) });
    expect(state.events).toContainEqual({ type: "missile-fired", playerId: 1 });
  });

  it.each(["waiting", "countdown", "round-over", "match-over"] as const)("has no input during %s", (phase) => {
    const state = playingMatch(["1...2", "....."], 2);
    state.phase = phase;
    expect(new AiController(1).sample(state)).toEqual({ dir: null, bomb: false });
  });

  it.each(["dead", "gone", "frozen", "jumping"])("has no input when %s", (condition) => {
    const state = playingMatch(["1...2", "....."], 2);
    const player = state.players[0];
    if (condition === "dead") player.alive = false;
    if (condition === "gone") player.gone = true;
    if (condition === "frozen") player.status.frozen = nowMs(state.tick);
    if (condition === "jumping") player.anim = Anim.Jump;
    expect(new AiController(1).sample(state)).toEqual({ dir: null, bomb: false });
  });
});

describe("AI on restored room maps", () => {
  it("plays a complete deterministic match against a stationary opponent", () => {
    const meta = JSON.parse(readFileSync(new URL("../../public/assets/maps/mizar01.json", import.meta.url), "utf8"));
    const state = createMatch(layoutFromLevel("mizar01", meta), setups(2), VERSUS, 23);
    const ai = new AiController(2);
    let placed = 0, moved = false;
    for (let tick = 0; tick < 16_000 && state.phase !== "match-over"; tick++) {
      const player = state.players[1];
      const x = player.x, y = player.y;
      const input = ai.sample(state);
      step(state, { 2: input });
      if (state.phase === "playing" && (player.x !== x || player.y !== y)) moved = true;
      placed += state.events.filter((event) => event.type === "bomb-placed" && event.owner === 2).length;
    }
    expect(moved).toBe(true);
    expect(placed).toBeGreaterThan(0);
    expect(state.phase).toBe("match-over");
    expect(state.matchWinnerId).toBe(2);
  }, 20_000);
});
