import { describe, expect, it } from "vitest";

import { nowMs, START_BOMBS, START_FIRE, START_SPEED } from "./constants.ts";
import { createMatch, step } from "./match.ts";
import { applyPickup } from "./pickup.ts";
import { msvcRand } from "./rng.ts";
import { CURSE_MS, RESET_ICON_MS } from "./status.ts";
import { addBomb, layoutFromAscii, run, runUntil, setups, VERSUS } from "./testing.ts";
import type { GameMode, InputFrame, MatchState, PlayerState, SimEvent } from "./types.ts";
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
  for (const mode of [6, 7] as const) {
    for (const earlierSlot of [false, true]) {
      it.each(["neutral", "held", "omitted"] as const)(`clears a completed death's stop before revival when polled in mode ${mode} (earlier slot=${earlierSlot}, input=%s)`, (poll) => {
        const targetId = earlierSlot ? 1 : 2;
        const pickerId = earlierSlot ? 2 : 1;
        const row = earlierSlot ? "2..1...3......." : "1..2...3.......";
        const players = setups(3).map((p) => ({ ...p, character: "shaky", team: p.id === 3 ? 2 : 1 }));
        const state = createMatch(layoutFromAscii([row]), players, { ...VERSUS, mode }, 71);
        const target = byId(state, targetId);
        const input: InputFrame | null = poll === "omitted" ? null : poll === "held"
          ? { dir: Dir.Up, bomb: true, attack: true, evade: true } : { dir: null, bomb: false };
        const heldBomb = poll === "held";

        run(state, 150);
        step(state, { [targetId]: { dir: null, bomb: true } });
        run(state, 59, { [targetId]: { dir: null, bomb: heldBomb } });
        step(state, { [targetId]: { dir: Dir.Left, bomb: heldBomb } });
        step(state, { [targetId]: { dir: null, bomb: heldBomb } });
        expect(target).toMatchObject({ alive: false, gone: false, stopRequested: true });
        runUntil(state, () => target.gone, 200, { [targetId]: { dir: null, bomb: heldBomb } });
        expect(target).toMatchObject({ stopRequested: true, actionLatch: heldBomb });

        step(state, { [targetId]: input });
        expect(target).toMatchObject({ gone: true, anim: Anim.Death, actionLatch: false, stopRequested: poll === "omitted" });

        run(state, 20, { [pickerId]: { dir: Dir.Right, bomb: false }, [targetId]: input });
        expect(state.events).toContainEqual({ type: "revived", playerId: targetId });
        expect(target.stopRequested).toBe(poll === "omitted" && earlierSlot);
        step(state, { [targetId]: { dir: Dir.Right, bomb: false } });
        expect(target.x).toBe(145);
        expect(target.anim).toBe((poll === "omitted" && earlierSlot ? Anim.Stand : Anim.Walk) + Dir.Right);
        expect(target.frame).toBe(poll === "omitted" || !earlierSlot ? 0 : 1);
      });
    }
  }

  for (const mode of [6, 7] as const) {
    for (const earlierSlot of [false, true]) {
      it.each([false, true])(`preserves a stop when death polls are omitted, then clears it on revived neutral input in mode ${mode} (target in earlier slot=${earlierSlot}, poll omitted=%s)`, (omittedPoll) => {
        const targetId = earlierSlot ? 1 : 2;
        const pickerId = earlierSlot ? 2 : 1;
        const row = earlierSlot ? "2..1...3......." : "1..2...3.......";
        const players = setups(3).map((p) => ({ ...p, character: "shaky", team: p.id === 3 ? 2 : 1 }));
        const state = createMatch(layoutFromAscii([row]), players, { ...VERSUS, mode }, 71);
        const target = byId(state, targetId);

        run(state, 150);
        step(state, { [targetId]: { dir: null, bomb: true } });
        run(state, 59);
        step(state, { [targetId]: { dir: Dir.Left, bomb: false } });
        step(state, {});
        run(state, 36, { [targetId]: null });
        run(state, 20, { [pickerId]: { dir: Dir.Right, bomb: false }, [targetId]: null });
        expect(state.events).toContainEqual({ type: "revived", playerId: targetId });
        expect(target.stopRequested).toBe(true);

        step(state, { [targetId]: omittedPoll ? null : { dir: null, bomb: false } });
        expect(target.stopRequested).toBe(omittedPoll);

        step(state, { [targetId]: { dir: Dir.Right, bomb: false } });
        expect(target.x).toBe(145);
        expect(target.anim).toBe((omittedPoll ? Anim.Stand : Anim.Walk) + Dir.Right);
        expect(target.frame).toBe(omittedPoll ? 0 : 1);
        expect(target.stopRequested).toBe(false);
      });
    }

    it.each([false, true])(`clears a natural death's pending walk stop before revival and the next movement in mode ${mode} (target in earlier slot=%s)`, (earlierSlot) => {
      const targetId = earlierSlot ? 1 : 2;
      const pickerId = earlierSlot ? 2 : 1;
      const row = earlierSlot ? "2..1...3......." : "1..2...3.......";
      const players = setups(3).map((p) => ({ ...p, character: "shaky", team: p.id === 3 ? 2 : 1 }));
      const state = createMatch(layoutFromAscii([row]), players, { ...VERSUS, mode }, 71);
      const target = byId(state, targetId);

      run(state, 150);
      step(state, { [targetId]: { dir: null, bomb: true } });
      run(state, 59);
      step(state, { [targetId]: { dir: Dir.Left, bomb: false } });
      step(state, {});
      expect(target.alive).toBe(false);
      expect(target.stopRequested).toBe(true);

      run(state, 36);
      run(state, 20, { [pickerId]: { dir: Dir.Right, bomb: false } });
      expect(state.events).toContainEqual({ type: "revived", playerId: targetId });
      expect(target.alive).toBe(true);
      expect(target.gone).toBe(false);
      expect(target.stopRequested).toBe(false);

      step(state, { [targetId]: { dir: Dir.Right, bomb: false } });
      expect(target.x).toBe(145);
      expect(target.anim).toBe(Anim.Walk + Dir.Right);
      expect(target.frame).toBe(1);
      expect(target.stopRequested).toBe(false);
    });
  }

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
    // Slot 2 also runs its common update after slot 1 revives it in this tick.
    expect(revived).toMatchObject({ alive: true, gone: false, x: 2 * 40 + 20, y: 16, anim: Anim.Stand + Dir.Down, frame: 1 });
    expect([revived.bombCapacity, revived.firePower, revived.speed]).toEqual([START_BOMBS, START_FIRE, START_SPEED]);
    expect(revived.badState).toEqual({ start: now, length: RESET_ICON_MS });
    expect(state.effects).toMatchObject([{ kind: "revival", owner: 2, follow: true, lifeMs: 0 }]);
    expect(events).toContainEqual({ type: "item-picked", playerId: picker.id, kind: ItemKind.Capsule });
    expect(events).toContainEqual({ type: "revived", playerId: 2 });
    expect(cell).toBe(2);
  });

  it("lets the one brought back act on a key held through the death: the dead read no key (0x4021bb), so their latch goes (0x45b5d7)", () => {
    const state = summonMatch([1, 1, 2, 2]);
    const space = { dir: null, bomb: true };
    const dead = byId(state, 2);
    state.flame[2] = 1;
    step(state, {});
    state.flame[2] = 0;
    expect(dead.alive).toBe(false);
    runUntil(state, () => dead.gone, 200, { 2: space });
    runUntil(state, () => dead.alive, 100, { 1: { dir: Dir.Right, bomb: false }, 2: space });
    expect(dead.actionLatch).toBe(false);

    step(state, { 2: space });
    expect(state.bombs.filter((b) => b.owner === 2)).toHaveLength(1);
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
    const second = Math.floor((state.clockMs + nowMs(state.tick)) / 1000);

    collectItem(state, byId(state, 1), 3);

    expect(byId(state, 2).alive).toBe(false);
    expect(state.items).toEqual([]);
    expect(state.effects).toEqual([]);
    expect(state.rng).toBe(second);
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

describe("curse expiry during the death animation (0x40acf7, 0x40b751)", () => {
  for (const mode of [6, 7] as const) {
    for (const victimId of [1, 2]) {
      const pickerId = victimId === 1 ? 2 : 1;
      const direction = victimId === 1 ? Dir.Left : Dir.Right;

      it(`keeps reset speed after a slow curse ends while dying, mode ${mode}, victim ${victimId}`, () => {
        const state = summonMatch([1, 1, 2, 2], mode);
        const victim = byId(state, victimId);
        applyPickup(state, victim, ItemKind.Teleport);
        applyPickup(state, victim, ItemKind.Speed);
        applyPickup(state, victim, ItemKind.Mystery, 33);
        const start = nowMs(state.tick);
        run(state, 285);
        expect(victim.speed).toBe(2);

        killOut(state, victimId, () => {
          runUntil(state, () => nowMs(state.tick) - start >= CURSE_MS, 30);
          expect(victim).toMatchObject({ alive: false, gone: false, speed: 2 });
          expect(victim.status.slow).toBe(start);

          step(state, {});

          expect(victim).toMatchObject({ alive: false, gone: false, speed: 6 });
          expect(victim.status.slow).toBeNull();
        });

        expect(nowMs(state.tick) - start).toBeGreaterThan(CURSE_MS);
        expect(victim.status.slow).toBeNull();
        expect(victim.speed).toBe(6);
        expect(state.items.some((item) => item.kind === ItemKind.Speed && item.dropped)).toBe(true);
        runUntil(state, () => victim.alive, 100, { [pickerId]: { dir: direction, bomb: false } });
        expect(victim.inv.teleport).toBe(1);
        expect(victim.speed).toBe(START_SPEED);
        run(state, 3);
        expect(victim.speed).toBe(START_SPEED);
      });

      it(`handles held B immediately after reviving when prohibition ended while dying, mode ${mode}, victim ${victimId}`, () => {
        const state = summonMatch([1, 1, 2, 2], mode);
        const victim = byId(state, victimId);
        applyPickup(state, victim, ItemKind.Teleport);
        applyPickup(state, victim, ItemKind.Mystery, 35);
        const start = nowMs(state.tick);
        const held = { dir: null, bomb: true, attack: true, evade: true };
        run(state, 285, { [victimId]: held });
        const cell = victimId === 1 ? 0 : 2;
        state.flame[cell] = 1;
        step(state, { [victimId]: held });
        state.flame[cell] = 0;
        runUntil(state, () => nowMs(state.tick) - start >= CURSE_MS, 30, { [victimId]: held });
        expect(victim).toMatchObject({ alive: false, gone: false });
        expect(victim.status.noBomb).toBe(start);

        step(state, { [victimId]: held });

        expect(victim).toMatchObject({ alive: false, gone: false });
        expect(victim.status.noBomb).toBeNull();
        runUntil(state, () => victim.gone, 200, { [victimId]: held });

        expect(nowMs(state.tick) - start).toBeGreaterThan(CURSE_MS);
        expect(victim.status.noBomb).toBeNull();
        runUntil(state, () => victim.alive, 100, { [pickerId]: { dir: direction, bomb: false }, [victimId]: held });
        expect(victim.actionLatch).toBe(false);

        step(state, { [victimId]: held });

        expect(state.bombs.filter((bomb) => bomb.owner === victimId)).toHaveLength(1);
        expect(victim.inv.teleport).toBe(1);
        expect(victim.flight).toBeNull();
        run(state, 3, { [victimId]: held });
        expect(state.bombs.filter((bomb) => bomb.owner === victimId)).toHaveLength(1);
      });
    }
  }
});
