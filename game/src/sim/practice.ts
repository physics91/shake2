// Practice (scene 9, loader 0x4542d0): practice.MAP with three dummies to practise on.
import { PRACTICE_CHARACTERS, ROUND_SECONDS } from "./constants.ts";
import { createMatch } from "./match.ts";
import { msvcRand } from "./rng.ts";
import type { LevelLayout, LocalMark, MatchState, PlayerSetup, Rules } from "./types.ts";
import { placePracticeItems } from "./world.ts";

/** Dummies at the top row's left, centre and right (0x469b8c), the local player at row 6, col 7 (0x469bac). */
export const PRACTICE_SPAWNS = [0, 7, 14, 97] as const;

/** Practice sets its timer to 150 s (0x457480) and never ends a round. */
export const PRACTICE_RULES: Rules = { practice: true, roundSeconds: ROUND_SECONDS, medalsToWin: 1, mode: 0 };

const DUMMIES = 3;

/**
 * The loader seeds rand() with the clock's second, `seed` (srand(time(0)), 0x4542dd), and first rolls each dummy's character, rand() % 18, so
 * characters 18 and 19 never appear and two dummies may match (0x454730). The local player comes
 * last, in slot 3 (0x454f44). The brick items roll on from the same generator; the display
 * items take no rand().
 */
export function createPractice(layout: LevelLayout, local: PlayerSetup, seed: number): MatchState {
  const rng = { rng: seed >>> 0 };
  const dummies: PlayerSetup[] = Array.from({ length: DUMMIES }, (_, i) => {
    const character = PRACTICE_CHARACTERS[msvcRand(rng) % PRACTICE_CHARACTERS.length];
    return { id: local.id + 1 + i, name: character, character };
  });
  const spawns = { spawns: [...PRACTICE_SPAWNS], rollSpawns: false };
  const state = createMatch({ ...layout, ...spawns }, [...dummies, local], PRACTICE_RULES, rng.rng, seed * 1000);
  for (const player of state.players) player.dummy = player.id !== local.id;
  state.localMark = localMarkFor(local.id);
  placePracticeItems(state);
  return state;
}

export function localMarkFor(playerId: number): LocalMark {
  return { playerId, x: 0, y: 0, placed: false, lastCell: 0, entered: null };
}
