// The start-up screens of shake.exe 0311: the logo (scene 0xe), loading (1), login (3), the server
// list (2) and the fade between scenes. Geometry and rules from findings_startup.md.
import type { Rect } from "../assets/types.ts";
import type { Button, Point } from "./roomLayout.ts";
import { inside } from "./roomLayout.ts";

/** The frame driver's 30 fps (0x45f98f); loading waits up to 100 ms a frame on its thread (0x40cc5f). */
export const FRAME_MS = 1000 / 30;
export const LOADING_FRAME_MS = 100;
/** SetTimer 8000 from the first logo frame (0x40cd2e). */
export const LOGO_MS = 2000;
/** SetTimer 9000: the loader thread resumes 2 s after the switch to loading (0x460b42). */
export const LOADER_DELAY_MS = 2000;
/** SetTimer 7000: the full bar shows 1 s before the login (0x40cc5f). */
export const FULL_BAR_MS = 1000;
export const FADE_FRAMES = 11;

/**
 * Fade-out (state 1): the scene is not drawn and the gamma goes 10 % darker a frame, the 11th
 * frame black (0x4130f0(1)). Frame counts from 0.
 */
export function fadeOutDarkness(frame: number): number {
  return Math.min(1, (frame + 1) / 10);
}

/** Fade-in (state 2): the new scene is drawn, 90 % dark first, 10 % less a frame, then restored. */
export function fadeInDarkness(frame: number): number {
  return Math.max(0, (9 - frame) / 10);
}

// Loading (0x418fd0)

/** 0x412d50(196, 468, 16·n, 109, 0xFD18) under loading.shk, whose fuse is its keyed hole. */
export const LOADING_BAR = { x: 196, y: 468, height: 109, step: 16, colour: "#ffa2c6" };
/** The loader's increments (0x4042c7 … 0x40580f). */
export const LOADING_STEPS = 33;

export function loadingBarWidth(count: number): number {
  return LOADING_BAR.step * Math.max(0, Math.min(LOADING_STEPS, count));
}

/** The 33 steps spread over the files this remake loads: after `done` of `total`. */
export function loadingCount(done: number, total: number): number {
  if (total <= 0) return LOADING_STEPS;
  return Math.floor((LOADING_STEPS * Math.min(done, total)) / total);
}

// Login (scene 3: draw 0x419a10, releases 0x459069)

/** new_banner (1,1)-(386,48) at (209,18), drawn by the server list's 0x433530 on both screens. */
export const START_BANNER = { src: [1, 1, 386, 48] as Rect, at: { x: 209, y: 18 } };

export const LOGIN = {
  panel: { x: 238, y: 203 },
  id: { text: { x: 405, y: 276 }, field: [401, 274, 516, 292] as Rect },
  pw: { text: { x: 405, y: 302 }, field: [401, 300, 516, 318] as Rect },
  /** TEXT_draw font 13, COLORREF 0x00FFFF with the black outline (0x41a040). */
  colour: "#ffff00",
  /** The editor's limit 0xb (0x41bc00): 10 bytes. */
  limit: 11,
  /** 11 rows of 3 px (black, black, white) written into the frame (0x41a5e0). */
  caretRows: 11,
};

export function loginCaret(field: "id" | "pw", caretBytes: number): Point {
  return { x: 406 + 7 * caretBytes, y: field === "id" ? 278 : 304 };
}

/** new_button's art: NEW ID has hover art; OK and EXIT only pressed art. */
export const LOGIN_BUTTONS = {
  ok: { hit: [261, 360, 292, 391] as Rect, hover: null, pressed: [1, 1, 34, 34] as Rect, at: { x: 261, y: 360 }, help: "확인(enter)" },
  newId: { hit: [353, 361, 443, 389] as Rect, hover: [338, 377, 428, 405] as Rect, pressed: [370, 348, 458, 376] as Rect, at: { x: 353, y: 361 }, help: "회원가입" },
  exit: { hit: [508, 360, 539, 391] as Rect, hover: null, pressed: [69, 1, 102, 34] as Rect, at: { x: 508, y: 360 }, help: "게임종료" },
} satisfies Record<string, Button & { help: string }>;

export type LoginTarget = keyof typeof LOGIN_BUTTONS | "id" | "pw";

export function loginButtonAt(x: number, y: number): LoginTarget | null {
  for (const [name, button] of Object.entries(LOGIN_BUTTONS)) if (inside(button.hit, x, y)) return name as LoginTarget;
  if (inside(LOGIN.id.field, x, y)) return "id";
  if (inside(LOGIN.pw.field, x, y)) return "pw";
  return null;
}

// Server list (scene 2: draw 0x433530, list 0x433750, rows 0x433b10, releases 0x4591fb)

export interface ListSlide {
  open: boolean;
  closing: boolean;
  /** Opening: the left half's width and x, the right half's source left (statics 0x46e99c…). */
  w: number;
  x: number;
  l: number;
  leftDone: boolean;
  rightDone: boolean;
  /** Closing's own statics, 31 / 281 / 225 at rest. */
  closeX: number;
  closeW: number;
  closeL: number;
}

const LIST_TOP = 126;
const LIST_RIGHT_AT = 491;

/** The statics as the program starts: open, so the first entry slides open. */
export function newSlide(): ListSlide {
  return { open: true, closing: false, w: 14, x: 300, l: 514, leftDone: false, rightDone: false, closeX: 31, closeW: 281, closeL: 225 };
}

/** One frame of 0x433750, before its draw. */
export function stepSlide(slide: ListSlide): void {
  if (slide.open) {
    slide.w = slide.w < 254 ? slide.w + 20 : 254;
    if (slide.x > 60) slide.x -= 20;
    else {
      slide.x = 60;
      slide.leftDone = true;
    }
    if (slide.l > 254) slide.l -= 20;
    else {
      slide.l = 254;
      slide.rightDone = true;
    }
    return;
  }
  if (!slide.closing) return;
  slide.closeX += 28;
  slide.closeW -= 28;
  slide.closeL += 28;
  if (slide.closeW <= 1) {
    slide.closeX = 31;
    slide.closeW = 281;
    slide.closeL = 225;
    slide.closing = false;
  }
}

/** The two halves of new_listwindow this frame. */
export function slideBlits(slide: ListSlide): { src: Rect; x: number; y: number }[] {
  if (slide.open) {
    return [
      { src: [1, 1, slide.w, 393], x: slide.x, y: LIST_TOP },
      { src: [slide.l, 1, 505, 393], x: LIST_RIGHT_AT, y: LIST_TOP },
    ];
  }
  if (!slide.closing) return [];
  return [
    { src: [1, 1, slide.closeW, 393], x: slide.closeX, y: LIST_TOP },
    { src: [slide.closeL, 1, 505, 393], x: LIST_RIGHT_AT, y: LIST_TOP },
  ];
}

export function rowsShown(slide: ListSlide): boolean {
  return slide.open && slide.leftDone && slide.rightDone;
}

/** A release on refresh (0x4345f0): an open list closes; a closed one opens from the start. */
export function toggleSlide(slide: ListSlide): void {
  if (slide.open) {
    slide.open = false;
    slide.closing = true;
    return;
  }
  Object.assign(slide, { open: true, closing: false, w: 14, x: 300, l: 514, leftDone: false, rightDone: false, closeX: 31, closeW: 281, closeL: 225 });
}

/** The original's two columns of twenty positions; overflow uses the same positions on another page (R). */
export const SERVER_ROWS_PER_PAGE = 40;

export function serverPageCount(count: number): number {
  return Math.max(1, Math.ceil(count / SERVER_ROWS_PER_PAGE));
}

/** Row i: Y resets at row 20 only (0x433b34–0x433b40); later original rows continued below the window. */
export function rowOrigin(i: number): Point {
  return { x: i < 20 ? 76 : 516, y: 142 + 18 * (i < 20 ? i : i - 20) };
}

function rowAt(x: number, y: number, count: number, columns: readonly [number, number][], page: number): number {
  const first = page * SERVER_ROWS_PER_PAGE;
  for (let i = 0; i < Math.min(count - first, SERVER_ROWS_PER_PAGE); i++) {
    const [left, right] = columns[i < 20 ? 0 : 1];
    const top = rowOrigin(i).y;
    if (x >= left && x <= right && y >= top && y <= top + 15) return first + i;
  }
  return -1;
}

/** The lit row (0x4339a0): x 76..265 or 514..726, inside the list, under the server count. */
export function rowHoverAt(x: number, y: number, count: number, page = 0): number {
  if (!inside([60, 126, 288, 517], x, y) && !inside([514, 126, 742, 517], x, y)) return -1;
  return rowAt(x, y, count, [
    [76, 265],
    [514, 726],
  ], page);
}

/** The clicked row (0x434770): the left column's band is wider, to 288. */
export function rowClickAt(x: number, y: number, count: number, page = 0): number {
  return rowAt(x, y, count, [
    [76, 288],
    [514, 726],
  ], page);
}

/** The bar's source top by row (jump table 0x433f14/0x433ef0); rows 39-48 keep row 38's. */
export function rowBarTop(i: number): number {
  if (i === 0) return 297;
  if (i === 19) return 342;
  if (i === 20) return 357;
  if (i === 49) return 402;
  if (i < 19) return i % 10 < 5 ? 312 : 327;
  if (i < 39) return (i - 20) % 10 < 5 ? 372 : 387;
  return 387;
}

/** new_serverob's bars: "normal" (3..213) under the mouse, "selected" (213..423) held or chosen. */
export function rowBar(i: number, selected: boolean): Rect {
  const top = rowBarTop(i);
  return selected ? [213, top, 423, top + 15] : [3, top, 213, top + 15];
}

/** The row's texts, TEXT_plain font 13 with a black shadow, and its gauge (0x433b10). */
export function rowTexts(i: number): { name: Point; nameShadow: Point; percent: Point; percentShadow: Point; gauge: Point; leftward: boolean } {
  const { y } = rowOrigin(i);
  if (i < 20) {
    return { name: { x: 90, y }, nameShadow: { x: 92, y: y + 1 }, percent: { x: 199, y }, percentShadow: { x: 201, y: y + 1 }, gauge: { x: 176, y: y + 1 }, leftward: false };
  }
  return { name: { x: 628, y }, nameShadow: { x: 629, y: y + 1 }, percent: { x: 569, y }, percentShadow: { x: 570, y: y + 1 }, gauge: { x: 620, y: y + 1 }, leftward: true };
}

/** A row's name, its shadow from x 92, before the left gauge at 176. The original cut none, its names
 *  being short; the remake's can be a host name, so it is cut to this width. */
export const ROW_NAME_WIDTH = 84;

/** "%3d%%" of the load; below 0 or above 100 shows 100. */
export function percentText(load: number): string {
  const shown = load < 0 || load > 100 ? 100 : Math.trunc(load);
  return `${String(shown).padStart(3, " ")}%`;
}

/** The ping gauge's level (0x4343f0): green by 100 ms steps to 500, then red; negatives are green. */
export function gaugeLevel(ping: number): { n: number; red: boolean } {
  if (ping <= 100) return { n: 5, red: false };
  if (ping <= 500) return { n: 5 - Math.ceil((ping - 100) / 100), red: false };
  if (ping <= 900) return { n: Math.ceil((ping - 500) / 100), red: true };
  return { n: 5, red: true };
}

/** The loop draws n+1 bars; the sixth's source is the keyed magenta, so at most 5 show. */
export function visibleBars(level: { n: number }): number {
  return Math.min(level.n + 1, 5);
}

/** Bar k of the gauge: 3×11 at a 4 px pitch, green at y 76 and red at y 88 in new_serverob. */
export function gaugeBar(k: number, red: boolean): Rect {
  const top = red ? 88 : 76;
  return [369 + 4 * k, top, 372 + 4 * k, top + 11];
}

export const SERVER_BUTTONS = {
  refresh: { hit: [340, 133, 462, 182] as Rect, hover: [3, 3, 125, 52] as Rect, pressed: [3, 52, 125, 101] as Rect, at: { x: 340, y: 133 }, help: "서버 리플레시", helpAt: null },
  auto: { hit: [564, 540, 652, 576] as Rect, hover: [369, 3, 457, 39] as Rect, pressed: [369, 39, 457, 75] as Rect, at: { x: 564, y: 540 }, help: "최적서버 자동 접속(현재 지원안함)", helpAt: { x: 564, y: 540 } },
  exit: { hit: [669, 540, 757, 576] as Rect, hover: [457, 3, 545, 39] as Rect, pressed: [457, 39, 545, 75] as Rect, at: { x: 669, y: 540 }, help: "게임종료 (esc)", helpAt: { x: 669, y: 540 } },
};

/** The refresh press's animation: new_serverob (3,t)-(125,t+49) at (340,133), four frames. */
export const REFRESH_FRAMES = [101, 150, 199, 248];

/** new_memo (1,1)-(325,336) at (238,132), opened on every login; its X has pressed art only. */
export const MEMO = {
  src: [1, 1, 325, 336] as Rect,
  at: { x: 238, y: 132 },
  close: { hit: [515, 431, 545, 461] as Rect, pressed: [318, 220, 348, 250] as Rect, at: { x: 515, y: 431 } },
  help: "창닫기(esc)",
};
