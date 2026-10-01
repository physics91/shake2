// Helpers for sim tests: build small layouts from ASCII and drive a match.
import { BOMB_DX, BOMB_DY, FUSE_MS, LONG_AGO_MS, nowMs, SPAWN_DX, SPAWN_DY } from "./constants.ts";
import type { InputMap } from "./match.ts";
import { createMatch, step } from "./match.ts";
import type { BombState, InputFrame, LevelLayout, MapObject, MatchState, PlayerSetup, Rules } from "./types.ts";
import { BombKind, CellKind, Dir } from "./types.ts";

/** Object map tiles by letter: their flag word and the object the shipped maps put on them. */
const TILES: Readonly<Record<string, { a?: number; b?: number; object: Omit<MapObject, "cell"> }>> = {
  r: { b: 0x400, object: { sheet: 1, anim: 0, loop: true } },
  y: { b: 0x1000, object: { sheet: 1, anim: 2, loop: true } },
  "^": { b: 0x20000, object: { sheet: 1, anim: 7, loop: false } },
  v: { b: 0x40000, object: { sheet: 1, anim: 8, loop: false } },
  "<": { b: 0x80000, object: { sheet: 1, anim: 9, loop: false } },
  ">": { b: 0x100000, object: { sheet: 1, anim: 10, loop: false } },
  f: { b: 0x800000, object: { sheet: 1, anim: 13, loop: true } },
  p: { b: 0x10000, object: { sheet: 1, anim: 6, loop: true } },
  g: { b: 0x1000000, object: { sheet: 1, anim: 14, loop: true } },
  z: { a: 0x10000, object: { sheet: 0, anim: 14, loop: true } },
};

/**
 * '.' empty, '#' fixed, 'B' brick (b1: 6 frames at 5 fps), digits 1-6 mark spawn order (empty
 * cells). Object tiles on empty cells: 'r' red and 'y' yellow warp gates, '^' 'v' '<' '>' jump
 * pads, 'f' 점프대, 'p' 폭발증폭, 'g' generator, 'z' blast zone.
 */
export function layoutFromAscii(rows: string[], cellW = 40, cellH = 32): LevelLayout {
  const width = rows[0].length;
  const kinds: CellKind[] = [];
  const tileA: number[] = [];
  const tileB: number[] = [];
  const objects: MapObject[] = [];
  const objectAt: number[] = [];
  const spawnByDigit: [number, number][] = [];
  rows.forEach((row, y) => {
    [...row].forEach((ch, x) => {
      const cell = y * width + x;
      const kind = ch === "#" ? CellKind.Fixed : ch === "B" ? CellKind.Brick : CellKind.Empty;
      const tile = TILES[ch];
      kinds.push(kind);
      tileA.push(kind | (tile?.a ?? 0));
      tileB.push(tile?.b ?? 0);
      objectAt.push(tile ? objects.length : -1);
      if (tile) objects.push({ cell, ...tile.object });
      if (/[1-6]/.test(ch)) spawnByDigit.push([Number(ch), cell]);
    });
  });
  spawnByDigit.sort((a, b) => a[0] - b[0]);
  return {
    id: "test",
    width,
    height: rows.length,
    cellW,
    cellH,
    kinds,
    breakAnims: kinds.map((k) => (k === CellKind.Brick ? { frames: 6, fps: 5 } : null)),
    spawns: spawnByDigit.map(([, c]) => c),
    rollSpawns: false,
    tileA,
    tileB,
    objects,
    objectAt,
  };
}

export const PRACTICE: Rules = { practice: true, roundSeconds: 150, medalsToWin: 3, mode: 0 };
export const VERSUS: Rules = { practice: false, roundSeconds: 150, medalsToWin: 3, mode: 0 };

export function setups(count: number): PlayerSetup[] {
  return Array.from({ length: count }, (_, i) => ({ id: i + 1, name: `P${i + 1}`, character: "rookie" }));
}

/** Create a match and skip the wait and countdown so the next step is live play. */
export function playingMatch(rows: string[], players = 1, rules: Rules = VERSUS, seed = 1): MatchState {
  const state = createMatch(layoutFromAscii(rows), setups(players), rules, seed);
  state.phase = "playing";
  state.phaseTick = state.tick;
  state.hidden = state.hidden.map(() => null);
  return state;
}

export const IDLE: InputFrame = { dir: null, bomb: false };

export function run(state: MatchState, ticks: number, inputs: InputMap = {}): void {
  for (let i = 0; i < ticks; i++) step(state, inputs);
}

/** Run until `done` holds (checked after each tick); returns the ticks taken. */
export function runUntil(state: MatchState, done: () => boolean, limit = 10_000, inputs: InputMap = {}): number {
  for (let i = 1; i <= limit; i++) {
    step(state, inputs);
    if (done()) return i;
  }
  throw new Error(`condition not reached in ${limit} ticks`);
}

/** Spawn point of a cell: (cellX + 20, cellY + 16). */
export function cellCenter(state: MatchState, col: number, row: number): { x: number; y: number } {
  return { x: col * state.layout.cellW + SPAWN_DX, y: row * state.layout.cellH + SPAWN_DY };
}

export function cellAt(state: MatchState, col: number, row: number): number {
  return row * state.layout.width + col;
}

/** A resting power-1 bomb owned by nobody on the field, as 0x457ed0 builds it; `fields` override. */
export function addBomb(state: MatchState, cell: number, fields: Partial<BombState> = {}): BombState {
  const { width, cellW, cellH } = state.layout;
  const bomb: BombState = {
    id: state.nextBombId++,
    owner: 99,
    cell,
    x: (cell % width) * cellW + BOMB_DX,
    y: Math.floor(cell / width) * cellH + BOMB_DY,
    kind: BombKind.Normal,
    anim: BombKind.Normal,
    frame: 0,
    frameMs: LONG_AGO_MS,
    power: 1,
    placedMs: nowMs(state.tick),
    fuseMs: FUSE_MS,
    motion: 0,
    fast: false,
    kicker: null,
    rollLeft: 0,
    braking: false,
    flightLeft: 96,
    firstFlight: true,
    double: false,
    pumpkin: false,
    tntLeft: 0,
    tntDir: Dir.Down,
    triggered: false,
    bitCleared: false,
    exploded: false,
    explodedTick: 0,
    fireCells: [],
    fireFrame: 0,
    fireMs: LONG_AGO_MS,
    ...fields,
  };
  state.bombs.push(bomb);
  return bomb;
}

/** Cells whose flame kind is set. */
export function burning(state: MatchState): number[] {
  return state.flame.flatMap((f, cell) => (f > 0 ? [cell] : []));
}
