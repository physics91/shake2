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

/** The nickname popup's refusals (S->C 0x57, 0x44b080); scene 5's 확인 answers with them too (R). */
export const NICK_REFUSALS: Readonly<Record<number, string>> = {
  0xfc: "한번이상 수정할수 없습니다!!",
  0xfd: "이미 사용중인 닉네임입니다!!",
  0xfe: "닉네임 수정 실패!!",
};

export function nickRefusal(code: number): string {
  return NICK_REFUSALS[code] ?? NICK_REFUSALS[0xfe];
}

export const GREETING_POPUP = {
  src: [1, 261, 239, 440] as Rect,
  at: { x: 274, y: 200 },
  text: { x: 323, y: 282, lineStep: 15 },
  ok: { hit: [281, 341, 311, 371] as Rect, pressed: [1, 147, 33, 179] as Rect, at: { x: 281, y: 341 } },
  cancel: { hit: [468, 341, 498, 371] as Rect, pressed: [34, 146, 66, 178] as Rect, at: { x: 468, y: 341 } },
};

/**
 * The colour popup "캐릭터 꾸미기" (draw 0x43cd8a): new_charchange's upper half over the 내캐릭터
 * box, the Wg_char face through work surface 6, the knob on its track. O and X are new_button2's
 * pressed art, ◀ and ▶ new_button's.
 */
export const COLOUR_POPUP = {
  src: [1, 1, 288, 259] as Rect,
  at: { x: 393, y: 97 },
  face: { x: 495, y: 182 },
  knob: { src: [355, 344, 368, 358] as Rect, y: 267 },
  ok: { hit: [403, 317, 433, 347] as Rect, pressed: [328, 10, 360, 42] as Rect, at: { x: 403, y: 317 } },
  cancel: { hit: [637, 316, 667, 347] as Rect, pressed: [361, 10, 393, 42] as Rect, at: { x: 637, y: 316 } },
  left: { hit: [474, 267, 486, 281] as Rect, pressed: [319, 343, 335, 359] as Rect, at: { x: 471, y: 266 } },
  right: { hit: [580, 267, 592, 281] as Rect, pressed: [336, 343, 353, 359] as Rect, at: { x: 578, y: 266 } },
  track: [488, 267, 576, 281] as Rect,
};

/** The colour icon's new_button art while the account has item 20: lit, and pressed while held (0x43c790). */
export const COLOUR_ICON = { lit: [175, 191, 203, 219] as Rect, pressed: [204, 191, 232, 219] as Rect, at: { x: 479, y: 229 } };

/** [0x496334] the slider's hue and [0x46ea44] the knob's x, a float. */
export interface ColourSlider {
  hue: number;
  knob: number;
}

/** Opening the popup (0x43e2c0) puts the hue at 0 and the knob at 526, not at the hue the character has. */
export function newColourSlider(): ColourSlider {
  return { hue: 0, knob: 526 };
}

const KNOB_STEP = 0.21;

/**
 * 0x43e580 at a held or released point: ◀ and ▶ move the hue 1 and the knob 0.21 px, clamping at
 * the knob's stops (so ◀ from 526 snaps from −153 to −180); the track sets the hue from x. Whether
 * it changed anything.
 */
export function slideColour(slider: ColourSlider, x: number, y: number): boolean {
  if (inside(COLOUR_POPUP.left.hit, x, y)) {
    slider.hue -= 1;
    slider.knob = Math.fround(slider.knob - KNOB_STEP);
    if (slider.hue < -180 || slider.knob <= 494) Object.assign(slider, { hue: -180, knob: 488 });
  } else if (inside(COLOUR_POPUP.right.hit, x, y)) {
    slider.hue += 1;
    slider.knob = Math.fround(slider.knob + KNOB_STEP);
    if (slider.hue > 180 || slider.knob >= 564) Object.assign(slider, { hue: 180, knob: 564 });
  } else if (inside(COLOUR_POPUP.track, x, y)) {
    if (x <= 494) Object.assign(slider, { hue: -180, knob: 488 });
    else if (x >= 564) Object.assign(slider, { hue: 180, knob: 564 });
    else Object.assign(slider, { hue: Math.trunc(((x - 530) / 37) * 180), knob: x - 6 });
  } else {
    return false;
  }
  return true;
}

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

const COLOUR_HELP: HelpEntry[] = [
  { rect: COLOUR_POPUP.ok.hit, text: "입력 및 수정 확인(enter)" },
  { rect: COLOUR_POPUP.cancel.hit, text: "취소 버튼(esc)" },
  { rect: [474, 267, 592, 281], text: "화살표로 색 조절" },
];

/** The balloon under the mouse: the open popup's, else the window's. */
export function myInfoHelpAt(
  x: number,
  y: number,
  at: { useId: boolean; popup?: "greeting" | "colour" },
): { text: string; x: number; y: number } | null {
  const entries = at.popup === "greeting" ? GREETING_HELP : at.popup === "colour" ? COLOUR_HELP : MAIN_HELP;
  const entry = entries.find((e) => inside(e.rect, x, y));
  if (!entry) return null;
  const text = typeof entry.text === "string" ? entry.text : entry.text(at.useId);
  return { text, x: entry.x ? entry.x(x) : x, y };
}
