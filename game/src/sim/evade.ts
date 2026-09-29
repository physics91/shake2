// Z (key 3): jump (0x45ca1e, practice 0x45c849), burrow (0x45cb0c → 0x453a80) and teleport
// (0x45cb8c, practice 0x45c90e), and the teleport flight (0x452ca0, 0x452a8b).
import { nowMs, PRACTICE_CHARACTERS } from "./constants.ts";
import { facing } from "./bomb.ts";
import { addEffect } from "./effects.ts";
import { cellAtPixel, cellTopLeft } from "./grid.ts";
import { msvcRand } from "./rng.ts";
import { PAD_BITS, tileB, WARP_BITS } from "./tiles.ts";
import type { MatchState, PlayerState } from "./types.ts";
import { Anim, CellKind, Dir } from "./types.ts";

/** Underground for more than 2000 ms before coming up (0x452fc5). */
export const BURROW_MS = 2000;
/** The flight climbs and drops 40 px an update (0x452aa8, 0x452afa). */
const FLIGHT_STEP = 40;
/** The landing search walks down the target's column: 15 probes, 15 cells apart, back to cell 0 past 254 (0x45cc5c). */
const SEARCH_PROBES = 15;
const SEARCH_STRIDE = 15;
const SEARCH_LAST = 254;
/** Room slots the random pick draws from (0x45cbda: rand() % 6). */
const SLOTS = 6;

/**
 * The Z handler: the first ability held of jump, burrow and teleport (the pickups keep one, but
 * question marks can give several). The press always sets the latch, even when nothing happens.
 */
export function evadeAction(state: MatchState, player: PlayerState): boolean {
  const inv = player.inv;
  if (inv.jump > 0) jump(state, player);
  else if (inv.burrow) burrow(state, player);
  else if (inv.teleport > 0) teleport(state, player);
  return true;
}

/** One charge: the jump animation in the facing, from frame 0 (its frame timer runs on), and jump1. */
function jump(state: MatchState, player: PlayerState): void {
  player.inv.jump -= 1;
  player.anim = Anim.Jump + facing(player);
  player.frame = 0;
  state.events.push({ type: "jumped", playerId: player.id });
}

/** 0x453a80(1): underground from frame 0 with a puff of dust where the player stands; no sound. */
function burrow(state: MatchState, player: PlayerState): void {
  const now = nowMs(state.tick);
  player.anim = Anim.Burrow;
  player.frame = 0;
  player.burrowMs = now;
  addEffect(state, "ground", player, now, 0, false);
}

/**
 * In the state timer pass (0x452fb2): after more than 2 s underground the player comes up with a
 * second puff. The item is only used up when that animation ends.
 */
export function emergeWhenDue(state: MatchState, player: PlayerState, now: number): void {
  if (player.anim !== Anim.Burrow || now - player.burrowMs <= BURROW_MS) return;
  addEffect(state, "ground", player, now, 0, false);
  player.anim = Anim.Emerge;
  player.frame = 0;
  player.burrowMs = 0;
}

/** The end of the emerge animation (0x4528d4): standing, facing down, the burrow gone. */
export function endEmerge(player: PlayerState): void {
  player.anim = Anim.Stand + Dir.Down;
  player.dir = Dir.Down;
  player.inv.burrow = false;
}

/**
 * Network game (0x45cb8c): with fewer than two players in the room nothing happens and the
 * charge stays. Otherwise rand() % 6 picks a slot until it holds another player still shown
 * (a dying one counts; no team filter), and the player flies to a free cell at or below that
 * player's. The charge is used at once and again on landing. Warp sound.
 */
function teleport(state: MatchState, player: PlayerState): void {
  if (state.rules.practice) return practiceTeleport(state, player);
  if (state.players.length < 2) return;
  // The original draws until it hits; with nobody to hit it would never return. A round ends
  // before that can happen, so this guard is never taken in play.
  if (!state.players.some((p) => p !== player && !p.gone)) return;
  let target: PlayerState | undefined;
  do {
    const slot = msvcRand(state) % SLOTS;
    target = state.players.find((p) => p.slot === slot);
  } while (!target || target === player || target.gone);
  const { x, y } = landing(state, target);
  startFlight(state, player, x, y);
  player.inv.teleport = Math.max(0, player.inv.teleport - 1);
}

/**
 * Practice (0x45c90e) uses the charge first, then draws rand() % 3 until entry r of the index
 * table (0x471704) names a player whose death has not ended (0x44ff20), and flies onto that
 * player's exact position, with no cell search. Practice fills the table with the dummies'
 * character numbers (0x454730), so only a dummy numbered 0-3 names one of the four players.
 * RECONSTRUCTION: higher numbers read past the player array in the original; here they never
 * match, and with no match at all (the original draws forever) the flight goes up and back.
 */
function practiceTeleport(state: MatchState, player: PlayerState): void {
  player.inv.teleport = Math.max(0, player.inv.teleport - 1);
  const named = (entry: number): PlayerState | undefined => {
    const dummy = state.players.find((p) => p.slot === entry);
    const index = dummy ? PRACTICE_CHARACTERS.indexOf(dummy.character as (typeof PRACTICE_CHARACTERS)[number]) : -1;
    const target = state.players.find((p) => p.slot === index);
    return target && !target.gone ? target : undefined;
  };
  if (![0, 1, 2].some((entry) => named(entry))) {
    startFlight(state, player, player.x, player.y);
    return;
  }
  let target: PlayerState | undefined;
  do target = named(msvcRand(state) % PRACTICE_TABLE);
  while (!target);
  startFlight(state, player, target.x, target.y);
}

/** Entries of the practice index table the teleport draws from. */
const PRACTICE_TABLE = 3;

/**
 * The target's cell, then down its column (0x45cc42-0x45cc6a) for a cell the flight may land on:
 * see canLand (bombs, items, fire and players are not looked at). The landing point is
 * (cellX + 20, cellY + 16); if all 15 probes fail it is the target's own position + (20, 16).
 */
function landing(state: MatchState, target: PlayerState): { x: number; y: number } {
  let cell = cellAtPixel(state, target.x, target.y) ?? 0;
  for (let probe = 0; probe < SEARCH_PROBES; probe++) {
    if (canLand(state, cell)) {
      const at = cellTopLeft(state, cell);
      return { x: at.x + 20, y: at.y + 16 };
    }
    cell += SEARCH_STRIDE;
    if (cell > SEARCH_LAST) cell = 0;
  }
  return { x: target.x + 20, y: target.y + 16 };
}

/**
 * 0x411440 on a cell of the grid: no wall, brick, warp gate or directional jump pad (the 점프대
 * is allowed). Cells past the grid (225-254) read beyond the tile array and are taken as not free.
 */
function canLand(state: MatchState, cell: number): boolean {
  return cell < state.grid.length && state.grid[cell] === CellKind.Empty && (tileB(state, cell) & (WARP_BITS | PAD_BITS)) === 0;
}

/** 0x452ca0: flight phase 1 towards the target, with the warp sound (0x45ccad). */
function startFlight(state: MatchState, player: PlayerState, x: number, y: number): void {
  state.events.push({ type: "teleported", playerId: player.id });
  player.flight = { phase: 1, x, y };
}

/**
 * One update of the flight, in place of collision and pickups (0x452a8b): up 40 px an update
 * until at or above the area's top, then from 40 px below the top at the target's x down 40 px
 * an update onto the target. Landing uses up the charge (again). The animation is left alone.
 */
export function flyTeleport(player: PlayerState): void {
  const flight = player.flight;
  if (!flight) return;
  if (flight.phase === 1) {
    player.y -= FLIGHT_STEP;
    if (player.y > 0) return;
    player.y = FLIGHT_STEP;
    player.x = flight.x;
    flight.phase = 2;
    return;
  }
  player.y += FLIGHT_STEP;
  if (player.y < flight.y) return;
  player.y = flight.y;
  player.flight = null;
  player.inv.teleport = 0;
}
