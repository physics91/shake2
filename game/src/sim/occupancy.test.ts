import { describe, expect, it } from "vitest";

import { FIRE_FRAMES, LONG_AGO_MS } from "./constants.ts";
import { playersIn } from "./grid.ts";
import { localMarkFor } from "./practice.ts";
import { deathFrames } from "./sheets.ts";
import { addBomb, cellCenter, PRACTICE, playingMatch, run, runUntil, VERSUS } from "./testing.ts";
import type { BombState, MatchState, PlayerState, Rules } from "./types.ts";
import { BombKind, Dir } from "./types.ts";

// The occupancy bits (tile C bits 10-18): every cell's bits are cleared before the player loop
// (0x45e9a0) and each player sets its own after its update (0x45e920), so the bomb pass, which
// comes first, sees the last loop's bits.

const ROW = ["1.2.3........."];

function match(rules: Rules): MatchState {
  return playingMatch(ROW, 3, rules);
}

/** Practice as createPractice sets it up: the last player is the local one, the others are dummies. */
function practice(rows = ROW, players = 3): MatchState {
  const state = playingMatch(rows, players, PRACTICE);
  const local = state.players[players - 1];
  for (const player of state.players) player.dummy = player !== local;
  state.localMark = localMarkFor(local.id);
  return state;
}

function standAt(state: MatchState, player: PlayerState, col: number, row = 0): void {
  Object.assign(player, cellCenter(state, col, row));
}

/** A bomb rolling right at x, not yet braking, with cells to go. */
function rollingRight(state: MatchState, x: number, row = 0): BombState {
  const cell = row * state.layout.width + Math.floor(x / state.layout.cellW);
  return addBomb(state, cell, { x, motion: Dir.Right + 1, anim: BombKind.Normal + 1, rollLeft: 5 });
}

/** An exploded bomb whose fire goes out on the next update. */
function endingFire(state: MatchState, owner: number, fireCells: number[], kind: BombKind = BombKind.Normal): BombState {
  return addBomb(state, fireCells[0], {
    owner,
    kind,
    anim: kind,
    exploded: true,
    fireCells,
    fireFrame: FIRE_FRAMES - 1,
    fireMs: LONG_AGO_MS,
  });
}

describe("occupancy after a death animation ends", () => {
  function goneThisTick(state: MatchState): MatchState {
    const dying = state.players[0];
    standAt(state, dying, 7);
    Object.assign(dying, { alive: false, frame: deathFrames(dying.character) - 1, animMs: LONG_AGO_MS });
    run(state, 1);
    expect(dying.gone).toBe(true);
    return state;
  }

  it("practice keeps the player in its cell for the rest of the tick and the next bomb pass (0x407f4d, 0x4083ad)", () => {
    const state = goneThisTick(practice());
    expect(playersIn(state, 7).map((p) => p.id)).toEqual([1]);

    const bomb = rollingRight(state, 275);
    run(state, 1);
    expect(bomb).toMatchObject({ x: 260, braking: true, cell: 6 });
    expect(playersIn(state, 7)).toEqual([]);
  });

  it("the network game drops the player at once (0x45e8a0 at 0x40ad4d, 0x40b7be)", () => {
    const state = goneThisTick(match(VERSUS));
    expect(playersIn(state, 7)).toEqual([]);

    const bomb = rollingRight(state, 275);
    run(state, 1);
    expect(bomb).toMatchObject({ x: 280, braking: false, cell: 7 });
  });
});

describe("a fire's end hides its owner in its arm cells until the player loop (0x40e510, 0x407277)", () => {
  it("a bomb later in the list rolls into the owner's arm cell in that update", () => {
    const state = match(VERSUS);
    standAt(state, state.players[0], 7);
    endingFire(state, 1, [8, 7, 9]);
    const bomb = rollingRight(state, 275);

    run(state, 1);
    expect(bomb).toMatchObject({ x: 280, braking: false, cell: 7 });
    expect(playersIn(state, 7).map((p) => p.id)).toEqual([1]);
  });

  it("a bomb earlier in the list still sees the owner", () => {
    const state = match(VERSUS);
    standAt(state, state.players[0], 7);
    const bomb = rollingRight(state, 275);
    endingFire(state, 1, [8, 7, 9]);

    run(state, 1);
    expect(bomb).toMatchObject({ x: 260, braking: true, cell: 6 });
  });

  it("hides only the owner, and never in the centre cell", () => {
    const other = match(VERSUS);
    standAt(other, other.players[0], 7);
    endingFire(other, 2, [8, 7, 9]);
    const blockedByOther = rollingRight(other, 275);
    run(other, 1);
    expect(blockedByOther).toMatchObject({ x: 260, braking: true });

    const centre = match(VERSUS);
    standAt(centre, centre.players[0], 7);
    endingFire(centre, 1, [7, 6, 8]);
    const blockedAtCentre = rollingRight(centre, 275);
    run(centre, 1);
    expect(blockedAtCentre).toMatchObject({ x: 260, braking: true, cell: 6 });
  });

  it("a nuke hides its owner in cells 0..k-1, the loop count, not in its own cells (0x407604)", () => {
    const rows = ["..............", "1.2.3.........", ".............."];
    const hidden = playingMatch(rows, 3, VERSUS);
    standAt(hidden, hidden.players[0], 2);
    endingFire(hidden, 1, [30, 31, 32], BombKind.Nuke);
    const passes = rollingRight(hidden, 75);
    run(hidden, 1);
    expect(passes).toMatchObject({ x: 80, braking: false, cell: 2 });

    const shown = playingMatch(rows, 3, VERSUS);
    standAt(shown, shown.players[0], 2);
    endingFire(shown, 1, [30, 31], BombKind.Nuke);
    const stops = rollingRight(shown, 75);
    run(shown, 1);
    expect(stops).toMatchObject({ x: 60, braking: true, cell: 1 });
  });
});

describe("practice: the local player's bit goes where the last dummy stands (0x40840a, 0x4929a4)", () => {
  /** Dummies 1 and 2 at columns 0 and 7, the local player 3 at column 4; one loop has run. */
  function lastDummyAt7(): MatchState {
    const state = practice();
    standAt(state, state.players[1], 7);
    run(state, 1);
    return state;
  }

  it("each dummy's update leaves its own position for the local player's set (0x407fd2)", () => {
    const state = lastDummyAt7();
    run(state, 1);
    expect(playersIn(state, 7).map((p) => p.id)).toEqual([2, 3]);
    expect(playersIn(state, 4)).toEqual([]);
  });

  it("a bomb the local player kicked rolls into the last dummy's cell", () => {
    const state = lastDummyAt7();
    const bomb = Object.assign(rollingRight(state, 275), { kicker: 3 });
    run(state, 1);
    expect(bomb).toMatchObject({ x: 280, braking: false, cell: 7 });
  });

  it("the other dummies still stop it", () => {
    const state = practice();
    standAt(state, state.players[0], 7);
    run(state, 1);
    const bomb = Object.assign(rollingRight(state, 275), { kicker: 3 });
    run(state, 1);
    expect(bomb).toMatchObject({ x: 260, braking: true, cell: 6 });
  });

  it("a 직격탄 goes into the last dummy's cell and goes off there", () => {
    const state = lastDummyAt7();
    const bomb = Object.assign(rollingRight(state, 250), { kicker: 3, fast: true });
    runUntil(state, () => bomb.exploded, 30);
    expect(bomb.cell).toBe(7);
  });

  it("a dummy in the local player's cell stops its bomb, except in the loop the local player entered it (0x450230)", () => {
    const shared = (): MatchState => {
      const state = practice();
      standAt(state, state.players[0], 7);
      standAt(state, state.players[2], 7);
      return state;
    };
    // The constructor leaves +0x184 at 0, so the first move counts as entering the cell.
    const entered = shared();
    run(entered, 1);
    const passes = Object.assign(rollingRight(entered, 275), { kicker: 3 });
    run(entered, 1);
    expect(passes).toMatchObject({ x: 280, braking: false, cell: 7 });

    const settled = shared();
    run(settled, 2);
    const stops = Object.assign(rollingRight(settled, 275), { kicker: 3 });
    run(settled, 1);
    expect(stops).toMatchObject({ x: 260, braking: true, cell: 6 });
  });

  it("points at the local player on the update its death starts (0x40829c), then at the last dummy again", () => {
    const state = lastDummyAt7();
    run(state, 1);
    const local = state.players[2];
    state.flame[4] = 1;
    run(state, 1);
    expect(local.alive).toBe(false);
    expect(playersIn(state, 4).map((p) => p.id)).toEqual([3]);
    expect(playersIn(state, 7).map((p) => p.id)).toEqual([2]);

    state.flame[4] = 0;
    run(state, 1);
    expect(playersIn(state, 4)).toEqual([]);
    expect(playersIn(state, 7).map((p) => p.id)).toEqual([2, 3]);
  });
});
