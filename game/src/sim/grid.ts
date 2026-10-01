import { TNT_MOVES } from "./constants.ts";
import { PAD_BITS, tileB, WARP_BITS } from "./tiles.ts";
import type { BombState, MatchState, PlayerState } from "./types.ts";
import { BombKind, CellKind, Dir } from "./types.ts";

export const STEP_X: Record<Dir, number> = { [Dir.Down]: 0, [Dir.Left]: -1, [Dir.Up]: 0, [Dir.Right]: 1 };
export const STEP_Y: Record<Dir, number> = { [Dir.Down]: 1, [Dir.Left]: 0, [Dir.Up]: -1, [Dir.Right]: 0 };
export const DIRS: Dir[] = [Dir.Down, Dir.Left, Dir.Up, Dir.Right];

export function cellIndex(state: MatchState, col: number, row: number): number | null {
  const { width, height } = state.layout;
  if (col < 0 || row < 0 || col >= width || row >= height) return null;
  return row * width + col;
}

/** Cell containing the pixel (x, y) of the play area, or null outside it (pixelToCell 0x410a90). */
export function cellAtPixel(state: MatchState, x: number, y: number): number | null {
  return cellIndex(state, Math.floor(x / state.layout.cellW), Math.floor(y / state.layout.cellH));
}

export function cellTopLeft(state: MatchState, cell: number): { x: number; y: number } {
  const { width, cellW, cellH } = state.layout;
  return { x: (cell % width) * cellW, y: Math.floor(cell / width) * cellH };
}

/** The cell under a player's centre point. */
export function playerCell(state: MatchState, player: PlayerState): number | null {
  return cellAtPixel(state, player.x, player.y);
}

export function isSolid(state: MatchState, cell: number | null): boolean {
  return cell === null || state.grid[cell] !== CellKind.Empty;
}

/**
 * pixelToCell without the column check, as the rolling and kick probes use it: a point just
 * past the right edge gives the next row's first cell. Null outside the tile array.
 */
export function rawCellAt(state: MatchState, x: number, y: number): number | null {
  const { width, height, cellW, cellH } = state.layout;
  if (x < 0 || y < 0) return null;
  const cell = Math.floor(y / cellH) * width + Math.floor(x / cellW);
  return cell < width * height ? cell : null;
}

/**
 * The cell's bomb bit (tile C & 0x100): set by placing, landing and rolling in, cleared by a
 * throw and by the fire's end on every fire cell. So flying bombs, a TNT that has moved (its new
 * cell never gets the bit, 0x40701a) and a bomb still burning where another fire went out do not
 * hold a cell.
 */
export function holdsCell(bomb: BombState): boolean {
  return bomb.motion < 5 && !bomb.bitCleared && !(bomb.exploded && bomb.kind === BombKind.Tnt && bomb.tntLeft < TNT_MOVES);
}

export function hasBomb(state: MatchState, cell: number | null): boolean {
  return cell !== null && state.bombs.some((b) => b.cell === cell && holdsCell(b));
}

/**
 * Players in a cell by the occupancy bits (tile C bits 10-18), which follow each player's cell:
 * set in the player loop, so a practice player whose death just ended still counts, and a fire's
 * end hides its owner in its arm cells until then (MatchState.lingering, hiddenOwners). The
 * practice local player's bit is elsewhere (MatchState.localMark).
 */
export function playersIn(state: MatchState, cell: number): PlayerState[] {
  return state.players.filter(
    (p) =>
      (!p.gone || state.lingering.includes(p.id)) &&
      marks(state, p, cell) &&
      !state.hiddenOwners.some((h) => h.cell === cell && h.playerId === p.id),
  );
}

function marks(state: MatchState, player: PlayerState, cell: number): boolean {
  const mark = state.localMark;
  if (mark?.playerId !== player.id) return playerCell(state, player) === cell;
  return mark.entered === cell || (mark.placed && cellAtPixel(state, mark.x, mark.y) === cell);
}

/** 0x410920: nothing solid, no warp gate or jump pad, no bomb and no item in the cell. */
export function isFree(state: MatchState, cell: number): boolean {
  return (
    state.grid[cell] === CellKind.Empty &&
    (tileB(state, cell) & (WARP_BITS | PAD_BITS)) === 0 &&
    !hasBomb(state, cell) &&
    !hasItem(state, cell)
  );
}

/** Player collision (0x45035c): walls, bricks and warp gates block; null is outside the area. */
export function blocksWalk(state: MatchState, cell: number | null): boolean {
  return isSolid(state, cell) || (tileB(state, cell as number) & WARP_BITS) !== 0;
}

/**
 * pixelToCell (0x410a90) where the original feeds it points off the grid: division truncates
 * towards zero, and a cell outside the tile array is taken as cell 0 (the original returns 0 off
 * the 800x600 screen and reads past the array otherwise).
 */
export function truncCell(state: MatchState, x: number, y: number): number {
  const { width, height, cellW, cellH } = state.layout;
  const cell = Math.trunc(y / cellH) * width + Math.trunc(x / cellW);
  return cell >= 0 && cell < width * height ? cell : 0;
}

export function hasItem(state: MatchState, cell: number | null): boolean {
  return cell !== null && state.items.some((item) => item.cell === cell);
}
