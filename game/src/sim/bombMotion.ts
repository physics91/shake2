// Moving bombs (0x40db00): rolling after a kick or as a 직격탄 (0x415820), flying after a throw (0x40ddc0).
import { BOMB_DX, BOMB_DY } from "./constants.ts";
import { cellAtPixel, cellTopLeft, isFree, playersIn, rawCellAt, STEP_X, STEP_Y } from "./grid.ts";
import type { BombState, MatchState } from "./types.ts";
import { BombKind, Dir } from "./types.ts";

/** A kicked bomb may roll this many cells (+0x40 = 5 at 0x450a52). */
export const ROLL_CELLS = 5;

export function isRolling(bomb: BombState): boolean {
  return bomb.motion >= 1 && bomb.motion <= 4;
}

export function isFlying(bomb: BombState): boolean {
  return bomb.motion >= 5;
}

export function moveBomb(state: MatchState, bomb: BombState, now: number): void {
  if (isRolling(bomb)) roll(state, bomb, now);
  else if (isFlying(bomb)) fly(state, bomb, now);
}

/** On its cell centre along one axis: (y - top) % 32 == 28 or (x - left) % 40 == 20. */
function onCentre(state: MatchState, bomb: BombState, vertical: boolean): boolean {
  return vertical ? bomb.y % state.layout.cellH === BOMB_DY : bomb.x % state.layout.cellW === BOMB_DX;
}

export function isCentred(state: MatchState, bomb: BombState): boolean {
  return onCentre(state, bomb, true) && onCentre(state, bomb, false);
}

/**
 * 0x415820, once per update. The first update switches to the rolling animation. Moving freely
 * refreshes the fuse and uses up one of the kicked bomb's cells per cell entered (not for timer
 * bombs or 직격탄), going off at the centre where they run out. Blocked, it runs on to (or back
 * to) its cell centre and brakes; braking at a centre it stops with 1 s of fuse left, or goes off
 * if it is a 직격탄 or has no cells left.
 */
function roll(state: MatchState, bomb: BombState, now: number): void {
  if (bomb.anim % 2 === 0) {
    bomb.anim = bomb.kind + 1;
    bomb.frame = 0;
  }
  const dir = (bomb.motion - 1) as Dir;
  const vertical = dir === Dir.Down || dir === Dir.Up;
  const step = (vertical ? 4 : 5) * (bomb.fast ? 2 : 1);
  const dx = STEP_X[dir] * step;
  const dy = STEP_Y[dir] * step;

  if (bomb.braking) {
    if (!onCentre(state, bomb, vertical)) shift(state, bomb, dx, dy);
    else if (bomb.fast || bomb.rollLeft === 0) bomb.triggered = true;
    else stop(bomb, now);
  } else if (canRoll(state, bomb, dir)) {
    if (shift(state, bomb, dx, dy) && bomb.kind !== BombKind.Timer && !bomb.fast) bomb.rollLeft -= 1;
    if (onCentre(state, bomb, vertical) && bomb.rollLeft === 0 && !bomb.fast) bomb.triggered = true;
    else bomb.placedMs = now;
  } else {
    if (!onCentre(state, bomb, vertical)) runToCentre(state, bomb, dir, dx, dy);
    bomb.braking = true;
  }
  bomb.cell = cellAtPixel(state, bomb.x, bomb.y) ?? bomb.cell;
}

/**
 * Move by one step; true when that changed the cell. The bomb bit moves with it (0x415a4f): the
 * cell left loses it, whatever other bomb still rests there.
 */
function shift(state: MatchState, bomb: BombState, dx: number, dy: number): boolean {
  const from = cellAtPixel(state, bomb.x, bomb.y);
  bomb.x += dx;
  bomb.y += dy;
  const moved = cellAtPixel(state, bomb.x, bomb.y) !== from;
  if (moved) {
    bomb.bitCleared = false;
    for (const other of state.bombs) if (other !== bomb && from !== null && other.cell === from) other.bitCleared = true;
  }
  return moved;
}

/** Blocked off-centre (0x415ac5-0x415c4e): past its cell's centre it snaps back to it, otherwise it steps on. */
function runToCentre(state: MatchState, bomb: BombState, dir: Dir, dx: number, dy: number): void {
  const cell = cellAtPixel(state, bomb.x, bomb.y);
  if (cell === null) return;
  const { x: left, y: top } = cellTopLeft(state, cell);
  const cx = left + BOMB_DX;
  const cy = top + BOMB_DY;
  switch (dir) {
    case Dir.Down:
      if (bomb.y > cy) bomb.y = cy;
      else shift(state, bomb, dx, dy);
      return;
    case Dir.Up:
      if (bomb.y < cy) bomb.y = cy;
      else shift(state, bomb, dx, dy);
      return;
    case Dir.Left:
      if (bomb.x < cx) bomb.x = cx;
      else shift(state, bomb, dx, dy);
      return;
    case Dir.Right:
      if (bomb.x > cx) bomb.x = cx;
      else shift(state, bomb, dx, dy);
      return;
  }
}

/** 0x416855: at rest again with its even animation and 1000 ms of fuse left. */
function stop(bomb: BombState, now: number): void {
  bomb.motion = 0;
  bomb.anim = bomb.kind;
  bomb.rollLeft = ROLL_CELLS;
  bomb.placedMs = now - 1000;
}

/**
 * The cell one cell-length ahead of the anchor must be inside the area and enterable; a 직격탄
 * also stops when anyone but exactly its thrower shares its current cell (0x4170b0).
 */
function canRoll(state: MatchState, bomb: BombState, dir: Dir): boolean {
  const { width, height, cellW, cellH } = state.layout;
  const ahead = { x: bomb.x + STEP_X[dir] * cellW, y: bomb.y + STEP_Y[dir] * cellH };
  if (ahead.x < 0 || ahead.y < 0 || ahead.x > width * cellW || ahead.y > height * cellH) return false;
  const next = rawCellAt(state, ahead.x, ahead.y);
  if (next === null || !canEnter(state, bomb, next)) return false;
  if (!bomb.fast) return true;
  const here = rawCellAt(state, bomb.x, bomb.y);
  const others = here === null ? [] : playersIn(state, here);
  return others.length === 0 || (others.length === 1 && others[0].id === bomb.kicker);
}

/** 0x40e430: free of walls, bricks, bombs and items; a rolling bomb is stopped by players unless its kicker is among them. */
function canEnter(state: MatchState, bomb: BombState, cell: number): boolean {
  if (!isFree(state, cell)) return false;
  if (!isRolling(bomb)) return true;
  const here = playersIn(state, cell);
  return here.length === 0 || here.some((p) => p.id === bomb.kicker);
}

// Throw arcs, by the distance left after the update's decrement (tables 0x40e300, 0x40e358, 0x40e3fc).
/** Up or down: pixels moved along the throw (96 → 0 by 8), and along a bounce (32 → 0). */
const THROW_STEP: Readonly<Record<number, number>> = { 88: 15, 80: 12, 72: 7, 64: 3, 56: 1, 48: 3, 40: 5, 32: 7, 24: 8, 16: 9, 8: 12, 0: 14 };
const BOUNCE_STEP: Readonly<Record<number, number>> = { 24: 3, 16: 8, 8: 15, 0: 6 };
/** Sideways: 10 px a update, rising by these (120 → 0 by 10, bounce 40 → 0). */
const THROW_RISE: Readonly<Record<number, number>> = {
  110: 33,
  100: 12,
  90: 7,
  80: 4,
  70: 3,
  60: 1,
  50: -1,
  40: -3,
  30: -4,
  20: -7,
  10: -12,
  0: -33,
};
const BOUNCE_RISE: Readonly<Record<number, number>> = { 30: 17, 20: 3, 10: -3, 0: -17 };
export const THROW_ACROSS = 120;
export const THROW_ALONG = 96;
const BOUNCE_ACROSS = 40;
const BOUNCE_ALONG = 32;

/**
 * 0x40db00 flight: three cells in the throw direction, wrapping around the area's edges. The
 * landing cell must be free (players do not count); otherwise it bounces one more cell, and
 * again, until it lands. It lands snapped to the cell centre. The fuse restarts every update.
 */
function fly(state: MatchState, bomb: BombState, now: number): void {
  const areaW = state.layout.width * state.layout.cellW;
  const areaH = state.layout.height * state.layout.cellH;
  switch ((bomb.motion - 5) as Dir) {
    case Dir.Down: {
      const dy = flyAlong(state, bomb, 1, areaH);
      bomb.y = bomb.y + dy >= areaH ? bomb.y + dy - areaH : bomb.y + dy;
      break;
    }
    case Dir.Up: {
      const dy = flyAlong(state, bomb, -1, areaH);
      bomb.y = bomb.y - dy < 0 ? bomb.y - dy + areaH : bomb.y - dy;
      break;
    }
    case Dir.Left:
      bomb.x = bomb.x - 10 < 0 ? areaW - 10 : bomb.x - 10;
      bomb.y -= flyAcross(state, bomb);
      break;
    case Dir.Right:
      bomb.x = bomb.x + 10 > areaW ? 10 : bomb.x + 10;
      bomb.y -= flyAcross(state, bomb);
      break;
  }
  bomb.cell = rawCellAt(state, bomb.x, bomb.y) ?? bomb.cell;
  if (bomb.motion === 0) {
    const { x, y } = cellTopLeft(state, bomb.cell);
    bomb.x = x + BOMB_DX;
    bomb.y = y + BOMB_DY;
  }
  bomb.placedMs = now;
}

/** 0x40ddc0 up/down: the step for this update; on the last one the landing is tested ahead of the bomb. */
function flyAlong(state: MatchState, bomb: BombState, sign: 1 | -1, areaH: number): number {
  bomb.flightLeft -= 8;
  const table = bomb.firstFlight ? THROW_STEP : BOUNCE_STEP;
  const step = table[bomb.flightLeft] ?? 0;
  if (bomb.flightLeft !== 0) return step;
  let probe = bomb.y + sign * step;
  if (sign > 0 && probe > areaH) probe = 0;
  if (sign < 0 && probe < 0) probe = areaH - 1;
  land(state, bomb, rawCellAt(state, bomb.x, probe), BOUNCE_ALONG);
  return step;
}

/** 0x40ddc0 sideways: the rise for this update; on the last one the landing cell is tested. */
function flyAcross(state: MatchState, bomb: BombState): number {
  bomb.flightLeft -= 10;
  const rise = (bomb.firstFlight ? THROW_RISE : BOUNCE_RISE)[bomb.flightLeft] ?? 0;
  if (bomb.flightLeft === 0) land(state, bomb, rawCellAt(state, bomb.x, bomb.y - rise), BOUNCE_ACROSS);
  return rise;
}

function land(state: MatchState, bomb: BombState, cell: number | null, bounce: number): void {
  if (cell !== null && isFree(state, cell)) {
    bomb.motion = 0;
    bomb.bitCleared = false;
  } else {
    bomb.flightLeft = bounce;
  }
  bomb.firstFlight = false;
}
