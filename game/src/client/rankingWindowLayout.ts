// The lobby's ranking window (scene 12: open 0x423170, draw 0x4231e0, clicks 0x459ffa): positions,
// hit tests and balloons. Rects are [left, top, right, bottom]; blits exclude right and bottom, hit
// tests include them. Evidence: re_work/findings_ranking.md §2.
import type { Rect } from "../assets/types.ts";
import type { Button, Point } from "./roomLayout.ts";
import { inside } from "./roomLayout.ts";

/** new_ranking.shk (502×460, keyed) over the lobby, whose draw stops after the user list. */
export const RANKING_WINDOW_AT: Point = { x: 52, y: 101 };

/**
 * The list's rows (0x4231e0), no cap on their count: rank "%9d" and cell point "%18d" and wins
 * "%13d" in font 13, the ID in font 12, all outlined black; white, or yellow for the row whose ID
 * is the last one found (_stricmp). Gender (new_button), guild and the level's badge go between.
 */
export const RANKING_ROWS = {
  firstY: 191,
  step: 18,
  rank: { x: 83, width: 9 },
  gender: { x: 156 },
  guild: { x: 172 },
  /** One pixel above the row. */
  badge: { x: 188, dy: -1 },
  id: { x: 209 },
  cell: { x: 224, width: 18 },
  wins: { x: 327, width: 13 },
  colour: "#ffffff",
  found: "#ffff00",
  outline: "#000000",
};

/** 0x4429b0's icons in new_button: 1 male, 2 female; nothing for any other value. */
export function genderIcon(gender: number): Rect | null {
  if (gender === 1) return [111, 78, 126, 91];
  if (gender === 2) return [94, 78, 109, 91];
  return null;
}

export function rankingRowY(i: number): number {
  return RANKING_ROWS.firstY + RANKING_ROWS.step * i;
}

function button(hit: Rect, hover: Rect | null, pressed: Rect): Button {
  return { hit, hover, pressed, at: { x: hit[0], y: hit[1] } };
}

/** new_button2 art at each hit's corner; X has no hover art. */
export const RANKING_BUTTONS = {
  prev: button([136, 468, 193, 496], [241, 1, 298, 29], [241, 88, 298, 116]),
  find: button([265, 468, 333, 496], [183, 30, 251, 58], [183, 59, 251, 87]),
  next: button([411, 468, 468, 496], [183, 1, 240, 29], [183, 88, 240, 116]),
  close: button([495, 522, 524, 551], null, [252, 30, 282, 59]),
};

export type RankingButton = keyof typeof RANKING_BUTTONS;

/**
 * The FIND popup (0x423a60): new_basicwindow, the "ID" label (new_button2), the ID typed in font 13
 * white outlined black, its 13-row caret, and O and X pressed while held over. The option window's
 * friend popup is the same art at another place.
 */
export const RANKING_POPUP = {
  src: [2, 2, 240, 181] as Rect,
  at: { x: 201, y: 234 },
  label: { src: [111, 220, 179, 240] as Rect, at: { x: 292, y: 293 } },
  text: { x: 258, y: 325 },
  colour: "#ffffff",
  outline: "#000000",
  caretRows: 13,
  /** The editor is set to 0xb: 10 bytes. */
  limit: 0xb,
  ok: button([208, 375, 238, 405], null, [1, 147, 33, 179]),
  cancel: button([395, 375, 425, 405], null, [34, 146, 66, 178]),
};

/** The caret after `caretBytes` bytes of the ID (0x403e40 from x 258). */
export function rankingCaret(caretBytes: number): Point {
  return { x: RANKING_POPUP.text.x + 7 * caretBytes, y: RANKING_POPUP.text.y };
}

/** A release with no popup (0x459ffa): X, then ◀, ▶ and FIND. */
export function rankingButtonAt(x: number, y: number): RankingButton | null {
  for (const id of ["close", "prev", "next", "find"] as const) if (inside(RANKING_BUTTONS[id].hit, x, y)) return id;
  return null;
}

/** A release with the popup open: O, then X; the rest is swallowed. */
export function rankingPopupAt(x: number, y: number): "ok" | "cancel" | null {
  if (inside(RANKING_POPUP.ok.hit, x, y)) return "ok";
  if (inside(RANKING_POPUP.cancel.hit, x, y)) return "cancel";
  return null;
}

/** The first of ◀, FIND and ▶ under the mouse, for the hover art (0x423780); X has none. */
export function rankingHoverAt(x: number, y: number): RankingButton | null {
  for (const id of ["prev", "find", "next"] as const) if (inside(RANKING_BUTTONS[id].hit, x, y)) return id;
  return null;
}

/** The first of ◀, FIND, ▶ and X under the held mouse, for the pressed art (0x4238c0). */
export function rankingPressedAt(x: number, y: number): RankingButton | null {
  for (const id of ["prev", "find", "next", "close"] as const) if (inside(RANKING_BUTTONS[id].hit, x, y)) return id;
  return null;
}

const WINDOW_HELP: readonly { id: RankingButton; text: string }[] = [
  { id: "find", text: "원하는 아이디 랭킹 확인" },
  { id: "next", text: "다음 리스트 보기" },
  { id: "prev", text: "이전리스트 보기" },
  { id: "close", text: "창닫기(esc)" },
];

/**
 * The balloon under the mouse (0x423570), where the mouse is: with the popup open its O and X,
 * even over the message box; else the window's buttons, but not over the message box.
 */
export function rankingHelpAt(x: number, y: number, context: { popup: boolean; message: boolean }): { text: string; x: number; y: number } | null {
  if (context.popup) {
    if (inside(RANKING_POPUP.ok.hit, x, y)) return { text: "확인(enter)", x, y };
    if (inside(RANKING_POPUP.cancel.hit, x, y)) return { text: "취소 버튼(esc)", x, y };
    return null;
  }
  if (context.message) return null;
  const entry = WINDOW_HELP.find((e) => inside(RANKING_BUTTONS[e.id].hit, x, y));
  return entry ? { text: entry.text, x, y } : null;
}
