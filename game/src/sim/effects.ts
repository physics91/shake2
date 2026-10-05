// The effect list [0x492740]: entries from the constructor 0x401000, drawn after the players and
// the side panel (0x40bdfd, practice 0x40891f) by 0x4010c0/0x401090, then advanced by 0x401100.
import { animDue, nowMs } from "./constants.ts";
import { EFFECT_SHEETS } from "./sheets.ts";
import type { Effect, EffectKind, MatchState, PlayerState } from "./types.ts";

/**
 * Appended at the tail (0x401260), frame 0, with its frame timer at `start`. A one-shot effect
 * (`lifeMs` 0) stays where it was made; a following one is drawn wherever its owner is.
 */
export function addEffect(state: MatchState, kind: EffectKind, owner: PlayerState, start: number, lifeMs: number, follow: boolean): void {
  state.effects.push({ kind, owner: owner.id, x: owner.x, y: owner.y, follow, lifeMs, start, frame: 0, frameMs: start, alive: true });
}

/**
 * One pass over the list, once an update after the players: a finished entry is dropped
 * undrawn; the others are drawn (a following one at its owner, while the owner is alive,
 * +0x170) and then advance when `now - last > 1000 / fps`. A one-shot entry finishes after its
 * last frame; a timed one loops until `now - start > lifeMs`.
 */
export function updateEffects(state: MatchState): void {
  const now = nowMs(state.tick);
  state.effects = state.effects.filter((effect) => effect.alive);
  state.effectSprites = [];
  for (const effect of state.effects) {
    if (effect.follow) {
      const owner = state.players.find((p) => p.id === effect.owner);
      if (owner?.alive && !owner.gone) {
        effect.x = owner.x;
        effect.y = owner.y;
      }
    }
    state.effectSprites.push({ kind: effect.kind, x: effect.x, y: effect.y, frame: effect.frame });
    advance(effect, now);
  }
}

function advance(effect: Effect, now: number): void {
  if (effect.lifeMs > 0 && now - effect.start > effect.lifeMs) {
    effect.alive = false;
    return;
  }
  const { frames, fps } = EFFECT_SHEETS[effect.kind];
  if (!animDue(now, effect.frameMs, fps)) return;
  effect.frameMs = now;
  effect.frame += 1;
  if (effect.frame < frames) return;
  if (effect.lifeMs > 0) effect.frame = 0;
  else effect.alive = false;
}
