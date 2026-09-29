import { describe, expect, it } from "vitest";

import { nowMs, START_BOMBS, START_FIRE, START_SPEED } from "./constants.ts";
import { createMatch, step } from "./match.ts";
import { msvcRand } from "./rng.ts";
import { RESET_ICON_MS } from "./status.ts";
import { addBomb, layoutFromAscii, run, runUntil, setups, VERSUS } from "./testing.ts";
import type { GameMode, MatchState, PlayerState, SimEvent } from "./types.ts";
import { Anim, Dir, ItemKind } from "./types.ts";
import { collectItem } from "./world.ts";

// Spawns at columns 0, 2, 5 and 7 of one open row.
const ROW = ["1.2..3.4."];

function summonMatch(teams: number[], mode: GameMode = 6): MatchState {
  const players = setups(teams.length).map((setup, i) => ({ ...setup, team: teams[i] }));
  const state = createMatch(layoutFromAscii(ROW), players, { ...VERSUS, mode }, 1);
  run(state, 150);
  state.hidden = state.hidden.map(() => null);
  return state;
}

function byId(state: MatchState, id: number): PlayerState {
  const player = state.players.find((p) => p.id === id);
  if (!player) throw new Error(`no player ${id}`);
  return player;
}

/**
 * Burn a player where it stands and play its death animation out; the flame is put out at once,
 * and `during` runs while the animation plays.
 */
function killOut(state: MatchState, id: number, during: (cell: number) => void = () => {}): number {
  const player = byId(state, id);
  const cell = Math.floor(player.y / 32) * state.layout.width + Math.floor(player.x / 40);
  state.flame[cell] = 1;
  step(state, {});
  state.flame[cell] = 0;
  during(cell);
  runUntil(state, () => player.gone, 200);
  return cell;
}

/** A player already gone this round. */
function goneOut(player: PlayerState): void {
  Object.assign(player, { alive: false, gone: true, anim: Anim.Death });
}

describe("summon capsule drop (0x453270)", () => {
  it("lays a capsule on the death cell when the death animation ends, before the stat drops", () => {
    const state = summonMatch([1, 1, 2, 2]);
    byId(state, 2).bombCapacity = START_BOMBS + 1;

    const cell = killOut(state, 2);

    expect(state.items[0]).toMatchObject({ cell, kind: ItemKind.Capsule, dropped: true });
    expect(state.items.slice(1)).toMatchObject([{ kind: ItemKind.Bomb }]);
  });

  it("lays none in the other modes", () => {
    for (const mode of [0, 1, 4] as const) {
      const state = summonMatch([1, 1, 2, 2], mode);
      killOut(state, 2);
      expect(state.items.map((item) => item.kind)).not.toContain(ItemKind.Capsule);
    }
  });

  it("lays none on a cell with a bomb or an item (0x410920)", () => {
    const withBomb = summonMatch([1, 1, 2, 2]);
    killOut(withBomb, 2, (cell) => addBomb(withBomb, cell, { placedMs: 1e9 }));
    expect(withBomb.items).toEqual([]);

    const withItem = summonMatch([1, 1, 2, 2]);
    killOut(withItem, 2, (cell) => withItem.items.push({ cell, kind: ItemKind.Kick, tick: 0, dropped: false }));
    expect(withItem.items.map((item) => item.kind)).toEqual([ItemKind.Kick]);
  });
});

describe("summon capsule pickup (0x40b2ac, 0x453d00)", () => {
  it("brings a dead teammate back on the capsule's cell, standing, with fresh stats, stars and the revival effect", () => {
    const state = summonMatch([1, 1, 2, 2]);
    const cell = killOut(state, 2);
    const picker = byId(state, 1);

    const events: SimEvent[] = [];
    runUntil(state, () => {
      events.push(...state.events);
      return state.items.length === 0;
    }, 100, { 1: { dir: Dir.Right, bomb: false } });
    events.push(...state.events);

    const revived = byId(state, 2);
    const now = nowMs(state.tick);
    expect(revived).toMatchObject({ alive: true, gone: false, x: 2 * 40 + 20, y: 16, anim: Anim.Stand + Dir.Down, frame: 0 });
    expect([revived.bombCapacity, revived.firePower, revived.speed]).toEqual([START_BOMBS, START_FIRE, START_SPEED]);
    expect(revived.badState).toEqual({ start: now, length: RESET_ICON_MS });
    expect(state.effects).toMatchObject([{ kind: "revival", owner: 2, follow: true, lifeMs: 0 }]);
    expect(events).toContainEqual({ type: "item-picked", playerId: picker.id, kind: ItemKind.Capsule });
    expect(events).toContainEqual({ type: "revived", playerId: 2 });
    expect(cell).toBe(2);
  });

  it("brings back a dead member of the picker's team, whoever dropped the capsule", () => {
    const state = summonMatch([1, 1, 2, 2]);
    goneOut(byId(state, 4));
    state.items.push({ cell: 2, kind: ItemKind.Capsule, tick: state.tick, dropped: true });

    collectItem(state, byId(state, 3), 2);

    expect(byId(state, 4).alive).toBe(true);
    expect(state.items).toEqual([]);
  });

  it("is used up with nobody to bring back, a player still in the death animation included", () => {
    const state = summonMatch([1, 1, 2, 2]);
    Object.assign(byId(state, 2), { alive: false, anim: Anim.Death });
    state.items.push({ cell: 3, kind: ItemKind.Capsule, tick: state.tick, dropped: true });
    const rng = state.rng;

    collectItem(state, byId(state, 1), 3);

    expect(byId(state, 2).alive).toBe(false);
    expect(state.items).toEqual([]);
    expect(state.effects).toEqual([]);
    expect(state.rng).toBe(rng);
  });

  it("picks among the dead teammates by rand() % count in slot order, after srand(time(0)) (0x453d11)", () => {
    const state = summonMatch([1, 1, 1, 2]);
    goneOut(byId(state, 2));
    goneOut(byId(state, 3));
    state.items.push({ cell: 1, kind: ItemKind.Capsule, tick: state.tick, dropped: true });
    state.clockMs = 1_700_000_002_900;
    state.rng = 12345; // the running sequence plays no part
    const second = Math.floor((state.clockMs + nowMs(state.tick)) / 1000);
    const expected = [2, 3][msvcRand({ rng: second }) % 2];

    collectItem(state, byId(state, 1), 1);

    expect(state.players.filter((p) => p.alive).map((p) => p.id)).toEqual([1, expected, 4].sort());
  });
});
