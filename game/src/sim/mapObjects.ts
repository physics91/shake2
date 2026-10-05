// Map objects (original/FIDELITY.md §10): their animation (0x411700), the blast zone
// (0x417860 → 0x417c80) and the generator's item roll (0x417f00).
import { animDue, LONG_AGO_MS, nowMs } from "./constants.ts";
import { addItem, hasItem } from "./grid.ts";
import { isFirepowerMode } from "./modes.ts";
import { msvcRand } from "./rng.ts";
import { objectAnim } from "./sheets.ts";
import { GENERATOR, objectIndex, tileA, tileB, ZONE } from "./tiles.ts";
import type { BombState, MatchState } from "./types.ts";
import { BombKind, CellKind, ItemKind } from "./types.ts";
import { startBreaking } from "./world.ts";

/** The blast zone's object: Object_A anim 14 (동시폭발효과). */
const ZONE_SHEET = 0;
const ZONE_ANIM = 14;
/** The Object_A pass animates anims 14-26 only; the others are baked into the background (0x411749). */
const SHEET_A_FIRST = 14;
const SHEET_A_LAST = 26;
/** The zone walk steps by a hard-coded map width (0x417a04-0x417a88, 0x417d73-0x417dba). */
const ZONE_STRIDE = 15;

/**
 * Records as the map load leaves them (0x411198): frame 0, the loop flag from the file, and a
 * last-advance time that is never initialised, so the first pass advances at once. A blast
 * zone therefore goes off once, harmlessly, at every round start.
 */
export function resetObjects(state: MatchState): void {
  state.objectSprites = null;
  state.objects = state.layout.objects.map((object) => ({
    cell: object.cell,
    frame: 0,
    lastMs: LONG_AGO_MS,
    active: object.loop,
    play: false,
  }));
}

/**
 * One pass of 0x411700 over one sheet, in file order: at most one frame per object when more
 * than 1000 / fps ms have passed. A looping object cycles; a still one stays on frame 0 until
 * triggered, then plays to its end once. Objects a sudden-death block took are skipped.
 */
export function updateObjects(state: MatchState, sheet: number): void {
  const now = nowMs(state.tick);
  state.layout.objects.forEach((object, i) => {
    if (object.sheet !== sheet) return;
    if (sheet === 0 && (object.anim < SHEET_A_FIRST || object.anim > SHEET_A_LAST)) return;
    const obj = state.objects[i];
    if (obj.cell < 0) return;
    const { frames, fps } = objectAnim(sheet, object.anim);
    if (!animDue(now, obj.lastMs, fps)) return;
    obj.lastMs = now;
    if (sheet === ZONE_SHEET && object.anim === ZONE_ANIM) {
      advanceBlast(state, i, frames);
      return;
    }
    obj.frame += 1;
    if (obj.frame < frames && obj.active) return;
    if (obj.play) {
      if (obj.frame >= frames) {
        obj.frame = 0;
        obj.play = false;
      }
      return;
    }
    obj.frame = 0;
  });
  // 0x411700 draws after advancing, before a later explosion or sudden-death pass changes it.
  const sprites = state.objectSprites ??= state.objects.map(({ cell, frame }) => ({ cell, frame }));
  state.layout.objects.forEach((object, i) => {
    if (object.sheet !== sheet) return;
    const { cell, frame } = state.objects[i];
    sprites[i] = { cell, frame };
  });
}

/**
 * The zone animation (0x4117ef-0x411868): idle on frame 0; set off, it plays bomb8 on reaching
 * frame 2, and at the end the cell's flame goes out.
 */
function advanceBlast(state: MatchState, index: number, frames: number): void {
  const obj = state.objects[index];
  if (!obj.active) {
    obj.frame = 0;
    return;
  }
  obj.frame += 1;
  if (obj.frame === 2) state.events.push({ type: "zone-blast" });
  if (obj.frame < frames) return;
  obj.active = false;
  obj.frame = 0;
  state.flame[obj.cell] = 0;
}

/** A jump pad's arrow plays once when the pad fires (+0x1a = 1, 0x451f04). */
export function playObject(state: MatchState, cell: number): void {
  const index = objectIndex(state, cell);
  if (index >= 0) state.objects[index].play = true;
}

export function isZone(state: MatchState, cell: number): boolean {
  return (tileA(state, cell) & ZONE) !== 0;
}

/**
 * Fire reaching a zone cell (0x417950-0x417ab0): its object starts the blast, the flame is set
 * at once, a brick there breaks and an item burns, without stopping the fire. Each zone
 * neighbour (left, up, right, down) starts a walk through the zone.
 */
export function setOffZone(state: MatchState, cell: number): void {
  blastCell(state, cell);
  for (const next of [cell - 1, cell - ZONE_STRIDE, cell + 1, cell + ZONE_STRIDE]) {
    if (inTiles(state, next) && isZone(state, next)) walkZone(state, next);
  }
}

/**
 * 0x417c80: from `cell`, while its object and flame are idle, blast it and go on to the first
 * idle zone neighbour, left, up, right, down; a dead end ends the walk. The whole walk happens
 * in the explosion's update.
 */
function walkZone(state: MatchState, start: number): void {
  let cell = start;
  for (;;) {
    const index = objectIndex(state, cell);
    if (index < 0 || state.objects[index].frame !== 0 || state.flame[cell] !== 0) return;
    blastCell(state, cell);
    const next = [cell - 1, cell - ZONE_STRIDE, cell + 1, cell + ZONE_STRIDE].find(
      (c) => inTiles(state, c) && isZone(state, c) && state.flame[c] === 0,
    );
    if (next === undefined) return;
    cell = next;
  }
}

function blastCell(state: MatchState, cell: number): void {
  const index = objectIndex(state, cell);
  if (index >= 0) {
    state.objects[index].frame = 1;
    state.objects[index].active = true;
  }
  state.flame[cell] = 1;
  if (state.grid[cell] === CellKind.Brick) startBreaking(state, cell);
  state.items = state.items.filter((item) => item.cell !== cell);
}

function inTiles(state: MatchState, cell: number): boolean {
  return cell >= 0 && cell < state.grid.length;
}

/** Second rolls of the generator (tables 0x418294, 0x4182ac); null draws nothing. */
const GEN_20: readonly (ItemKind | null)[] = [6, 8, 9, 20, null, 23];
const GEN_85: readonly ItemKind[] = [0, 1, 2, 3];

/**
 * A fire that ends on a generator (0x40728f; a TNT also before each move, 0x40e52c) rolls for an
 * item when it is not of the water family (type < 12, 0x407299), its owner is in the match and
 * the cell holds none. Only the owner's client rolls and sends the item (packet 0x6e), so one
 * roll per fire here.
 */
export function rollGenerator(state: MatchState, bomb: BombState): void {
  if ((tileB(state, bomb.cell) & GENERATOR) === 0 || bomb.kind >= BombKind.Water) return;
  if (!state.players.some((p) => p.id === bomb.owner) || hasItem(state, bomb.cell)) return;
  const kind = generatorItem(() => msvcRand(state), isFirepowerMode(state.rules.mode));
  if (kind !== null) addItem(state, { cell: bomb.cell, kind, tick: state.tick, dropped: false });
}

/** The 화력 modes' generator bands (0x417f00): r below 85 only, one rand() in all. */
const FIREPOWER_GEN: readonly [below: number, kind: ItemKind][] = [
  [20, ItemKind.Fire],
  [40, ItemKind.Bomb],
  [50, ItemKind.Speed],
  [60, ItemKind.Jump],
  [70, ItemKind.Teleport],
  [80, ItemKind.Burrow],
  [85, ItemKind.Power],
];

/**
 * 0x417f00: rand() % 200, half the time nothing. The 화력 modes (3-5, `firepower`) read a fixed
 * table; the others pick within the band by a second rand(), and their 95-99 band rolls a
 * question mark effect and then drops nothing.
 */
export function generatorItem(rand: () => number, firepower = false): ItemKind | null {
  const r = rand() % 200;
  if (r >= 100) return null;
  if (firepower) return FIREPOWER_GEN.find(([below]) => r < below)?.[1] ?? null;
  if (r < 20) return (rand() % 3) as ItemKind;
  if (r < 45) return GEN_20[rand() % 6];
  if (r < 60) return ([3, 4, 10] as const)[rand() % 3];
  if (r < 75) return ([5, 14, 17] as const)[rand() % 3];
  if (r < 85) return ([7, 15, 2] as const)[rand() % 3];
  if (r < 95) return GEN_85[rand() & 3];
  rand();
  return null;
}
