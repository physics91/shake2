import { describe, expect, it } from "vitest";

import { COUNTDOWN_MS } from "../sim/constants.ts";
import { createMatch, step } from "../sim/match.ts";
import { layoutFromAscii, setups, VERSUS } from "../sim/testing.ts";
import { balloonAt, Balloons, closesExitBox, countdownEnd, enterOpensChat, helpAllowed, HOST_SILENCE_MS, hostSilent, matchEscape, sendsChat } from "./matchChat.ts";

describe("match chat balloons (0x418940, 0x40c254)", () => {
  it("puts slot i's balloon at (606, 65 i + 8) and its lines from (608, 65 i + 11); practice's slot 3 is (606,203)", () => {
    expect(balloonAt(0)).toEqual({ x: 606, y: 8, textX: 608, textY: 11 });
    expect(balloonAt(3)).toEqual({ x: 606, y: 203, textX: 608, textY: 206 });
    expect(balloonAt(5)).toEqual({ x: 606, y: 333, textX: 608, textY: 336 });
  });

  it("shows a line for 5000 ms from when it was stored, and a later line of the same slot replaces it (0x45ec00)", () => {
    const balloons = new Balloons();
    balloons.say(2, "안녕", 1000);
    balloons.say(0, "하나", 1500);
    expect(balloons.shown(5999)).toEqual([
      { slot: 0, text: "하나" },
      { slot: 2, text: "안녕" },
    ]);
    expect(balloons.shown(6000)).toEqual([{ slot: 0, text: "하나" }]);
    // The echo from the host stores the own line again, so its 5 s start over.
    balloons.say(0, "하나", 3000);
    expect(balloons.shown(7999)).toEqual([{ slot: 0, text: "하나" }]);
    expect(balloons.shown(8000)).toEqual([]);
  });

  it("forgets every line when the next round's world loads (0x44d740)", () => {
    const balloons = new Balloons();
    balloons.say(1, "끝", 0);
    balloons.clear();
    expect(balloons.shown(1)).toEqual([]);
  });
});

describe("match chat keys (0x45fafd, 0x461590)", () => {
  const base = { help: false, chatOpen: false, host: false, round: 2, phase: "playing" as const };

  it("closes the help first, then the chat line", () => {
    expect(matchEscape({ ...base, help: true, chatOpen: true })).toBe("help");
    expect(matchEscape({ ...base, chatOpen: true })).toBe("chat");
  });

  it("leaves at once from the first round's wait screen, host or not", () => {
    expect(matchEscape({ ...base, round: 1, phase: "waiting" })).toBe("leave");
    expect(matchEscape({ ...base, round: 1, phase: "waiting", host: true })).toBe("leave");
  });

  it("asks a guest with the exit box anywhere else, and does nothing for the host", () => {
    expect(matchEscape({ ...base, round: 1, phase: "countdown" })).toBe("box");
    expect(matchEscape({ ...base, round: 2, phase: "waiting" })).toBe("box");
    expect(matchEscape({ ...base, phase: "round-over" })).toBe("box");
    expect(matchEscape({ ...base, host: true })).toBe("none");
    expect(matchEscape({ ...base, host: true, round: 2, phase: "waiting" })).toBe("none");
  });

  it("has the result screens and the later rounds' wait screen close the exit box every frame (0x40fd50, 0x410560, 0x4100e0)", () => {
    expect(closesExitBox("round-over", 1)).toBe(true);
    expect(closesExitBox("match-over", 3)).toBe(true);
    expect(closesExitBox("waiting", 2)).toBe(true);
    // The first wait screen keeps it (its Esc leaves at once, so no box is up there).
    expect(closesExitBox("waiting", 1)).toBe(false);
    expect(closesExitBox("countdown", 2)).toBe(false);
    expect(closesExitBox("playing", 2)).toBe(false);
  });

  it("has F1's help only in the countdown and play: the wait and result screens refuse it and turn it off (0x460285, 0x406054)", () => {
    expect(helpAllowed("countdown")).toBe(true);
    expect(helpAllowed("playing")).toBe(true);
    expect(helpAllowed("waiting")).toBe(false);
    expect(helpAllowed("round-over")).toBe(false);
    expect(helpAllowed("match-over")).toBe(false);
  });

  it("opens the line with Enter except on the result screens; the wait screen opens it unseen (0x45fec8)", () => {
    expect(enterOpensChat("waiting")).toBe(true);
    expect(enterOpensChat("countdown")).toBe(true);
    expect(enterOpensChat("playing")).toBe(true);
    expect(enterOpensChat("round-over")).toBe(false);
    expect(enterOpensChat("match-over")).toBe(false);
  });

  it("sends and keeps a line only in the countdown and in play (0x4462e4)", () => {
    expect(sendsChat("countdown")).toBe(true);
    expect(sendsChat("playing")).toBe(true);
    expect(sendsChat("waiting")).toBe(false);
    expect(sendsChat("round-over")).toBe(false);
    expect(sendsChat("match-over")).toBe(false);
  });
});

describe("hostSilent (0x40bf99 → 0x45ec60)", () => {
  it("gives up on the host after 5 s without a word from it, in play only", () => {
    expect(HOST_SILENCE_MS).toBe(5000);
    expect(hostSilent("playing", 10_000, 5_001, 0)).toBe(false);
    expect(hostSilent("playing", 10_000, 5_000, 0)).toBe(true);
  });

  it("waits through the countdown, then counts the 5 s from its end or the last word, whichever is later (0x40c868, 0x40c905)", () => {
    expect(hostSilent("countdown", 60_000, 0, Number.POSITIVE_INFINITY)).toBe(false);
    expect(hostSilent("countdown", 8_999, 0, 4_000)).toBe(false);
    expect(hostSilent("countdown", 9_000, 0, 4_000)).toBe(true);
    expect(hostSilent("countdown", 10_999, 6_000, 4_000)).toBe(false);
    expect(hostSilent("countdown", 11_000, 6_000, 4_000)).toBe(true);
  });

  it("runs no such check on the wait and result screens", () => {
    for (const phase of ["waiting", "round-over", "match-over"] as const) expect(hostSilent(phase, 60_000, 0, 0)).toBe(false);
  });

  it("puts the countdown's end 4000 ms after its start, less what a frame shows gone", () => {
    const state = createMatch(layoutFromAscii(["1....", ".....", "....2"]), setups(2), VERSUS, 1);
    while (state.phase !== "countdown") step(state, {});
    expect(countdownEnd(state, 10_000)).toBe(10_000 + COUNTDOWN_MS);
    for (let i = 0; i < 45; i++) step(state, {});
    expect(countdownEnd(state, 10_000)).toBe(10_000 + COUNTDOWN_MS - 1500);
  });
});
