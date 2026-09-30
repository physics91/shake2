// Scene 5, the old full-screen "My Status" menu (loader 0x41cc30, draw 0x41cf30, clicks 0x45a8d3 →
// 0x41dfc0). 0311 keeps its code but never shows it: the background was dropped (findings_scene5.md).
// The remake draws Shake1's status.shk under it (AGENTS.md, R); every rect, art and text place here
// is 0311's.
import type { Rect } from "../assets/types.ts";
import { cp949Bytes } from "../server/cp949.ts";
import { NO_BADGE } from "../server/protocol.ts";
import type { Point } from "./roomLayout.ts";
import { inside } from "./roomLayout.ts";

/** A button with hover art only: scene 5 has no pressed art and no balloons (0x41f580, 0x41f8a0). */
export interface HoverButton {
  hit: Rect;
  /** images.shk. */
  hover: Rect;
  at: Point;
}

/** The bottom row, in the release order of 0x45a8d3; every page has them. */
export const STATUS_BUTTONS = {
  go: { hit: [24, 509, 169, 581], hover: [315, 0, 460, 72], at: { x: 24, y: 509 } },
  practice: { hit: [195, 509, 338, 581], hover: [460, 0, 603, 72], at: { x: 195, y: 509 } },
  ranking: { hit: [362, 509, 500, 581], hover: [603, 0, 741, 72], at: { x: 362, y: 509 } },
  option: { hit: [537, 509, 650, 581], hover: [0, 59, 113, 131], at: { x: 537, y: 509 } },
  exit: { hit: [686, 509, 777, 581], hover: [113, 59, 204, 131], at: { x: 686, y: 509 } },
} satisfies Record<string, HoverButton>;

export type StatusButton = keyof typeof STATUS_BUTTONS;

/** banner1.spr from its top-left (draw type 8, anchor 0,0); a frame lasts over 500 ms (0x41cf71). */
export const BANNER = { at: { x: 549, y: 290 } as Point, hit: [547, 288, 787, 480] as Rect, frameMs: 500 };

/** The main page's buttons (0x41f8a0 art). */
export const MAIN_BUTTONS = {
  ok: { hit: [47, 375, 123, 434], hover: [280, 72, 356, 131], at: { x: 47, y: 375 } },
  characterUp: { hit: [491, 71, 510, 93], hover: [741, 0, 760, 22], at: { x: 491, y: 71 } },
  characterDown: { hit: [491, 219, 510, 241], hover: [760, 0, 779, 22], at: { x: 491, y: 219 } },
  guildPassword: { hit: [307, 236, 326, 255], hover: [272, 40, 291, 59], at: { x: 307, y: 236 } },
  guildUp: { hit: [308, 276, 327, 298], hover: [741, 0, 760, 22], at: { x: 308, y: 276 } },
  guildDown: { hit: [308, 424, 327, 446], hover: [760, 0, 779, 22], at: { x: 308, y: 424 } },
  hueDown: { hit: [497, 118, 513, 133], hover: [204, 72, 218, 85], at: { x: 498, y: 119 } },
  hueUp: { hit: [497, 185, 513, 200], hover: [219, 72, 233, 85], at: { x: 498, y: 186 } },
} satisfies Record<string, HoverButton>;

/** The ID and nick checkboxes (0x41e86d) and their mark, images (255,43)-(272,59) (0x41da90). */
export const USE_ID_BOX: Rect = [262, 72, 279, 88];
export const USE_NICK_BOX: Rect = [262, 110, 279, 126];
export const CHECK_MARK = { src: [255, 43, 272, 59] as Rect, useId: { x: 262, y: 72 }, useNick: { x: 262, y: 110 } };

/** TEXT_plain colours: [0x469bb4] orange for the values, [0x469bb0] light blue for lists. */
export const ORANGE = "#ffb177";
export const LIGHT_BLUE = "#c8e5fd";

/** The ID (0x493fb0, which 0311 never fills) at (140,73), 굴림체 13. */
export const ID_TEXT: Point = { x: 140, y: 73 };

/**
 * The account's rows (0x41d320), font 13 orange. 0311 has no writer for any of them; Shake1 fills
 * them at login (0x411a50), and the remake from the login record (R). Rank, cell point and wins are
 * Shake1's "%15d", "%12d" and "%15d", so all three end at x 506.
 */
export const ACCOUNT_ROWS = {
  guild: { mark: { x: 140, y: 200 } as Point, name: { x: 157, y: 200 } as Point },
  level: { right: 508, y: 299, badgeGap: 18 },
  rank: { x: 401, y: 325, width: 15 },
  cell: { x: 422, y: 353, width: 12 },
  wins: { x: 401, y: 381, width: 15 },
};

/** printf's "%*d": the number right-aligned in `width` characters of the fixed-pitch 굴림체. */
export function padNumber(value: number, width: number): string {
  return String(value).padStart(width);
}

/** The level's title right-aligned at 508 (x = 508 − 7·strlen) and its badge 18 px before it (0x41d4f5). */
export function levelTitleAt(title: string): { title: Point; badge: Point } {
  const { right, y, badgeGap } = ACCOUNT_ROWS.level;
  const x = right - 7 * cp949Bytes(title);
  return { title: { x, y }, badge: { x: x - badgeGap, y } };
}

/**
 * The three edit fields (0x41ed31..0x41eeb8, Tab 0x41f110): their click rects, text places, the
 * editor's limit (bytes + 1) and the caret row. The password shows as '*' per byte.
 */
export const FIELDS = [
  { name: "nick", hit: [135, 108, 250, 127] as Rect, text: { x: 140, y: 111 }, limit: 0xb, caretY: 111 },
  { name: "greeting", hit: [135, 148, 306, 167] as Rect, text: { x: 140, y: 152 }, limit: 0x16, caretY: 151 },
  { name: "password", hit: [135, 234, 299, 253] as Rect, text: { x: 140, y: 238 }, limit: 0xb, caretY: 237 },
] as const;

/** The caret (0x41f480): a white line 1 × 14 at the editor's caret from x 140. */
export const CARET = { x: 140, height: 14, colour: "#ffffff" };

export function caretX(base: number, caretBytes: number): number {
  return base + 7 * caretBytes;
}

// The character browser (0x41d7c0)

/** Wg_char.shk's 70 × 70 face at (382,69); `_p.spr` from its top-left at (382,139). */
export const FACE_AT: Point = { x: 382, y: 69 };
export const PORTRAIT_AT: Point = { x: 382, y: 139 };

/** A usable face (0x41d7c0): indices 0–9 on the top row, 10–19 on the next. */
export function faceCell(index: number): Rect {
  const x = 70 * (index % 10);
  const y = index < 10 ? 0 : 70;
  return [x, y, x + 70, y + 70];
}

/** ▲ and ▼ (0x41e962, 0x41ea0a): −1 wraps to 17, and 17 + 1 to 0; nothing else wraps. */
export function stepStatusCharacter(index: number, step: 1 | -1): number {
  const next = index + step;
  if (step < 0) return next < 0 ? 17 : next;
  // 18 and 19 are reached only from a saved choice; the remake wraps past 19 too (R).
  return next === 18 || next > 19 ? 0 : next;
}

/**
 * The hue box, which is also the knob (0x41d7c0): white 35 × 13 at (489, 153 + d), its number black
 * at (505, 152 + d), with d = hue / 10 as C divides; the knob's hit is that box (0x494318).
 */
export function hueBox(hue: number): { fill: readonly [number, number, number, number]; hit: Rect; text: Point } {
  const d = Math.trunc(hue / 10);
  return { fill: [489, 153 + d, 35, 13], hit: [489, 153 + d, 524, 166 + d], text: { x: 505, y: 152 + d } };
}

/** The knob held (0x458e68): hue = (mouse y − 159) · 10, clamped to ±180. */
export function hueFromKnob(mouseY: number): number {
  return Math.max(-180, Math.min(180, (mouseY - 159) * 10));
}

// The guild list (0x41d320) and its scroll bar (object 0x471888)

export const GUILD_LIST = {
  box: [135, 272, 299, 444] as Rect,
  rows: 10,
  firstY: 274,
  step: 17,
  iconX: 135,
  nameX: 152,
};

/** The chosen row's bar (0x412d50): 565 colour 0x001F, 134 × 13 at (152, y), under the name. */
export const GUILD_BAR = { x: 152, width: 134, height: 13, fill: "#0000ff" };

/**
 * The row a click in the list picks (0x41ec80): (y − 274) / 17 from the top, below the count. 0311
 * counts a list box it never fills, so no row is ever picked there; the remake takes the ten shown (R).
 */
export function guildRowAt(x: number, y: number, top: number, count: number): number | null {
  if (!inside(GUILD_LIST.box, x, y)) return null;
  const shown = Math.trunc((y - GUILD_LIST.firstY) / GUILD_LIST.step);
  const row = top + shown;
  return shown < GUILD_LIST.rows && row < count ? row : null;
}

/**
 * The guild a row stands for (R): row k is guild.dat's line k, whose mark and name every list and
 * window draws by the name (0x441940, 0x42dc93); row 0, "없음", leaves (−1). 0311's list numbers
 * line k as k − 1 (0x4419e0), draws that cell by it and sends that number (0x448290): one off.
 */
export function guildOfRow(row: number): number {
  return row === 0 ? NO_BADGE.guild : row;
}

/** The track (308,298)-(326,423); the knob, images.shk, is drawn from (308, knob − 5). */
export const GUILD_TRACK: Rect = [308, 298, 326, 423];
export const KNOB = { dragging: [779, 0, 798, 10] as Rect, idle: [779, 10, 798, 20] as Rect };
const KNOB_TOP = GUILD_TRACK[1] + 5;
const KNOB_BOTTOM = GUILD_TRACK[3] - 5;
const SPAN = GUILD_TRACK[3] - GUILD_TRACK[1] - 10;
/** The x87 code multiplies by 100.0f and 0.01f, which is a hair under 1. */
const HUNDREDTH = Math.fround(0.01);

/** [0x4944cc] the first row shown; [0x494298] the knob's y; [0x48c328] held on the track; [0x46d85c] the chosen row, −1 none. */
export interface GuildScroll {
  top: number;
  knob: number;
  dragging: boolean;
  selected: number;
}

/** The reset (0x4205e0) puts the knob on the track's top; the first draw brings it down to 303. */
export function newGuildScroll(): GuildScroll {
  return { top: 0, knob: GUILD_TRACK[1], dragging: false, selected: -1 };
}

/** The first row for the knob's previous place (each step moves the knob after this). */
function topFor(scroll: GuildScroll, count: number): number {
  if (scroll.knob - KNOB_TOP === 0) return scroll.top;
  return knobTop(scroll.knob, count);
}

function knobTop(knob: number, count: number): number {
  return Math.trunc(((knob - KNOB_TOP) / SPAN) * 100 * HUNDREDTH * (count - 5));
}

/**
 * A row stepped to from the keyboard brought into the ten shown (R: 0311 has no such step): the knob
 * goes where its top shows the row, so the next ▲, ▼ or wheel notch goes on from there.
 */
export function showGuildRow(scroll: GuildScroll, row: number, count: number): void {
  if (row >= scroll.top && row < scroll.top + GUILD_LIST.rows) return;
  if (count < 10) {
    reset(scroll);
    return;
  }
  let knob = KNOB_TOP;
  if (row >= scroll.top + GUILD_LIST.rows) {
    while (knob < KNOB_BOTTOM && knobTop(knob, count) < row - (GUILD_LIST.rows - 1)) knob++;
  } else {
    while (knob < KNOB_BOTTOM && knobTop(knob + 1, count) <= row) knob++;
  }
  scroll.knob = knob;
  scroll.top = knobTop(knob, count);
}

function reset(scroll: GuildScroll): void {
  scroll.top = 0;
  scroll.knob = KNOB_TOP;
}

/** ▲ held (0x456980, 2 px) or the wheel up (0x456b20, 5 px). */
export function scrollUp(scroll: GuildScroll, count: number, px: 2 | 5): void {
  if (count < 10 || scroll.knob <= KNOB_TOP) {
    reset(scroll);
    return;
  }
  scroll.top = topFor(scroll, count);
  scroll.knob -= px;
}

/** ▼ held (0x456a50, 2 px, no stop of its own) or the wheel down (0x456bf0, 5 px, not past 418). */
export function scrollDown(scroll: GuildScroll, count: number, px: 2 | 5): void {
  if (count < 10) {
    reset(scroll);
    return;
  }
  if (px === 5 && scroll.knob > KNOB_BOTTOM) return;
  scroll.top = topFor(scroll, count);
  scroll.knob += px;
}

/** A frame held with the drag on (0x456890): the knob follows the mouse above y 419. */
export function dragKnob(scroll: GuildScroll, count: number, mouseY: number): void {
  if (count < 10) {
    reset(scroll);
    return;
  }
  if (mouseY >= GUILD_TRACK[3] - 4) return;
  if (mouseY <= KNOB_TOP) {
    reset(scroll);
    return;
  }
  scroll.top = topFor(scroll, count);
  scroll.knob = mouseY;
}

/** The draw keeps the knob within 303..418 and writes it back (0x41d6a5). */
export function clampKnob(scroll: GuildScroll): number {
  if (scroll.knob <= KNOB_TOP) scroll.knob = KNOB_TOP;
  if (scroll.knob >= KNOB_BOTTOM) scroll.knob = KNOB_BOTTOM;
  return scroll.knob;
}

// The ranking page (0x41db60, 0x41fd00)

export const RANKING = {
  panel: { x: 18, y: 7 },
  up: { hit: [498, 74, 517, 96], hover: [741, 0, 760, 22], at: { x: 498, y: 74 } } satisfies HoverButton,
  down: { hit: [498, 401, 517, 423], hover: [760, 0, 779, 22], at: { x: 498, y: 401 } } satisfies HoverButton,
  search: { hit: [483, 434, 511, 456], hover: [741, 22, 769, 49], at: { x: 483, y: 436 } } satisfies HoverButton,
  /** The ID to find: the editor is always on it while the page is open (0x41f1c0, limit 0xb). */
  field: { hit: [332, 438, 475, 459] as Rect, text: { x: 334, y: 441 }, limit: 0xb },
};

/** The resource strings scene 5 shows in the message box. */
export const STATUS_TEXT = {
  notFound: "찾을 수 없습니다.",
  chooseGuild: "길드를 선택하세요",
  /** S->C 0x4a's answer (0x445464): resource 35 over "되었습니다". */
  guildSaved: "길드가 수정\n되었습니다",
  /** Its refusal (resource 36). */
  guildFailed: "길드 수정 실패",
  /** 확인's answer: 0311's text for it is not known; the my-info window's (S->C 0x1a) is used (R). */
  saved: "수정 되었습니다.",
};

// The option page (0x41d062, 0x41fea0; clicks in 0x41dfc0). 0311 never makes its panel (NULL,
// so opening the page crashes it); the remake draws Shake1's option.shk (521 × 480) there (R).

export const OPTION_PAGE = {
  panel: { x: 18, y: 7 },
  /** CM1..CM10 as F1..F10, font 13 light blue at (92, 97 + 24 i); the editor takes 25 bytes (0x1a). */
  macros: { hit: [90, 88, 295, 329] as Rect, x: 92, firstY: 97, step: 24, top: 88, lines: 10, limit: 0x1a },
  joystick: [427, 94, 444, 110] as Rect,
  keyboard: [427, 121, 444, 137] as Rect,
  /** The device's mark, images (255,43)-(272,59). */
  mark: { src: [255, 43, 272, 59] as Rect, joystick: { x: 427, y: 94 } as Point, keyboard: { x: 427, y: 121 } as Point },
  music: {
    on: { hit: [134, 352, 192, 373] as Rect, art: [508, 72, 566, 93] as Rect, at: { x: 134, y: 352 } as Point },
    off: { hit: [192, 352, 255, 373] as Rect, art: [566, 72, 629, 93] as Rect, at: { x: 192, y: 352 } as Point },
  },
  sound: {
    on: { hit: [134, 373, 192, 395] as Rect, art: [508, 93, 566, 115] as Rect, at: { x: 134, y: 373 } as Point },
    off: { hit: [192, 373, 255, 395] as Rect, art: [566, 93, 629, 115] as Rect, at: { x: 192, y: 373 } as Point },
  },
  /** Key1..Key3: the boxes, and where the name (or, while it changes, the blue bar 0x4129b0) goes. */
  keys: [
    { hit: [425, 321, 484, 340] as Rect, name: { x: 427, y: 324 } as Point },
    { hit: [425, 374, 484, 393] as Rect, name: { x: 427, y: 377 } as Point },
    { hit: [425, 428, 484, 447] as Rect, name: { x: 427, y: 431 } as Point },
  ],
  /** Eight spaces of 굴림체 13 (7 × 13 px each) on an opaque background, COLORREF 0xFF0000. */
  changing: { width: 56, height: 13, fill: "#0000ff" },
  ok: { hit: [57, 408, 133, 467], hover: [356, 72, 432, 131], at: { x: 57, y: 408 } } satisfies HoverButton,
  cancel: { hit: [142, 408, 218, 467], hover: [432, 72, 508, 131], at: { x: 142, y: 408 } } satisfies HoverButton,
};

/**
 * The macro line a click in the area picks, (y − 88) / 24 (0x41e5ea). Its last two rows give 10,
 * a buffer past CM10; the remake takes no line there (R).
 */
export function optionMacroLine(y: number): number | null {
  const line = Math.trunc((y - OPTION_PAGE.macros.top) / OPTION_PAGE.macros.step);
  return line < OPTION_PAGE.macros.lines ? line : null;
}

/**
 * 0x46d864: the page's key names, 137 of them, index = DIK. The order is the scene-13 table's
 * (dik.ts: from 0x54 dinput's names without its gaps, so F11, DIK 0x57, shows "F14"), unpadded.
 */
export const STATUS_KEY_NAMES: readonly string[] = [
  "ESCAPE", "ESCAPE", "1", "2", "3", "4", "5", "6", "7", "8", "9", "0", "MINUS", "EQUALS", "BACK", "TAB",
  "Q", "W", "E", "R", "T", "Y", "U", "I", "O", "P", "LBRACKET", "RBRACKET", "RETURN", "LCONTROL", "A", "S",
  "D", "F", "G", "H", "J", "K", "L", "SEMICOLON", "APOSTROPHE", "GRAVE", "LSHIFT", "BACKSLASH", "Z", "X",
  "C", "V", "B", "N", "M", "COMMA", "PERIOD", "SLASH", "RSHIFT", "MULTIPLY", "LMENU", "SPACE", "CAPITAL",
  "F1", "F2", "F3", "F4", "F5", "F6", "F7", "F8", "F9", "F10", "NUMLOCK", "SCROLL", "NUMPAD7", "NUMPAD8",
  "NUMPAD9", "SUBTRACT", "NUMPAD4", "NUMPAD5", "NUMPAD6", "ADD", "NUMPAD1", "NUMPAD2", "NUMPAD3", "NUMPAD0",
  "DECIMAL", "F11", "F12", "F13", "F14", "F15", "KANA", "CONVERT", "NOCONVERT", "YEN", "NUMPADEQUALS",
  "CIRCUMFLEX", "AT", "COLON", "UNDERLINE", "KANJI", "STOP", "AX", "UNLABELED", "NUMPADENTER", "RCONTROL",
  "NUMPADCOMMA", "DIVIDE", "SYSRQ", "RMENU", "HOME", "UP", "PRIOR", "LEFT", "RIGHT", "END", "DOWN", "NEXT",
  "INSERT", "DELETE", "LWIN", "RWIN", "APPS", "PAUSE", "BACKSPACE", "NUMPADSTAR", "LALT", "CAPSLOCK",
  "NUMPADMINUS", "NUMPADPLUS", "NUMPADPERIOD", "NUMPADSLASH", "RALT", "UPARROW", "PGUP", "LEFTARROW",
  "RIGHTARROW", "DOWNARROW", "PGDN",
];

/** Past the table 0311 reads on into other pointers; the remake draws nothing (R). */
export function statusKeyName(dik: number): string {
  return STATUS_KEY_NAMES[dik] ?? "";
}

/** 확인's message once the options are written (0x420410). */
export const OPTION_SAVED = "수정되었습니다.";
