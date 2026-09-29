// What picking up an item does (0x451100, jump table 0x451618; question marks 0x451a50).
import { MAX_BOMBS, MAX_FIRE, MAX_SPEED, nowMs } from "./constants.ts";
import { freeze, resetAbilities, startInvisible, startNoBomb, startReverse, startShield, startSlow } from "./status.ts";
import type { Inventory, MatchState, PlayerState, StatusTimers } from "./types.ts";
import { ItemKind } from "./types.ts";

export function emptyInventory(): Inventory {
  return {
    glove: false,
    kick: false,
    line: false,
    jump: 0,
    teleport: 0,
    burrow: false,
    power: 0,
    nuke: 0,
    missile: 0,
    timer: 0,
    xbomb: 0,
    tnt: 0,
    mine: 0,
    double: 0,
    pumpkin: 0,
    water: 0,
    poop: 0,
    apple: 0,
    panda: 0,
  };
}

export function noStatus(): StatusTimers {
  return { slow: null, noBomb: null, reverse: null, shield: null, invisible: null, frozen: null, blind: null };
}

type SpecialBomb = "nuke" | "missile" | "timer" | "xbomb" | "tnt" | "mine";

/** Picking one special bomb kind drops the others; their counts are lost. */
function keepSpecialBomb(inv: Inventory, keep: SpecialBomb): void {
  for (const kind of ["nuke", "missile", "timer", "xbomb", "tnt", "mine"] as const) if (kind !== keep) inv[kind] = 0;
}

export type WaterBomb = "water" | "poop" | "apple" | "panda";

/** The water family in the order a bomb takes them (0x458100). */
export const WATER_BOMBS: readonly WaterBomb[] = ["water", "poop", "apple", "panda"];

/** 0x451544-0x451597: the one picked is filled to the bomb count, the other three emptied. */
function fillWaterBomb(player: PlayerState, keep: WaterBomb): void {
  for (const kind of WATER_BOMBS) player.inv[kind] = kind === keep ? upToBombs(player, player.inv[kind], player.bombCapacity) : 0;
}

/** Count items grow by `n` but never past the player's bomb count. */
function upToBombs(player: PlayerState, current: number, n: number): number {
  return Math.max(0, Math.min(current + n, player.bombCapacity));
}

/**
 * The stat caps (+0x2bc bombs, +0x2c4 fire, +0x2c0 speed): 9/9/10 set by the network game's
 * map load (0x44dd58). Practice never runs it, so its caps stay 0 and these pickups do nothing
 * (0x4511d7, 0x4511f7, 0x451217).
 */
function statCaps(state: MatchState): { bombs: number; fire: number; speed: number } {
  return state.rules.practice ? { bombs: 0, fire: 0, speed: 0 } : { bombs: MAX_BOMBS, fire: MAX_FIRE, speed: MAX_SPEED };
}

function moreBombs(state: MatchState, player: PlayerState): void {
  if (player.bombCapacity < statCaps(state).bombs) player.bombCapacity += 1;
}

function moreFire(state: MatchState, player: PlayerState): void {
  if (player.firePower < statCaps(state).fire) player.firePower += 1;
}

function moreSpeed(state: MatchState, player: PlayerState): void {
  if (player.speed < statCaps(state).speed) player.speed += 1;
}

/** Apply an item picked up by `player`. `sub` is a question mark's hidden effect. */
export function applyPickup(state: MatchState, player: PlayerState, kind: number, sub = 0): void {
  const inv = player.inv;
  switch (kind) {
    case ItemKind.Bomb:
      return moreBombs(state, player);
    case ItemKind.Fire:
      return moreFire(state, player);
    case ItemKind.Speed:
      return moreSpeed(state, player);
    case ItemKind.Glove:
      inv.glove = true;
      inv.line = false;
      return;
    case ItemKind.Kick:
      inv.kick = true;
      return;
    case ItemKind.Jump:
      inv.jump = 1;
      inv.teleport = 0;
      inv.burrow = false;
      return;
    case ItemKind.Nuke:
      inv.nuke = Math.min(inv.nuke + 1, 3);
      return keepSpecialBomb(inv, "nuke");
    case ItemKind.Power:
      inv.power = upToBombs(player, inv.power, player.bombCapacity);
      return;
    case ItemKind.Missile:
      inv.missile = 1;
      return keepSpecialBomb(inv, "missile");
    case ItemKind.Timer:
      inv.timer = upToBombs(player, inv.timer, player.bombCapacity);
      return keepSpecialBomb(inv, "timer");
    case ItemKind.Line:
      inv.line = true;
      inv.glove = false;
      return;
    case ItemKind.Mystery:
      return applyMystery(state, player, sub);
    case ItemKind.Switch:
      // Every bomb on the field goes off at its next update; the picker freezes for 5 s (0x451399, 0x4517a0).
      for (const bomb of state.bombs) bomb.triggered = true;
      freeze(player, nowMs(state.tick));
      return;
    case ItemKind.Teleport:
      inv.teleport = 1;
      inv.jump = 0;
      inv.burrow = false;
      return;
    case ItemKind.Double:
      inv.double = 1;
      inv.pumpkin = 0;
      return;
    case ItemKind.Burrow:
      inv.burrow = true;
      inv.teleport = 0;
      inv.jump = 0;
      return;
    case ItemKind.Shake:
      startShield(state, player, nowMs(state.tick));
      return;
    case ItemKind.XBomb:
      inv.xbomb = upToBombs(player, inv.xbomb, player.bombCapacity);
      return keepSpecialBomb(inv, "xbomb");
    case ItemKind.Mine:
      inv.mine = upToBombs(player, inv.mine, player.bombCapacity);
      return keepSpecialBomb(inv, "mine");
    case ItemKind.Pumpkin:
      inv.pumpkin = upToBombs(player, inv.pumpkin, 1);
      inv.double = 0;
      return;
    case ItemKind.Tnt:
      inv.tnt = upToBombs(player, inv.tnt, 1);
      return keepSpecialBomb(inv, "tnt");
    case ItemKind.Water:
      return fillWaterBomb(player, "water");
    case ItemKind.Poop:
      return fillWaterBomb(player, "poop");
    case ItemKind.Apple:
      return fillWaterBomb(player, "apple");
    case ItemKind.Panda:
      return fillWaterBomb(player, "panda");
    case ItemKind.Candy:
      player.candy += 1;
      return;
  }
}

/** Question mark effects by sub value (0x451a50, table 0x451da8). */
function applyMystery(state: MatchState, player: PlayerState, sub: number): void {
  const inv = player.inv;
  const now = nowMs(state.tick);
  switch (sub) {
    case 0:
    case 12:
    case 21:
    case 26:
      return moreBombs(state, player);
    case 1:
    case 22:
    case 30:
      return moreFire(state, player);
    case 2:
      return moreSpeed(state, player);
    case 3:
    case 4:
    case 6:
    case 8:
    case 9:
    case 10:
    case 15:
    case 20:
    case 23:
      return applyPickup(state, player, sub);
    case 5:
      inv.jump = 1;
      inv.teleport = 0;
      return;
    case 7:
    case 28:
    case 29:
      return applyPickup(state, player, ItemKind.Power);
    case 14:
      inv.teleport = 1;
      inv.jump = 0;
      return;
    case 17:
      inv.burrow = true;
      return;
    case 31:
      inv.power = 0;
      return;
    case 32:
      inv.missile = 0;
      return;
    case 33:
      return startSlow(player, now);
    case 34:
      return resetAbilities(player, now);
    case 35:
      return startNoBomb(player, now);
    case 36:
      return startReverse(player, now);
    case 37:
      return startShield(state, player, now);
    case 38:
      return startInvisible(player, now);
  }
}
