// What a finished match is worth to each account. In 0311 the host's client works out each slot's
// cell point share (0x440a90) and every player reports its own (C->S 0x4e, 0x44b1b0); the remake's
// server runs the match, so it works the same shares out itself and takes no report (R).
import { isTeamMode } from "../sim/modes.ts";
import type { GameMode } from "../sim/types.ts";

/** A slot's stake on the room screen (the "100" beside it): the pool is this much a player. */
export const STAKE = 100;
/** What a loser's medal is worth (0x440c77, 0x440b82). */
export const MEDAL_CELLS = 50;
/**
 * 한판더넷's rule (shake.hanpanthe.net/ranking/ranking.html, 2002-02-14): "플레이 도중 나간 사람에게는
 * -200셀의 벌점을 줍니다." The host's own (−players × 100) is for a match its PC ran; the remake's
 * server runs every match, so a host who leaves is only a player who leaves (R).
 */
export const LEAVE_PENALTY = 200;

export interface Finisher {
  id: number;
  team: number;
  medals: number;
}

export interface MatchEnd {
  mode: GameMode;
  /** The match's last round, 1 the first: the original's round counter [0x140] + 1. */
  round: number;
  /** Players in the room as the first round's countdown ended (0x4413e0 from 0x40c974). */
  startCount: number;
  /** Players still in the room at the end. */
  finishers: readonly Finisher[];
  winnerId: number | null;
  winnerTeam: number | null;
}

export interface Share {
  /** The slot's +0x34: added to the account's cell points. */
  cell: number;
  /** The slot's +0x28. */
  won: boolean;
}

/** Each finisher's share (0x440a90). */
export function cellShares(end: MatchEnd): Map<number, Share> {
  const shares = new Map<number, Share>(end.finishers.map((f) => [f.id, { cell: 0, won: false }]));
  if (isTeamMode(end.mode)) teamShares(end, shares);
  else individualShares(end, shares);
  return shares;
}

/**
 * 0x440c37: the pool set as the first round began (0x4413e0) less 50 a medal for every loser
 * still there. A winner left alone with under three medals gets 50 a medal instead; otherwise
 * the winner takes the rest and 20 a player still there if no loser has a medal, else 10 a round.
 */
function individualShares(end: MatchEnd, shares: Map<number, Share>): void {
  let pool = STAKE * end.startCount;
  let noLoserMedal = true;
  for (const f of end.finishers) {
    const share = shares.get(f.id)!;
    if (f.id === end.winnerId) {
      share.won = true;
      continue;
    }
    if (f.medals <= 0) continue;
    share.cell = MEDAL_CELLS * f.medals;
    noLoserMedal = false;
    pool -= share.cell;
  }
  const winner = end.finishers.find((f) => f.id === end.winnerId);
  if (!winner) return;
  if (end.finishers.length === 1 && winner.medals < 3) pool = MEDAL_CELLS * winner.medals;
  else pool += noLoserMedal ? 20 * end.finishers.length : 10 * end.round;
  shares.get(winner.id)!.cell = pool;
}

/**
 * 0x440ab0: the pool is 100 a player still there (0x440b5a). When a loser has a medal, every
 * loser gets 50 a medal out of it. The winners split the rest (a whole division), each adding
 * 20 a player still there if no loser has a medal, else 10 a round, and the last digit is cut.
 */
function teamShares(end: MatchEnd, shares: Map<number, Share>): void {
  let pool = STAKE * end.finishers.length;
  const losers = end.finishers.filter((f) => f.team !== end.winnerTeam);
  const winners = end.finishers.filter((f) => f.team === end.winnerTeam);
  const noLoserMedal = !losers.some((f) => f.medals > 0);
  if (!noLoserMedal) {
    for (const f of losers) {
      const cell = MEDAL_CELLS * f.medals;
      shares.get(f.id)!.cell = cell;
      pool -= cell;
    }
  }
  // The original divides by the winners left without a check (idiv, 0x440bb1).
  if (winners.length === 0) return;
  const each = roundShare(Math.trunc(pool / winners.length) + (noLoserMedal ? 20 * end.finishers.length : 10 * end.round));
  for (const f of winners) Object.assign(shares.get(f.id)!, { cell: each, won: true });
}

/** 0x440bd4: a last digit of 1..4 is dropped and 6..8 becomes 5; 0, 5, 9 and below 0 stay. */
export function roundShare(share: number): number {
  const digit = share % 10;
  if (digit > 0 && digit < 5) return share - digit;
  if (digit > 5 && digit < 9) return share + 5 - digit;
  return share;
}
