import { describe, expect, it } from "vitest";

import { NETWORK_SPAWNS, START_FIRE } from "./constants.ts";
import { countdownValue, createMatch, matchResultDone, step } from "./match.ts";
import { layoutFromAscii, PRACTICE, run, runUntil, setups, VERSUS } from "./testing.ts";
import { msvcRand } from "./rng.ts";
import { rollHiddenItems } from "./world.ts";
import type { InputFrame, MatchState, PlayerState } from "./types.ts";
import { CellKind, Dir } from "./types.ts";

const ARENA = ["1...2", ".#B#.", "3...4"];

/** Wait (1 s) and countdown (4 s): 150 logic frames at 30 Hz. */
const TO_PLAY = 150;

function burnPlayers(state: MatchState, ids: number[]): void {
  for (const p of state.players) {
    if (!ids.includes(p.id)) continue;
    state.flame[Math.floor(p.y / 32) * state.layout.width + Math.floor(p.x / 40)] = 1;
  }
}

/** Flame under the player for one update: its death starts on it. */
function killNow(state: MatchState, id: number, inputs: Record<number, InputFrame> = {}): void {
  const p = state.players.find((q) => q.id === id)!;
  const cell = Math.floor(p.y / 32) * state.layout.width + Math.floor(p.x / 40);
  state.flame[cell] = 1;
  step(state, inputs);
  state.flame[cell] = 0;
  expect(p.alive).toBe(false);
}

/** Players of the given characters, each on its own team. */
function cast(characters: string[]) {
  return characters.map((character, i) => ({ id: i + 1, name: `P${i + 1}`, character, team: i + 1 }));
}

describe("round start", () => {
  it("spawns players at (cellX + 20, cellY + 16) and waits 1 s before the countdown", () => {
    const state = createMatch(layoutFromAscii(ARENA), setups(4), VERSUS, 1);

    expect(state.players.map((p) => [p.x, p.y])).toEqual([
      [20, 16],
      [180, 16],
      [20, 80],
      [180, 80],
    ]);
    expect(state.phase).toBe("waiting");
    expect(state.events).toContainEqual({ type: "round-start", round: 1 });

    run(state, 29);
    expect(state.phase).toBe("waiting");
    run(state, 1);
    expect(state.phase).toBe("countdown");
  });

  it("draws each slot's spawn point every round, rand() % 8, never a point still in the table (0x44dd79)", () => {
    const open = Array.from({ length: 15 }, () => ".".repeat(15));
    const layout = { ...layoutFromAscii(open), spawns: [...NETWORK_SPAWNS], rollSpawns: true };
    const state = createMatch(layout, setups(2), VERSUS, 5);
    const pointOf = (p: PlayerState) => NETWORK_SPAWNS.indexOf((((p.y - 16) / 32) * 15 + (p.x - 20) / 40) as never);

    const rng = { rng: 5 };
    const table = [-1, -1];
    for (const slot of [0, 1]) {
      let point: number;
      do point = msvcRand(rng) % 8;
      while (table.includes(point));
      table[slot] = point;
    }
    expect(state.players.map(pointOf)).toEqual(table);

    run(state, TO_PLAY);
    burnPlayers(state, [2]);
    runUntil(state, () => state.phase === "waiting" && state.round === 2);
    const [first, second] = state.players.map(pointOf);
    expect([table[0], table[1]]).not.toContain(first);
    expect([first, table[1]]).not.toContain(second);
  });

  it("never draws point 0: the comparison reads on past the six entries to a word that is always 0 (0x44dd93, 0x471720)", () => {
    const open = Array.from({ length: 15 }, () => ".".repeat(15));
    const layout = { ...layoutFromAscii(open), spawns: [...NETWORK_SPAWNS], rollSpawns: true };
    // srand(1700000003): the first rand() % 8 is 0, so slot 0 draws again.
    const state = createMatch(layout, setups(2), VERSUS, 0, 1_700_000_003_000);
    const rng = { rng: 1_700_000_003 };
    expect(msvcRand(rng) % 8).toBe(0);
    const table = [-1, -1];
    for (const slot of [0, 1]) {
      let point: number;
      do point = msvcRand(rng) % 8;
      while (point === 0 || table.includes(point));
      table[slot] = point;
    }
    expect(state.spawnPoints.slice(0, 2)).toEqual(table);

    for (let second = 1_700_000_000; second < 1_700_000_200; second++) {
      const match = createMatch(layout, setups(6), VERSUS, 0, second * 1000);
      expect(match.spawnPoints).not.toContain(0);
    }
  });

  it("seeds rand() with the clock's second at each world load and again before the brick items (0x44d77c, 0x44e2a0)", () => {
    const rows = Array.from({ length: 15 }, (_, y) => (y % 2 ? ".".repeat(15) : "B.".repeat(7) + "B"));
    const layout = { ...layoutFromAscii(rows), spawns: [...NETWORK_SPAWNS], rollSpawns: true };
    const clockMs = 1_700_000_000_250;
    const second = Math.floor(clockMs / 1000);
    const a = createMatch(layout, setups(2), VERSUS, 5, clockMs);
    const b = createMatch(layout, setups(2), VERSUS, 9, clockMs);
    // The match's own seed no longer matters: both draws start from srand(time(0)).
    expect(b.spawnPoints).toEqual(a.spawnPoints);
    expect(b.hidden).toEqual(a.hidden);

    const rng = { rng: second };
    const table = [-1, -1];
    for (const slot of [0, 1]) {
      let point: number;
      do point = msvcRand(rng) % 8;
      while (table.includes(point));
      table[slot] = point;
    }
    expect(a.spawnPoints.slice(0, 2)).toEqual(table);
    // Within the same second the items start over from the spawns' first number.
    const fresh = createMatch(layout, setups(2), VERSUS, 5, clockMs);
    fresh.rng = second;
    rollHiddenItems(fresh);
    expect(a.hidden).toEqual(fresh.hidden);
  });

  it("counts 3, 2, 1, shows START after 3 s and starts play at 4 s, ignoring input until then", () => {
    const state = createMatch(layoutFromAscii(ARENA), setups(2), VERSUS, 1);
    run(state, 30);
    const seen: number[] = [];
    let startTick = -1;
    while (state.phase === "countdown") {
      step(state, { 1: { dir: Dir.Right, bomb: true } });
      if (state.phase === "countdown") seen.push(countdownValue(state));
      if (state.events.some((e) => e.type === "start-shown")) startTick = state.tick;
    }

    expect([...new Set(seen)]).toEqual([3, 2, 1, 0]);
    expect(startTick).toBe(30 + 91);
    expect(state.tick).toBe(TO_PLAY);
    expect(state.events).toContainEqual({ type: "go" });
    expect(state.bombs).toEqual([]);
    expect(state.players[0].x).toBe(20);
  });

  it("takes the first clock second on the first playing frame, then one per 30 frames", () => {
    const state = createMatch(layoutFromAscii(ARENA), setups(2), VERSUS, 1);
    run(state, TO_PLAY);
    expect(state.timerSeconds).toBe(150);

    run(state, 1);
    expect(state.timerSeconds).toBe(149);
    run(state, 29);
    expect(state.timerSeconds).toBe(149);
    run(state, 1);
    expect(state.timerSeconds).toBe(148);
  });

  it("raises Hurry once when the clock reaches 70 s", () => {
    const state = createMatch(layoutFromAscii(ARENA), setups(2), VERSUS, 1);
    run(state, TO_PLAY);
    state.timerSeconds = 72;

    const hurries: number[] = [];
    for (let i = 0; i < 120; i++) {
      step(state, {});
      if (state.events.some((e) => e.type === "hurry")) hurries.push(state.timerSeconds);
    }

    expect(hurries).toEqual([70]);
  });

  it("takes no keys on the wait and countdown screens: Space held through them places a bomb at once (0x45aea1)", () => {
    const state = createMatch(layoutFromAscii(ARENA), setups(2), VERSUS, 1);
    const space: InputFrame = { dir: null, bomb: true };
    runUntil(state, () => state.phase === "playing", TO_PLAY + 10, { 1: space });
    expect(state.players[0].actionLatch).toBe(false);
    step(state, { 1: space });
    expect(state.bombs.filter((b) => b.owner === 1)).toHaveLength(1);
  });
});

describe("round end", () => {
  it("awards the survivor once the loser's death animation ends, then resets for the next round", () => {
    const state = createMatch(layoutFromAscii(ARENA), setups(2), VERSUS, 1);
    run(state, TO_PLAY);
    state.grid[7] = CellKind.Empty;
    state.players[0].firePower = 5;
    burnPlayers(state, [2]);

    run(state, 1);
    expect(state.players[1].alive).toBe(false);
    expect(state.phase).toBe("playing");
    const frames = runUntil(state, () => state.phase !== "playing");
    // 8 frames of 앞죽음 at 5 fps: 7 updates each, the first one sooner.
    expect(frames).toBeGreaterThan(7 * 7);
    expect(frames).toBeLessThanOrEqual(8 * 7);

    expect(state.phase).toBe("round-over");
    expect(state.events).toContainEqual({ type: "round-over", winnerId: 1, winnerTeam: null });
    expect(state.players[0].medals).toBe(1);

    run(state, 45);
    expect(state.round).toBe(2);
    expect(state.phase).toBe("waiting");
    expect(state.grid[7]).toBe(CellKind.Brick);
    expect(state.players.every((p) => p.alive && !p.gone)).toBe(true);
    expect(state.players[0].firePower).toBe(START_FIRE);
    expect(state.players[0].medals).toBe(1);
  });

  it("gives the medal to the last player out when nobody is left: the later slot in one update", () => {
    const state = createMatch(layoutFromAscii(ARENA), setups(2), VERSUS, 1);
    run(state, TO_PLAY);
    burnPlayers(state, [1, 2]);

    runUntil(state, () => state.phase !== "playing");

    expect(state.roundWinnerId).toBe(2);
    expect(state.players[1].medals).toBe(1);
  });

  it("counts a player out from the death's start (0x441110 at 0x40afb4): the later death wins though its animation ends first", () => {
    for (const mode of [0, 1] as const) {
      // doomsy's 앞죽음 has 9 frames, rookie's 8.
      const state = createMatch(layoutFromAscii(ARENA), cast(["doomsy", "rookie"]), { ...VERSUS, mode }, 1);
      const [p1, p2] = state.players;
      run(state, TO_PLAY);
      killNow(state, 1);
      run(state, 1);
      killNow(state, 2);
      runUntil(state, () => state.phase !== "playing");
      expect([p1.gone, p2.gone]).toEqual([false, true]);
      expect([state.roundWinnerId, state.roundWinnerTeam]).toEqual(mode === 0 ? [2, null] : [null, 2]);
      expect([p1.medals, p2.medals]).toEqual([0, 1]);
    }
  });

  it("decides the round at the first death end when one player alone has not started dying (0x441130)", () => {
    const state = createMatch(layoutFromAscii(ARENA), cast(["rookie", "rookie", "rookie"]), VERSUS, 1);
    const [p1, p2] = state.players;
    run(state, TO_PLAY);
    killNow(state, 1);
    run(state, 7); // one death frame later
    killNow(state, 2);
    runUntil(state, () => p1.gone);
    expect(p2.gone).toBe(false);
    expect([state.phase, state.roundWinnerId]).toEqual(["round-over", 3]);
  });

  it("ends the match straight away on the third medal", () => {
    const state = createMatch(layoutFromAscii(ARENA), setups(2), VERSUS, 1);
    state.players[1].medals = 2;
    run(state, TO_PLAY);
    burnPlayers(state, [1]);

    const events: string[] = [];
    runUntil(state, () => {
      events.push(...state.events.map((e) => e.type));
      return state.phase !== "playing";
    });
    events.push(...state.events.map((e) => e.type));

    expect(state.phase).toBe("match-over");
    expect(state.matchWinnerId).toBe(2);
    expect(events).not.toContain("round-over");
    expect(matchResultDone(state)).toBe(false);
    run(state, 150);
    expect(matchResultDone(state)).toBe(true);
  });

  it("declares a draw without medals when the clock runs out", () => {
    const state = createMatch(layoutFromAscii(ARENA), setups(2), { ...VERSUS, roundSeconds: 3 }, 1);
    run(state, TO_PLAY);
    state.suddenDeath.lastMs = Infinity; // below 60 s it would close the arena first

    runUntil(state, () => state.phase !== "playing");

    expect(state.phase).toBe("round-over");
    expect(state.draw).toBe(true);
    expect(state.roundWinnerId).toBeNull();
    expect(state.players.every((p) => p.medals === 0)).toBe(true);
  });

  it("never ends a practice round: the player's death brings up the box and play runs on", () => {
    const state = createMatch(layoutFromAscii(ARENA), setups(1), PRACTICE, 1);
    run(state, 10);
    burnPlayers(state, [1]);

    runUntil(state, () => state.events.some((e) => e.type === "practice-over"));
    run(state, 45);

    expect(state.phase).toBe("playing");
    expect(state.players[0].gone).toBe(true);
    expect(state.players[0].medals).toBe(0);
  });
});

describe("walking", () => {
  it("keeps walking after the key is released until the walk animation next advances", () => {
    const state = createMatch(layoutFromAscii(["1......"]), setups(1), PRACTICE, 1);
    run(state, TO_PLAY);
    const player = state.players[0];

    run(state, 3, { 1: { dir: Dir.Right, bomb: false } });
    expect(player.anim).toBe(Dir.Right);
    const x = player.x;
    const released = runUntil(state, () => player.anim !== Dir.Right, 10);

    expect(player.anim).toBe(4 + Dir.Right);
    expect(player.x - x).toBe(released * 5);
  });

  it("reports a footstep each time the 4-frame walk cycle wraps", () => {
    const state = createMatch(layoutFromAscii(["1" + ".".repeat(40)]), setups(1), PRACTICE, 1);
    run(state, TO_PLAY);

    const steps: number[] = [];
    for (let i = 0; i < 60; i++) {
      step(state, { 1: { dir: Dir.Right, bomb: false } });
      if (state.events.some((e) => e.type === "walk-cycle")) steps.push(state.tick);
    }

    // Speed 5: 18 fps, one frame per 2 updates (more than 55 ms), a cycle per 8 updates.
    const gaps = steps.slice(1).map((t, i) => t - steps[i]);
    expect(new Set(gaps)).toEqual(new Set([8]));
  });
});

describe("determinism", () => {
  it("is deterministic for the same seed and inputs", () => {
    const script: Record<number, InputFrame>[] = [
      { 1: { dir: Dir.Right, bomb: true }, 2: { dir: Dir.Left, bomb: false } },
      { 1: { dir: Dir.Down, bomb: false }, 2: { dir: null, bomb: true } },
    ];
    const results = [0, 1].map(() => {
      const state = createMatch(layoutFromAscii(["1B.B2", ".#B#.", "3.B.4"]), setups(2), VERSUS, 42);
      for (let t = 0; t < 900; t++) step(state, script[Math.floor(t / 37) % 2]);
      return JSON.stringify(state);
    });
    expect(results[0]).toBe(results[1]);
  });
});
