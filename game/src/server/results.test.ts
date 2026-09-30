import { describe, expect, it } from "vitest";

import type { MatchEnd } from "./results.ts";
import { cellShares, LEAVE_PENALTY, roundShare } from "./results.ts";

const player = (id: number, medals: number, team = 1) => ({ id, team, medals });

function shares(end: MatchEnd): Record<number, [number, boolean]> {
  return Object.fromEntries([...cellShares(end)].map(([id, share]) => [id, [share.cell, share.won]]));
}

describe("the individual modes' shares (0x440c37)", () => {
  it("takes 50 a medal off the pool for the losers and adds 10 a round when a loser has one", () => {
    const end = { mode: 0, round: 4, startCount: 3, winnerId: 1, winnerTeam: null, finishers: [player(1, 3), player(2, 1), player(3, 0)] } as const;
    expect(shares(end)).toEqual({ 1: [300 - 50 + 40, true], 2: [50, false], 3: [0, false] });
  });

  it("adds 20 a player still there when no loser has a medal", () => {
    const end = { mode: 3, round: 3, startCount: 2, winnerId: 2, winnerTeam: null, finishers: [player(1, 0), player(2, 3)] } as const;
    expect(shares(end)).toEqual({ 1: [0, false], 2: [200 + 40, true] });
  });

  it("keeps the pool of the first round's players when some have left", () => {
    const end = { mode: 0, round: 5, startCount: 4, winnerId: 1, winnerTeam: null, finishers: [player(1, 3), player(2, 2)] } as const;
    expect(shares(end)).toEqual({ 1: [400 - 100 + 50, true], 2: [100, false] });
  });

  it("gives a winner left alone 50 a medal under three, and the pool and 20 with three", () => {
    const alone = (medals: number) => ({ mode: 0, round: 2, startCount: 3, winnerId: 1, winnerTeam: null, finishers: [player(1, medals)] }) as const;
    expect(shares(alone(1))).toEqual({ 1: [50, true] });
    expect(shares(alone(3))).toEqual({ 1: [300 + 20, true] });
  });
});

describe("the team modes' shares (0x440ab0)", () => {
  it("splits the pool of the players still there among the winners, adding 20 each of them", () => {
    const end = {
      mode: 1,
      round: 3,
      startCount: 4,
      winnerId: null,
      winnerTeam: 1,
      finishers: [player(1, 3, 1), player(2, 3, 1), player(3, 3, 1), player(4, 0, 2)],
    } as const;
    // 400 / 3 = 133, + 80 = 213, which ends in 3 and loses it.
    expect(shares(end)).toEqual({ 1: [210, true], 2: [210, true], 3: [210, true], 4: [0, false] });
  });

  it("pays the losers' medals first and adds 10 a round", () => {
    const end = {
      mode: 2,
      round: 4,
      startCount: 6,
      winnerId: null,
      winnerTeam: 2,
      finishers: [player(1, 1, 1), player(2, 3, 2), player(3, 3, 2), player(4, 3, 2)],
    } as const;
    // (400 − 50) / 3 = 116, + 40 = 156, which ends in 6 and becomes 155.
    expect(shares(end)).toEqual({ 1: [50, false], 2: [155, true], 3: [155, true], 4: [155, true] });
  });

  it("pays nobody when no winner is left to divide by", () => {
    const end = { mode: 1, round: 3, startCount: 2, winnerId: null, winnerTeam: 2, finishers: [player(1, 1, 1)] } as const;
    expect(shares(end)).toEqual({ 1: [50, false] });
  });
});

describe("the team share's last digit (0x440bd4)", () => {
  it("drops 1..4, turns 6..8 into 5 and keeps 0, 5, 9 and negative remainders", () => {
    expect([200, 201, 204, 205, 206, 208, 209, -7].map(roundShare)).toEqual([200, 200, 200, 205, 205, 205, 209, -7]);
  });
});

describe("the leave penalty", () => {
  it("is ranking.html's 200 cells", () => {
    expect(LEAVE_PENALTY).toBe(200);
  });
});
