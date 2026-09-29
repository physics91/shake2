// Warp gates (워프존, 0x4522c0), entered from player collision (0x450230).
import { cellTopLeft, isSolid, STEP_X, STEP_Y, truncCell } from "./grid.ts";
import type { MatchState, PlayerState } from "./types.ts";
import { Anim, Dir } from "./types.ts";

/** Gates are Object_B anims 0-3, one per colour (the destination search, 0x452305). */
const GATE_SHEET = 1;
/** The exit is 32 px from the destination gate's centre in the facing (0x4523a0-0x4523b1). */
const EXIT_OFFSET = 32;
/** Directions tried for the exit: the facing, then turning 1 → 2 → 3 → 0, five in all (0x4523d8). */
const EXIT_TRIES = 5;
/** The exit jump starts at frame 4 of the 12 (0x452420): 8 steps. */
const EXIT_FRAME = 4;

/**
 * 0x4522c0: the last gate object of the colour in file order that is not in `entry` is the
 * destination, even with more than two gates. The player appears 32 px from its centre in the
 * facing (turning while that cell is a wall or brick) and jumps on from frame 4; the frame timer
 * runs on. With no destination, or no open exit, the player jumps back from where it stands.
 * warpzone plays either way.
 */
export function warp(state: MatchState, player: PlayerState, colour: number, entry: number): void {
  state.events.push({ type: "warped", playerId: player.id });
  const facing = (player.anim % 4) as Dir;
  let destination: number | null = null;
  state.layout.objects.forEach((object, i) => {
    const cell = state.objects[i].cell;
    if (object.sheet === GATE_SHEET && object.anim === colour && cell !== entry) destination = cell;
  });
  if (destination !== null) {
    const centre = gateCentre(state, destination);
    let dir = facing;
    for (let attempt = 0; attempt < EXIT_TRIES; attempt++) {
      const x = centre.x + STEP_X[dir] * EXIT_OFFSET;
      const y = centre.y + STEP_Y[dir] * EXIT_OFFSET;
      if (!isSolid(state, truncCell(state, x, y))) {
        player.x = x;
        player.y = y;
        jumpFrom(player, dir);
        return;
      }
      dir = ((dir + 1) % 4) as Dir;
    }
  }
  jumpFrom(player, ((facing + 2) % 4) as Dir);
}

/**
 * The gate cell's centre by 0x4109a0, whose signed division puts a gate a sudden-death block
 * took (cell -1) at column -1 of row 0.
 */
function gateCentre(state: MatchState, cell: number): { x: number; y: number } {
  if (cell >= 0) {
    const { x, y } = cellTopLeft(state, cell);
    return { x: x + 20, y: y + 16 };
  }
  const { width, cellW, cellH } = state.layout;
  return { x: (cell % width) * cellW + 20, y: Math.trunc(cell / width) * cellH + 16 };
}

function jumpFrom(player: PlayerState, dir: Dir): void {
  player.anim = Anim.Jump + dir;
  player.dir = dir;
  player.frame = EXIT_FRAME;
}
