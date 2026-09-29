import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { PRACTICE_CHARACTERS } from "./constants.ts";
import { layoutFromLevel } from "./level.ts";
import { step } from "./match.ts";
import { practiceBrickItem } from "./items.ts";
import { createPractice } from "./practice.ts";
import { msvcRand } from "./rng.ts";
import { IDLE } from "./testing.ts";
import type { MatchState } from "./types.ts";
import { Anim, ItemKind } from "./types.ts";

const MAP = join(import.meta.dirname, "..", "..", "public", "assets", "maps", "practice.json");
const LOCAL = { id: 1, name: "나", character: "bobo" };

function practice(seed = 7): MatchState {
  const layout = layoutFromLevel("practice", JSON.parse(readFileSync(MAP, "utf-8")));
  return createPractice(layout, LOCAL, seed);
}

function run(state: MatchState, ticks: number, input = IDLE): MatchState["events"] {
  const events: MatchState["events"] = [];
  for (let i = 0; i < ticks; i++) {
    step(state, { [LOCAL.id]: input });
    events.push(...state.events);
  }
  return events;
}

function burn(state: MatchState, playerId: number): void {
  const player = state.players.find((p) => p.id === playerId);
  if (!player) throw new Error(`no player ${playerId}`);
  const cell = Math.floor(player.y / 32) * state.layout.width + Math.floor(player.x / 40);
  state.flame[cell] = 1;
}

describe.skipIf(!existsSync(MAP))("practice (scene 9)", () => {
  it("loads three dummies of rand() % 18 characters at cells 0, 7 and 14 and the local player at 97, +20/+17", () => {
    const state = practice(7);
    const rng = { rng: 7 };
    const expected = [0, 1, 2].map(() => PRACTICE_CHARACTERS[msvcRand(rng) % 18]);

    expect(state.players.map((p) => [p.slot, p.dummy, p.character, p.x, p.y])).toEqual([
      [0, true, expected[0], 20, 17],
      [1, true, expected[1], 300, 17],
      [2, true, expected[2], 580, 17],
      [3, false, "bobo", 300, 209],
    ]);
    expect(new Set(state.players.map((p) => p.id)).size).toBe(4);
  });

  it("starts in play with a 150 s clock: no wait, no countdown", () => {
    const state = practice();
    expect(state.phase).toBe("playing");
    const events = run(state, 1, { dir: 3, bomb: false });
    expect(state.timerSeconds).toBe(149);
    expect(events.map((e) => e.type)).not.toContain("go");
    expect(state.players[3].anim).toBe(Anim.Walk + 3);
  });

  it("dummies stand still with no input", () => {
    const state = practice();
    run(state, 90);
    expect(state.players.slice(0, 3).map((p) => [p.x, p.y, p.anim])).toEqual([
      [20, 17, Anim.Stand],
      [300, 17, Anim.Stand],
      [580, 17, Anim.Stand],
    ]);
  });

  it("dummies never pick items up: only the local player does (0x4501f0)", () => {
    const state = practice();
    state.items = [{ cell: 0, kind: ItemKind.Kick, tick: 0, dropped: false }];
    run(state, 10);
    expect(state.items).toHaveLength(1);
    expect(state.players[0].inv.kick).toBe(false);
  });

  it("shows the end box once every dummy is gone, and the game runs on", () => {
    const state = practice();
    const dummies = state.players.filter((p) => p.dummy);
    for (const dummy of dummies.slice(0, 2)) burn(state, dummy.id);
    let events = run(state, 60);
    expect(events.filter((e) => e.type === "practice-over")).toEqual([]);
    burn(state, dummies[2].id);
    events = run(state, 60);
    expect(events.filter((e) => e.type === "practice-over")).toHaveLength(1);
    expect(state.phase).toBe("playing");
  });

  it("shows the end box when the local player's death ends", () => {
    const state = practice();
    burn(state, LOCAL.id);
    const events = run(state, 60);
    expect(events.map((e) => e.type)).toContain("practice-over");
    expect(state.players.filter((p) => p.dummy).every((p) => !p.gone)).toBe(true);
  });

  it("has no sudden death and no hurry, and time-over leaves at once", () => {
    const state = practice();
    const events = run(state, 30 * 149);
    expect(events.map((e) => e.type)).not.toContain("hurry");
    expect(state.flame.every((f) => f === 0)).toBe(true);
    expect(state.suddenDeath.placed).toBe(0);
    const end = run(state, 30 * 2);
    expect(end.map((e) => e.type)).toContain("practice-time-up");
    expect(state.phase).toBe("match-over");
  });

  describe("teleport (0x45c90e)", () => {
    const Z = { dir: null, bomb: false, evade: true };
    const withCharacters = (numbers: number[]) => {
      const state = practice();
      numbers.forEach((n, i) => (state.players[i].character = PRACTICE_CHARACTERS[n]));
      state.players[3].inv.teleport = 1;
      return state;
    };

    it("reads a dummy's character number as a player index and flies onto that player's exact spot", () => {
      // Only dummy 0's number (2, imp) names a player: the dummy in slot 2.
      const state = withCharacters([2, 9, 15]);
      run(state, 1, Z);
      expect(state.players[3].flight).toEqual({ phase: 1, x: 580, y: 17 });
      expect(state.players[3].inv.teleport).toBe(0);
    });

    it("draws again past a player whose death has ended", () => {
      const state = withCharacters([2, 1, 15]);
      state.players[2].gone = true;
      run(state, 1, Z);
      expect(state.players[3].flight).toEqual({ phase: 1, x: 300, y: 17 });
    });

    it("flies up and back down in place when no number names a player", () => {
      const state = withCharacters([9, 12, 15]);
      run(state, 1, Z);
      expect(state.players[3].flight).toEqual({ phase: 1, x: 300, y: 209 });
      expect(state.players[3].inv.teleport).toBe(0);
    });
  });

  it("stat pickups do nothing: the caps are 0", () => {
    const state = practice();
    const me = state.players[3];
    const cell = 97 + 1;
    state.items = [ItemKind.Bomb, ItemKind.Fire, ItemKind.Speed].map((kind, i) => ({ cell: cell + i, kind, tick: 0, dropped: false }));
    state.grid[cell] = state.grid[cell + 1] = state.grid[cell + 2] = 0;
    run(state, 45, { dir: 3, bomb: false });
    expect(me.x).toBeGreaterThan(420);
    expect(state.items).toEqual([]);
    expect([me.bombCapacity, me.firePower, me.speed]).toEqual([1, 2, 5]);
  });
});

describe("practice brick roll (0x454d7a)", () => {
  const roll = (values: number[]) => {
    const queue = [...values];
    return practiceBrickItem(() => {
      const next = queue.shift();
      if (next === undefined) throw new Error("rand() called too often");
      return next;
    });
  };

  it.each([
    [[100], null],
    [[399], null],
    [[39, 2], 2],
    [[40, 0], ItemKind.Glove],
    [[69, 4], ItemKind.Teleport],
    [[70, 0], ItemKind.Power],
    [[89, 3], ItemKind.Line],
    [[75, 4], ItemKind.Double],
    [[90, 1], ItemKind.XBomb],
    [[99, 0, 20], (21 << 8) | ItemKind.Mystery],
    [[95, 2, 0], (1 << 8) | ItemKind.Mystery],
  ])("rand() %j gives %j", (values, word) => {
    expect(roll(values)).toBe(word);
  });
});

describe.skipIf(!existsSync(MAP))("practice pre-placed items (0x455000)", () => {
  it("puts 24 items, each on the first free neighbour of its cell, one pixel higher", () => {
    const state = practice();
    expect(state.items).toHaveLength(24);
    expect(state.items.every((item) => item.dropped && state.grid[item.cell] === 0)).toBe(true);
    expect(new Set(state.items.map((item) => item.cell)).size).toBe(24);
    // Cell 195 (row 13, col 0) has nothing to its left, so its first free neighbour is the one above, 180.
    expect(state.items[0]).toMatchObject({ cell: 180, kind: ItemKind.Speed });
    // Cell 225 lies below the grid; its first neighbour inside is straight up, 210.
    expect(state.items.find((item) => item.kind === ItemKind.Timer)?.cell).toBe(210 + 0);
    expect(state.items.filter((item) => item.kind === ItemKind.Mystery).map((item) => item.sub)).toEqual([37, 38]);
  });
});
