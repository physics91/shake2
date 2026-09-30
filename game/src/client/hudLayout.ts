// Screen geometry of shake.exe's in-game HUD and result screens (original/FIDELITY.md §6).
// Pure data so the coordinates can be tested without a canvas.
import type { Rect } from "../assets/types.ts";
import type { PlayerState } from "../sim/types.ts";

export const SCREEN_W = 800;
export const SCREEN_H = 600;

/** Character order of shake.exe's tables (0x469bc0): Wg_char portraits and bomb colours are indexed by it. */
export const CHARACTER_ORDER = [
  "rookie",
  "tofi",
  "imp",
  "bogle",
  "doona",
  "doon",
  "domshell",
  "bobo",
  "spider",
  "rooster",
  "slack",
  "shark",
  "red",
  "orange",
  "milky",
  "shaky",
  "doomsy",
  "doomy",
  "doonae",
  "rookiee",
] as const;

/** `w-doomy` is not in the original's table; it shares doomy's entries. */
export function characterIndex(character: string): number {
  const index = (CHARACTER_ORDER as readonly string[]).indexOf(character.replace(/^w-/, ""));
  return index < 0 ? 0 : index;
}

/** Bomb sheet per character (pointer table 0x469a8c, 0x44dec2). */
const BOMB_COLORS: Record<string, string> = {
  rookie: "beige",
  slack: "beige",
  shaky: "beige",
  rookiee: "beige",
  tofi: "blue",
  rooster: "blue",
  shark: "blue",
  doomy: "blue",
  imp: "green",
  bogle: "green",
  doon: "green",
  doona: "yellow",
  spider: "yellow",
  doonae: "yellow",
  domshell: "pink",
  bobo: "pink",
  doomsy: "pink",
  red: "red",
  orange: "red",
  milky: "red",
};

export function bombColor(character: string): string {
  return BOMB_COLORS[character.replace(/^w-/, "")] ?? "beige";
}

export interface Blit {
  src: Rect;
  x: number;
  y: number;
}

/** Timer (0x457350): minutes ones, colon, seconds tens and ones; the minutes tens digit is never drawn. */
export function timerGlyphs(seconds: number): { digit: number | null; x: number; y: number }[] {
  const minutes = Math.floor(seconds / 60) % 10;
  const rest = seconds % 60;
  return [
    { digit: minutes, x: 331, y: 14 },
    { digit: null, x: 345, y: 16 },
    { digit: Math.floor(rest / 10), x: 352, y: 14 },
    { digit: rest % 10, x: 365, y: 14 },
  ];
}

export const CLOCK_POS = { x: 297, y: 8 };

/** Right panel row of a room slot (0x40f9a0). */
export function panelTop(slot: number): number {
  return 44 + 63 * slot;
}

export const PANEL = {
  faceX: 688,
  spLabel: { src: [6, 2, 20, 10] as Rect, x: 739, dy: 4 },
  barX: [741, 747],
  barBottomDy: 34,
  medal: { src: [82, 32, 100, 59] as Rect, x: 753, step: 20, dy: 9 },
  guild: { x: 692, dy: 45 },
  rank: { x: 710, dy: 45 },
  name: { x: 727, dy: 44 },
};

/** 3x3 bar blocks in mark.shk. */
export const BAR_BLOCKS = { yellow: [8, 11, 11, 14] as Rect, green: [14, 11, 17, 14] as Rect, red: [20, 11, 23, 14] as Rect };

/** Rank badge r (1-based) in mark.shk (0x442900). */
export function rankRect(rank: number): Rect {
  return [15 * rank - 15, 19, 15 * rank, 32];
}

/** Guild mark g in guild.shk: 15x13 cells, 15 per row (0x441940). */
export function guildRect(guild: number): Rect {
  return [15 * (guild % 15), 13 * Math.floor(guild / 15), 15 * (guild % 15) + 15, 13 * Math.floor(guild / 15) + 13];
}

export interface GridCell {
  icon: number;
  count: number;
  x: number;
  y: number;
}

/**
 * Own item grid (0x40b848-0x40bbd6 → 0x4430a0): slot < 4 in the first column, 4-7 in the second,
 * 8 and up in the third, rows by slot % 4. Slot 0 bombs; 1 fire, or the power bomb; 2 the Z
 * ability (jump, teleport, burrow); 3 glove or line bomb; 4 speed - 4; 5 the special bomb (the
 * nuke and TNT always show 1); 6 double; 8 the kick shoe. Practice's copy (0x40842c-0x408808)
 * adds the mine to slot 5, the pumpkin (always 1) to slot 6 and the water family to slot 7.
 */
export function itemGrid(player: Pick<PlayerState, "bombCapacity" | "firePower" | "speed" | "inv">, practice = false): GridCell[] {
  const cells: GridCell[] = [];
  const at = (slot: number, icon: number, count: number): void => {
    cells.push({ icon, count, x: [690, 726, 762][Math.min(2, Math.floor(slot / 4))], y: 432 + 30 * (slot % 4) });
  };
  const inv = player.inv;
  at(0, 0, player.bombCapacity);
  if (inv.power > 0) at(1, POWER_ICON, inv.power);
  else at(1, 3, player.firePower);
  if (inv.jump > 0) at(2, 7, 1);
  else if (inv.teleport > 0) at(2, 8, 1);
  else if (inv.burrow) at(2, 9, 1);
  if (inv.glove) at(3, 2, 1);
  else if (inv.line) at(3, 4, 1);
  at(4, 1, player.speed - 4);
  if (inv.nuke > 0) at(5, 0xc, 1);
  else if (inv.timer > 0) at(5, 0xf, inv.timer);
  else if (inv.missile > 0) at(5, 0xe, 1);
  else if (inv.xbomb > 0) at(5, 0xd, inv.xbomb);
  else if (inv.tnt > 0) at(5, 0x13, 1);
  else if (practice && inv.mine > 0) at(5, 0x10, inv.mine);
  if (inv.double > 0) at(6, 0x12, 1);
  else if (practice && inv.pumpkin > 0) at(6, 0x11, 1);
  if (practice) {
    if (inv.water > 0) at(7, 0x18, inv.water);
    else if (inv.poop > 0) at(7, 0x1a, inv.poop);
    else if (inv.apple > 0) at(7, 0x1b, inv.apple);
    else if (inv.panda > 0) at(7, 0x1c, inv.panda);
  }
  if (inv.kick) at(8, 6, 1);
  return cells;
}

/** The power bomb's icon shows ∞ in place of a count. */
const POWER_ICON = 5;

/**
 * The count beside an icon (0x443168): none at 0 or below; 1-9 one small digit at (x + 24, y + 11),
 * or ∞ for the power bomb; 10 and up a tens glyph from a blank part of mark.shk, then the units.
 */
export function countBlits(cell: GridCell): Blit[] {
  if (cell.count <= 0) return [];
  if (cell.count < 10) {
    if (cell.icon === POWER_ICON) return [{ src: [35, 13, 45, 17], x: cell.x + 19, y: cell.y + 17 }];
    return [{ src: smallDigitRect(cell.count), x: cell.x + 24, y: cell.y + 11 }];
  }
  const tens = Math.floor(cell.count / 10);
  return [
    { src: [13 * tens + 115, 0, 13 * tens + 128, 15], x: cell.x + 18, y: cell.y + 11 },
    { src: smallDigitRect(cell.count % 10), x: cell.x + 24, y: cell.y + 11 },
  ];
}

/** 22x22 icon i of item.shk. */
export function itemIconRect(icon: number): Rect {
  const x = 22 * (icon % 7);
  const y = 22 * Math.floor(icon / 7);
  return [x, y, x + 22, y + 22];
}

/** Small count digit n in mark.shk, drawn at (cell x + 24, cell y + 11). The tens digit's glyphs are blank. */
export function smallDigitRect(n: number): Rect {
  return [35 + 5 * n, 2, 40 + 5 * n, 12];
}

export const CANDY_POS = { x: 685, y: 557 };
/** One-digit count position; 2, 3 and 4 digits start at x 745, 737 and 729. */
export const CANDY_COUNT = { x: 753, y: 565 };

export function candyCountX(digits: number): number {
  return CANDY_COUNT.x - 8 * (Math.min(4, Math.max(1, digits)) - 1);
}
export const TEXTBOX_POS = { x: 43, y: 557 };
/** Practice's help text (0x4557f0): title at (49,560), description lines at x 140 from y 560, 15 apart. */
export const HELP_TEXT = { titleX: 49, lineX: 140, y: 560, lineStep: 15 };
/** COLORREF 0x9bffff ([0x469bb8]). */
export const HELP_COLOR = "#ffff9b";
/** F1 help's version line (0x440490). */
export const VERSION_TEXT = { x: 720, y: 580 };
/** Registry Shake2\version as the 0311 installer sets it; the game reads it at 0x45f48a. */
export const INSTALLED_VERSION = 23;
/** The match's bottom line (0x40c1d2): the notice line at (133,567) while its buffer holds a text, else this at (153,567). */
export const BOTTOM_MESSAGE = { x: 153, y: 567, text: "*** 바른말 고운말을 사용하고 매너를 지키는 쉐이커가 됩시다. ***", notice: { x: 133, y: 567 } };
export const HURRY_POS = { x: 200, y: 200 };
export const HURRY_MS = 3000;

/** Countdown (0x40c85b): 3, 2, 1 from sd.shk at (320, 254), then START at (234, 254). */
export function countdownBlit(value: number): Blit {
  if (value <= 0) return { src: [2, 69, 242, 139], x: 234, y: 254 };
  return { src: [56 * value - 56, 1, 56 * value, 68], x: 320, y: 254 };
}

export const DRAW_BLIT: Blit = { src: [2, 140, 253, 207], x: 272, y: 254 };

/** Wg_char portrait (0x442f50): 20 characters, 15 in the first row. */
export function portraitRect(character: string): Rect {
  const c = characterIndex(character);
  return c < 15 ? [46 * c, 279, 46 * c + 46, 319] : [46 * (c - 15), 320, 46 * (c - 15) + 46, 360];
}

/** Big round-number digits d in mark.shk (0x442cf0); the "9" glyph is blank in the original. */
export function roundDigitBlits(round: number): Blit[] {
  const digits = String(round);
  const start = digits.length > 1 ? 157 : 167;
  return [...digits].map((d, i) => ({ src: [26 * Number(d), 91, 26 * Number(d) + 26, 126] as Rect, x: start + 26 * i, y: 23 }));
}

/** Round result and wait screen rows (0x40fd50, 0x4100e0), by room slot. */
export function resultRowBase(slot: number): number {
  return 157 + 67 * slot;
}

export const RESULT_ROW = {
  portrait: { x: 221, dy: -11 },
  /** Team modes: the team's bar after the portrait, under the badges (0x40ff54, 0x4101f7). */
  teambar: { x: 314, dy: -4 },
  guild: { x: 337, dy: 0 },
  rank: { x: 353, dy: 0 },
  name: { x: 376, dy: 0 },
  status: { x: 339, dy: 21 },
  /** Round 1 wait screen: the STATE column of new_load. */
  loadStatus: { x: 488, dy: 5 },
  medal: { x: 487, step: 27, dy: -3 },
};

/** Final result rows (0x410560). */
export function finalRowTop(slot: number): number {
  return 147 + 67 * slot;
}

export const FINAL_ROW = {
  portrait: { x: 207, dy: 0 },
  teambar: { x: 278, dy: -1 },
  guild: { x: 301, dy: 3 },
  rank: { x: 317, dy: 3 },
  name: { x: 339, dy: 2 },
  medal: { x: 435, step: 27, dy: 7 },
  win: { src: [139, 0, 211, 24] as Rect, x: 303, dy: 23 },
};

/**
 * Team colours, COLORREF 0x00BBGGRR set at 0x404206-0x40423c for teams 1..6 (purple, blue,
 * green, pink, red, yellow); team 0 reads the black entry before them (0x48be3c).
 */
const TEAM_COLORS = ["#000000", "#bf85ff", "#9cc3fd", "#62ef7f", "#ff91cf", "#ff003c", "#fee220"];

export function teamColor(team: number): string {
  return TEAM_COLORS[team] ?? TEAM_COLORS[0];
}

/** new_teambar's row for a team (0x442580): 137x21 at pitch 22. */
export function teambarRect(team: number): Rect {
  const top = 22 * (team - 1) + 1;
  return [1, top, 138, top + 21];
}

/**
 * Status strings of the result rows (spacing as in shake.exe). The wait screen's ready string
 * (0x46af54) carries three trailing spaces that draw nothing; the round result's (0x46af30) has
 * none, but no guest is ready there: the round's end clears every +0x80 (0x44ea40, 0x44f110).
 */
export const STATUS_TEXT = { host: "방       장", waiting: "준 비 중 ..", ready: "준 비 완 료   " };
