// The option window (scene 13): where things are drawn (0x420ed0), where a release acts (0x45a172)
// and the balloons (0x421840), from shake.exe 0311. Hit rects include all four edges; art rects
// are blit sources, right and bottom edges excluded.
import type { Rect } from "../assets/types.ts";
import { bubbleLines } from "./chat.ts";
import type { Point } from "./roomLayout.ts";
import { inside } from "./roomLayout.ts";

/** new_option whole, colour-keyed, at (66,80) (0x420f1c); the lobby's partial draw under it, not dimmed. */
export const OPTION_AT: Point = { x: 66, y: 80 };

export type CheckId = "music" | "effects" | "balloons" | "keyboard" | "joystick";

/** new_button's check (125,94)-(140,109); the keyboard and joystick marks are (141,94)-(156,109). */
const CHECK_ART: Rect = [125, 94, 140, 109];
const DEVICE_ART: Rect = [141, 94, 156, 109];

export const CHECKS: Record<CheckId, { hit: Rect; src: Rect; at: Point }> = {
  music: { hit: [189, 474, 204, 489], src: CHECK_ART, at: { x: 190, y: 475 } },
  effects: { hit: [287, 474, 302, 489], src: CHECK_ART, at: { x: 288, y: 475 } },
  balloons: { hit: [620, 481, 635, 496], src: CHECK_ART, at: { x: 620, y: 481 } },
  keyboard: { hit: [192, 357, 207, 372], src: DEVICE_ART, at: { x: 192, y: 357 } },
  joystick: { hit: [319, 357, 334, 372], src: DEVICE_ART, at: { x: 319, y: 357 } },
};
/** 2P and 기본정보공개: never drawn, no click, a balloon only. */
const TWO_P: Rect = [235, 357, 250, 372];
const PUBLIC_INFO: Rect = [501, 481, 516, 496];

/** BOMB, ITEM1 and ITEM2 (Key1..Key3): the box, its change bar (new_button2) and the name, 굴림체 13 yellow. */
export const KEY_BOXES: readonly { hit: Rect; at: Point; name: Point }[] = [
  { hit: [120, 403, 183, 418], at: { x: 120, y: 403 }, name: { x: 123, y: 405 } },
  { hit: [198, 403, 261, 418], at: { x: 198, y: 403 }, name: { x: 201, y: 405 } },
  { hit: [276, 403, 339, 418], at: { x: 276, y: 403 }, name: { x: 279, y: 405 } },
];
export const KEY_BAR: Rect = [80, 201, 144, 218];
export const KEY_COLOUR = "#ffff00";
/** GESTURE's name is a constant (0x46df54); ITEM3 and ITEM4 draw nothing. */
export const GESTURE = { text: "    D   ", at: { x: 123, y: 448 } };

const MACRO_COLUMNS: readonly [number, number][] = [[108, 185], [189, 266], [270, 347]];
const MACRO_ROWS: readonly [number, number][] = [[174, 222], [227, 275], [280, 328]];
const MACRO_AREA: Rect = [108, 174, 347, 328];
export const MACRO_TEXT_COLOUR = "#ffffff";
/** new_button2's dark box over the edited box's F label, at the text origin less (2,3). */
export const MACRO_HIGHLIGHT: Rect = [1, 201, 79, 252];

/** Box k = 0..8 edits slot k+1 (F2..F10), row-major; its text origin is (110|191|272, 177|230|283). */
export function macroBox(k: number): { hit: Rect; text: Point } {
  const [left, right] = MACRO_COLUMNS[k % 3];
  const [top, bottom] = MACRO_ROWS[Math.floor(k / 3)];
  return { hit: [left, top, right, bottom], text: { x: left + 2, y: top + 3 } };
}

export function macroBoxAt(x: number, y: number): number {
  for (let k = 0; k < 9; k++) if (inside(macroBox(k).hit, x, y)) return k;
  return -1;
}

/** 0x418870: 12 bytes a line, a double-byte character at the 12th byte moves down, three lines 15 px apart. */
export function macroLines(text: string): string[] {
  return bubbleLines(text);
}

/**
 * The caret (0x421d80): by the text's length, not the caret's line: under 12 bytes on line 1,
 * under 24 on line 2, else line 3, 6 px a byte past that line's 12th byte, none when the caret
 * stands before it (0x403e90). So after a wrap at byte 11 the caret sits half a character short.
 * 13 rows.
 */
export function macroCaret(textBytes: number, caretBytes: number, origin: Point): Point {
  const line = textBytes < 12 ? 0 : textBytes < 24 ? 1 : 2;
  return { x: origin.x + 6 * Math.max(0, caretBytes - 12 * line), y: origin.y + 15 * line };
}
export const MACRO_CARET_ROWS = 13;

export interface OptionButton {
  hit: Rect;
  hover: Rect | null;
  pressed: Rect;
  at: Point;
}

/** O, 초기화 and X (new_button2). Only 초기화 has hover art; its pressed art goes over the hover. */
export const OPTION_BUTTONS: Record<"ok" | "reset" | "cancel", OptionButton> = {
  ok: { hit: [86, 521, 116, 551], hover: null, pressed: [373, 191, 404, 221], at: { x: 86, y: 521 } },
  reset: { hit: [332, 522, 422, 550], hover: [282, 191, 372, 219], pressed: [340, 162, 430, 190], at: { x: 332, y: 522 } },
  cancel: { hit: [639, 521, 669, 551], hover: null, pressed: [80, 219, 110, 249], at: { x: 639, y: 521 } },
};

// Friends (0x422a10, popup 0x421558)

export const FRIEND_ROWS = 12;
const ID_COLUMN: Rect = [409, 201, 534, 449];
const LOCATION_COLUMN: Rect = [539, 202, 639, 449];
/** A row's parts: gender (410, not drawn here), guild, rank, then the ID and the location in 굴림체 13 white, no outline. */
export const FRIEND_PARTS = { guild: 426, rank: 442, name: 461, location: 544, colour: "#ffffff" };
export const OFFLINE = "접속하지 않음";

export function friendRowY(i: number): number {
  return 203 + 21 * i;
}

/** Row i's click band (0x422b00): 409..534 by 201+21i..217+21i. */
export function friendRowAt(x: number, y: number): number {
  for (let i = 0; i < FRIEND_ROWS; i++) if (inside([409, 201 + 21 * i, 534, 217 + 21 * i], x, y)) return i;
  return -1;
}

/** The ID editor (0x422c40: 0xb): 10 bytes; a longer ID closes the popup without asking (0x45a1db). */
export const FRIEND_ID_LIMIT = 11;

export const FRIEND_POPUP = {
  /** new_basicwindow. */
  src: [2, 2, 240, 181] as Rect,
  at: { x: 451, y: 295 },
  question: { text: "ID를 삭제 하시겠습니까?", at: { x: 489, y: 358 }, colour: "#ffff00" },
  /** The "ID" label (new_button2) in the add popup. */
  label: { src: [111, 220, 179, 240] as Rect, at: { x: 542, y: 354 } },
  text: { x: 508, y: 386, colour: "#ffffff" },
  ok: { hit: [458, 436, 489, 467] as Rect, pressed: [1, 147, 33, 179] as Rect, at: { x: 458, y: 436 } },
  cancel: { hit: [645, 436, 676, 467] as Rect, pressed: [34, 146, 66, 178] as Rect, at: { x: 645, y: 436 } },
};

// Releases (0x45a172)

export type OptionTarget =
  | { kind: "ok" | "reset" | "cancel" | "elsewhere" }
  | { kind: "check"; id: CheckId }
  | { kind: "key"; slot: 0 | 1 | 2 }
  | { kind: "macro"; box: number }
  | { kind: "friend"; row: number };

/** The window's control under a release with no popup open, in the original's order. */
export function optionTargetAt(x: number, y: number): OptionTarget {
  for (const kind of ["ok", "reset", "cancel"] as const) if (inside(OPTION_BUTTONS[kind].hit, x, y)) return { kind };
  for (const id of ["music", "effects", "balloons", "keyboard", "joystick"] as const) if (inside(CHECKS[id].hit, x, y)) return { kind: "check", id };
  // BOMB, then ITEM2, then ITEM1 (0x45a2d6).
  for (const slot of [0, 2, 1] as const) if (inside(KEY_BOXES[slot].hit, x, y)) return { kind: "key", slot };
  const box = macroBoxAt(x, y);
  if (box >= 0) return { kind: "macro", box };
  const row = friendRowAt(x, y);
  if (row >= 0) return { kind: "friend", row };
  return { kind: "elsewhere" };
}

/** A release while the friend popup is open: only its O and X act (0x422bc0). */
export function popupTargetAt(x: number, y: number): "ok" | "cancel" | null {
  if (inside(FRIEND_POPUP.ok.hit, x, y)) return "ok";
  if (inside(FRIEND_POPUP.cancel.hit, x, y)) return "cancel";
  return null;
}

// Balloons (0x421840; the box is 0x44d5d0 at the raw mouse)

const OK_HELP = "입력 및 수정 확인(enter)";
const CANCEL_HELP = "취소 버튼(esc)";

const MAIN_HELP: readonly { rect: Rect; text: string }[] = [
  { rect: MACRO_AREA, text: "단축메세지지정, 클릭하면 편집가능" },
  { rect: CHECKS.keyboard.hit, text: "게임중 키보드 사용지정" },
  { rect: TWO_P, text: "현재 지원안함" },
  { rect: CHECKS.joystick.hit, text: "게임중 조이스틱 사용지정" },
  ...KEY_BOXES.map((box) => ({ rect: box.hit, text: "키보드 설정변경 클릭하면 키 바꿈모드" })),
  { rect: CHECKS.music.hit, text: "체크하면 배경음악사용" },
  { rect: CHECKS.effects.hit, text: "체크하면 효과음 사용" },
  { rect: ID_COLUMN, text: "클릭하면 추가,삭제 가능" },
  { rect: LOCATION_COLUMN, text: "친구의 위치표시" },
  { rect: PUBLIC_INFO, text: "체크되면 모든 정보 공개(준비중)" },
  { rect: CHECKS.balloons.hit, text: "체크하면 풍선 도움말 사용" },
  { rect: OPTION_BUTTONS.reset.hit, text: "모든 옵션내용 초기화" },
  { rect: OPTION_BUTTONS.ok.hit, text: OK_HELP },
  { rect: OPTION_BUTTONS.cancel.hit, text: CANCEL_HELP },
];

const POPUP_HELP: readonly { rect: Rect; text: string }[] = [
  { rect: FRIEND_POPUP.ok.hit, text: OK_HELP },
  { rect: FRIEND_POPUP.cancel.hit, text: CANCEL_HELP },
];

/**
 * The balloon under the mouse: the popup's while it is open; none under the yes/no box or the
 * message box unless the popup is open. The rects do not overlap, so the first match is the one.
 */
export function optionHelpAt(x: number, y: number, at: { popup: boolean; message: boolean }): { text: string; x: number; y: number } | null {
  if (at.message && !at.popup) return null;
  const entry = (at.popup ? POPUP_HELP : MAIN_HELP).find((e) => inside(e.rect, x, y));
  return entry ? { text: entry.text, x, y } : null;
}

/** The popup's ID caret, add mode only: 7 px a byte from (508,386). */
export function friendCaret(caretBytes: number): Point {
  return { x: FRIEND_POPUP.text.x + 7 * caretBytes, y: FRIEND_POPUP.text.y };
}
