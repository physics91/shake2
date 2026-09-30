// The lobby's user information window (0x42da60, opened by a user row 0x4307b0 → 0x42f160): a
// snapshot of the row's record from the user list (S->C 0x16). Geometry from findings_userinfo.md.
import type { Rect } from "../assets/types.ts";
import type { Point } from "./roomLayout.ts";

/** new_userinfo (1,1)-(325,479) at (238,61), keyed; the user list beside it stays in sight. */
export const USER_INFO = {
  src: [1, 1, 325, 479] as Rect,
  at: { x: 238, y: 61 },
  /** Font 12 in [0x469cf4] with the black outline. */
  colour: "#f5ff00",
};

/**
 * The rows' text (0x42da60). 이름, EMAIL and 성별 are the sign-up's, which the remake does not take (R):
 * their boxes stay empty.
 */
export const USER_INFO_FIELDS = {
  id: { x: 346, y: 222 },
  nick: { x: 346, y: 242 },
  /** 0x418760, font 13, 18 bytes a line, two lines. */
  greeting: { x: 346, y: 264, lineStep: 15 },
  guild: { icon: { x: 346, y: 302 } as Point, name: { x: 361, y: 302 } as Point },
  manner: { x: 346, y: 323 },
  rank: { x: 346, y: 375 },
  level: { icon: { x: 346, y: 394 } as Point, title: { x: 361, y: 394 } as Point },
  cell: { x: 365, y: 415 },
  record: { x: 346, y: 435 },
  exp: { x: 346, y: 455 },
};

/** X (0x42fe10): pressed art only, new_button's. */
export const USER_INFO_CLOSE = { hit: [515, 503, 546, 533] as Rect, pressed: [134, 110, 166, 141] as Rect, at: { x: 515, y: 503 } };

/**
 * The whisper and mask icons, lit with the viewer's own items 8 and 3 (0x42df65, 0x42df1e); their
 * clicks do nothing. The mask's lit art goes to the lobby's own mask icon at (71,535), where the
 * lobby's already is (the original's slip), so the window's stays dim.
 */
export const USER_INFO_ITEMS = {
  whisper: { lit: [126, 148, 155, 178] as Rect, litAt: { x: 482, y: 228 }, hit: [482, 228, 511, 260] as Rect, pressed: [63, 148, 93, 177] as Rect, at: { x: 482, y: 228 } },
  mask: { lit: [156, 148, 185, 178] as Rect, litAt: { x: 71, y: 535 }, hit: [482, 261, 511, 290] as Rect, pressed: [94, 148, 125, 177] as Rect, at: { x: 482, y: 261 } },
};

/** 전적 (0x46e8a0). */
export function recordText(wins: number, losses: number): string {
  return `${wins} / ${losses}`;
}
