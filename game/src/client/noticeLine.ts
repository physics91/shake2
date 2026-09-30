// The notice line (drawer 0x4142d0) and its one buffer ([0x4927dc], stamp [0x492844], blink stamp
// [0x492848], phase [0x49284c]): S->C 0x50 or the F1 hint fills it, and the lobby (51,515), the room
// (52,515) and the match (133,567, in the bottom message's place) draw it. One for the session, so
// a notice goes on across the screens until its 60 s run out.
import { cp949Bytes } from "../server/cp949.ts";
import { NOTICE_BYTES } from "../server/protocol.ts";
import type { Point } from "./roomLayout.ts";
import { FONT_13, outlinedText, YELLOW } from "./text.ts";

export const NOTICE_SHOW_MS = 60_000;
export const NOTICE_SWAP_MS = 500;

export class NoticeLine {
  private text = "";
  private stamp = 0;
  /** Phase 1: the caller's colour; phase 0: white. */
  private yellow = false;
  private swappedAt = 0;

  /** The buffer holds a text: the match then draws it instead of its bottom message (0x40c1d2). */
  get held(): boolean {
    return this.text !== "";
  }

  /** S->C 0x50 (0x44579f): 1..99 bytes replace the text and restart its 60 s, the blink runs on; anything else is dropped. */
  receive(text: unknown, now: number): void {
    if (typeof text !== "string" || text === "" || cp949Bytes(text) > NOTICE_BYTES) return;
    this.text = text;
    this.stamp = now;
  }

  /** The F1 hint on entering the lobby from the login or a room as a joiner (0x44911e, 0x449dd6): only into an empty buffer. */
  hint(text: string, now: number): void {
    if (this.held) return;
    this.text = text;
    this.stamp = now;
  }

  /**
   * 0x4142d0 without the pen: after 60 s the buffer empties and that frame shows nothing; else the
   * colour swaps each time more than 500 ms have passed, so a notice after an empty buffer starts
   * yellow. An empty buffer counts as run out (GetTickCount is far past 60 s from its zero stamp).
   */
  frame(now: number): { text: string; yellow: boolean } | null {
    if (!this.held) return null;
    if (now - this.stamp > NOTICE_SHOW_MS) {
      this.text = "";
      this.stamp = 0;
      this.yellow = false;
      this.swappedAt = 0;
      return null;
    }
    if (now - this.swappedAt > NOTICE_SWAP_MS) {
      this.swappedAt = now;
      this.yellow = !this.yellow;
    }
    return { text: this.text, yellow: this.yellow };
  }

  /** Phase 1 in yellow, phase 0 in white, both with a black outline. */
  draw(ctx: CanvasRenderingContext2D, now: number, at: Point, font = FONT_13): void {
    const shown = this.frame(now);
    if (shown) outlinedText(ctx, shown.text, at.x, at.y, shown.yellow ? YELLOW : "#ffffff", font);
  }
}
