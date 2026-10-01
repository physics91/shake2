// Bombs: creation (0x457ed0), the Space and Left Ctrl actions (0x45b5e6, 0x45c264), kicks
// (0x450769) and the per-update bomb loop (0x406508).
import { animDue, BOMB_DX, BOMB_DY, FUSE_MS, LONG_AGO_MS, nowMs, TIMER_FUSE_MS, TNT_MOVES } from "./constants.ts";
import { burnFire, explode, isWaterBomb } from "./fire.ts";
import { cellIndex, cellTopLeft, hasBomb, isFree, playerCell, playersIn, STEP_X, STEP_Y } from "./grid.ts";
import { isCentred, isFlying, moveBomb, ROLL_CELLS, THROW_ACROSS, THROW_ALONG } from "./bombMotion.ts";
import { WATER_BOMBS } from "./pickup.ts";
import { BOMB_FRAMES, bombFps } from "./sheets.ts";
import { BOOST, PAD_BITS, tileB } from "./tiles.ts";
import type { BombState, Inventory, MatchState, PlayerState } from "./types.ts";
import { Anim, BombKind, Dir } from "./types.ts";

/** A player's facing is the direction part of its animation (state & 3). */
export function facing(player: PlayerState): Dir {
  return (player.anim % 4) as Dir;
}

/** Bombs of a player still on the list, exploded or not, count against the capacity (0x45b886). */
function ownBombs(state: MatchState, player: PlayerState): number {
  return state.bombs.filter((b) => b.owner === player.id).length;
}

/** setState + frame 0 for the kick and throw animations. */
function startAction(player: PlayerState, anim: number): void {
  player.anim = anim;
  player.frame = 0;
}

/** The water family's bomb kinds, in WATER_BOMBS order. */
const WATER_KINDS: readonly BombKind[] = [BombKind.Water, BombKind.Poop, BombKind.Apple, BombKind.Panda];

function holdsWaterBomb(inv: Inventory): boolean {
  return WATER_BOMBS.some((kind) => inv[kind] > 0);
}

/**
 * 0x457ed0: a bomb at the cell's anchor with a 2000 ms fuse. The power item or a 폭발증폭 cell
 * (0x457bdc) gives it the map width; the double item doubles its fire, or else a pumpkin makes
 * it last. The water family comes first and uses one charge (0x458100). Otherwise a 직격탄 rolls
 * off at once and takes no special kind, and the first special stock held decides the kind: nuke
 * and TNT use up their whole stock, timer, X and mine one each. A mine in a line of bombs starts
 * on the rolling mine's animation (0x457943).
 */
export function createBomb(state: MatchState, player: PlayerState, cell: number, dir: Dir, fired: boolean, line = false): BombState {
  const at = cellTopLeft(state, cell);
  const bomb: BombState = {
    id: state.nextBombId++,
    owner: player.id,
    cell,
    x: at.x + BOMB_DX,
    y: at.y + BOMB_DY,
    kind: BombKind.Normal,
    anim: BombKind.Normal,
    frame: 0,
    frameMs: LONG_AGO_MS,
    power: player.firePower,
    placedMs: nowMs(state.tick),
    fuseMs: FUSE_MS,
    motion: fired ? dir + 1 : 0,
    fast: fired,
    kicker: null,
    rollLeft: 0,
    braking: false,
    flightLeft: THROW_ALONG,
    firstFlight: true,
    double: false,
    pumpkin: false,
    tntLeft: 0,
    tntDir: dir,
    triggered: false,
    exploded: false,
    explodedTick: 0,
    fireCells: [],
    fireFrame: 0,
    fireMs: LONG_AGO_MS,
  };
  const inv = player.inv;
  if (inv.power > 0 || tileB(state, cell) & BOOST) bomb.power = state.layout.width;
  if (inv.double > 0) {
    bomb.double = true;
    inv.double = 0;
  } else if (inv.pumpkin > 0) {
    bomb.pumpkin = true;
    inv.pumpkin = 0;
  }
  const water = WATER_BOMBS.findIndex((kind) => inv[kind] > 0);
  if (water >= 0) {
    bomb.kind = WATER_KINDS[water];
    inv[WATER_BOMBS[water]] -= 1;
  } else if (fired) {
    bomb.kicker = player.id;
  } else if (inv.nuke > 0) {
    bomb.kind = BombKind.Nuke;
    bomb.power = 2;
    inv.nuke = 0;
  } else if (inv.timer > 0) {
    bomb.kind = BombKind.Timer;
    bomb.fuseMs = TIMER_FUSE_MS;
    inv.timer -= 1;
  } else if (inv.xbomb > 0) {
    bomb.kind = BombKind.X;
    bomb.power = 2;
    inv.xbomb -= 1;
  } else if (inv.tnt > 0) {
    bomb.kind = BombKind.Tnt;
    bomb.power = 1;
    bomb.tntLeft = TNT_MOVES;
    inv.tnt = 0;
  } else if (inv.mine > 0) {
    bomb.kind = BombKind.Mine;
    bomb.power = 1;
    inv.mine -= 1;
  }
  bomb.anim = line && bomb.kind === BombKind.Mine ? bomb.kind + 1 : bomb.kind;
  player.bombPass = true;
  state.bombs.push(bomb);
  return bomb;
}

/**
 * Space (0x45b5e6): false when the no-bomb curse swallows the press without setting the latch.
 * Nothing happens on a jump pad (0x45b668). On a free cell it places a bomb below capacity. On a
 * bomb, the line item places a row of bombs and the glove throws the bomb.
 */
export function spaceAction(state: MatchState, player: PlayerState): boolean {
  if (player.status.noBomb !== null) return false;
  const cell = playerCell(state, player);
  if (cell === null || tileB(state, cell) & PAD_BITS) return true;
  if (!hasBomb(state, cell)) {
    if (ownBombs(state, player) >= player.bombCapacity) return true;
    createBomb(state, player, cell, facing(player), false);
    state.events.push({ type: "bomb-placed", cell, owner: player.id });
  } else if (player.inv.line) {
    lineBombs(state, player, cell);
  } else if (player.inv.glove) {
    throwBomb(state, player, cell);
  }
  return true;
}

/**
 * 스페셜폭탄 (0x4574e0): one bomb per free cell from the next cell in the facing direction, up to
 * the capacity left; players do not stop the row. The network game plays one bomb1 for the row
 * (0x45bd34), practice none.
 */
function lineBombs(state: MatchState, player: PlayerState, from: number): void {
  const count = player.bombCapacity - ownBombs(state, player);
  if (count <= 0) return;
  const dir = facing(player);
  const { width } = state.layout;
  let col = from % width;
  let row = Math.floor(from / width);
  for (let i = 0; i < count; i++) {
    const cell = cellIndex(state, col + STEP_X[dir], row + STEP_Y[dir]);
    if (cell === null || !isFree(state, cell)) break;
    col += STEP_X[dir];
    row += STEP_Y[dir];
    createBomb(state, player, cell, dir, false, true);
  }
  if (!state.rules.practice) state.events.push({ type: "bomb-placed", cell: from, owner: player.id });
}

/** 손 (0x45b73d): throw animation and bomb2; the first bomb on the list in the player's cell takes off. */
function throwBomb(state: MatchState, player: PlayerState, cell: number): void {
  const dir = facing(player);
  startAction(player, Anim.Throw + dir);
  state.events.push({ type: "bomb-thrown", playerId: player.id });
  const bomb = state.bombs.find((b) => b.cell === cell);
  if (!bomb) return;
  bomb.firstFlight = true;
  bomb.motion = dir + 5;
  bomb.flightLeft = dir === Dir.Down || dir === Dir.Up ? THROW_ALONG : THROW_ACROSS;
}

/**
 * Left Ctrl (0x45c264): false when a curse or the freeze swallows it. With a 직격탄 and no water
 * family charge it fires a fast-rolling bomb from a free cell below capacity; otherwise it sets
 * off the player's own timer and water-family bombs, never mines (0x45c765).
 */
export function attackAction(state: MatchState, player: PlayerState): boolean {
  if (player.status.noBomb !== null || player.status.frozen !== null) return false;
  if (player.inv.missile <= 0 || holdsWaterBomb(player.inv)) {
    for (const bomb of state.bombs) {
      if ((bomb.kind === BombKind.Timer || isWaterBomb(bomb.kind)) && bomb.owner === player.id) bomb.triggered = true;
    }
    return true;
  }
  const cell = playerCell(state, player);
  if (cell === null || hasBomb(state, cell) || ownBombs(state, player) >= player.bombCapacity) return true;
  const dir = facing(player);
  startAction(player, Anim.Throw + dir);
  createBomb(state, player, cell, dir, true);
  state.events.push({ type: "missile-fired", playerId: player.id });
  player.inv.missile -= 1;
  return true;
}

/**
 * Kick shoe (0x450769), when the player's tentative centre enters a bomb cell. Returns whether
 * the player may still move. Walking into another cell, a resting or rolling bomb there is kicked
 * on in the facing direction if the cell beyond is free (players there block unless the bomb's
 * last kicker is among them); in the player's own cell a rolling bomb is turned. A kick never
 * moves the player; with no bomb to kick the player walks in.
 */
export function kickBomb(state: MatchState, player: PlayerState, target: number, current: number): boolean {
  const dir = facing(player);
  const ownCell = target === current;
  const bomb = state.bombs.find(
    (b) => b.cell === target && b.motion < 5 && !b.fast && (!ownCell || b.motion > 0),
  );
  if (!bomb) return true;
  const { width } = state.layout;
  const next = cellIndex(state, (target % width) + STEP_X[dir], Math.floor(target / width) + STEP_Y[dir]);
  if (next === null || !isFree(state, next)) return false;
  if (!ownCell) {
    const there = playersIn(state, next);
    if (there.length > 0 && !there.some((p) => p.id === bomb.kicker)) return false;
    bomb.braking = false;
  }
  startAction(player, Anim.Kick + dir);
  state.events.push({ type: "bomb-kicked", playerId: player.id });
  bomb.motion = dir + 1;
  bomb.placedMs = nowMs(state.tick) - 500;
  bomb.rollLeft = ROLL_CELLS;
  bomb.kicker = player.id;
  const at = cellTopLeft(state, target);
  bomb.x = at.x + BOMB_DX;
  bomb.y = at.y + BOMB_DY;
  return false;
}

function insideArea(state: MatchState, bomb: BombState): boolean {
  const { width, height, cellW, cellH } = state.layout;
  return bomb.x >= 0 && bomb.x <= width * cellW && bomb.y >= 0 && bomb.y <= height * cellH;
}

/** A mine waits for a player, a flame or a trigger; its fuse never runs out (0x4065a0). */
function fuseOut(bomb: BombState, now: number): boolean {
  return now - bomb.placedMs >= bomb.fuseMs && bomb.kind !== BombKind.Mine;
}

/**
 * The bomb loop in list order (0x406508). A bomb explodes when centred and flagged (not in
 * flight) or past its fuse, and is not drawn that update. Otherwise it is drawn, moves, is
 * flagged when flame covers its cell, and advances its animation. Exploded bombs burn.
 */
export function updateBombs(state: MatchState): void {
  const now = nowMs(state.tick);
  state.bombSprites = [];
  for (const bomb of [...state.bombs]) {
    if (bomb.exploded) {
      burnFire(state, bomb, now);
      continue;
    }
    if (isCentred(state, bomb) && ((bomb.triggered && !isFlying(bomb)) || fuseOut(bomb, now))) {
      explode(state, bomb);
      continue;
    }
    state.bombSprites.push({ type: "bomb", owner: bomb.owner, x: bomb.x, y: bomb.y, anim: bomb.anim, frame: bomb.frame });
    const fps = bombFps(bomb.anim);
    moveBomb(state, bomb, now);
    if (!isFlying(bomb) && insideArea(state, bomb) && state.flame[bomb.cell] > 0) bomb.triggered = true;
    if (animDue(now, bomb.frameMs, fps)) {
      bomb.frameMs = now;
      bomb.frame = (bomb.frame + 1) % BOMB_FRAMES;
    }
  }
}
