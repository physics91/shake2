import type { MatchState, Phase, SimEvent } from "../sim/types.ts";

/** Menu button clicks (0x4589a9): main buttons menu2, secondary buttons menu3. */
export const MENU_SOUNDS = { primary: "menu2", secondary: "menu3" } as const;

/** Round and match result cues follow the music switch, not the effects switch (0x40fd87, 0x410586). */
export const MUSIC_GATED = new Set(["end", "endsig"]);

/**
 * fade(1) inside a match: the countdown's timer (0x460950), a round's end (0x44ebfd, 0x44f157) and
 * the match's (0x44eb1c), also when a leave in the countdown ends it (0x44f341 -> 0x44ea40). The
 * round result goes to the next wait screen with no fade (0x40fde2, 0x40fe40), and play starts
 * under the countdown's last frame.
 */
export function phaseFades(from: Phase, to: Phase): boolean {
  if (to === "countdown") return from === "waiting";
  return (from === "playing" || from === "countdown") && (to === "round-over" || to === "match-over");
}

export interface Presentation {
  /** Tick the HURRY UP sprite appeared (shown for 3000 ms), or null. */
  hurryTick: number | null;
}

export function initialPresentation(): Presentation {
  return { hurryTick: null };
}

export interface Cues {
  play: string[];
  stop: string[];
  /** Start the round's music from the top, or stop it. */
  music: "start" | "stop" | null;
}

/**
 * Turn one batch of sim events into the original's sounds (original/FIDELITY.md §1).
 * `localIds` are the players controlled on this screen; only their footsteps are heard.
 */
export function present(
  view: Presentation,
  state: MatchState,
  events: readonly SimEvent[],
  localIds: readonly number[],
): Cues {
  const cues: Cues = { play: [], stop: [], music: null };
  const play = (name: string) => {
    if (!cues.play.includes(name)) cues.play.push(name);
  };

  for (const event of events) {
    switch (event.type) {
      case "round-start":
        // The round result cue is stopped when the next round is being prepared (0x41014e).
        cues.stop.push("end");
        view.hurryTick = null;
        break;
      case "start-shown":
        play("gamestart");
        break;
      case "go":
        cues.music = "start";
        break;
      case "bomb-placed":
        play("bomb1");
        break;
      case "explode":
        play("bomb6");
        break;
      case "bomb-thrown":
        play("bomb2");
        break;
      case "bomb-kicked":
        play("bomb3");
        break;
      case "missile-fired":
        play("bomb4");
        break;
      case "jumped":
        play("jump1");
        break;
      case "teleported":
        play("warp");
        break;
      // Gates and pads are handled by each player's own client only (0x4522e9, 0x451e86).
      case "warped":
        if (localIds.includes(event.playerId)) play("warpzone");
        break;
      case "pad-jumped":
        if (localIds.includes(event.playerId)) play("jump2");
        break;
      case "zone-blast":
        play("bomb8");
        break;
      case "item-picked":
        play("item1");
        break;
      case "walk-cycle":
        if (localIds.includes(event.playerId)) play("walk");
        break;
      case "death": {
        // Practice plays die(1 + local slot) for everyone, and the local player is slot 3 (0x407d84, 0x4081cd).
        const player = state.players.find((p) => p.id === event.playerId);
        if (player) play(state.rules.practice ? "die4" : `die${player.slot + 1}`);
        break;
      }
      case "hurry":
        view.hurryTick = state.tick;
        play("hurry1");
        break;
      case "round-over":
        cues.music = "stop";
        play("end");
        break;
      case "match-over":
        cues.music = "stop";
        play("endsig");
        break;
      case "brick-broken":
      case "sudden-death":
      case "practice-over":
      case "practice-time-up":
        break;
    }
  }
  return cues;
}
