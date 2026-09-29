import { HIT_BOTTOM, HIT_LEFT, HIT_RIGHT, HIT_TOP } from "./constants.ts";
import { blocksWalk, cellAtPixel, cellTopLeft, hasBomb, isSolid, playerCell, STEP_X, STEP_Y } from "./grid.ts";
import { kickBomb } from "./bomb.ts";
import { warp } from "./gates.ts";
import { stepOnPad } from "./pads.ts";
import { tileB, warpColour } from "./tiles.ts";
import type { MatchState, PlayerState } from "./types.ts";
import { Anim, BombKind, Dir } from "./types.ts";
import { collectItem } from "./world.ts";

type Point = [x: number, y: number];

/** Probe points on the tentative position: two leading corners and the trailing centre (0x450290). */
export function probes(dir: Dir, x: number, y: number): [Point, Point, Point] {
  switch (dir) {
    case Dir.Down:
      return [[x + HIT_RIGHT, y + HIT_BOTTOM], [x - HIT_LEFT, y + HIT_BOTTOM], [x, y - HIT_TOP]];
    case Dir.Left:
      return [[x - HIT_LEFT, y + HIT_BOTTOM], [x - HIT_LEFT, y - HIT_TOP], [x + HIT_RIGHT, y]];
    case Dir.Up:
      return [[x - HIT_LEFT, y - HIT_TOP], [x + HIT_RIGHT, y - HIT_TOP], [x, y + HIT_BOTTOM]];
    case Dir.Right:
      return [[x + HIT_RIGHT, y - HIT_TOP], [x + HIT_RIGHT, y + HIT_BOTTOM], [x - HIT_LEFT, y]];
  }
}

/**
 * Corner slide when exactly one leading probe is blocked (0x450dc0): the direction turned to
 * and the animation offset, indexed by facing and by whether p0 is the free one.
 */
const SLIDES: Record<Dir, { p0Free: [Dir, number]; p1Free: [Dir, number] }> = {
  [Dir.Down]: { p0Free: [Dir.Right, 3], p1Free: [Dir.Left, 1] },
  [Dir.Left]: { p0Free: [Dir.Down, -1], p1Free: [Dir.Up, 1] },
  [Dir.Up]: { p0Free: [Dir.Left, -1], p1Free: [Dir.Right, 1] },
  [Dir.Right]: { p0Free: [Dir.Up, -1], p1Free: [Dir.Down, -3] },
};

/**
 * One logic frame of movement in a walk, stand or jump state (0x4525c0 → 0x44ff30 → 0x450230):
 * `step` pixels in the facing direction (0 when standing, or jumping between frames). A player
 * who does not move is still checked at its own position, so it can be pushed off a corner it
 * overlaps. A jump pad under the tentative centre launches the player first; items are not
 * picked up mid-jump (0x45112c). Warp gates block like walls, and a walking player whose
 * leading edge (or, going back out, trailing edge) meets one is warped (0x4503e0, 0x450537).
 */
export function movePlayer(state: MatchState, player: PlayerState, step: number): void {
  let nx = player.x + STEP_X[(player.anim % 4) as Dir] * step;
  let ny = player.y + STEP_Y[(player.anim % 4) as Dir] * step;
  [nx, ny] = clampToArea(state, nx, ny);
  [nx, ny] = stepOnPad(state, player, nx, ny);
  if (player.anim < Anim.Jump) collectItem(state, player, cellAtPixel(state, nx, ny));

  const dir = (player.anim % 4) as Dir;
  const [c0, c1, c2] = probes(dir, nx, ny).map(([x, y]) => cellAtPixel(state, x, y));
  const p0Free = !blocksWalk(state, c0);
  const p1Free = !blocksWalk(state, c1);
  if (!p0Free && !p1Free) {
    enterGate(state, player, c1, c0);
    return;
  }
  if (p0Free !== p1Free) {
    slide(state, player, dir, p0Free);
    return;
  }
  if (blocksWalk(state, c2)) {
    enterGate(state, player, c2, c2);
    return;
  }
  if (!bombAllows(state, player, dir, nx, ny)) return;
  player.x = nx;
  player.y = ny;
}

/** A gate in `gate` warps a walking or standing player, leaving `entry` out of the destinations. */
function enterGate(state: MatchState, player: PlayerState, gate: number | null, entry: number | null): void {
  if (gate === null || entry === null || player.anim >= Anim.Jump) return;
  const colour = warpColour(tileB(state, gate));
  if (colour !== null) warp(state, player, colour, entry);
}

/** 0x44ff30: a tentative point outside the area is put back 16/20/12 px inside, one axis only. */
function clampToArea(state: MatchState, x: number, y: number): Point {
  const right = state.layout.width * state.layout.cellW;
  const bottom = state.layout.height * state.layout.cellH;
  if (x - HIT_LEFT > 0 && x + HIT_RIGHT < right && y - HIT_TOP > 0 && y + HIT_BOTTOM < bottom) return [x, y];
  if (x - HIT_LEFT <= 0) return [16, y];
  if (x + HIT_RIGHT >= right) return [right - 16, y];
  if (y - HIT_TOP <= 0) return [x, 20];
  return [x, bottom - 12];
}

/** Move the current position `speed` px sideways and turn; undone if the centre enters a solid or bomb cell. */
function slide(state: MatchState, player: PlayerState, dir: Dir, p0Free: boolean): void {
  const [side, animOffset] = p0Free ? SLIDES[dir].p0Free : SLIDES[dir].p1Free;
  const from = playerCell(state, player);
  const x = player.x + STEP_X[side] * player.speed;
  const y = player.y + STEP_Y[side] * player.speed;
  const to = cellAtPixel(state, x, y);
  if (to === from || (!isSolid(state, to) && !hasBomb(state, to))) {
    player.x = x;
    player.y = y;
  }
  player.anim += animOffset;
  player.dir = side;
}

/**
 * Bombs block by the centre cell (0x4506c9), except during jump, kick and throw animations.
 * Heading into another bomb cell sets off its mines, whoever laid them; only the client's own
 * player does this (0x4506f9-0x450759), so never a practice dummy. With the kick shoe the bomb is
 * kicked instead (0x450769). Entering another bomb cell is never allowed and clears the pass
 * flag; inside a bomb cell the pass flag allows any move, without it only moves on the side of
 * the cell centre given by the (axis-swapped) original test.
 */
function bombAllows(state: MatchState, player: PlayerState, dir: Dir, nx: number, ny: number): boolean {
  if (player.anim >= Anim.Jump) return true;
  const target = cellAtPixel(state, nx, ny);
  if (!hasBomb(state, target) || target === null) return true;
  const current = playerCell(state, player);
  if (target !== current && !player.dummy) {
    for (const bomb of state.bombs) if (bomb.cell === target && bomb.kind === BombKind.Mine) bomb.triggered = true;
  }
  if (player.inv.kick) return kickBomb(state, player, target, current);
  if (target !== current) {
    player.bombPass = false;
    return false;
  }
  if (player.bombPass) return true;
  const { x: left, y: top } = cellTopLeft(state, target);
  switch (dir) {
    case Dir.Down:
      return ny <= top + 16;
    case Dir.Up:
      return ny >= top + 16;
    case Dir.Left:
      return nx <= left + 20;
    case Dir.Right:
      return nx >= left + 20;
  }
}
