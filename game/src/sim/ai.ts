// Remake AI (FIDELITY §8, R). It supplies ordinary inputs; the match remains the rules authority.
import { combatPlan, evadePlan } from "./aiCombat.ts";
import type { CombatPlan } from "./aiCombat.ts";
import { chooseGoal } from "./aiGoals.ts";
import type { Goal } from "./aiGoals.ts";
import { adjacent, anticipate, centre, centred, enemies, forecast, keyboardInput, LOOKAHEAD, predictionState, refuge, routes, safe, steer } from "./aiWorld.ts";
import type { Forecast, Route } from "./aiWorld.ts";
import { nowMs } from "./constants.ts";
import { DIRS, hasBomb, playerCell } from "./grid.ts";
import { step } from "./match.ts";
import type { InputFrame, MatchState, PlayerState } from "./types.ts";
import { Anim, BombKind, CellKind, Dir } from "./types.ts";

const IDLE: InputFrame = { dir: null, bomb: false };
const REPLAN_TICKS = 3;
const COMBAT_TICKS = 6;

function shotDirections(state: MatchState, player: PlayerState): Dir[] {
  const cell = playerCell(state, player)!;
  const targets = enemies(state, player).flatMap((p) => [playerCell(state, p)!, anticipate(state, p, 20)]);
  const found = new Set<Dir>();
  for (const target of targets) {
    const dx = target % state.layout.width - cell % state.layout.width;
    const dy = Math.floor(target / state.layout.width) - Math.floor(cell / state.layout.width);
    if (dx === 0 && dy !== 0) found.add(dy > 0 ? Dir.Down : Dir.Up);
    else if (dy === 0 && dx !== 0) found.add(dx > 0 ? Dir.Right : Dir.Left);
  }
  if (player.inv.jump > 0 || player.inv.burrow || player.inv.glove) {
    for (const dir of DIRS) {
      const next = adjacent(state, cell, dir);
      if (next !== null && (state.grid[next] !== CellKind.Empty || hasBomb(state, next))) found.add(dir);
    }
  }
  return [...found];
}

/** One controller per AI seat. The same controls, movement, cooldowns and action latch as a human. */
export class AiController {
  private readonly playerId: number;
  private round = -1;
  private waypoint: number | null = null;
  private goal: Goal | null = null;
  private shelter: number | null = null;
  private refused = new Map<number, number>();
  private depart = 0;
  private prediction: Forecast | null = null;
  private worldKey = "";
  private lastBombTick = -100;
  private lastCombatTick = -100;
  private followup: { action: "bomb" | "evade"; until: number } | null = null;
  private sampledState: MatchState | null = null;
  private sampledTick = -1;
  private sampledInput: InputFrame = IDLE;

  constructor(playerId: number) { this.playerId = playerId; }

  sample(state: MatchState): InputFrame {
    const player = state.players.find((p) => p.id === this.playerId);
    if (this.round !== state.round) {
      this.round = state.round;
      this.waypoint = null;
      this.goal = null;
      this.shelter = null;
      this.refused.clear();
      this.prediction = null;
      this.followup = null;
      this.lastBombTick = this.lastCombatTick = -100;
    }
    if (state.phase !== "playing" || !player?.alive || player.gone || player.flight || player.status.frozen !== null ||
        (player.anim >= Anim.Jump && player.anim < Anim.Jump + 4) || player.anim >= Anim.Death) return { ...IDLE };
    if (this.sampledState === state && this.sampledTick === state.tick) return { ...this.sampledInput };
    this.sampledState = state;
    this.sampledTick = state.tick;
    this.sampledInput = keyboardInput(player, this.stopSafely(state, player, this.decide(state, player)));
    return { ...this.sampledInput };
  }

  private decide(state: MatchState, player: PlayerState): InputFrame {
    const cell = playerCell(state, player);
    if (cell === null) return { ...IDLE };
    if (this.followup) {
      const next = this.followup;
      if (state.tick <= next.until) {
        if (player.actionLatch) return { ...IDLE };
        this.followup = null;
        return { dir: null, bomb: next.action === "bomb", evade: next.action === "evade" };
      }
      this.followup = null;
    }
    const key = [state.grid.join(""), state.flame.join(""), state.suddenDeath.placed,
      state.bombs.map((b) => `${b.id}:${b.cell}:${b.motion}:${b.triggered}:${b.exploded}`).join(","),
      state.items.map((i) => i.cell).join(","), state.objects.map((o) => `${o.cell}:${o.active}:${o.play}`).join(","),
      enemies(state, player).map((p) => `${p.id}:${playerCell(state, p)}`).join(",")].join("/");
    if (!this.prediction || key !== this.worldKey || state.tick - this.prediction.tick >= REPLAN_TICKS) {
      this.prediction = forecast(state, player.id);
      this.worldKey = key;
    }
    const prediction = this.prediction;
    const offset = state.tick - prediction.tick;

    if (this.shelter !== null) {
      // Reach the chosen refuge, including safe intermediate tiles. Opponent
      // motion must not replace it every tick with the refuge on the other side.
      const reachable = routes(state, player, prediction);
      const continuing = reachable.find((r) =>
        r.cell === this.shelter && safe(prediction, r.cell, r.at + 1, LOOKAHEAD));
      if (continuing) {
        if (!this.waypointReaches(state, player, prediction, continuing, reachable)) this.waypoint = null;
        const walking = this.followWaypoint(state, player, prediction);
        if (walking) return walking;
        if (continuing.first !== null) return this.walk(state, player, continuing, prediction.tick);
      }
      this.shelter = null;
      this.waypoint = null;
      if (continuing) return { ...IDLE };
    }

    if (!safe(prediction, cell, offset + 1, LOOKAHEAD)) {
      const reachable = routes(state, player, prediction), destination = this.goal;
      // A future blast lane can still be crossed before ignition. Replacing that
      // timed route with a new refuge on every tile entry sends us back and forth.
      const continuing = destination && destination.until >= state.tick
        ? reachable.find((r) => r.cell === destination.cell && safe(prediction, r.cell, r.at + 1, LOOKAHEAD))
        : undefined;
      const escape = continuing ?? refuge(state, player, prediction, reachable);
      this.shelter = escape?.cell ?? null;
      if (!continuing) this.goal = null;
      if (escape?.first != null) return this.walk(state, player, escape, prediction.tick);
      // A glove can remove the bomb underfoot before using a limited evasion charge.
      if (!player.actionLatch && player.inv.glove && !player.inv.line && hasBomb(state, cell)) {
        const thrown = combatPlan(state, player, prediction, { dir: player.dir, bomb: true });
        if (thrown) return this.commit(state, thrown);
      }
      if (!player.actionLatch && (player.inv.jump || player.inv.burrow || player.inv.teleport)) {
        const evasion = evadePlan(state, player);
        if (evasion) return this.commit(state, evasion);
        // Wait when an early jump/emergence would land in fire. Imminent danger
        // still warrants the available immunity or an unpredictable teleport.
        if ((player.inv.teleport && !player.inv.jump && !player.inv.burrow) ||
            !safe(prediction, cell, offset + 1, offset + 2)) return { dir: player.dir, bomb: false, evade: true };
      }
      return { ...IDLE };
    }

    if (!player.actionLatch && state.tick - this.lastCombatTick >= COMBAT_TICKS) {
      this.lastCombatTick = state.tick;
      const attacks: CombatPlan[] = [];
      if (player.inv.missile > 0) {
        for (const dir of shotDirections(state, player)) {
          const shot = combatPlan(state, player, prediction, { dir, bomb: false, attack: true });
          if (shot && shot.value >= 6) attacks.push(shot);
        }
      } else if (state.bombs.some((b) => b.owner === player.id && !b.exploded &&
        (b.kind === BombKind.Timer || b.kind >= BombKind.Water) && nowMs(state.tick) - b.placedMs >= 500)) {
        const detonation = combatPlan(state, player, prediction, { dir: null, bomb: false, attack: true });
        if (detonation) attacks.push(detonation);
      }
      const ownBombs = state.bombs.filter((b) => b.owner === player.id).length;
      if ((centred(state, player, cell) || (player.anim >= Anim.Stand && player.anim < Anim.Jump)) &&
          state.tick - this.lastBombTick >= COMBAT_TICKS &&
          player.status.noBomb === null &&
          (ownBombs < player.bombCapacity || (hasBomb(state, cell) && (player.inv.line || player.inv.glove)))) {
        let placedPlan = false;
        for (const dir of player.inv.line ? DIRS : [null]) {
          const placed = combatPlan(state, player, prediction, { dir, bomb: true });
          if (placed) { attacks.push(placed); placedPlan = true; }
        }
        // A rejected firing position must not keep beating every movement goal.
        if (!placedPlan) this.refused.set(cell, state.tick + 30);
      }
      attacks.sort((a, b) => b.value - a.value);
      if (attacks[0]) return this.commit(state, attacks[0]);
    }

    const walking = this.followWaypoint(state, player, prediction);
    if (walking) return walking;
    for (const [position, until] of this.refused) if (until < state.tick) this.refused.delete(position);
    const choice = chooseGoal(state, player, prediction, routes(state, player, prediction), this.goal, this.refused);
    this.goal = choice?.goal ?? null;
    if (!choice) return { ...IDLE };
    const route = choice.route;
    // A reached destination needs a released key. The final walk frame can stop
    // off centre; repeatedly correcting it starts another walk instead of settling.
    return route.first === null ? { ...IDLE } : this.walk(state, player, route, prediction.tick);
  }

  private commit(state: MatchState, plan: CombatPlan): InputFrame {
    this.goal = null;
    this.shelter = plan.escape?.cell ?? null;
    this.waypoint = plan.escape?.first ?? null;
    this.depart = plan.depart;
    this.prediction = null;
    this.lastBombTick = state.tick;
    if (plan.followup) this.followup = { action: plan.followup, until: state.tick + 3 };
    return plan.input;
  }

  private followWaypoint(state: MatchState, player: PlayerState, prediction: Forecast): InputFrame | null {
    if (this.waypoint === null) return null;
    const cell = playerCell(state, player)!, target = this.waypoint, at = centre(state, target);
    const offset = state.tick - prediction.tick;
    const duration = Math.ceil((Math.abs(at.x - player.x) + Math.abs(at.y - player.y)) / player.speed) + 2;
    if (state.tick < this.depart && safe(prediction, cell, offset + 1, offset + this.depart - state.tick)) return { ...IDLE };
    if (!centred(state, player, target) && safe(prediction, cell, offset + 1, offset + Math.ceil(duration / 2)) &&
        safe(prediction, target, offset + 1, offset + duration + 2, target !== cell)) {
      return { dir: steer(state, player, target), bomb: false };
    }
    this.waypoint = null;
    return null;
  }

  private waypointReaches(state: MatchState, player: PlayerState, prediction: Forecast, destination: Route, reachable: Route[]): boolean {
    const waypoint = this.waypoint;
    if (waypoint === null || waypoint === playerCell(state, player) || waypoint === destination.first) return true;
    const arrival = reachable.find((route) => route.cell === waypoint && route.first === waypoint);
    if (!arrival) return false;
    // A locally safe leg can enter a pocket whose only exit was just bombed.
    // Preserve the leg only while it still leads to the chosen refuge.
    const visitor = { ...player, ...centre(state, waypoint) };
    const delay = arrival.at - (state.tick - prediction.tick);
    return routes(state, visitor, prediction, delay).some((route) =>
      route.cell === destination.cell && safe(prediction, route.cell, route.at + 1, LOOKAHEAD));
  }

  private stopSafely(state: MatchState, player: PlayerState, input: InputFrame): InputFrame {
    if (input.dir !== null || input.bomb || input.attack || input.evade || player.anim >= Anim.Stand) return input;
    // Releasing a direction is a stop request, not an immediate stop. Check the actual
    // remaining walk frames before waiting beside fire; turn back if they would burn us.
    const trial = predictionState(state, player.id);
    const actor = trial.players.find((p) => p.id === player.id)!;
    for (let tick = 0; tick < 12 && actor.alive && actor.anim < Anim.Stand && trial.phase === "playing"; tick++) {
      step(trial, { [actor.id]: IDLE });
    }
    // Fire is checked before movement, so a final walking frame can land in fire
    // while still alive. Include the following standing frame's check as well.
    if (actor.alive && trial.phase === "playing") step(trial, { [actor.id]: IDLE });
    const end = playerCell(trial, actor), start = playerCell(state, player);
    const drifting = this.prediction && end !== null && end !== start &&
      !safe(this.prediction, end, trial.tick - this.prediction.tick + 1, LOOKAHEAD);
    return actor.alive && !drifting ? input : { ...IDLE, dir: ((player.dir + 2) % 4) as Dir };
  }

  private walk(state: MatchState, player: PlayerState, route: Route, tick: number): InputFrame {
    this.waypoint = route.first;
    this.depart = tick + route.depart;
    return { dir: state.tick < this.depart || route.first === null ? null : steer(state, player, route.first), bomb: false };
  }
}
