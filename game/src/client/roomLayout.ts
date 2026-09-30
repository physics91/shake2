// The waiting room (scene 7): drawn by 0x425560, pressed and hover art by 0x426d10, clicks on
// release by 0x45a412. Blit sources are [left, top, right, bottom) like the original's RECTs;
// hit rects are inclusive on all four edges (its jl/jg tests). See original/FIDELITY.md §13.
import type { Rect } from "../assets/types.ts";
import { cp949Bytes } from "../server/cp949.ts";
import type { RoomInfo } from "../server/protocol.ts";

export interface Point {
  x: number;
  y: number;
}

/** Both edges count (jl/jg). */
export function inside(rect: Rect, x: number, y: number): boolean {
  return x >= rect[0] && x <= rect[2] && y >= rect[1] && y <= rect[3];
}

// Text

/** Outline colours of the room's text (0x413df0's B,G,R bytes). */
export const OUTLINE = { blue: "#3e60a0", name: "#050556", black: "#000000", own: "#311400", other: "#212070", system: "#002700" };
export const ROOM_NUMBER_AT: Point = { x: 235, y: 30 };
export const ROOM_TITLE_AT: Point = { x: 305, y: 30 };
export const MAP_NAME_AT: Point = { x: 635, y: 283 };
export const MUSIC_NAME_AT: Point = { x: 635, y: 326 };
export const MODE_NAME_AT: Point = { x: 635, y: 369 };
/** The notice line (0x4142d0): #ffffff and #ffff00 in turn every 500 ms, for 60 s. */
export const NOTICE = { x: 52, y: 515, swapMs: 500, showMs: 60_000, joinText: "도움말을 보시려면 F1키를 눌러주세요." };

/** The message box's line when the host puts this player out (S->C 0x44, string 28 at [0x48df74]). */
export const KICKED_TEXT = "강퇴 당했습니다.";

/** "%03d" of the room number + 1 (0x440660). */
export function roomNumberText(number: number): string {
  return String(number + 1).padStart(3, "0");
}

/** The room shows a map name without its two-digit list prefix, RANDOM as it is (0x425560). */
export function shownMapName(name: string): string {
  return name === "RANDOM" ? name : name.slice(2);
}

// Slots

export const SLOT_ORIGINS: readonly Point[] = [
  { x: 65, y: 105 },
  { x: 304, y: 105 },
  { x: 65, y: 196 },
  { x: 304, y: 196 },
  { x: 65, y: 287 },
  { x: 304, y: 287 },
];

/** A slot's hit rect (0x428a30): 226 x 82 past its origin, edges included. */
export function slotRect(slot: number): Rect {
  const { x, y } = SLOT_ORIGINS[slot];
  return [x, y, x + 226, y + 82];
}

/** new_pReadyobject1's parts and where they go in a slot (0x426554, 0x4277a0). */
export const SLOT_ART = {
  closed: [1, 169, 227, 252] as Rect,
  /** Pressed art of an empty slot the host is about to close or open. */
  pressOpen: [1, 85, 227, 168] as Rect,
  pressClosed: [1, 1, 227, 84] as Rect,
  panel: [1, 253, 227, 336] as Rect,
  host: [73, 337, 144, 408] as Rect,
  ready: [1, 337, 72, 408] as Rect,
  square: { x: 8, y: 6 },
  teamPanel: { x: 87, y: 8 },
  portrait: { x: 8, y: 6 },
  guild: { x: 112, y: 19 },
  rank: { x: 128, y: 19 },
  name: { x: 145, y: 19 },
  points: { x: 185, y: 50 },
};

/** Team t's panel (1..6): purple, blue, green, pink, red, yellow. */
export function teamPanelRect(team: number): Rect {
  const top = 70 * (team - 1) + 1;
  return [228, top, 360, top + 70];
}

/**
 * The account's item icons on every taken slot, the own one too (0x425560), lit by the local
 * account's items whoever sits there: kick (the host with item 2), mask (item 3) and whisper
 * (item 8), new_button art past the slot's origin. Pressed art (0x426d10) goes one pixel right for
 * the kick; hits (0x428b40) run x L+92..119, 120..146, 147..174.
 */
export const SLOT_ICONS = {
  kick: { lit: [285, 61, 313, 90] as Rect, pressed: [285, 91, 313, 120] as Rect, at: { x: 91, y: 41 }, pressedAt: { x: 92, y: 41 }, hit: [92, 119] },
  mask: { lit: [285, 1, 312, 30] as Rect, pressed: [285, 31, 312, 60] as Rect, at: { x: 120, y: 41 }, pressedAt: { x: 120, y: 41 }, hit: [120, 146] },
  whisper: { lit: [251, 94, 279, 123] as Rect, pressed: [222, 94, 250, 123] as Rect, at: { x: 147, y: 41 }, pressedAt: { x: 147, y: 41 }, hit: [147, 174] },
};

export type SlotIcon = keyof typeof SLOT_ICONS;

/** The icon under the mouse on a slot (0x428b40): by x, from T+41 to the slot's bottom − 14. */
export function slotIconAt(slot: number, x: number, y: number): SlotIcon | null {
  const [left, top, , bottom] = slotRect(slot);
  if (y < top + 41 || y > bottom - 14) return null;
  for (const icon of ["kick", "mask", "whisper"] as const) {
    const [from, to] = SLOT_ICONS[icon].hit;
    if (x >= left + from && x <= left + to) return icon;
  }
  return null;
}

/**
 * The mask and whisper icons under the chat (0x425560 step 4), lit by items 3 and 8, pressed while
 * held; a click does nothing in the room (0x45a412). Their balloons are helpAt's.
 */
export const ROOM_ITEM_ICONS = {
  mask: { lit: [285, 1, 312, 30] as Rect, pressed: [285, 31, 312, 60] as Rect, at: { x: 71, y: 535 }, hit: [71, 535, 100, 564] as Rect },
  whisper: { lit: [251, 94, 279, 123] as Rect, pressed: [222, 94, 250, 123] as Rect, at: { x: 101, y: 535 }, hit: [101, 535, 128, 563] as Rect },
};

/** The slot under the mouse, or -1; the own slot is -1 too (0x428a30, 0x469948). */
export function slotAt(x: number, y: number, ownSlot: number): number {
  const slot = SLOT_ORIGINS.findIndex((_, i) => inside(slotRect(i), x, y));
  return slot === ownSlot ? -1 : slot;
}

// Buttons (new_button.shk)

export interface Button {
  hit: Rect;
  hover: Rect | null;
  pressed: Rect;
  at: Point;
}

export const START: Button & { blink: Rect } = {
  hit: [640, 462, 729, 490],
  hover: [193, 32, 284, 62],
  pressed: [193, 63, 284, 93],
  blink: [193, 1, 284, 31],
  at: { x: 640, y: 462 },
};
export const SHOP: Button = { hit: [649, 493, 717, 521], hover: [72, 281, 142, 311], pressed: [215, 281, 286, 311], at: { x: 649, y: 493 } };
export const EXIT: Button = { hit: [649, 523, 717, 551], hover: [72, 312, 142, 342], pressed: [215, 312, 286, 342], at: { x: 649, y: 523 } };
export const SCROLL_UP: Button = { hit: [528, 405, 542, 418], hover: null, pressed: [111, 180, 125, 193], at: { x: 528, y: 405 } };
export const SCROLL_DOWN: Button = { hit: [528, 510, 542, 523], hover: null, pressed: [126, 180, 140, 193], at: { x: 528, y: 510 } };
export const SCROLL_TRACK: Rect = [527, 419, 542, 508];

export type ListKind = "map" | "music" | "mode";

/** The host's ◀ and ▶ per list (0x428340) and the name strip that opens its dropdown (0x4285d0). */
export const LISTS: Record<ListKind, { prev: Button; next: Button; strip: Rect }> = {
  map: {
    prev: { hit: [617, 281, 628, 296], hover: null, pressed: [150, 37, 162, 53], at: { x: 617, y: 281 } },
    next: { hit: [738, 281, 752, 296], hover: null, pressed: [164, 37, 176, 53], at: { x: 738, y: 281 } },
    strip: [629, 282, 737, 296],
  },
  music: {
    prev: { hit: [617, 324, 628, 339], hover: null, pressed: [150, 54, 162, 70], at: { x: 617, y: 324 } },
    next: { hit: [738, 324, 752, 339], hover: null, pressed: [164, 54, 176, 70], at: { x: 738, y: 324 } },
    strip: [629, 325, 737, 339],
  },
  mode: {
    prev: { hit: [617, 367, 628, 382], hover: null, pressed: [150, 71, 162, 87], at: { x: 617, y: 367 } },
    next: { hit: [738, 367, 752, 382], hover: null, pressed: [164, 71, 176, 87], at: { x: 738, y: 367 } },
    strip: [629, 368, 737, 382],
  },
};

/**
 * ◀ and ▶ wrap around (0x428340). The map list has `count` maps after RANDOM, entries 0..count.
 * The music arrows wrap at count - 1, so the last tune is only in the dropdown. Modes are 0..7.
 */
export function stepList(kind: ListKind, index: number, count: number, dir: -1 | 1): number {
  const last = kind === "map" ? count : kind === "music" ? count - 1 : 7;
  if (dir < 0) return index > 0 ? index - 1 : last;
  return index < last ? index + 1 : 0;
}

/** SELECTTEAM (0x425d6e): six buttons drawn from new_button y 124..141, pressed y 142..159. */
export const TEAM_BUTTONS: readonly { src: [number, number]; x: number; hit: [number, number] }[] = [
  { src: [186, 205], x: 630, hit: [630, 648] },
  { src: [206, 224], x: 649, hit: [649, 665] },
  { src: [225, 243], x: 667, hit: [667, 684] },
  { src: [244, 262], x: 685, hit: [685, 702] },
  { src: [263, 281], x: 703, hit: [703, 720] },
  { src: [282, 300], x: 721, hit: [721, 738] },
];
export const TEAM_ROW = { y: 412, bottom: 429, src: 124, pressedSrc: 142, height: 18 };

/** The team button under the mouse (1..6), or 0. */
export function teamAt(x: number, y: number): number {
  if (y < TEAM_ROW.y || y > TEAM_ROW.bottom) return 0;
  return TEAM_BUTTONS.findIndex((b) => x >= b.hit[0] && x <= b.hit[1]) + 1;
}

// Map preview

export const MAP_PREVIEW_AT: Point = { x: 624, y: 181 };

/** mapimage's cell for the map at list position i (RANDOM left out): 5 per row (0x425bcb). */
export function mapPreviewRect(i: number): Rect {
  const c = i % 5;
  const r = Math.floor(i / 5);
  return [120 * c + 1, 96 * r + 1, 120 * c + 120, 96 * r + 96];
}

// Dropdowns (new_pReadyobject2.shk)

/** An open dropdown's panel and its rows: `entries` rows of 15 px under the strip (0x425560, 0x428700). */
export function dropdownPanel(kind: ListKind, entries: number): { src: Rect; at: Point } {
  const strip = LISTS[kind].strip;
  return { src: [1, 1, 111, 15 * entries + 3], at: { x: 629, y: strip[3] } };
}

/** Row i's text point (plain 굴림체 12): x 635, 3 px under the row's top. */
export function dropdownTextAt(kind: ListKind, i: number): Point {
  return { x: 635, y: LISTS[kind].strip[3] + 3 + 15 * i };
}

/** The row under the mouse, or -1: the strip's rect moved down 15 px per row (0x428700). */
export function dropdownRowAt(kind: ListKind, entries: number, x: number, y: number): number {
  const [left, top, right, bottom] = LISTS[kind].strip;
  for (let i = 0; i < entries; i++) {
    if (inside([left, top + 15 * (i + 1), right, bottom + 15 * (i + 1)], x, y)) return i;
  }
  return -1;
}

export const DROPDOWN_COLOURS = { hover: "#ecefff", normal: "#7a84bd" };

// Chat log (0x427810)

export const CHAT_LOG = { x: 51, y: 396, lineStep: 17, lines: 7 };
export const CHAT_INPUT = { x: 204, y: 542 };
/** The room's editor (0x418d37): under 45 bytes. */
export const ROOM_EDITOR_LIMIT = 45;
const WRAP_BYTES = 70;
const CONTINUATION = "        ";

/**
 * A log line cut at 70 bytes; a double-byte character that would start at byte 69 goes on. The
 * rest follows on lines led by 8 spaces, which no colour test matches.
 */
export function wrapChat(line: string): string[] {
  const out: string[] = [];
  let current = "";
  let bytes = 0;
  for (const char of line) {
    const size = cp949Bytes(char);
    if (bytes + size > WRAP_BYTES) {
      out.push(current);
      current = CONTINUATION;
      bytes = cp949Bytes(CONTINUATION);
    }
    current += char;
    bytes += size;
  }
  out.push(current);
  return out;
}

/** The scroll thumb (new_button, drawn lighten-blended at its y - 8) and its three stops. */
export const THUMB = { normal: [91, 93, 107, 109] as Rect, dragging: [108, 93, 124, 109] as Rect, x: 527, top: 427, middle: 464, bottom: 500 };

/** A chat log's scroll bar: the thumb's three stops, the lines shown, and the drag's pixels per line. */
export interface ScrollGeometry {
  top: number;
  middle: number;
  bottom: number;
  lines: number;
  dragStep: number;
}

/** The room's: 7 lines; the drag's step is the track's 89 px over 8 - 3 (0x456750). */
export const ROOM_SCROLL: ScrollGeometry = {
  top: THUMB.top,
  middle: THUMB.middle,
  bottom: THUMB.bottom,
  lines: CHAT_LOG.lines,
  dragStep: Math.trunc((SCROLL_TRACK[3] - SCROLL_TRACK[1]) / 5),
};

/** Past this many lines the thumb shows and the arrows and the track answer (both scenes). */
const SCROLL_FROM = 8;

/**
 * A chat log's scroll bar (object 0x471888; the room's 0x427810, the lobby's 0x42d350). The thumb
 * rests at the top, the middle or the bottom: the arrows move it one stop and the track sends it
 * to an end. At the top the log shows from line 0, at the bottom its last lines, in the middle
 * from count / 2 - 8 (or the last lines when that is negative). Dragging moves it within 16 px.
 */
export class ChatScroll {
  thumb: number;
  dragging = false;
  private readonly g: ScrollGeometry;
  private top = 0;
  private seen: number;
  private middle = false;
  private dragIndex = 0;

  constructor(geometry: ScrollGeometry = ROOM_SCROLL) {
    this.g = geometry;
    this.thumb = geometry.bottom;
    this.seen = geometry.lines;
  }

  /** The first line shown, recomputed each frame like 0x427810; `count` is the log's length. */
  first(count: number): number {
    if (count <= this.g.lines) {
      this.seen = this.g.lines;
      this.thumb = this.g.bottom;
      this.top = 0;
      return 0;
    }
    if (count > this.seen && !this.dragging) {
      this.seen = count;
      this.top = count - this.g.lines;
      this.thumb = this.g.bottom;
    } else if (this.dragging && this.thumb !== this.g.bottom) {
      this.top = this.dragIndex;
    }
    if (this.middle) {
      this.top = Math.trunc(count / 2) - 8;
      if (this.top < 0) this.top = count - this.g.lines;
      this.middle = false;
    }
    if (this.thumb === this.g.bottom) this.top = count - this.g.lines;
    return this.thumb === this.g.top ? 0 : this.top;
  }

  /** The thumb as drawn: shown past 8 lines, clamped to its stops. */
  drawnThumb(count: number): number | null {
    if (count <= SCROLL_FROM) return null;
    this.thumb = Math.min(this.g.bottom, Math.max(this.g.top, this.thumb));
    return this.thumb;
  }

  /** ▲ on release (0x4567f0). */
  up(count: number): void {
    if (count <= SCROLL_FROM) return;
    if (this.thumb >= this.g.top && this.thumb <= this.g.middle) this.thumb = this.g.top;
    else if (this.thumb > this.g.middle && this.thumb <= this.g.bottom) {
      this.thumb = this.g.middle;
      this.middle = true;
    }
  }

  /** ▼ on release (0x456840). */
  down(count: number): void {
    if (count <= SCROLL_FROM) return;
    if (this.thumb >= this.g.middle && this.thumb <= this.g.bottom) this.thumb = this.g.bottom;
    else if (this.thumb >= this.g.top && this.thumb < this.g.middle) {
      this.thumb = this.g.middle;
      this.middle = true;
    }
  }

  /** A release on the track (0x428079): above the thumb to the top, else to the bottom. */
  trackClick(count: number, y: number): void {
    if (count <= SCROLL_FROM) return;
    this.thumb = y < this.thumb ? this.g.top : this.g.bottom;
  }

  /**
   * Each frame the button is held over the track (0x427e90): the first frame only starts the
   * drag; then the thumb follows the mouse while it stays within 16 px of it (0x456770). The line
   * index counts back from the bottom, one per 17 px of the thumb's previous place.
   */
  hold(count: number, y: number): void {
    if (this.dragging && y >= this.thumb - 16 && y <= this.thumb + 16 && y !== this.thumb) {
      let at = this.g.bottom;
      for (let n = count - 10; n > 0; n--, at -= this.g.dragStep) {
        if (at < this.thumb) {
          this.dragIndex = n;
          break;
        }
      }
      this.thumb = y;
    }
    this.dragging = true;
  }

  /** Any release ends the drag (0x459055). */
  release(): void {
    this.dragging = false;
  }
}

// Help balloons (0x426570 → 0x44d5d0), shown while the 풍선 도움말 option (F1) is on

export const HELP_BOX = { fill: "#6b71d6", height: 16, font: 12 };

export interface HelpContext {
  isHost: boolean;
  /** Per slot: the player there, whether it is the host's, or null for an empty slot. */
  slots: readonly ({ host: boolean } | null)[];
  closed: readonly boolean[];
}

/** The balloon under the mouse: its text and the point it hangs from, or null. */
export function helpAt(x: number, y: number, context: HelpContext): { text: string; x: number; y: number } | null {
  const fixed: { rect: Rect; text: string; x?: (x: number) => number }[] = [
    { rect: [212, 25, 280, 48], text: "방번호 표시" },
    { rect: [282, 25, 590, 48], text: "방제목 표시" },
    { rect: [624, 185, 741, 275], text: "맵 미리 보기", x: (mx) => Math.min(mx, 711) },
    { rect: [617, 281, 752, 296], text: "버튼을 누르면 맵선택", x: () => 627 },
    { rect: [617, 324, 752, 339], text: "버튼을 누르면 배경음악 선택", x: () => 598 },
    { rect: [617, 367, 752, 382], text: "버튼을 누르면 게임방식 결정", x: () => 595 },
    { rect: START.hit, text: "게임시작 버튼", x: (mx) => Math.min(mx, 705) },
    { rect: SHOP.hit, text: "현재 지원안함" },
    { rect: EXIT.hit, text: "대기실로 이동" },
    { rect: ROOM_ITEM_ICONS.whisper.hit, text: "채팅창에서 /w 아이디" },
    { rect: ROOM_ITEM_ICONS.mask.hit, text: "마스크 설정 및 해지(현재지원안함)" },
  ];
  for (const entry of fixed) {
    if (inside(entry.rect, x, y)) return { text: entry.text, x: entry.x ? entry.x(x) : x, y };
  }
  for (let slot = 0; slot < SLOT_ORIGINS.length; slot++) {
    const { x: left, y: top } = SLOT_ORIGINS[slot];
    const player = context.slots[slot];
    if (!player) {
      if (context.isHost && inside(slotRect(slot), x, y)) {
        return { text: context.closed[slot] ? "클릭하면 Open됩니다." : "클릭하면 Close됩니다.", x, y };
      }
      continue;
    }
    if (player.host && inside([left + 8, top + 6, left + 79, top + 76], x, y)) return { text: "방장 빨간바탕표시", x, y };
    // The kick icon's place, lit or not, the own slot too: for the host alone.
    if (context.isHost && inside([left + 91, top + 41, left + 119, top + 70], x, y)) return { text: "강제 퇴장 아이콘", x, y };
    if (inside([left + 178, top + 43, left + 215, top + 70], x, y)) return { text: "게임에 걸려있는 셀포인트", x, y };
  }
  return null;
}

/** The balloon box: (x+3, y-20), 16 rows, 6 px per byte + 2. */
export function helpBox(text: string, x: number, y: number): { rect: Rect; dark: Point; light: Point } {
  const width = 6 * cp949Bytes(text) + 2;
  return { rect: [x + 3, y - 20, x + 3 + width, y - 4], dark: { x: x + 4, y: y - 18 }, light: { x: x + 5, y: y - 17 } };
}

/**
 * Whether a room update ends the host's busy cursor. Of the news the room gets, only a slot opened or
 * closed (S->C 0x45, 0x4452fd) and a team change (0x2e, 0x44511e) end it, whoever caused them;
 * ready, map, music, mode, host, join and leave news do not.
 */
export function endsBusy(before: RoomInfo, after: RoomInfo): boolean {
  if (before.closed.some((closed, slot) => closed !== after.closed[slot])) return true;
  return after.players.some((p) => {
    const was = before.players.find((q) => q.id === p.id);
    return was !== undefined && was.team !== p.team;
  });
}
