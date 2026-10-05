// Read-only world model for the remake AI. Public geometry and ordinary rules, never future loot/RNG.
import { updateBombs } from "./bomb.ts";
import { HIT_BOTTOM, HIT_LEFT, HIT_RIGHT, HIT_TOP, nowMs } from "./constants.ts";
import { cellAtPixel, cellIndex, cellTopLeft, DIRS, holdsCell, playerCell, STEP_X, STEP_Y } from "./grid.ts";
import { updateObjects } from "./mapObjects.ts";
import { CURSE_MS } from "./status.ts";
import { FACING_PAD, PAD_BITS, tileB, WARP_BITS } from "./tiles.ts";
import type { InputFrame, MatchState, PlayerState } from "./types.ts";
import { Anim, CellKind, Dir } from "./types.ts";
import { applySuddenDeath, updateBricks, updateSuddenDeath } from "./world.ts";

export const LOOKAHEAD = 180;
const FIRE = 1, WALL = 2, BOMB = 4;
export interface Forecast {
  tick: number;
  frames: Uint8Array[];
  blasts: Map<number, { at: number; until: number; cells: number[] }>;
}
export interface Route { cell: number; at: number; first: number | null; depart: number }

export function enemies(state: MatchState, player: PlayerState): PlayerState[] {
  return state.players.filter((p) => p.id !== player.id && p.alive && !p.gone && p.status.invisible === null);
}

export function predictionState(state: MatchState, viewerId?: number): MatchState {
  const future = structuredClone(state);
  future.hidden.fill(null);
  for (const brick of future.breaking) brick.item = null;
  // Hypothetical generators and drops must not reveal the live game's upcoming random draws.
  future.rng = 1;
  future.clockMs = 0;
  for (const player of future.players) if (player.id !== viewerId && player.status.invisible !== null) player.gone = true;
  return future;
}

/** Actual fire, chain reactions, rolling bombs, objects and sudden-death timings. */
export function forecast(state: MatchState, viewerId?: number): Forecast {
  const future = predictionState(state, viewerId);
  const special = Uint8Array.from(future.grid, (_, cell) => Number((tileB(future, cell) & (WARP_BITS | PAD_BITS | FACING_PAD)) !== 0));
  const frames: Uint8Array[] = [];
  const blasts: Forecast["blasts"] = new Map();
  for (let t = 0; t <= LOOKAHEAD; t++) {
    if (t > 0) {
      future.tick++;
      future.events = [];
      future.hiddenOwners = [];
      const now = nowMs(future.tick);
      if (now - future.timerMs >= 1000) { future.timerMs = now; future.timerSeconds--; }
      updateObjects(future, 0);
      if (!future.rules.practice) { updateSuddenDeath(future); applySuddenDeath(future); }
      updateBricks(future);
      updateObjects(future, 1);
      updateBombs(future);
      updateObjects(future, 2);
    }
    const frame = Uint8Array.from(future.grid, (kind, cell) => (future.flame[cell] > 0 ? FIRE : 0) |
      (kind !== CellKind.Empty || special[cell] ? WALL : 0));
    for (const bomb of future.bombs) {
      if (holdsCell(bomb) && bomb.cell >= 0 && bomb.cell < frame.length) frame[bomb.cell] |= BOMB;
      if (bomb.exploded) {
        const blast = blasts.get(bomb.id);
        if (blast) blast.until = t;
        else blasts.set(bomb.id, { at: Math.max(0, bomb.explodedTick - state.tick), until: t, cells: [...bomb.fireCells] });
      }
    }
    frames.push(frame);
  }
  return { tick: state.tick, frames, blasts };
}

export function safe(prediction: Forecast, cell: number, from: number, until: number, walk = false): boolean {
  if (cell < 0 || cell >= prediction.frames[0].length || until >= prediction.frames.length) return false;
  const mask = FIRE | WALL | (walk ? BOMB : 0);
  for (let t = Math.max(0, from); t <= until; t++) if (prediction.frames[t][cell] & mask) return false;
  return true;
}

export function centre(state: MatchState, cell: number): { x: number; y: number } {
  const at = cellTopLeft(state, cell);
  // Leading probes must remain strictly before the next tile. Aim halfway between
  // the legal integer positions (15..24 vertically), so speed 10 can reach that band
  // from either pixel parity instead of bouncing across an unreachable integer centre.
  return {
    x: at.x + (state.layout.cellW + HIT_LEFT - HIT_RIGHT - 1) / 2,
    y: at.y + (state.layout.cellH + HIT_TOP - HIT_BOTTOM - 1) / 2,
  };
}

export function centred(state: MatchState, player: PlayerState, cell: number): boolean {
  const at = centre(state, cell);
  const yTolerance = Math.min(player.speed, (state.layout.cellH - HIT_TOP - HIT_BOTTOM) / 2);
  return Math.abs(player.x - at.x) <= player.speed / 2 && Math.abs(player.y - at.y) <= yTolerance;
}

export function steer(state: MatchState, player: PlayerState, cell: number): Dir | null {
  const at = centre(state, cell);
  const dx = at.x - player.x, dy = at.y - player.y;
  const tolerance = player.speed / 2;
  const yTolerance = Math.min(player.speed, (state.layout.cellH - HIT_TOP - HIT_BOTTOM) / 2);
  if (Math.abs(dy) > yTolerance && Math.abs(dx) < state.layout.cellW / 2) return dy > 0 ? Dir.Down : Dir.Up;
  if (Math.abs(dx) > tolerance) return dx > 0 ? Dir.Right : Dir.Left;
  if (Math.abs(dy) > yTolerance) return dy > 0 ? Dir.Down : Dir.Up;
  return null;
}

export function adjacent(state: MatchState, cell: number, dir: Dir): number | null {
  return cellIndex(state, cell % state.layout.width + STEP_X[dir], Math.floor(cell / state.layout.width) + STEP_Y[dir]);
}

/** Earliest safe arrivals; a short wait can let existing fire finish before entering it. */
export function routes(state: MatchState, player: PlayerState, prediction: Forecast, delay = 0): Route[] {
  const start = playerCell(state, player);
  if (start === null) return [];
  const offset = state.tick - prediction.tick + delay;
  const pending: Route[] = [{ cell: start, at: offset, first: null, depart: offset }];
  const arrivals = new Int16Array(state.grid.length).fill(32767);
  arrivals[start] = offset;
  const found: Route[] = [];
  while (pending.length) {
    pending.sort((a, b) => b.at - a.at);
    const route = pending.pop()!;
    if (arrivals[route.cell] !== route.at) continue;
    found.push(route);
    for (const dir of DIRS) {
      const cell = adjacent(state, route.cell, dir);
      if (cell === null) continue;
      if ((prediction.frames[Math.max(0, offset)][cell] & WALL) && (prediction.frames[LOOKAHEAD][cell] & WALL)) continue;
      const distance = STEP_X[dir] ? state.layout.cellW : state.layout.cellH;
      const duration = Math.ceil(distance / Math.max(1, player.speed)) + 2;
      for (let wait = 0; wait <= 24; wait += 3) {
        const depart = route.at + wait, at = depart + duration;
        if (at >= arrivals[cell] || at + 2 >= prediction.frames.length) break;
        if (!safe(prediction, route.cell, route.at + 1, depart + Math.ceil(duration / 2))) break;
        if (!safe(prediction, cell, depart + 1, at + 2, true)) continue;
        arrivals[cell] = at;
        pending.push({ cell, at, first: route.first ?? cell, depart: route.first === null ? depart : route.depart });
        break;
      }
    }
  }
  return found;
}

export function distance(state: MatchState, a: number, b: number): number {
  return Math.abs(a % state.layout.width - b % state.layout.width) + Math.abs(Math.floor(a / state.layout.width) - Math.floor(b / state.layout.width));
}

/** Public walking topology extends beyond the short hazard forecast's travel range. */
export function walkingDistances(state: MatchState, prediction: Forecast, start: number): Int16Array {
  const distances = new Int16Array(state.grid.length).fill(-1);
  const pending = [start];
  distances[start] = 0;
  for (let index = 0; index < pending.length; index++) {
    const cell = pending[index];
    for (const dir of DIRS) {
      const next = adjacent(state, cell, dir);
      if (next === null || distances[next] >= 0 || prediction.frames[LOOKAHEAD][next] & WALL) continue;
      distances[next] = distances[cell] + 1;
      pending.push(next);
    }
  }
  return distances;
}

/** Extrapolate only a visible walk, stopping at public obstacles; never read the opponent's keys. */
export function anticipate(state: MatchState, player: PlayerState, ticks: number): number {
  let x = player.x, y = player.y;
  const current = playerCell(state, player) ?? 0;
  if (player.anim >= Anim.Walk + 4 || player.stopRequested || player.status.frozen !== null) return current;
  for (let t = 0; t < Math.min(30, ticks); t++) {
    const nx = x + STEP_X[player.dir] * player.speed, ny = y + STEP_Y[player.dir] * player.speed;
    const cell = cellAtPixel(state, nx, ny);
    if (cell === null || state.grid[cell] !== CellKind.Empty || (tileB(state, cell) & (WARP_BITS | PAD_BITS | FACING_PAD)) ||
        state.bombs.some((b) => b.cell === cell && holdsCell(b) && cell !== current)) break;
    x = nx; y = ny;
  }
  return cellAtPixel(state, x, y) ?? current;
}

export function exits(state: MatchState, prediction: Forecast, cell: number, at: number): number {
  return DIRS.filter((dir) => {
    const next = adjacent(state, cell, dir);
    return next !== null && safe(prediction, next, at, Math.min(at + 12, LOOKAHEAD), true);
  }).length;
}

/** Prefer an escape that retains several exits over a pocket an opponent can seal next. */
export function refuge(state: MatchState, player: PlayerState, prediction: Forecast, reachable: Route[]): Route | undefined {
  const opponents = enemies(state, player);
  let best: Route | undefined, value = -Infinity;
  for (const route of reachable) {
    if (!safe(prediction, route.cell, route.at + 1, LOOKAHEAD)) continue;
    const mobility = exits(state, prediction, route.cell, Math.min(route.at, LOOKAHEAD - 12));
    const separation = Math.min(5, ...opponents.map((p) => distance(state, route.cell, anticipate(state, p, route.at))));
    const score = mobility * 3 + separation - (route.at - (state.tick - prediction.tick)) / 5;
    if (score > value) { best = route; value = score; }
  }
  return best;
}

export function keyboardInput(player: PlayerState, input: InputFrame): InputFrame {
  return input.dir == null || player.status.reverse === null ? input : { ...input, dir: ((input.dir + 2) % 4) as Dir };
}

export function shieldedThrough(state: MatchState, player: PlayerState, ticks: number): boolean {
  return player.status.shield !== null && nowMs(state.tick + ticks) - player.status.shield <= CURSE_MS;
}
