// Timed player states: setters 0x453110, 0x453190, 0x453200, 0x452e20, 0x452cd0, 0x4517a0,
// 0x40d7a0 and 0x40cea0; they run out in the player update (0x452651) and its timer pass (0x452e60).
import { START_BOMBS, START_FIRE, START_SPEED } from "./constants.ts";
import { addEffect } from "./effects.ts";
import { emptyInventory } from "./pickup.ts";
import type { MatchState, PlayerState } from "./types.ts";

/** Curses, the egg and invisibility last 10 s; the bomb switch freezes for 5 s. Each ends once `now - start > length`. */
export const CURSE_MS = 10_000;
export const FREEZE_MS = 5_000;
/** The reset's dizzy stars stay 1.5 s (0x40cf60). */
export const RESET_ICON_MS = 1_500;
/** Slowed, walk and stand states move 2 px an update and animate at 4 fps (0x45266c). */
export const SLOW_SPEED = 2;
export const SLOW_FPS = 4;

/** The one dizzy-stars icon (bad_state.spr, +0x2a8): the newest bad state sets its start and length. */
function showStars(player: PlayerState, now: number, length: number): void {
  player.badState = { start: now, length };
}

/** 0x453110: speed above 2 is kept to come back afterwards. */
export function startSlow(player: PlayerState, now: number): void {
  if (player.speed > SLOW_SPEED) player.savedSpeed = player.speed;
  player.status.slow = now;
  showStars(player, now, CURSE_MS);
}

/** 0x453190: Space and Left Ctrl do nothing; Z still works. */
export function startNoBomb(player: PlayerState, now: number): void {
  player.status.noBomb = now;
  showStars(player, now, CURSE_MS);
}

/** 0x453200: the direction keys are swapped. */
export function startReverse(player: PlayerState, now: number): void {
  player.status.reverse = now;
  showStars(player, now, CURSE_MS);
}

/** 0x40d7a0, apple flame: only a window around the player is shown (0x406109, 0x412e20). */
export function startBlind(player: PlayerState, now: number): void {
  player.status.blind = now;
  showStars(player, now, CURSE_MS);
}

/** 0x452e20: no icon. */
export function startInvisible(player: PlayerState, now: number): void {
  player.status.invisible = now;
}

/**
 * 0x452cd0: the egg keeps fire off and ends invisibility; no icon. It adds an egg to the effect
 * list that follows the player for 10 s; a second pickup adds a second egg.
 */
export function startShield(state: MatchState, player: PlayerState, now: number): void {
  player.status.shield = now;
  player.status.invisible = null;
  addEffect(state, "egg", player, now, CURSE_MS, true);
}

/** 0x4517a0: picking up the bomb switch; keys are ignored and walking stops for 5 s. */
export function freeze(player: PlayerState, now: number): void {
  player.status.frozen = now;
  showStars(player, now, FREEZE_MS);
}

/**
 * 0x40cea0: back to 1 bomb, fire 2 and speed 5 and every item gone except a teleport charge;
 * blindness ends, the curses go on. Dizzy stars for 1.5 s.
 */
export function resetAbilities(player: PlayerState, now: number): void {
  player.bombCapacity = START_BOMBS;
  player.firePower = START_FIRE;
  player.speed = START_SPEED;
  player.inv = { ...emptyInventory(), teleport: player.inv.teleport };
  player.status.blind = null;
  showStars(player, now, RESET_ICON_MS);
}

/**
 * The slow curse at the top of the player update (0x452651): in walk and stand states the speed
 * is held at 2 and the animation at 4 fps. When it runs out the saved speed returns. Returns the
 * animation rate it imposes, if any.
 */
export function holdSlow(player: PlayerState, now: number, inWalkOrStand: boolean): number | null {
  const start = player.status.slow;
  if (start === null) return null;
  if (inWalkOrStand) player.speed = SLOW_SPEED;
  if (now - start <= CURSE_MS) return inWalkOrStand ? SLOW_FPS : null;
  player.speed = player.savedSpeed;
  player.status.slow = null;
  return null;
}

/** 0x452e60, every update: states and the icon end when their time is up. */
export function expireStatus(player: PlayerState, now: number): void {
  const s = player.status;
  if (s.noBomb !== null && now - s.noBomb > CURSE_MS) s.noBomb = null;
  if (s.reverse !== null && now - s.reverse > CURSE_MS) s.reverse = null;
  if (s.shield !== null && now - s.shield > CURSE_MS) s.shield = null;
  if (s.invisible !== null && now - s.invisible > CURSE_MS) s.invisible = null;
  if (s.frozen !== null && now - s.frozen > FREEZE_MS) s.frozen = null;
  if (s.blind !== null && now - s.blind > CURSE_MS) s.blind = null;
  if (player.badState && now - player.badState.start > player.badState.length) player.badState = null;
}
