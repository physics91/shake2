// Tile flag words of object maps (original/FIDELITY.md §10). Each tile kind is one bit: Object_A
// anim n is A bit n + 2, Object_B anim n is B bit n + 10.
import type { MatchState } from "./types.ts";

/** B: warp gates red, blue, yellow, green (Object_B anims 0-3). */
export const WARP_BITS = 0x3c00;
/** B: jump pads up, down, left, right (Object_B anims 7-10). */
export const PAD_UP = 0x20000;
export const PAD_DOWN = 0x40000;
export const PAD_LEFT = 0x80000;
export const PAD_RIGHT = 0x100000;
export const PAD_BITS = PAD_UP | PAD_DOWN | PAD_LEFT | PAD_RIGHT;
/** B: 점프대, the pad that jumps on in the facing (Object_B anim 13). */
export const FACING_PAD = 0x800000;
/** B: 폭발증폭, bombs there burn the whole map width (Object_B anim 6). */
export const BOOST = 0x10000;
/** B: 제너레이터, drops items after explosions (Object_B anim 14). */
export const GENERATOR = 0x1000000;
/** A: 동시폭발지역, cells that blow up together (Object_A anim 14). */
export const ZONE = 0x10000;

/**
 * The cell's object index (tile +4), -1 when it has none or a sudden-death block took it (0x40161d).
 */
export function objectIndex(state: MatchState, cell: number): number {
  const index = state.layout.objectAt[cell] ?? -1;
  return index >= 0 && state.objects[index].cell >= 0 ? index : -1;
}

export function tileA(state: MatchState, cell: number): number {
  return state.layout.tileA[cell] ?? 0;
}

/** A sudden-death block clears the jump pad bits of a cell that had an object (0x401645-0x4016bf). */
export function tileB(state: MatchState, cell: number): number {
  const b = state.layout.tileB[cell] ?? 0;
  const index = state.layout.objectAt[cell] ?? -1;
  return index >= 0 && state.objects[index].cell < 0 ? b & ~PAD_BITS : b;
}

/** The gate colour 0-3 of a B word, lowest bit first (0x450391); null if it is no gate. */
export function warpColour(b: number): number | null {
  for (let colour = 0; colour < 4; colour++) if (b & (0x400 << colour)) return colour;
  return null;
}
