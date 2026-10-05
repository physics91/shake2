// Strategic destinations use only visible resources, terrain and opponents.
import { adjacent, anticipate, enemies, exits, LOOKAHEAD, routes, safe, shieldedThrough, walkingDistances } from "./aiWorld.ts";
import type { Forecast, Route } from "./aiWorld.ts";
import { FIRE_FPS, FIRE_FRAMES, FUSE_MS, MAX_BOMBS, MAX_FIRE, MAX_SPEED, nowMs, START_BOMBS, START_FIRE, START_SPEED, TICK_RATE } from "./constants.ts";
import { DIRS, hasItem, playerCell } from "./grid.ts";
import { FREEZE_MS } from "./status.ts";
import { PAD_BITS, tileB, WARP_BITS } from "./tiles.ts";
import type { MatchState, PlayerState } from "./types.ts";
import { CellKind, ItemKind } from "./types.ts";

export interface Goal { cell: number; kind: "item" | "develop" | "pressure"; until: number }
interface Choice { route: Route; goal: Goal; value: number }

function itemValue(player: PlayerState, kind: ItemKind): number {
  switch (kind) {
    case ItemKind.Speed: return player.speed < MAX_SPEED ? 18 : 0;
    case ItemKind.Bomb: return player.bombCapacity < MAX_BOMBS ? (player.bombCapacity < 3 ? 16 : 10) : 0;
    case ItemKind.Fire: return player.firePower < MAX_FIRE ? (player.firePower < 3 ? 15 : 10) : 0;
    case ItemKind.Missile: return player.inv.missile === 0 ? 18 : 0;
    case ItemKind.Jump: return player.inv.jump === 0 ? 15 : 0;
    case ItemKind.Burrow: return !player.inv.burrow ? 14 : 0;
    case ItemKind.Shake: return player.status.shield === null ? 16 : 0;
    case ItemKind.Glove: return !player.inv.glove ? 12 : 0;
    case ItemKind.Kick: return !player.inv.kick ? 10 : 0;
    case ItemKind.Line: return !player.inv.line ? 10 : 0;
    case ItemKind.Teleport: return player.inv.teleport === 0 ? 10 : 0;
    case ItemKind.Candy: return 1;
    case ItemKind.Mystery: case ItemKind.Switch: return 0;
    default: return 8;
  }
}

/** Approach estimates only; an actual button press still requires combatPlan's exact forecast. */
function rays(state: MatchState, cell: number, power: number): number[] {
  const cells = [cell];
  for (const dir of DIRS) {
    let next = cell;
    for (let reach = 0; reach < power; reach++) {
      const target = adjacent(state, next, dir);
      if (target === null || state.grid[target] === CellKind.Fixed || tileB(state, target) & (WARP_BITS | PAD_BITS)) break;
      cells.push(target);
      if (state.grid[target] === CellKind.Brick || hasItem(state, target)) break;
      next = target;
    }
  }
  return cells;
}

/** Keep a useful destination across tile crossings, but react to danger and materially better opportunities. */
export function chooseGoal(state: MatchState, player: PlayerState, prediction: Forecast, reachable: Route[],
  previous: Goal | null, refused: ReadonlyMap<number, number>): Choice | undefined {
  const start = playerCell(state, player)!;
  const offset = state.tick - prediction.tick;
  const items = new Map(state.items.filter((i) => !state.itemBitCleared.includes(i.cell)).map((i) => [i.cell, i]));
  const racing = [...items.values()].some((item) => itemValue(player, item.kind) > 1);
  const opponents = enemies(state, player).map((enemy) => {
    const current = playerCell(state, enemy)!;
    const expected = anticipate(state, enemy, 30);
    const frozenDelay = enemy.status.frozen === null ? 0 :
      Math.max(0, Math.floor((FREEZE_MS - nowMs(state.tick) + enemy.status.frozen) * TICK_RATE / 1000) + 1);
    const reachable = racing ? routes(state, enemy, prediction, frozenDelay) : [];
    return {
      player: enemy, current, expected, distances: walkingDistances(state, prediction, expected),
      arrivals: new Map(reachable.map((route) => [route.cell, route.at - offset])),
    };
  });
  const canAttack = player.status.noBomb === null || player.inv.missile > 0;
  const candidates = reachable.filter((r) => safe(prediction, r.cell, r.at + 1, LOOKAHEAD)).map((route) => {
    const item = items.get(route.cell);
    const cells = canAttack ? rays(state, route.cell, player.firePower) : [];
    const rejected = (refused.get(route.cell) ?? -1) >= state.tick;
    const bricks = rejected ? 0 : cells.filter((cell) => state.grid[cell] === CellKind.Brick).length;
    let attack = 0, progress = 0;
    if (canAttack && !rejected) for (const enemy of opponents) {
      // Approach estimate; combatPlan checks the selected bomb's actual fire lifetime.
      const fireEnd = route.at - offset + Math.ceil(FUSE_MS * TICK_RATE / 1000) +
        FIRE_FRAMES * (Math.floor(TICK_RATE / FIRE_FPS) + 1);
      const from = enemy.distances[start], to = enemy.distances[route.cell];
      if (shieldedThrough(state, enemy.player, fireEnd)) {
        if (from >= 0 && to >= 0) progress += Math.max(0, Math.min(5, to) - from) * 1.5;
        continue;
      }
      if (cells.includes(enemy.current)) attack += 8;
      if (cells.includes(enemy.expected)) attack += 12;
      // Retain progress toward an opponent beyond the forecast's walking range.
      if (from >= 0 && to >= 0) progress += Math.max(0, from - to) * 1.5;
    }
    let pickup = item ? itemValue(player, item.kind) : 0;
    const travel = route.at - offset;
    const rival = Math.min(Infinity, ...opponents.map((enemy) => enemy.arrivals.get(route.cell) ?? Infinity));
    // A clearly lost race should not pull us away from an attainable upgrade.
    if (rival + 6 < travel) pickup *= 0.2;
    return { route, pickup, bricks, attack, progress };
  });
  const growth = Math.max(0, player.speed - START_SPEED) + Math.min(2, player.bombCapacity - START_BOMBS) +
    Math.min(2, player.firePower - START_FIRE) + (player.inv.missile > 0 ? 2 : 0);
  const nearestEnemy = Math.min(Infinity, ...opponents.map((enemy) => enemy.distances[start] < 0 ? Infinity : enemy.distances[start]));
  const developing = state.tick - state.phaseTick < 20 * TICK_RATE && growth < 4 && nearestEnemy > 4 &&
    candidates.some((c) => c.pickup > 1 || c.bricks > 0);
  let best: Choice | undefined, retained: Choice | undefined;
  for (const candidate of candidates) {
    const { route, pickup, bricks, attack, progress } = candidate;
    const travel = route.at - (state.tick - prediction.tick);
    const value = (pickup * (developing ? 1.2 : 1) + bricks * (developing ? 6 : 2) +
      attack * (developing ? 0.45 : 1) + progress * (developing ? 0.4 : 1)) / (1 + travel / 18) +
      Math.min(2, exits(state, prediction, route.cell, route.at)) * 0.15;
    if (value <= 0.3) continue;
    const kind: Goal["kind"] = pickup > 0 ? "item" : bricks > 0 ? "develop" : "pressure";
    const goal: Goal = { cell: route.cell, kind, until: state.tick + (kind === "pressure" ? 90 : 300) };
    const choice = { route, goal, value };
    if (!best || value > best.value) best = choice;
    if (previous && previous.until >= state.tick && previous.cell === route.cell && previous.kind === kind) {
      retained = { ...choice, goal: previous };
    }
  }
  return retained && best && best.value < retained.value * 1.4 + 1 ? retained : best;
}
