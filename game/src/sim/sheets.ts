// Animation data from the original .spr files that changes gameplay timing, so the
// server and the browser share it without loading sprite sheets. sheets.test.ts checks
// these tables against the exported sheets when they are present.
import type { BreakAnim, EffectKind } from "./types.ts";

/** Frames of anim 20 (앞죽음, 5 fps): the round decision waits for it to finish. */
export const DEATH_FRAMES: Readonly<Record<string, number>> = {
  bobo: 8,
  bogle: 8,
  domshell: 8,
  doomsy: 9,
  doomy: 9,
  doon: 8,
  doona: 8,
  doonae: 8,
  imp: 8,
  milky: 9,
  orange: 8,
  red: 9,
  rookie: 8,
  rookiee: 8,
  rooster: 8,
  shaky: 8,
  shark: 8,
  slack: 9,
  spider: 9,
  tofi: 8,
  "w-doomy": 9,
};

/** Frame rate of the four standing animations (anims 4-7). */
export const STAND_FPS: Readonly<Record<string, number>> = {
  bobo: 8,
  bogle: 8,
  domshell: 8,
  doomsy: 5,
  doomy: 5,
  doon: 5,
  doona: 5,
  doonae: 5,
  imp: 8,
  milky: 7,
  orange: 5,
  red: 7,
  rookie: 5,
  rookiee: 5,
  rooster: 7,
  shaky: 7,
  shark: 5,
  slack: 5,
  spider: 5,
  tofi: 8,
  "w-doomy": 5,
};

/** Anim 1 (터지는/깨지는 벽돌) of each brick sheet: frames and fps. */
export const BRICK_BREAK: Readonly<Record<string, BreakAnim>> = {
  b1: { frames: 6, fps: 5 },
  b2: { frames: 5, fps: 5 },
  b3: { frames: 5, fps: 5 },
  b4: { frames: 5, fps: 5 },
  b5: { frames: 5, fps: 5 },
  b6: { frames: 5, fps: 5 },
  b7: { frames: 4, fps: 6 },
  b8: { frames: 5, fps: 5 },
  b9: { frames: 5, fps: 5 },
  b10: { frames: 5, fps: 5 },
  b11: { frames: 5, fps: 5 },
  wday1: { frames: 5, fps: 5 },
  wday2: { frames: 5, fps: 5 },
  year1: { frames: 5, fps: 5 },
  year2: { frames: 5, fps: 5 },
  year3: { frames: 5, fps: 5 },
};

/** Bomb sheets (bomb_*.spr): 4 frames per animation at 5 fps, 보폭굴 (anim 1) at 7 fps. */
export const BOMB_FRAMES = 4;
export function bombFps(anim: number): number {
  return anim === 1 ? 7 : 5;
}

/** Kick (anims 12-15, 20 fps) and throw (anims 16-19, 11 fps) run 4 frames. */
export const KICK_FRAMES = 4;
export const THROW_FRAMES = 4;
export const THROW_FPS = 11;
/** Kick rates by facing (down, left, up, right) where a sheet differs from 20 fps. */
export const KICK_FPS: Readonly<Record<string, readonly [number, number, number, number]>> = {
  rooster: [17, 17, 17, 17],
  spider: [20, 20, 18, 20],
};
export function kickFps(character: string, dir: number): number {
  return KICK_FPS[character]?.[dir] ?? 20;
}

/** Jump (anims 8-11): 12 frames at 15 fps for every character. */
export const JUMP_FRAMES = 12;
export const JUMP_FPS = 15;
/** Going underground (anim 21) and coming up (anim 22): 4 frames at 12 fps for every character. */
export const BURROW_FRAMES = 4;
export const BURROW_FPS = 12;
/** Effect sheets: u_ground.spr and egg.spr, one animation each. */
export const EFFECT_SHEETS: Readonly<Record<EffectKind, { frames: number; fps: number }>> = {
  ground: { frames: 9, fps: 25 },
  egg: { frames: 6, fps: 5 },
  revival: { frames: 10, fps: 8 },
};

/**
 * Map object sheets Object_A, Object_B and Object_C.spr: frames and fps of each animation that
 * has frames. The animator (0x411700) runs these on the logic clock.
 */
export const OBJECT_ANIMS: readonly Readonly<Record<number, { frames: number; fps: number }>>[] = [
  {
    10: { frames: 4, fps: 5 },
    11: { frames: 4, fps: 5 },
    12: { frames: 4, fps: 5 },
    13: { frames: 4, fps: 5 },
    14: { frames: 6, fps: 5 },
    31: { frames: 4, fps: 5 },
    32: { frames: 4, fps: 5 },
    33: { frames: 4, fps: 5 },
    34: { frames: 4, fps: 5 },
  },
  {
    0: { frames: 4, fps: 7 },
    1: { frames: 4, fps: 7 },
    2: { frames: 4, fps: 7 },
    3: { frames: 4, fps: 5 },
    6: { frames: 4, fps: 7 },
    7: { frames: 4, fps: 6 },
    8: { frames: 4, fps: 6 },
    9: { frames: 4, fps: 6 },
    10: { frames: 4, fps: 6 },
    13: { frames: 4, fps: 7 },
    14: { frames: 4, fps: 5 },
  },
  {
    0: { frames: 1, fps: 5 },
    1: { frames: 1, fps: 5 },
  },
];

/** An object animation without frames (unused by the shipped maps) holds frame 0. */
export function objectAnim(sheet: number, anim: number): { frames: number; fps: number } {
  return OBJECT_ANIMS[sheet]?.[anim] ?? { frames: 0, fps: 5 };
}

export const WALK_FRAMES = 4;
export const STAND_FRAMES = 4;
const DEFAULT_BREAK: BreakAnim = { frames: 5, fps: 5 };

export function deathFrames(character: string): number {
  return DEATH_FRAMES[character] ?? 8;
}

export function standFps(character: string): number {
  return STAND_FPS[character] ?? 5;
}

/** `sprite` is a map's brick sheet file name, e.g. "b1.spr". */
export function brickBreak(sprite: string): BreakAnim {
  return BRICK_BREAK[sprite.replace(/\.spr$/i, "").toLowerCase()] ?? DEFAULT_BREAK;
}
