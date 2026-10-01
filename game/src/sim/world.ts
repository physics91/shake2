import {
  animDue,
  LONG_AGO_MS,
  nowMs,
  START_BOMBS,
  START_FIRE,
  START_SPEED,
  SUDDEN_DEATH_INTERVAL_MS,
  SUDDEN_DEATH_SECONDS,
} from "./constants.ts";
import { addItem, cellIndex, hasItem, isFree, playerCell, takeItem } from "./grid.ts";
import { itemKindOf, itemSubOf, practiceBrickItem, rollBrickItem } from "./items.ts";
import { isFirepowerMode } from "./modes.ts";
import { applyPickup } from "./pickup.ts";
import { msvcRand } from "./rng.ts";
import { reviveTeammate } from "./summon.ts";
import type { ItemWord, MatchState, PlayerState } from "./types.ts";
import { CellKind, ItemKind } from "./types.ts";

/**
 * Roll the item hidden in every brick, in cell order (every map lists its bricks in cell
 * order), like the host does at each round's start (0x44d740 → 0x44e2ed); the one-time items
 * are fresh every round. The 화력 modes have their own bands; practice rolls its own table (0x454d7a).
 */
export function rollHiddenItems(state: MatchState): void {
  const once = { switch: true, shake: true, candy: true };
  const rand = () => msvcRand(state);
  const firepower = isFirepowerMode(state.rules.mode);
  const roll = () => (state.rules.practice ? practiceBrickItem(rand) : rollBrickItem(rand, once, firepower));
  state.hidden = state.grid.map((kind) => (kind === CellKind.Brick ? roll() : null));
}

/** practice.MAP's display items (0x455000): cell and item word, in the order they are placed. */
const PRACTICE_ITEMS: readonly [cell: number, word: ItemWord][] = [
  [195, 2],
  [197, 0],
  [210, 1],
  [212, 7],
  [216, 3],
  [217, 4],
  [218, 5],
  [219, 14],
  [222, 10],
  [223, 6],
  [224, 8],
  [225, 9],
  [206, 15],
  [117, 0x250b],
  [133, 0x260b],
  [131, 12],
  [129, 17],
  [127, 20],
  [121, 21],
  [125, 22],
  [123, 23],
  [110, 28],
  [112, 29],
  [114, 30],
];

/**
 * Practice lays its items out at load (0x455000): each on the first free neighbour of its cell
 * in the drop order (0x455500; the cell itself is never tried), a pixel higher like a drop. The
 * first one that finds no room ends the list (0x455398).
 */
export function placePracticeItems(state: MatchState): void {
  for (const [cell, word] of PRACTICE_ITEMS) {
    const target = freeNeighbour(state, cell);
    if (target === null) return;
    addItem(state, { cell: target, kind: itemKindOf(word), sub: itemSubOf(word), tick: state.tick, dropped: true });
  }
}

/** Crumbling bricks advance like the brick sheet's anim 1 and reveal their item when it wraps (0x401890). */
export function updateBricks(state: MatchState): void {
  const now = nowMs(state.tick);
  const finished: number[] = [];
  for (const brick of state.breaking) {
    if (!animDue(now, brick.lastMs, brick.fps)) continue;
    brick.lastMs = now;
    brick.frame += 1;
    if (brick.frame < brick.frames) continue;
    finished.push(brick.cell);
    if (brick.item !== null) {
      const kind = itemKindOf(brick.item);
      addItem(state, { cell: brick.cell, kind, sub: itemSubOf(brick.item), tick: state.tick, dropped: false });
    }
  }
  if (finished.length > 0) state.breaking = state.breaking.filter((b) => !finished.includes(b.cell));
}

/** The brick bit is cleared at once, so the cell is open while it crumbles from frame 1 (0x417ab9). */
export function startBreaking(state: MatchState, cell: number): void {
  state.grid[cell] = CellKind.Empty;
  const anim = state.layout.breakAnims[cell] ?? { frames: 5, fps: 5 };
  // The per-brick timer starts zeroed (0x41111e), so frame 2 follows on the next update.
  state.breaking.push({ cell, frame: 1, frames: anim.frames, fps: anim.fps, lastMs: LONG_AGO_MS, item: state.hidden[cell] });
  state.events.push({ type: "brick-broken", cell });
}

/**
 * Item pickup (0x451100) by a walking or standing player, on the cell of its tentative position.
 * Practice's dummies never pick up: the call is made for the local player only (0x4501f0).
 */
export function collectItem(state: MatchState, player: PlayerState, cell: number | null): void {
  if (player.dummy || cell === null) return;
  const item = takeItem(state, cell);
  if (!item) return;
  state.events.push({ type: "item-picked", playerId: player.id, kind: item.kind });
  // The capsule is handled apart from the pickup table (0x40b2ac).
  if (item.kind === ItemKind.Capsule) reviveTeammate(state, player, item.cell);
  else applyPickup(state, player, item.kind, item.sub ?? 0);
}

/** Neighbours tried for dropped items: left, up-left, up, up-right, right, down-right, down, down-left (0x453690). */
const DROP_OFFSETS: [number, number][] = [
  [-1, 0],
  [-1, -1],
  [0, -1],
  [1, -1],
  [1, 0],
  [1, 1],
  [0, 1],
  [-1, 1],
];

/**
 * After the death animation (0x453270): one of each raised stat, then 손, 발 and 점프 if held
 * (0x4534f4, 0x45357c, 0x453604), each to the first free neighbour (0x410920).
 */
export function scatterItems(state: MatchState, player: PlayerState): void {
  const cell = playerCell(state, player);
  if (cell === null) return;
  const kinds: ItemKind[] = [];
  if (player.bombCapacity > START_BOMBS) kinds.push(0);
  if (player.firePower > START_FIRE) kinds.push(1);
  if (player.speed > START_SPEED) kinds.push(2);
  if (player.inv.glove) kinds.push(ItemKind.Glove);
  if (player.inv.kick) kinds.push(ItemKind.Kick);
  if (player.inv.jump !== 0) kinds.push(ItemKind.Jump);
  for (const kind of kinds) {
    const target = freeNeighbour(state, cell);
    if (target === null) continue;
    addItem(state, { cell: target, kind, tick: state.tick, dropped: true });
  }
}

/** The first free neighbour of `cell` in DROP_OFFSETS order; the cell's own row and column may lie off the grid. */
function freeNeighbour(state: MatchState, cell: number): number | null {
  const col = cell % state.layout.width;
  const row = Math.floor(cell / state.layout.width);
  for (const [dx, dy] of DROP_OFFSETS) {
    const next = cellIndex(state, col + dx, row + dy);
    if (next !== null && isFree(state, next)) return next;
  }
  return null;
}

/**
 * Sudden-death cell order, decoded from the direction table at 0x401c5c (0x401b70):
 * 0-3 turn right/down/left/up, 5 keep going, 4 ends the list. It spirals inward
 * clockwise from the top-left corner and leaves the centre 5x5 open.
 */
const SUDDEN_DEATH_STEPS = [
  0, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 1, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 2, 5, 5, 5, 5, 5, 5, 5, 5, 5,
  5, 5, 5, 5, 3, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 0, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 1, 5, 5, 5, 5, 5, 5, 5, 5,
  5, 5, 5, 2, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 3, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 0, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 1, 5,
  5, 5, 5, 5, 5, 5, 5, 5, 2, 5, 5, 5, 5, 5, 5, 5, 5, 5, 3, 5, 5, 5, 5, 5, 5, 5, 5, 0, 5, 5, 5, 5, 5, 5, 5, 5, 1, 5, 5,
  5, 5, 5, 5, 5, 2, 5, 5, 5, 5, 5, 5, 5, 3, 5, 5, 5, 5, 5, 5, 0, 5, 5, 5, 5, 5, 5, 1, 5, 5, 5, 5, 5, 2, 5, 5, 5, 5, 5,
  3, 5, 5, 5, 5, 4,
];

export function suddenDeathOrder(width: number): number[] {
  const order: number[] = [];
  let pos = -1;
  let dir = 0;
  for (const code of SUDDEN_DEATH_STEPS) {
    if (code === 4) break;
    if (code < 4) dir = code;
    pos += [1, width, -1, -width][dir];
    order.push(pos);
  }
  return order;
}

const orderCache = new Map<number, number[]>();

function orderFor(width: number): number[] {
  let order = orderCache.get(width);
  if (!order) {
    order = suddenDeathOrder(width);
    orderCache.set(width, order);
  }
  return order;
}

/** 0x401810: every >200 ms, once the clock is at 60 s or less, one more cell of the spiral closes. */
export function updateSuddenDeath(state: MatchState): void {
  const sd = state.suddenDeath;
  const now = nowMs(state.tick);
  if (now - sd.lastMs <= SUDDEN_DEATH_INTERVAL_MS) return;
  sd.lastMs = now;
  if (state.timerSeconds <= SUDDEN_DEATH_SECONDS && sd.placed === 0 && !sd.active) {
    sd.active = true;
    state.events.push({ type: "sudden-death" });
  }
  if (!sd.active) return;
  sd.placed += 1;
  if (sd.placed >= orderFor(state.layout.width).length) sd.active = false;
}

/**
 * 0x4014c0, run every frame for each closed cell: original walls are left alone; any other
 * cell becomes a wall with flame kind 1 (deadly). An intact brick there is cancelled with its
 * hidden item (0x401593 tests the brick bit), but a crumbling one crumbles on over the block
 * and lets its item out (0x401890); items go every frame (0x4016c7), so that one shows for one
 * update. A map object there is taken off the map, and with it the cell's jump pad
 * (0x4015ff-0x4016bf).
 */
export function applySuddenDeath(state: MatchState): void {
  const order = orderFor(state.layout.width);
  const cells = state.layout.width * state.layout.height;
  const closed = new Set<number>();
  for (let i = 0; i < state.suddenDeath.placed; i++) {
    const cell = order[i];
    if (cell < 0 || cell >= cells || state.layout.kinds[cell] === CellKind.Fixed) continue;
    state.flame[cell] = 1;
    closed.add(cell);
    if (state.grid[cell] === CellKind.Fixed) continue;
    state.grid[cell] = CellKind.Fixed;
    state.hidden[cell] = null;
    const object = state.layout.objectAt[cell];
    if (object >= 0) state.objects[object].cell = -1;
  }
  // One listed item per cell each frame, while the cell's bit is on; the bit stays on (0x4016e4).
  for (const cell of closed) {
    if (hasItem(state, cell)) state.items.splice(state.items.findIndex((item) => item.cell === cell), 1);
  }
}
