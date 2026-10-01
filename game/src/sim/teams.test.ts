import { describe, expect, it } from "vitest";

import { createMatch, removePlayer, step } from "./match.ts";
import { isFirepowerMode, isSummonMode, isTeamMode } from "./modes.ts";
import { layoutFromAscii, run, setups, VERSUS } from "./testing.ts";
import type { GameMode, MatchState, SimEvent } from "./types.ts";

const ARENA = ["1...2", ".#.#.", "3...4"];
const TO_PLAY = 150;

function teamMatch(teams: number[], mode: GameMode = 1): MatchState {
  const players = setups(teams.length).map((setup, i) => ({ ...setup, team: teams[i] }));
  const state = createMatch(layoutFromAscii(ARENA), players, { ...VERSUS, mode }, 1);
  run(state, TO_PLAY);
  return state;
}

function burn(state: MatchState, ids: number[]): void {
  for (const p of state.players) {
    if (ids.includes(p.id)) state.flame[Math.floor(p.y / 32) * state.layout.width + Math.floor(p.x / 40)] = 1;
  }
}

/** Run until the phase leaves play or `limit` frames pass, collecting every event on the way. */
function playOut(state: MatchState, limit = 120): SimEvent[] {
  const events: SimEvent[] = [];
  for (let i = 0; i < limit && state.phase === "playing"; i++) {
    step(state, {});
    events.push(...state.events);
  }
  return events;
}

describe("mode predicates (0x440680 callers)", () => {
  it("tells team, 화력 and 소환 modes apart, and nothing else", () => {
    const modes = [0, 1, 2, 3, 4, 5, 6, 7] as const;
    expect(modes.filter(isTeamMode)).toEqual([1, 2, 4, 5, 6, 7]);
    expect(modes.filter(isFirepowerMode)).toEqual([3, 4, 5]);
    expect(modes.filter(isSummonMode)).toEqual([6, 7]);
  });
});

describe("team round end (0x441130)", () => {
  it("gives the round to the team every standing player is on, with a medal for each member, dead ones too", () => {
    const state = teamMatch([1, 1, 2, 2]);
    burn(state, [2, 3, 4]);

    const events = playOut(state);

    expect(state.phase).toBe("round-over");
    expect(state.roundWinnerTeam).toBe(1);
    expect(events).toContainEqual({ type: "round-over", winnerId: null, winnerTeam: 1 });
    expect(state.players.map((p) => p.medals)).toEqual([1, 1, 0, 0]);
  });

  it("plays on while two teams still have someone standing", () => {
    const state = teamMatch([1, 1, 2, 2]);
    burn(state, [2, 3]);

    playOut(state, 90);

    expect(state.phase).toBe("playing");
    expect(state.players.filter((p) => p.gone).map((p) => p.id)).toEqual([2, 3]);
  });

  it("ends the match when the winning team already had two wins", () => {
    const state = teamMatch([1, 2, 1, 2]);
    for (const p of state.players) p.medals = p.team === 2 ? 2 : 1;
    burn(state, [1, 3]);

    const events = playOut(state);

    expect(state.phase).toBe("match-over");
    expect(state.matchWinnerTeam).toBe(2);
    expect(events).toContainEqual({ type: "match-over", winnerId: null, winnerTeam: 2 });
    expect(state.players.map((p) => p.medals)).toEqual([1, 3, 1, 3]);
  });

  it("ends the match once every player left in the room is on the winning team, short of three wins", () => {
    const state = teamMatch([1, 1, 2]);

    removePlayer(state, 3);

    expect(state.phase).toBe("match-over");
    expect(state.matchWinnerTeam).toBe(1);
    expect(state.players.map((p) => p.medals)).toEqual([1, 1]);
  });

  it("gives the round to the team of the last player out when nobody is left standing", () => {
    const state = teamMatch([1, 2]);
    state.players[1].gone = true;
    state.players[1].alive = false;

    removePlayer(state, 1);

    expect(state.roundWinnerTeam).toBe(1);
    expect(state.phase).toBe("round-over");
  });

  it("ignores teams in the individual modes 0 and 3", () => {
    for (const mode of [0, 3] as const) {
      const state = teamMatch([1, 1, 2], mode);
      burn(state, [3]);

      playOut(state, 90);

      expect(state.phase).toBe("playing");
    }
  });

  it("calls a time-out a draw without medals in team modes too", () => {
    const players = setups(2).map((setup, i) => ({ ...setup, team: i + 1 }));
    const state = createMatch(layoutFromAscii(ARENA), players, { ...VERSUS, mode: 1, roundSeconds: 3 }, 1);
    run(state, TO_PLAY);
    state.suddenDeath.lastMs = Infinity;

    playOut(state, 200);

    expect(state.draw).toBe(true);
    expect(state.roundWinnerTeam).toBeNull();
    expect(state.players.every((p) => p.medals === 0)).toBe(true);
  });
});

describe("individual round end with one player left in the room (0x441130)", () => {
  it("ends the match when the only other player leaves", () => {
    const state = teamMatch([0, 0], 0);

    removePlayer(state, 2);

    expect(state.phase).toBe("match-over");
    expect(state.matchWinnerId).toBe(1);
    expect(state.players[0].medals).toBe(1);
  });

  it("ends the match when the only other player leaves on the round's result screen, with no second medal", () => {
    const state = teamMatch([0, 0], 0);
    burn(state, [1]);
    playOut(state);
    expect(state.phase).toBe("round-over");
    expect(state.roundWinnerId).toBe(2);

    removePlayer(state, 2);

    expect(state.phase).toBe("match-over");
    expect(state.matchWinnerId).toBe(1);
    expect(state.players[0].medals).toBe(0);
  });

  it("ends a team match when everyone left on the round's result screen is on one team", () => {
    const state = teamMatch([1, 1, 2]);
    burn(state, [3]);
    playOut(state);
    expect(state.phase).toBe("round-over");
    expect(state.roundWinnerTeam).toBe(1);

    removePlayer(state, 3);
    expect(state.phase).toBe("match-over");
    expect(state.matchWinnerTeam).toBe(1);
    expect(state.players.map((p) => p.medals)).toEqual([1, 1]);
  });

  it("goes on to the next round when players of two teams are left", () => {
    const state = teamMatch([1, 1, 2, 2]);
    burn(state, [3, 4]);
    playOut(state);
    expect(state.phase).toBe("round-over");

    removePlayer(state, 1);
    expect(state.phase).toBe("round-over");
  });
});
