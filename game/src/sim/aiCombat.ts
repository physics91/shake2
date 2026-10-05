// Evaluate ordinary button presses against the real simulation before committing to an attack.
import { facing } from "./bomb.ts";
import { anticipate, enemies, exits, forecast, keyboardInput, LOOKAHEAD, predictionState, refuge, routes, safe, shieldedThrough } from "./aiWorld.ts";
import type { Forecast, Route } from "./aiWorld.ts";
import { DIRS, playerCell } from "./grid.ts";
import { step } from "./match.ts";
import type { InputFrame, MatchState, PlayerState } from "./types.ts";
import { Anim, CellKind } from "./types.ts";

export interface CombatPlan {
  input: InputFrame;
  escape: Route | undefined;
  depart: number;
  value: number;
  followup: "bomb" | "evade" | null;
}

function shelters(state: MatchState, player: PlayerState, prediction: Forecast, deadline: number): Route[] {
  const offset = state.tick - prediction.tick;
  return routes(state, player, prediction).filter((r) => r.at - offset <= deadline && safe(prediction, r.cell, r.at + 1, LOOKAHEAD));
}

function escapeWeight(options: Route[], offset: number): number {
  return options.reduce((sum, route) => sum + 1 / (1 + (route.at - offset) / 12) ** 2, 0);
}

/** New fire matters most when it removes the opponent's remaining safe destinations. */
function pressure(state: MatchState, trial: MatchState, player: PlayerState, before: Forecast, after: Forecast, affected: number[]): number {
  const cells = new Set<number>();
  let deadline = LOOKAHEAD, fireEnd = 0;
  for (const id of affected) {
    const blast = after.blasts.get(id);
    if (!blast) continue;
    deadline = Math.min(deadline, blast.at);
    fireEnd = Math.max(fireEnd, blast.until);
    for (const cell of blast.cells) cells.add(cell);
  }
  const scheduled = new Map<number, number>();
  for (const blast of before.blasts.values()) for (const cell of blast.cells) {
    scheduled.set(cell, Math.min(scheduled.get(cell) ?? Infinity, blast.at));
  }
  // Reserve capacity for new territory rather than clearing a brick twice.
  let value = [...cells].filter((cell) => state.grid[cell] === CellKind.Brick &&
    (scheduled.get(cell) ?? Infinity) > deadline + trial.tick - before.tick + 15).length * 2;
  const spareBomb = trial.bombs.filter((bomb) => bomb.owner === player.id).length < player.bombCapacity;
  for (const enemy of enemies(state, player)) {
    if (shieldedThrough(trial, enemy, fireEnd)) continue;
    const cell = playerCell(state, enemy);
    if (cell === null) continue;
    const currentHit = cells.has(cell), predictedHit = cells.has(anticipate(state, enemy, deadline));
    if (currentHit) value += 8;
    if (predictedHit) value += 12;
    const target = trial.players.find((p) => p.id === enemy.id)!;
    // Don't give credit for a player who was already trapped by existing fire.
    const original = shelters(state, enemy, before, deadline + trial.tick - state.tick);
    if (original.length > 0) {
      const remaining = shelters(trial, target, after, deadline);
      const originalWeight = escapeWeight(original, state.tick - before.tick);
      const remainingWeight = escapeWeight(remaining, trial.tick - after.tick);
      const removed = Math.max(0, (originalWeight - remainingWeight) / originalWeight);
      // Nearby retreats matter more than remote cells the opponent needn't visit.
      // A slow cutoff needs a spare bomb to finish it; otherwise close in first.
      if (removed >= 0.2 && (currentHit || predictedHit || spareBomb || deadline <= 15)) value += 30 * removed;
      if (remaining.length === 0) value += 50;
    }
  }
  return value;
}

/** A release tick is mandatory between the shot and the follow-up, as with human input. */
function comboEscape(state: MatchState, player: PlayerState, input: InputFrame):
  { action: "bomb" | "evade"; trial: MatchState; future: Forecast } | null {
  const options: ("bomb" | "evade")[] = [];
  if (player.inv.glove && !player.inv.line) options.push("bomb");
  if (player.inv.jump > 0 || player.inv.burrow) options.push("evade");
  for (const action of options) {
    const trial = predictionState(state, player.id);
    const actor = trial.players.find((p) => p.id === player.id)!;
    step(trial, { [actor.id]: keyboardInput(actor, input) });
    step(trial, { [actor.id]: { dir: null, bomb: false } });
    if (!actor.alive) continue;
    const follow = { dir: null, bomb: action === "bomb", evade: action === "evade" };
    step(trial, { [actor.id]: follow });
    if (!trial.events.some((event) => (event.type === "bomb-thrown" || event.type === "jumped") && event.playerId === actor.id) &&
        actor.anim !== Anim.Burrow) continue;
    // Include landing/emergence and the thrown bomb's eventual fire, rather than only its immunity frames.
    const landing = structuredClone(trial);
    const landed = landing.players.find((p) => p.id === player.id)!;
    for (let t = 0; t < 110 && landed.alive && landing.phase === "playing"; t++) step(landing, { [actor.id]: { dir: null, bomb: false } });
    if (!landed.alive || landed.flight) continue;
    const future = forecast(landing, player.id);
    if (refuge(landing, landed, future, routes(landing, landed, future))) return { action, trial, future: forecast(trial, player.id) };
  }
  return null;
}

function safeEscape(state: MatchState, player: PlayerState, future: Forecast): Route | undefined {
  const cell = playerCell(state, player);
  const delay = player.anim >= Anim.Throw ? 12 : 0;
  return cell !== null && safe(future, cell, 1, delay)
    ? refuge(state, player, future, routes(state, player, future, delay)) : undefined;
}

/** Ordinary Z presses: check landing/emergence, including the first vulnerable frame. */
export function evadePlan(state: MatchState, player: PlayerState): CombatPlan | null {
  if (player.actionLatch || (!player.inv.jump && !player.inv.burrow)) return null;
  let best: CombatPlan | null = null;
  for (const dir of player.inv.jump ? DIRS : [player.dir]) {
    const input: InputFrame = { dir, bomb: false, evade: true };
    const trial = predictionState(state, player.id);
    const actor = trial.players.find((p) => p.id === player.id)!;
    step(trial, { [actor.id]: keyboardInput(actor, input) });
    for (let tick = 0; tick < 100 && actor.alive && actor.anim >= Anim.Jump && trial.phase === "playing"; tick++) {
      step(trial, { [actor.id]: { dir: null, bomb: false } });
    }
    if (!actor.alive || actor.flight || (trial.phase === "playing" && actor.anim >= Anim.Jump)) continue;
    if (trial.phase === "playing") step(trial, { [actor.id]: { dir: null, bomb: false } });
    if (!actor.alive) continue;
    if (trial.phase !== "playing") return { input, escape: undefined, depart: 0, value: 10, followup: null };
    const future = forecast(trial, player.id), escape = safeEscape(trial, actor, future);
    if (!escape) continue;
    const value = exits(trial, future, playerCell(trial, actor)!, 1);
    if (!best || value > best.value) best = { input, escape, depart: future.tick + escape.depart, value, followup: null };
  }
  return best;
}

export function combatPlan(state: MatchState, player: PlayerState, before: Forecast, input: InputFrame): CombatPlan | null {
  if (player.actionLatch || player.status.noBomb !== null) return null;
  const trial = predictionState(state, player.id);
  const actor = trial.players.find((p) => p.id === player.id)!;
  const previous = new Map(trial.bombs.map((b) => [b.id, { triggered: b.triggered, motion: b.motion }]));
  step(trial, { [actor.id]: keyboardInput(actor, input) });
  if (!actor.alive || trial.phase !== "playing") return null;
  const thrown = trial.events.some((e) => e.type === "bomb-thrown" && e.playerId === actor.id);
  const affected = trial.bombs.filter((b) => (!previous.has(b.id) && b.owner === actor.id) ||
    (b.owner === actor.id && b.triggered && !previous.get(b.id)?.triggered) ||
    (thrown && b.motion >= 5 && (previous.get(b.id)?.motion ?? 5) < 5)).map((b) => b.id);
  if (affected.length === 0) return null;
  const future = forecast(trial, player.id);
  const escape = safeEscape(trial, actor, future);
  const value = pressure(state, trial, player, before, future, affected);
  let plan: CombatPlan | null = escape && value > 0
    ? { input, escape, depart: future.tick + escape.depart, value, followup: null } : null;
  if (input.bomb && actor.inv.line && affected.some((id) => !previous.has(id))) {
    const line = structuredClone(trial);
    const placer = line.players.find((p) => p.id === player.id)!;
    step(line, { [placer.id]: { dir: null, bomb: false } });
    step(line, { [placer.id]: { dir: null, bomb: true } });
    const extended = line.bombs.filter((b) => b.owner === player.id && !previous.has(b.id)).map((b) => b.id);
    if (placer.alive && line.phase === "playing" && extended.length > affected.length) {
      const lineFuture = forecast(line, player.id);
      const lineEscape = safeEscape(line, placer, lineFuture);
      const lineValue = pressure(state, line, player, before, lineFuture, extended);
      if (lineEscape && lineValue > (plan?.value ?? 0)) plan = {
        input, escape: lineEscape, depart: lineFuture.tick + lineEscape.depart, value: lineValue, followup: "bomb",
      };
    }
  }
  if (plan) return plan;
  if (input.attack && actor.anim === Anim.Throw + facing(actor)) {
    const combo = comboEscape(state, player, input);
    if (combo) {
      const combined = pressure(state, combo.trial, player, before, combo.future, affected);
      if (combined > 0) return { input, escape: undefined, depart: 0, value: combined, followup: combo.action };
    }
  }
  return null;
}
