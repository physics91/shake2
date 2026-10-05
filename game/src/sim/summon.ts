// 소환 modes (6, 7): a death lays a capsule; picking it up brings a dead teammate back
// (original/FIDELITY.md §12).
import { nowMs, SPAWN_DX, SPAWN_DY } from "./constants.ts";
import { addEffect } from "./effects.ts";
import { addItem, cellTopLeft, isFree, playerCell } from "./grid.ts";
import { isSummonMode } from "./modes.ts";
import { msvcRand, srandTime } from "./rng.ts";
import { resetAbilities } from "./status.ts";
import type { MatchState, PlayerState } from "./types.ts";
import { Anim, Dir, ItemKind } from "./types.ts";

/**
 * 0x453270 at the death animation's end, before the stat drops: a capsule on the player's own
 * cell when it is inside the area and free (0x410920), a pixel higher like any drop.
 */
export function dropCapsule(state: MatchState, player: PlayerState): void {
  if (!isSummonMode(state.rules.mode)) return;
  const cell = playerCell(state, player);
  if (cell === null || !isFree(state, cell)) return;
  addItem(state, { cell, kind: ItemKind.Capsule, tick: state.tick, dropped: true });
}

/**
 * 0x453d00 for whoever picked the capsule up, on either team: one of the picker's teammates whose
 * death animation has ended, rand() % count in slot order, stands again at the capsule cell's
 * centre facing down, with the item reset's stats and stars (0x40cea0) and revival.spr. With
 * nobody to bring back the capsule is simply used up. It reseeds before checking the candidates
 * (0x453d11), even when none are dead. Revival keeps the body's animation clock, bomb pass and
 * pending walk stop (+0x171); the next common update consumes that stop when a frame is due.
 */
export function reviveTeammate(state: MatchState, picker: PlayerState, cell: number): void {
  const now = nowMs(state.tick);
  srandTime(state, now);
  const candidates = state.players.filter((p) => p.gone && p.team === picker.team);
  if (candidates.length === 0) return;
  const revived = candidates[msvcRand(state) % candidates.length];
  const at = cellTopLeft(state, cell);
  Object.assign(revived, {
    x: at.x + SPAWN_DX,
    y: at.y + SPAWN_DY,
    dir: Dir.Down,
    anim: Anim.Stand + Dir.Down,
    frame: 0,
    alive: true,
    gone: false,
    flight: null,
  });
  resetAbilities(revived, now);
  addEffect(state, "revival", revived, now, 0, true);
  state.events.push({ type: "revived", playerId: revived.id });
}
