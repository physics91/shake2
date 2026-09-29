// Jump pads (점프대, 0x451e50), checked on the tentative position before pickups and collision (0x44ff30).
import { cellAtPixel, cellTopLeft, isSolid, truncCell } from "./grid.ts";
import { playObject } from "./mapObjects.ts";
import { FACING_PAD, PAD_DOWN, PAD_LEFT, PAD_RIGHT, PAD_UP, tileB } from "./tiles.ts";
import type { MatchState, PlayerState } from "./types.ts";
import { Anim, Dir } from "./types.ts";

/** Directional pads in the order they are tested (0x451ea5-0x452019), and their jumps. */
const PADS: readonly [bit: number, dir: Dir][] = [
  [PAD_DOWN, Dir.Down],
  [PAD_LEFT, Dir.Left],
  [PAD_UP, Dir.Up],
  [PAD_RIGHT, Dir.Right],
];

/** 점프대: the point, from the pad cell's top-left, whose cell decides on or back (table 0x4522ac). */
const FACING_PROBE: Readonly<Record<Dir, [number, number]>> = {
  [Dir.Down]: [25, 48],
  [Dir.Left]: [-7, 16],
  [Dir.Up]: [25, -16],
  [Dir.Right]: [57, 16],
};

/**
 * A walking or standing player whose tentative centre is in a pad cell is put on the cell's
 * centre ((cellX + 25) for the right pad, 0x452050) and jumps: a directional pad its way, the
 * 점프대 on in the facing, or back when the next cell that way is a wall or brick. The jump runs
 * from frame 0 on the running frame timer; the pad's arrow plays once and jump2 plays. Returns
 * the point collision goes on with.
 */
export function stepOnPad(state: MatchState, player: PlayerState, x: number, y: number): [number, number] {
  if (player.anim >= Anim.Jump) return [x, y];
  const cell = cellAtPixel(state, x, y);
  if (cell === null) return [x, y];
  const b = tileB(state, cell);
  const { x: left, y: top } = cellTopLeft(state, cell);
  const pad = PADS.find(([bit]) => b & bit);
  if (pad) {
    const [bit, dir] = pad;
    launch(state, player, cell, dir);
    return [left + (bit === PAD_RIGHT ? 25 : 20), top + 16];
  }
  if (b & FACING_PAD) {
    const facing = (player.anim % 4) as Dir;
    const [dx, dy] = FACING_PROBE[facing];
    const back = isSolid(state, truncCell(state, left + dx, top + dy));
    launch(state, player, cell, back ? (((facing + 2) % 4) as Dir) : facing);
    return [left + 20, top + 16];
  }
  return [x, y];
}

function launch(state: MatchState, player: PlayerState, cell: number, dir: Dir): void {
  playObject(state, cell);
  player.anim = Anim.Jump + dir;
  player.dir = dir;
  player.frame = 0;
  state.events.push({ type: "pad-jumped", playerId: player.id });
}
