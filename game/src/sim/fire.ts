// Explosions and fires (0x417170, 0x417860, fire branch of the bomb loop 0x406a6b-0x407a53).
import { animDue, FIRE_FPS, FIRE_FRAMES, nowMs, PUMPKIN_MS } from "./constants.ts";
import { cellIndex, STEP_X, STEP_Y } from "./grid.ts";
import { isZone, rollGenerator, setOffZone } from "./mapObjects.ts";
import { BOOST, PAD_BITS, tileB, WARP_BITS } from "./tiles.ts";
import type { BombState, MatchState } from "./types.ts";
import { BombKind, CellKind } from "./types.ts";
import { startBreaking } from "./world.ts";

type Step = [dx: number, dy: number];

/** Cross arms in the order they burn and are drawn: up, left, down, right (0x417253-0x4173a6). */
const ARMS: Step[] = [
  [0, -1],
  [-1, 0],
  [0, 1],
  [1, 0],
];
/** X bomb diagonals: up-left, down-left, down-right, up-right (0x4175d2-0x417762). */
const DIAGONALS: Step[] = [
  [-1, -1],
  [-1, 1],
  [1, 1],
  [1, -1],
];

/** Water, poop, apple and panda bombs (types 12-19). */
export function isWaterBomb(kind: BombKind): boolean {
  return kind >= BombKind.Water;
}

/** Flame kind a fire writes (0x40da60): 2-5 for water, poop, apple and panda, else 1 (deadly). */
function flameKind(bomb: BombState): number {
  return isWaterBomb(bomb.kind) ? 2 + (bomb.kind - BombKind.Water) / 2 : 1;
}

/**
 * Cell test 0x417860: a wall, a warp gate or a jump pad stops fire before it; a blast zone cell
 * goes off and lets it through, though water-family fire passes it untouched (0x417918); a brick
 * or an item is burnt, included and stops it.
 */
const Burn = { Pass: 0, Last: 1, Stop: 2 } as const;
type Burn = (typeof Burn)[keyof typeof Burn];

function burnCell(state: MatchState, bomb: BombState, cell: number): Burn {
  if (state.grid[cell] === CellKind.Fixed) return Burn.Stop;
  if (tileB(state, cell) & (WARP_BITS | PAD_BITS)) return Burn.Stop;
  if (isZone(state, cell)) {
    if (!isWaterBomb(bomb.kind)) setOffZone(state, cell);
    return Burn.Pass;
  }
  if (state.grid[cell] === CellKind.Brick) {
    startBreaking(state, cell);
    return Burn.Last;
  }
  const item = state.items.findIndex((i) => i.cell === cell);
  if (item >= 0) {
    state.items.splice(item, 1);
    return Burn.Last;
  }
  return Burn.Pass;
}

/**
 * 0x417170: works out the cells at once, burning bricks and items; flame kinds are only
 * written by the fire draw from the next update on (blast zones set theirs at once). On a
 * 폭발증폭 cell the power becomes the map width (0x41720a). The fire's frame restarts at 0 and
 * its timer is left as it was.
 */
export function explode(state: MatchState, bomb: BombState): void {
  bomb.exploded = true;
  bomb.explodedTick = state.tick;
  bomb.fireFrame = 0;
  if (tileB(state, bomb.cell) & BOOST) bomb.power = state.layout.width;
  bomb.fireCells = bomb.kind === BombKind.Nuke ? nukeCells(state, bomb) : rayCells(state, bomb);
  state.events.push({ type: "explode", cell: bomb.cell });
}

/** The centre, then each ray while the count is below the power (cross: arms, X: diagonals of 2). */
function rayCells(state: MatchState, bomb: BombState): number[] {
  const { width } = state.layout;
  const col = bomb.cell % width;
  const row = Math.floor(bomb.cell / width);
  // The centre is tested too (it matters only for map objects) and always drawn.
  burnCell(state, bomb, bomb.cell);
  const cells = [bomb.cell];
  for (const [dx, dy] of bomb.kind === BombKind.X ? DIAGONALS : ARMS) {
    for (let reach = 1; reach <= bomb.power; reach++) {
      const cell = cellIndex(state, col + dx * reach, row + dy * reach);
      if (cell === null) break;
      const burn = burnCell(state, bomb, cell);
      if (burn === Burn.Stop) break;
      cells.push(cell);
      if (burn === Burn.Last) break;
    }
  }
  return cells;
}

/** 핵폭탄 (0x4173ff): every cell of the 5x5 square is tested on its own, so walls shadow nothing. */
function nukeCells(state: MatchState, bomb: BombState): number[] {
  const centre = bomb.cell;
  const { width, height } = state.layout;
  const [c0, c1] = nukeSpan(centre % width, width);
  const [r0, r1] = nukeSpan(Math.floor(centre / width), height);
  const cells: number[] = [];
  for (let row = r0; row <= r1; row++) {
    for (let col = c0; col <= c1; col++) {
      const cell = cellIndex(state, col, row);
      if (cell !== null && burnCell(state, bomb, cell) !== Burn.Stop) cells.push(cell);
    }
  }
  return cells;
}

/** Two cells each way, fewer at an edge; the far side is only clipped when the near side is not (0x41741b-0x417486). */
function nukeSpan(pos: number, size: number): [number, number] {
  if (pos - 2 < 0) return [pos - 1 < 0 ? pos : pos - 1, pos + 2];
  return [pos - 2, pos + 2 < size ? pos + 2 : pos + 1 < size ? pos + 1 : pos];
}

/**
 * One update of an exploded bomb: the fire draw writes its flame kind on its cells (0x40da60),
 * with the special fire (fire.spr anim 1) for the water family (0x45831b), then the frame
 * advances when `now - last > 1000 / 15`. At the end a double fire replays from frame 1; a
 * pumpkin fire replays until 2.5 s have passed since the blast, then once more (0x406fe2); a TNT
 * moves on and explodes again; any other fire goes out.
 */
export function burnFire(state: MatchState, bomb: BombState, now: number): void {
  const water = isWaterBomb(bomb.kind);
  state.bombSprites.push({ type: "fire", cells: bomb.fireCells, anim: water ? 1 : 0, frame: bomb.fireFrame });
  const kind = flameKind(bomb);
  for (const cell of bomb.fireCells) state.flame[cell] = kind;
  if (!animDue(now, bomb.fireMs, FIRE_FPS)) return;
  bomb.fireMs = now;
  bomb.fireFrame += 1;
  if (bomb.fireFrame < FIRE_FRAMES) return;
  if (bomb.double) {
    bomb.double = false;
    bomb.fireFrame = 1;
    return;
  }
  if (bomb.pumpkin) {
    if (now - nowMs(bomb.explodedTick) > PUMPKIN_MS) bomb.pumpkin = false;
    bomb.fireFrame = 1;
    return;
  }
  if (bomb.tntLeft > 0 && moveTnt(state, bomb)) return;
  endFire(state, bomb);
}

/**
 * 0x40701a: one cell on in the placer's facing unless that is outside the area, a wall, a warp
 * gate or a jump pad (0x4177d0; bricks are not checked); the cell left rolls a generator
 * (0x40e510), the old fire goes out, the new one starts at frame 1.
 */
function moveTnt(state: MatchState, bomb: BombState): boolean {
  bomb.tntLeft -= 1;
  const { width, cellW, cellH } = state.layout;
  const dx = STEP_X[bomb.tntDir];
  const dy = STEP_Y[bomb.tntDir];
  const next = cellIndex(state, (bomb.cell % width) + dx, Math.floor(bomb.cell / width) + dy);
  if (next === null || state.grid[next] === CellKind.Fixed || tileB(state, next) & (WARP_BITS | PAD_BITS)) {
    bomb.tntLeft = 0;
    return false;
  }
  rollGenerator(state, bomb);
  clearFire(state, bomb);
  bomb.cell = next;
  explode(state, bomb);
  bomb.x += dx * cellW;
  bomb.y += dy * cellH;
  bomb.fireFrame = 1;
  return true;
}

/**
 * Fire end (0x407277): the flame of every covered cell but walls goes out, even where another fire
 * burns. Each arm cell (not the centre) also loses the owner's occupancy bit until the player
 * loop; a nuke's loop indexes the tiles by its counter, so it clears cells 0..k-1 instead of its
 * own (0x407604, the same in 0x40a472 and 0x40e8a0).
 */
function clearFire(state: MatchState, bomb: BombState): void {
  for (const cell of bomb.fireCells) {
    if (state.grid[cell] !== CellKind.Fixed) state.flame[cell] = 0;
  }
  const hidden = bomb.kind === BombKind.Nuke ? bomb.fireCells.map((_, i) => i) : bomb.fireCells.slice(1);
  for (const cell of hidden) state.hiddenOwners.push({ cell, playerId: bomb.owner });
}

function endFire(state: MatchState, bomb: BombState): void {
  rollGenerator(state, bomb);
  clearFire(state, bomb);
  state.bombs = state.bombs.filter((b) => b !== bomb);
}
