// Gameplay constants read from shake.exe (Shake0311, 2002). Each value's code address and
// the remaining inferences are listed in original/FIDELITY.md §3-5.

/** Logic frames per second: the frame limiter 0x405d30 runs one frame per QPC freq/30. */
export const TICK_RATE = 30;

// Player stats: start values 0x44fc50, caps 0x44dd58 (network game).
export const START_BOMBS = 1;
export const MAX_BOMBS = 9;
export const START_FIRE = 2;
export const MAX_FIRE = 9;
export const START_SPEED = 5;
export const MAX_SPEED = 10;

/** A bomb explodes when `now - placed >= FUSE_MS` and it sits on its cell centre (0x40658b). */
export const FUSE_MS = 2000;
/** 시한폭탄 fuse (0x4581a9). */
export const TIMER_FUSE_MS = 5000;
/** A pumpkin fire loops until this long after its blast, then runs once more (0x406ffb). */
export const PUMPKIN_MS = 2500;
/** A TNT moves on up to 3 times after its first blast (+0xd4 = 3, 0x458221). */
export const TNT_MOVES = 3;
/**
 * A timer field the object constructor zeroes: GetTickCount is always far past it, so the
 * first timer test after construction passes (e.g. the fire's first frame advance, 0x4153ba).
 */
export const LONG_AGO_MS = -1_000_000_000;
/** Fire uses bomb/fire.spr anim 0: 8 frames at 15 fps, advancing when `now - last > 1000/15`. */
export const FIRE_FRAMES = 8;
export const FIRE_FPS = 15;
/** Walk animations speed up with the player's speed: fps = 18 + 4 * (speed - 5) (0x452618). */
export const WALK_FPS = 18;
export const DEATH_FPS = 5;


// Round flow (0x444670 SetTimer, 0x40c85b countdown, 0x457480 timer, 0x40fd50 / 0x410560 screens).
export const WAIT_MS = 1000;
/**
 * Frames of a fade's darkening half (0x413d10, stepped by 0x4130f0). The frame function
 * (0x405fb0) is skipped for all of them (0x405e08), so nothing on the field moves then.
 */
export const FADE_OUT_FRAMES = 11;
export const COUNTDOWN_MS = 4000;
export const ROUND_SECONDS = 150;
export const HURRY_SECONDS = 70;
export const SUDDEN_DEATH_SECONDS = 60;
export const SUDDEN_DEATH_INTERVAL_MS = 200;
export const ROUND_RESULT_MS = 1500;
export const MATCH_RESULT_MS = 5000;
export const MEDALS_TO_WIN = 3;
export const MAX_PLAYERS = 6;

/** Player body box around the centre point (0x450290). */
export const HIT_LEFT = 15;
export const HIT_RIGHT = 15;
export const HIT_TOP = 15;
export const HIT_BOTTOM = 7;
/** Spawn point inside the spawn cell, from the cell's top-left (network game, 0x44de0d). */
export const SPAWN_DX = 20;
export const SPAWN_DY = 16;
/**
 * The network game's spawn points (0x469b8c), the same cells on every map: the corners, the
 * middles of the top and bottom rows and of the side columns. The host draws one per slot.
 */
export const NETWORK_SPAWNS = [0, 7, 14, 105, 119, 210, 217, 224] as const;
/** Practice places its players one pixel lower (0x4547e6). */
export const PRACTICE_SPAWN_DY = 17;
/** Bombs sit at (cellX + 20, cellY + 28) (0x415340). */
export const BOMB_DX = 20;
export const BOMB_DY = 28;

/** GetTickCount as seen by logic frame `tick`, with the ideal 1000/30 ms frame period. */
export function nowMs(tick: number): number {
  return Math.floor((tick * 1000) / TICK_RATE);
}

/** The original animation timer test: advance when `now - last > 1000 / fps` (integer division). */
export function animDue(now: number, last: number, fps: number): boolean {
  return now - last > Math.trunc(1000 / fps);
}

export function walkFps(speed: number): number {
  return WALK_FPS + 4 * (speed - START_SPEED);
}

/** Character numbers as the practice loader's sprite table orders them (0x4699ec). */
export const PRACTICE_CHARACTERS = [
  "rookie",
  "tofi",
  "imp",
  "bogle",
  "doona",
  "doon",
  "domshell",
  "bobo",
  "spider",
  "rooster",
  "slack",
  "shark",
  "red",
  "orange",
  "milky",
  "shaky",
  "doomsy",
  "doomy",
] as const;
