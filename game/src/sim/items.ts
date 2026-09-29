// Special items: the host's hidden brick roll and what a pickup does (original/FIDELITY.md §9).
import type { ItemWord } from "./types.ts";
import { ItemKind } from "./types.ts";

export function itemWord(kind: ItemKind, sub = 0): ItemWord {
  return kind | (sub << 8);
}

export function itemKindOf(word: ItemWord): ItemKind {
  return (word & 0xff) as ItemKind;
}

export function itemSubOf(word: ItemWord): number {
  return (word >> 8) & 0xff;
}

/** The bomb switch, the shake and the candy come at most once per roll (locals of 0x44d740). */
export interface OnceItems {
  switch: boolean;
  shake: boolean;
  candy: boolean;
}

/** Second rolls of the 40-69 and 70-94 bands (jump tables 0x44e6cc and 0x44e6e0; missile is in the second twice). */
const BAND_40: readonly ItemKind[] = [ItemKind.Glove, ItemKind.Jump, ItemKind.Teleport, ItemKind.Timer, ItemKind.Burrow];
const BAND_70: readonly ItemKind[] = [
  ItemKind.Kick,
  ItemKind.Power,
  ItemKind.Line,
  ItemKind.Nuke,
  ItemKind.Missile,
  ItemKind.Double,
  ItemKind.Missile,
  ItemKind.XBomb,
  ItemKind.Tnt,
];

/**
 * One brick of the host's roll (0x44e2ed-0x44e642): r = rand() % 300, then a second rand() inside
 * each band. Null is the original's 0x64 "nothing". The 화력 modes (3-5, `firepower`) keep the
 * stat band and the candy, keep jump, teleport and burrow, turn 70-94 into power on one entry in
 * nine, and skip 95-105 without a second rand() (0x44e47f-0x44e5fb).
 */
export function rollBrickItem(rand: () => number, once: OnceItems, firepower = false): ItemWord | null {
  const r = rand() % 300;
  if (r > 110) return null;
  if (r >= 106) {
    if (!once.candy) return null;
    once.candy = false;
    return ItemKind.Candy;
  }
  if (r >= 95 && firepower) return null;
  if (r >= 100) {
    if (rand() % 2 === 0) {
      if (!once.switch) return ItemKind.Power;
      once.switch = false;
      return ItemKind.Switch;
    }
    if (!once.shake) return ItemKind.Bomb;
    once.shake = false;
    return ItemKind.Shake;
  }
  if (r < 40) return (rand() % 3) as ItemKind;
  if (r < 70) {
    const kind = BAND_40[rand() % 5];
    return firepower && (kind === ItemKind.Glove || kind === ItemKind.Timer) ? null : kind;
  }
  if (r < 95) {
    const entry = rand() % 9;
    if (firepower) return entry === 1 ? ItemKind.Power : null;
    return BAND_70[entry];
  }
  return itemWord(ItemKind.Mystery, rand() % 39);
}

/**
 * Practice's roll per brick (0x454d7a-0x454e7c): r = rand() % 299, nothing above 99. 0-39 a stat
 * (rand() % 3); 40-69 rand() % 5 + 3 with 7 read as 14 (glove, kick, jump, nuke, teleport);
 * 70-89 rand() % 5 + 7 with 11 read as 15 (power, missile, timer, line, double); 90-99
 * rand() % 3 + 11: 12 is the X bomb, 11 and 13 a question mark whose sub is rand() % 21 + 1.
 * No one-time items and no candy.
 */
export function practiceBrickItem(rand: () => number): ItemWord | null {
  const r = rand() % 299;
  if (r > 99) return null;
  if (r < 40) return (rand() % 3) as ItemKind;
  if (r < 70) {
    const kind = (rand() % 5) + 3;
    return kind === 7 ? ItemKind.Teleport : kind;
  }
  if (r < 90) {
    const kind = (rand() % 5) + 7;
    return kind === 11 ? ItemKind.Double : kind;
  }
  if ((rand() % 3) + 11 === 12) return ItemKind.XBomb;
  return itemWord(ItemKind.Mystery, (rand() % 21) + 1);
}
