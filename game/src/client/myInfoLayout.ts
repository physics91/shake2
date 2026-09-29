// The my-info window (scene 10, 0x43c3c0): where the original picks the character. Geometry and
// rules from shake.exe 0311 (draw 0x43c790, clicks 0x459552, keys 0x43ec60/0x461590).
import type { Rect } from "../assets/types.ts";
import { cp949Bytes } from "../server/cp949.ts";
import type { Button, Point } from "./roomLayout.ts";
import { inside } from "./roomLayout.ts";

/** new_statuswindow (1,1)-(622,479) at (79,64): not centred, and the lobby under it is not dimmed. */
export const MY_INFO_WINDOW = { src: [1, 1, 622, 479] as Rect, at: { x: 79, y: 64 } };
/** Every field's text: #F5FF00 ([0x469cf4]) with the black outline. */
export const FIELD_COLOUR = "#f5ff00";

/** The fields' text positions (0x43c790); 인사말 is 굴림체 13, the rest 12. */
export const FIELDS = {
  name: { x: 189, y: 133 },
  gender: { x: 189, y: 153 },
  email: { x: 189, y: 173 },
  id: { x: 189, y: 225 },
  nick: { x: 189, y: 245 },
  greeting: { x: 189, y: 267, lineStep: 15 },
  guild: { icon: { x: 189, y: 305 }, name: { x: 204, y: 305 } },
  manner: { x: 189, y: 325 },
  standing: { x: 189, y: 377 },
  level: { icon: { x: 189, y: 397 }, title: { x: 204, y: 397 } },
  cellPoint: { x: 211, y: 418 },
  record: { x: 189, y: 438 },
  exp: { x: 189, y: 458 },
};

/** The ID check's mark (new_button 141,94-156,109 at (303,223)) while "use the ID" is on. */
export const USE_ID_MARK = { src: [141, 94, 156, 109] as Rect, at: { x: 303, y: 223 } };
/** 내캐릭터: `_p.spr` from its top-left at (542,190); the name at (548,270) in 굴림체 14. */
export const PORTRAIT_AT: Point = { x: 542, y: 190 };
export const CHARACTER_NAME_AT: Point = { x: 548, y: 270 };

/** 0x469adc: the characters by index, as this remake's sheet names. */
export const CHARACTER_IDS = [
  "rookie", "tofi", "imp", "bogle", "doona", "doon", "domshell", "bobo", "spider", "rooster",
  "slack", "shark", "red", "orange", "milky", "shaky", "doomsy", "doomy", "doonae", "rookiee",
] as const;

/** 0x469bc0: the names as the window shows them, padded to 8 bytes. */
export const CHARACTER_NAMES = [
  "루    키", "토    피", "임    프", "보    글", "두    나", "   둔   ", "둠    쉘", "보    보", "스파이더", "루 스 터",
  "슬    랙", "샤    크", "레    드", "오 렌 지", "밀    키", "쉐 이 키", "둠    시", "두    미", "한복두나", "한복루키",
] as const;

/** 0x469ca0: the level titles; this remake shows level 1 like its badges elsewhere. */
export const LEVEL_TITLES = [
  "닉네임", "쉐이크 마스터", "쉐이크 히어로", "쉐이크 나이츠", "골드 나이츠", "실버 나이츠",
  "나이츠 ", "골드 워리어", "실버 워리어", "파이터 ", "베테랑 ", "솔 져 ",
] as const;

/**
 * Ownership is by pairs (0x43eb60): a new 0311 account has pairs 0-4 and 8, so 0-9 and 16-17
 * (0x448c50); purchases (S->C 0x5a) add pairs. This remake has no shop: it owns all 20.
 */
export const OWNED: readonly number[] = CHARACTER_IDS.map((_, i) => i);

export function characterIndex(id: string): number {
  return (CHARACTER_IDS as readonly string[]).indexOf(id);
}

/** ◀ and ▶ (0x43e320): the next owned index, wrapping 0..19, up to 20 tries. */
export function stepCharacter(index: number, step: 1 | -1, owned: readonly number[]): number {
  let next = index;
  for (let tries = 0; tries < 20; tries++) {
    next = (next + step + 20) % 20;
    if (owned.includes(next)) return next;
  }
  return index;
}

/** The dropdown's lines (0x43c510): both characters of each owned pair among 0..9, in order. */
export function dropdownLines(owned: readonly number[]): number[] {
  const lines: number[] = [];
  for (let pair = 0; pair < 10; pair++) {
    if (owned.includes(2 * pair) || owned.includes(2 * pair + 1)) lines.push(2 * pair, 2 * pair + 1);
  }
  return lines;
}

/** new_winobject (1,1)-(72, 3 + 30 n) under the name box at (542,286), n the owned pairs. */
export function dropdownHeight(owned: readonly number[]): number {
  return 3 + 15 * dropdownLines(owned).length;
}

export const DROPDOWN = {
  at: { x: 542, y: 286 },
  text: { x: 546, y: 290, step: 15 },
  lit: "#ecefff",
  idle: "#7a84bd",
};

/** The line under the point (0x43eda0): bands 542..613 by 287+15j..305+15j, the first one wins. */
export function dropdownLineAt(x: number, y: number, count: number): number {
  for (let j = 0; j < count; j++) {
    if (inside([542, 287 + 15 * j, 613, 305 + 15 * j], x, y)) return j;
  }
  return -1;
}

/** Whether a line is lit: the mouse in 542,288+15j-613,303+15j (0x43c510). */
export function dropdownLineLit(j: number, x: number, y: number): boolean {
  return inside([542, 288 + 15 * j, 613, 303 + 15 * j], x, y);
}

/** 0x418760: 18 bytes a line, a double-byte character that would not fit goes to the next, two lines. */
export function greetingLines(text: string): string[] {
  const lines: string[] = [];
  let line = "";
  let bytes = 0;
  for (const char of text) {
    const size = cp949Bytes(char);
    if (bytes + size > 18) {
      lines.push(line);
      if (lines.length === 2) return lines;
      line = "";
      bytes = 0;
    }
    line += char;
    bytes += size;
  }
  if (line) lines.push(line);
  return lines.slice(0, 2);
}

/**
 * The greeting popup's caret (0x43e040): on line 1 at 323 + 7 a byte while the whole text is
 * under 18 bytes; otherwise on line 2 at 323 + 7 a byte past the 18th, never left of 323.
 */
export function greetingCaret(textBytes: number, caretBytes: number): Point {
  if (textBytes < 18) return { x: 323 + 7 * Math.max(0, caretBytes), y: 282 };
  return { x: 323 + 7 * Math.max(0, caretBytes - 18), y: 297 };
}

/** The greeting editor's limit (0x43ea00: 0x25): 36 bytes. */
export const GREETING_LIMIT = 37;

export const GREETING_POPUP = {
  src: [1, 261, 239, 440] as Rect,
  at: { x: 274, y: 200 },
  text: { x: 323, y: 282, lineStep: 15 },
  ok: { hit: [281, 341, 311, 371] as Rect, pressed: [1, 147, 33, 179] as Rect, at: { x: 281, y: 341 } },
  cancel: { hit: [468, 341, 498, 371] as Rect, pressed: [34, 146, 66, 178] as Rect, at: { x: 468, y: 341 } },
};

function button(hit: Rect, hover: Rect | null, pressed: Rect, at: Point = { x: hit[0], y: hit[1] }): Button {
  return { hit, hover, pressed, at };
}

/** The main window's buttons in the order their pressed art is looked up (0x43c790). */
export const MY_INFO_BUTTONS = {
  close: button([651, 504, 681, 534], null, [345, 124, 377, 155]),
  save: button([98, 504, 128, 534], null, [373, 191, 404, 221]),
  money: button([445, 458, 535, 486], [287, 312, 379, 342], [287, 281, 379, 311]),
  shop: button([554, 458, 622, 486], [276, 191, 346, 221], [276, 160, 346, 190]),
  prev: button([532, 270, 541, 284], null, [246, 202, 259, 220], { x: 529, y: 268 }),
  next: button([614, 269, 624, 284], null, [260, 202, 273, 220], { x: 613, y: 268 }),
  greeting: button([324, 267, 353, 287], [246, 181, 275, 201], [246, 160, 275, 180]),
};
/** O's pressed art is in new_button2; the others are new_button's. */
export const SAVE_ART_SHEET = "button2";

export type MyInfoButton = keyof typeof MY_INFO_BUTTONS | "useId" | "names" | "colour" | "nickname";

const USE_ID: Rect = [303, 223, 318, 238];
const NAMES: Rect = [542, 268, 613, 286];
const COLOUR: Rect = [479, 229, 508, 259];
const NICKNAME: Rect = [324, 235, 353, 265];

/** The control under a release on the main window (0x459552). */
export function myInfoButtonAt(x: number, y: number): MyInfoButton | null {
  for (const [name, b] of Object.entries(MY_INFO_BUTTONS)) if (inside(b.hit, x, y)) return name as MyInfoButton;
  if (inside(USE_ID, x, y)) return "useId";
  if (inside(NAMES, x, y)) return "names";
  if (inside(COLOUR, x, y)) return "colour";
  if (inside(NICKNAME, x, y)) return "nickname";
  return null;
}

type HelpEntry = { rect: Rect; text: string | ((useId: boolean) => string); x?: (x: number) => number };

const NOT_SUPPORTED = "현재 지원안함";
const PICK = "화살표로 원하는 캐릭터 선택가능";

/** 0x43d9a0 over the main window, first match (string table 0x46f3e4). */
const MAIN_HELP: HelpEntry[] = [
  { rect: USE_ID, text: (useId) => (useId ? "닉네임을 사용하려면 아이디체크 해지" : "게임중에서 아이디 사용시 체크") },
  { rect: NICKNAME, text: "닉네임 수정시 사용" },
  { rect: MY_INFO_BUTTONS.greeting.hit, text: "인사말 수정시 사용" },
  { rect: [527, 130, 641, 148], text: NOT_SUPPORTED },
  { rect: [543, 191, 612, 260], text: PICK, x: (x) => Math.min(x, 594) },
  { rect: MY_INFO_BUTTONS.prev.hit, text: PICK },
  { rect: MY_INFO_BUTTONS.next.hit, text: PICK, x: () => 594 },
  { rect: COLOUR, text: "캐릭터의 색상조절 버튼" },
  { rect: [628, 401, 649, 421], text: NOT_SUPPORTED },
  { rect: [427, 401, 448, 421], text: NOT_SUPPORTED },
  { rect: MY_INFO_BUTTONS.money.hit, text: NOT_SUPPORTED },
  { rect: MY_INFO_BUTTONS.shop.hit, text: NOT_SUPPORTED },
  { rect: MY_INFO_BUTTONS.save.hit, text: "입력 및 수정 확인(enter)" },
  { rect: MY_INFO_BUTTONS.close.hit, text: "취소 버튼(esc)" },
];

const GREETING_HELP: HelpEntry[] = [
  { rect: GREETING_POPUP.ok.hit, text: "입력 및 수정 확인(enter)" },
  { rect: GREETING_POPUP.cancel.hit, text: "취소 버튼(esc)" },
];

/** The balloon under the mouse: the greeting popup's while it is open, else the window's. */
export function myInfoHelpAt(
  x: number,
  y: number,
  at: { useId: boolean; greeting?: boolean },
): { text: string; x: number; y: number } | null {
  const entries = at.greeting ? GREETING_HELP : MAIN_HELP;
  const entry = entries.find((e) => inside(e.rect, x, y));
  if (!entry) return null;
  const text = typeof entry.text === "string" ? entry.text : entry.text(at.useId);
  return { text, x: entry.x ? entry.x(x) : x, y };
}
