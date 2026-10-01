import { describe, expect, it } from "vitest";

import { createMatch, step } from "../sim/match.ts";
import { layoutFromAscii, playingMatch, PRACTICE, run, setups, VERSUS } from "../sim/testing.ts";
import { Dir } from "../sim/types.ts";
import { initialPresentation, phaseFades, present } from "./presentation.ts";

const ROWS = ["1....", ".....", "....2"];

describe("present", () => {
  it("is silent through 3, 2, 1, plays gamestart at START and starts the music at 4 s", () => {
    const state = createMatch(layoutFromAscii(ROWS), setups(2), VERSUS, 1);
    const view = initialPresentation();
    const heard: string[][] = [];
    let musicAt = -1;
    while (state.phase !== "playing") {
      step(state, {});
      const cues = present(view, state, state.events, [1]);
      if (cues.play.length > 0) heard.push(cues.play);
      if (cues.music === "start") musicAt = state.tick;
    }

    expect(heard).toEqual([["gamestart"]]);
    expect(musicAt).toBe(150);
  });

  it("plays bomb1 on placing, bomb6 on the explosion and die(slot + 1) on a death", () => {
    const state = playingMatch(ROWS, 2, VERSUS);
    const view = initialPresentation();
    const heard: string[] = [];
    step(state, { 2: { dir: null, bomb: true } });
    heard.push(...present(view, state, state.events, [1]).play);
    for (let i = 0; i < 70; i++) {
      step(state, {});
      heard.push(...present(view, state, state.events, [1]).play);
    }

    expect(heard).toEqual(["bomb1", "bomb6", "die2"]);
  });

  it("plays die4 for every death in practice", () => {
    const state = playingMatch(ROWS, 2, PRACTICE);
    const view = initialPresentation();
    const heard: string[] = [];
    step(state, { 1: { dir: null, bomb: true } });
    for (let i = 0; i < 70; i++) {
      step(state, {});
      heard.push(...present(view, state, state.events, [2]).play);
    }

    expect(heard.filter((name) => name.startsWith("die"))).toEqual(["die4"]);
  });

  it("plays footsteps only for players controlled on this screen", () => {
    const state = playingMatch(["1" + ".".repeat(20), "2" + ".".repeat(20)], 2, VERSUS);
    const view = initialPresentation();
    const walk = { dir: Dir.Right, bomb: false };
    const heard = (localIds: number[]) => {
      const names: string[] = [];
      for (let i = 0; i < 16; i++) {
        step(state, { 1: walk, 2: walk });
        names.push(...present(view, state, state.events, localIds).play);
      }
      return names;
    };

    expect(heard([1])).toEqual(["walk", "walk"]);
    expect(heard([])).toEqual([]);
  });

  it.each([
    ["bomb-thrown", "bomb2"],
    ["bomb-kicked", "bomb3"],
    ["missile-fired", "bomb4"],
    ["jumped", "jump1"],
    ["teleported", "warp"],
  ] as const)("plays %s as %s for every player", (type, sound) => {
    const state = playingMatch(ROWS, 2, VERSUS);
    expect(present(initialPresentation(), state, [{ type, playerId: 2 }], [1]).play).toEqual([sound]);
  });

  it.each([
    ["warped", "warpzone"],
    ["pad-jumped", "jump2"],
  ] as const)("plays %s as %s only for a player controlled on this screen (0x4522e9, 0x451e86)", (type, sound) => {
    const state = playingMatch(ROWS, 2, VERSUS);
    expect(present(initialPresentation(), state, [{ type, playerId: 1 }], [1]).play).toEqual([sound]);
    expect(present(initialPresentation(), state, [{ type, playerId: 2 }], [1]).play).toEqual([]);
  });

  it("plays bomb8 once however many zone cells reach frame 2 together", () => {
    const state = playingMatch(ROWS, 2, VERSUS);
    const blasts = [{ type: "zone-blast" }, { type: "zone-blast" }] as const;
    expect(present(initialPresentation(), state, blasts, []).play).toEqual(["bomb8"]);
  });

  it("stops the music at the end of a round, plays end, and stops end when the next round starts", () => {
    const state = playingMatch(ROWS, 2, VERSUS);
    const view = initialPresentation();
    state.flame[0] = 1;
    const cues = [];
    while (state.phase === "playing") {
      step(state, {});
      cues.push(present(view, state, state.events, [1]));
    }
    expect(cues.at(-1)).toMatchObject({ play: ["end"], music: "stop" });

    let next = present(view, state, [], [1]);
    while (state.phase !== "waiting") {
      step(state, {});
      next = present(view, state, state.events, [1]);
    }
    expect(next.stop).toEqual(["end"]);
  });

  it("plays endsig when the match is won and remembers when Hurry was raised", () => {
    const state = playingMatch(ROWS, 2, VERSUS);
    const view = initialPresentation();
    state.timerSeconds = 71;
    state.timerMs = -Infinity;
    step(state, {});
    expect(present(view, state, state.events, [1]).play).toEqual(["hurry1"]);
    expect(view.hurryTick).toBe(state.tick);

    state.players[0].medals = 2;
    state.flame[state.layout.width * 2 + 4] = 1;
    let last = present(view, state, [], [1]);
    while (state.phase === "playing") {
      run(state, 1);
      last = present(view, state, state.events, [1]);
    }
    expect(state.phase).toBe("match-over");
    expect(last).toMatchObject({ play: ["endsig"], music: "stop" });
  });
});

describe("phaseFades (findings_fades C)", () => {
  it("fades into the countdown, the round result and the final result", () => {
    expect(phaseFades("waiting", "countdown")).toBe(true);
    expect(phaseFades("playing", "round-over")).toBe(true);
    expect(phaseFades("playing", "match-over")).toBe(true);
  });

  it("fades into the final result when a leave ends the match in the countdown (0x44f341 -> 0x44eb1c)", () => {
    expect(phaseFades("countdown", "match-over")).toBe(true);
  });

  it("fades into the final result when a leave ends the match on the round result (0x44f341 -> 0x44eb1c)", () => {
    expect(phaseFades("round-over", "match-over")).toBe(true);
  });

  it("cuts to play and from the round result to the next wait screen", () => {
    expect(phaseFades("countdown", "playing")).toBe(false);
    expect(phaseFades("round-over", "waiting")).toBe(false);
    expect(phaseFades("round-over", "playing")).toBe(false);
    expect(phaseFades("playing", "playing")).toBe(false);
  });
});
