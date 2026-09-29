// Chat in a network match (scene 8). A line goes to the room host, which passes it to everyone,
// the speaker too (record type 0x14, 0x446200 → 0x444500 → 0x45ec00); each player's last line shows
// for 5 s in the balloon beside its face (0x418940). Enter sends and closes the line in one press.
import type { Rect } from "../assets/types.ts";
import type { Phase } from "../sim/types.ts";

export const BALLOON_MS = 5000;
/** mark.shk's "chat" label over a typing player (0x40c3df, 0x40ac4a); practice's is images.shk's. */
export const NET_TYPING_MARK = { src: [123, 33, 153, 49] as Rect, dx: 20, dy: -50 };

/**
 * Slot i's balloon (0x418940): mark.shk's frame at (606, 65 i + 8) and its lines from (608,
 * 65 i + 11). The faces beside it are 63 px apart (0x44dc9f), so the balloons drift down from them.
 */
export function balloonAt(slot: number): { x: number; y: number; textX: number; textY: number } {
  return { x: 606, y: 65 * slot + 8, textX: 608, textY: 65 * slot + 11 };
}

/**
 * Each slot's last line (+0x204) and when it was stored (+0x208). The field's loop drops a line
 * after 5 s (0x40c254); the wait and result screens neither draw nor drop them, and the next
 * round's world load frees them all.
 */
export class Balloons {
  private readonly lines = new Map<number, { text: string; since: number }>();

  say(slot: number, text: string, now: number): void {
    this.lines.set(slot, { text, since: now });
  }

  clear(): void {
    this.lines.clear();
  }

  /** The lines the field shows now, by slot; expired ones are dropped. */
  shown(now: number): { slot: number; text: string }[] {
    const out: { slot: number; text: string }[] = [];
    for (const [slot, line] of this.lines) {
      if (now - line.since >= BALLOON_MS) this.lines.delete(slot);
      else out.push({ slot, text: line.text });
    }
    return out.sort((a, b) => a.slot - b.slot);
  }
}

export type MatchEscape = "help" | "chat" | "leave" | "box" | "none";

/**
 * Esc in a match with no box up (0x461590): the help, then the open line (its text is dropped).
 * Otherwise the first round's wait screen is left at once; anywhere else a guest gets the exit
 * box and the host nothing (the frame hides the host's box, 0x40ca23).
 */
export function matchEscape(at: { help: boolean; chatOpen: boolean; host: boolean; round: number; phase: Phase }): MatchEscape {
  if (at.help) return "help";
  if (at.chatOpen) return "chat";
  if (at.round === 1 && at.phase === "waiting") return "leave";
  return at.host ? "none" : "box";
}

/**
 * The round and final result screens (0x40fd50, 0x410560) and the wait screen from the second
 * round on (0x4100e0) close the exit box on every frame they draw (0x443d50), so a box opened in
 * play goes when the round ends and Esc there shows nothing.
 */
export function closesExitBox(phase: Phase, round: number): boolean {
  return phase === "round-over" || phase === "match-over" || (phase === "waiting" && round > 1);
}

/** A guest leaves when the host has sent nothing for this long (0x45ec60, `+0x25c`). */
export const HOST_SILENCE_MS = 5000;

/**
 * Whether a guest gives the host up (0x40bf99): in play, not in the countdown, 5 s after the last
 * data from the host (set on each read, 0x4471d3, and when the countdown ends, 0x40c905). The wait
 * and result screens do not draw the field, where the check is. Here the server is the host.
 */
export function hostSilent(phase: Phase, now: number, lastHeard: number): boolean {
  return phase === "playing" && now - lastHeard >= HOST_SILENCE_MS;
}

/** Enter opens the line unless a result screen is up (0x45fec8); on the wait screen it is typed unseen. */
export function enterOpensChat(phase: Phase): boolean {
  return phase !== "round-over" && phase !== "match-over";
}

/** A line is dropped, not sent nor kept, on the wait and result screens (0x4462e4). */
export function sendsChat(phase: Phase): boolean {
  return phase === "countdown" || phase === "playing";
}
