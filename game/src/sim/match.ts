import {
  animDue,
  COUNTDOWN_MS,
  DEATH_FPS,
  FADE_OUT_FRAMES,
  HURRY_SECONDS,
  LONG_AGO_MS,
  MATCH_RESULT_MS,
  MAX_PLAYERS,
  nowMs,
  PRACTICE_SPAWN_DY,
  ROUND_RESULT_MS,
  SPAWN_DX,
  SPAWN_DY,
  START_BOMBS,
  START_FIRE,
  START_SPEED,
  WAIT_MS,
  walkFps,
} from "./constants.ts";
import { attackAction, spaceAction, updateBombs } from "./bomb.ts";
import { updateEffects } from "./effects.ts";
import { emergeWhenDue, endEmerge, evadeAction, flyTeleport } from "./evade.ts";
import { cellTopLeft, playerCell } from "./grid.ts";
import { resetObjects, updateObjects } from "./mapObjects.ts";
import { dropCapsule } from "./summon.ts";
import { isTeamMode } from "./modes.ts";
import { movePlayer } from "./movement.ts";
import { emptyInventory, noStatus } from "./pickup.ts";
import { expireStatus, holdSlow, resetAbilities, startBlind, startReverse, startSlow } from "./status.ts";
import {
  BURROW_FPS,
  BURROW_FRAMES,
  deathFrames,
  JUMP_FPS,
  JUMP_FRAMES,
  KICK_FRAMES,
  kickFps,
  STAND_FRAMES,
  standFps,
  THROW_FPS,
  THROW_FRAMES,
  WALK_FRAMES,
} from "./sheets.ts";
import type { InputFrame, LevelLayout, MatchState, PlayerSetup, PlayerState, Rules } from "./types.ts";
import { Anim, Dir } from "./types.ts";
import { msvcRand, srandTime } from "./rng.ts";
import { applySuddenDeath, rollHiddenItems, scatterItems, updateBricks, updateSuddenDeath } from "./world.ts";

/**
 * Each player's keys this frame. `null`: the input poll did not run (0x458750 returns before the
 * player's part under practice's box, F1 help or chat line), so the player is left as it was.
 */
export type InputMap = Readonly<Record<number, InputFrame | null | undefined>>;

/**
 * `clockMs` is the host's wall clock at tick 0, which the reseeds read (srand(time(0))); by
 * default the clock's second is the seed, so the first world load draws as a plain seed would.
 */
export function createMatch(layout: LevelLayout, setups: PlayerSetup[], rules: Rules, seed: number, clockMs = seed * 1000): MatchState {
  const slots = setups.map((setup, index) => setup.slot ?? index);
  const needed = layout.rollSpawns ? setups.length : Math.max(0, ...slots.map((slot) => slot + 1));
  if (needed > layout.spawns.length) {
    throw new Error(`level ${layout.id} has ${layout.spawns.length} spawns for ${needed} slots`);
  }
  const state: MatchState = {
    tick: 0,
    phase: "waiting",
    phaseTick: 0,
    round: 0,
    rules,
    layout,
    grid: [],
    flame: [],
    hidden: [],
    players: setups.map((setup, index) => ({
      id: setup.id,
      slot: slots[index],
      name: setup.name,
      character: setup.character,
      team: setup.team ?? 0,
      x: 0,
      y: 0,
      dir: Dir.Down,
      anim: Anim.Stand,
      frame: 0,
      animMs: 0,
      stopRequested: false,
      alive: true,
      gone: false,
      bombCapacity: START_BOMBS,
      firePower: START_FIRE,
      speed: START_SPEED,
      medals: 0,
      actionLatch: false,
      bombPass: false,
      lastCell: 0,
      inv: emptyInventory(),
      status: noStatus(),
      savedSpeed: START_SPEED,
      badState: null,
      burrowMs: 0,
      flight: null,
      candy: 0,
      dummy: false,
    })),
    spawnPoints: Array.from({ length: MAX_PLAYERS }, () => -1),
    bombs: [],
    hiddenOwners: [],
    lingering: [],
    localMark: null,
    bombSprites: [],
    effects: [],
    effectSprites: [],
    breaking: [],
    items: [],
    itemBitCleared: [],
    objects: [],
    timerSeconds: rules.roundSeconds,
    timerMs: LONG_AGO_MS,
    hurried: false,
    suddenDeath: { placed: 0, active: false, lastMs: LONG_AGO_MS },
    rng: seed >>> 0,
    clockMs,
    nextBombId: 1,
    lastGoneId: null,
    lastGoneTeam: 0,
    roundWinnerId: null,
    roundWinnerTeam: null,
    draw: false,
    matchWinnerId: null,
    matchWinnerTeam: null,
    events: [],
  };
  startRound(state, 1);
  return state;
}

/** Milliseconds since the current phase began. */
export function phaseElapsedMs(state: MatchState): number {
  return nowMs(state.tick) - nowMs(state.phaseTick);
}

/** Countdown number on screen: 3, 2, 1, then 0 for START (0x40c85b: (start + 4000 - now) / 1000). */
export function countdownValue(state: MatchState): number {
  return countdownAt(state, state.tick);
}

function countdownAt(state: MatchState, tick: number): number {
  return Math.trunc((COUNTDOWN_MS - (nowMs(tick) - nowMs(state.phaseTick))) / 1000);
}

/** Advance one logic frame. Mutates `state`; `state.events` holds only this frame's events. */
export function step(state: MatchState, inputs: InputMap): void {
  state.events = [];
  state.tick += 1;
  const elapsed = phaseElapsedMs(state);

  // The wait and countdown screens take no keys: the input poll returns before the players
  // (0x45aea1-0x45aec2), so a key held there leaves the action latch as it was.
  switch (state.phase) {
    case "waiting":
      if (elapsed >= WAIT_MS) setPhase(state, "countdown");
      break;
    case "countdown":
      // The countdown starts under a fade (0x460950): the field stands still while it darkens,
      // the switch's own frame being the first of the darkening.
      if (state.tick - state.phaseTick >= FADE_OUT_FRAMES) animateObjects(state);
      if (countdownAt(state, state.tick) === 0 && countdownAt(state, state.tick - 1) !== 0) {
        state.events.push({ type: "start-shown" });
      }
      if (elapsed >= COUNTDOWN_MS) {
        setPhase(state, "playing");
        state.events.push({ type: "go" });
      }
      break;
    case "playing":
      applyInputs(state, inputs);
      updateClock(state);
      if (state.phase !== "playing") break;
      // The object passes are drawn between these (0x4090b8, 0x409128, 0x40c183).
      updateObjects(state, 0);
      // Practice never draws or applies the sudden-death blocks (0x4014c0 is network only).
      if (!state.rules.practice) {
        updateSuddenDeath(state);
        applySuddenDeath(state);
      }
      updateBricks(state);
      updateObjects(state, 1);
      updateBombs(state);
      updatePlayers(state);
      updateEffects(state);
      updateObjects(state, 2);
      break;
    case "round-over":
      if (elapsed >= ROUND_RESULT_MS) startRound(state, state.round + 1);
      break;
    case "match-over":
      break;
  }
}

/**
 * The countdown is drawn over the game screen (0x40c85b), so objects animate under it; the wait
 * screen before it returns before the field (0x408e61).
 */
function animateObjects(state: MatchState): void {
  for (let sheet = 0; sheet < 3; sheet++) updateObjects(state, sheet);
}

function setPhase(state: MatchState, phase: MatchState["phase"]): void {
  state.phase = phase;
  state.phaseTick = state.tick;
}

const Action = { None: 0, Bomb: 1, Attack: 2, Evade: 3 } as const;
type Action = (typeof Action)[keyof typeof Action];

/** getAction (0x4024e0): one action per frame, key 1 (Space) > key 2 (Left Ctrl) > key 3 (Z). */
function actionOf(input: InputFrame | null | undefined): Action {
  if (input?.bomb) return Action.Bomb;
  if (input?.attack) return Action.Attack;
  if (input?.evade) return Action.Evade;
  return Action.None;
}

/**
 * Input poll (0x458750): facing and walk/stand state change at once; an action runs once per
 * press (0x45b5bf). The keys of a player in teleport flight (0x45af34), underground or coming up
 * (0x45af5f) or frozen (0x45af71) are not handled at all. During a jump the keys read as
 * released (0x4021bb); during a throw only the action keys are read (actionKeysRead); during a
 * kick a direction turns the kick.
 */
function applyInputs(state: MatchState, inputs: InputMap): void {
  for (const player of state.players) {
    const pressed = inputs[player.id];
    if (pressed === null) continue;
    // A dying player is hidden (0x462050), so the poll returns before the keys (0x45af4a) and the
    // latch stays. Once the death has ended the poll reads no key (0x4021bb: the death state is past
    // the walk, stand and kick groups), so the action is none and the latch goes (0x45b5d7).
    if (player.gone) {
      player.actionLatch = false;
      continue;
    }
    if (!player.alive) continue;
    if (player.flight !== null || player.anim >= Anim.Burrow || player.status.frozen !== null) continue;
    const input = keysRead(player) ? pressed : undefined;
    const action = actionOf(actionKeysRead(player) ? pressed : undefined);
    if (input?.dir != null) {
      // Reversed controls swap up/down and left/right (tables 0x45d0e4, 0x45d0f4).
      const dir = player.status.reverse === null ? input.dir : (((input.dir + 2) % 4) as Dir);
      player.dir = dir;
      setAnim(player, (isKicking(player) ? Anim.Kick : Anim.Walk) + dir);
    } else if (isWalking(player)) {
      player.stopRequested = true;
    }
    if (action === Action.None) player.actionLatch = false;
    else if (!player.actionLatch) runAction(state, player, action);
  }
}

/** 0x4021bb: keys are read in the walk, stand and kick groups only. */
function keysRead(player: PlayerState): boolean {
  return player.anim < Anim.Jump || isKicking(player);
}

/**
 * RECONSTRUCTION (FIDELITY §8): the action keys are also read during a throw animation. 0311
 * reads no key there (0x4021bb; Shake1 and the 2002-02 Shake 2nd build alike), but the service's
 * later builds did: letsgame's 2004 technique videos fire a 직격탄 against a wall and jump or
 * throw it right after (vod_16 "0칸 계열정리", vod_15 "미던 계열 정리"). A key held through the
 * animation keeps the latch set, so Z pressed while Left Ctrl is still down does nothing (0311,
 * reading nothing, let the latch go there and acted on a held key once the animation ended).
 */
function actionKeysRead(player: PlayerState): boolean {
  return keysRead(player) || isThrowing(player);
}

/** The action handlers of 0x45b5bf (table 0x45d104): each sets the latch unless a curse swallowed the press. */
function runAction(state: MatchState, player: PlayerState, action: Action): void {
  let handled = true;
  if (action === Action.Bomb) handled = spaceAction(state, player);
  else if (action === Action.Attack) handled = attackAction(state, player);
  else if (action === Action.Evade) handled = evadeAction(state, player);
  if (handled) player.actionLatch = true;
}

function isWalking(player: PlayerState): boolean {
  return player.anim >= Anim.Walk && player.anim < Anim.Walk + 4;
}

function isJumping(player: PlayerState): boolean {
  return player.anim >= Anim.Jump && player.anim < Anim.Jump + 4;
}

function isKicking(player: PlayerState): boolean {
  return player.anim >= Anim.Kick && player.anim < Anim.Kick + 4;
}

function isThrowing(player: PlayerState): boolean {
  return player.anim >= Anim.Throw && player.anim < Anim.Throw + 4;
}

/** setState (0x461ff0): the frame restarts only when the animation group changes. */
function setAnim(player: PlayerState, anim: number): void {
  if (Math.floor(anim / 4) !== Math.floor(player.anim / 4)) player.frame = 0;
  player.anim = anim;
}

/** Round clock (0x457440): one second off every >= 1000 ms; the first playing frame already takes one. */
function updateClock(state: MatchState): void {
  const now = nowMs(state.tick);
  if (now - state.timerMs < 1000) return;
  state.timerMs = now;
  if (state.timerSeconds > 0) {
    state.timerSeconds -= 1;
    if (state.timerSeconds <= HURRY_SECONDS && !state.hurried && !state.rules.practice) {
      state.hurried = true;
      state.events.push({ type: "hurry" });
    }
    return;
  }
  timeOut(state);
}

/**
 * The player loop starts by clearing every cell's occupancy bits (0x45e9a0: practice 0x407b6c,
 * network 0x40a952); each player then sets its own after its update, so a player later in the
 * loop sees the earlier ones where they now stand. The network game updates the local player
 * last; the server's analogue is every other player in its current cell. Practice sets the
 * local player's bit where the last dummy stands (MatchState.localMark).
 */
function updatePlayers(state: MatchState): void {
  const now = nowMs(state.tick);
  state.hiddenOwners = [];
  state.lingering = [];
  clearLocalMark(state);
  for (const player of state.players) {
    if (state.phase !== "playing") return;
    if (player.gone) continue;
    if (!player.alive) {
      advanceDeath(state, player, now);
    } else {
      updatePlayer(state, player, now);
      const cell = playerCell(state, player);
      const kind = cell === null ? 0 : state.flame[cell];
      if (kind > 0 && !fireproof(player)) burnPlayer(state, player, kind, now);
    }
    placeLocalMark(state, player);
  }
}

function clearLocalMark(state: MatchState): void {
  if (!state.localMark) return;
  state.localMark.placed = false;
  state.localMark.entered = null;
}

/**
 * The end of a practice loop iteration: each dummy leaves its position in the static the local
 * player's set reads (0x407fd2, 0x407e53); the local player's set (0x40840a) then uses it.
 */
function placeLocalMark(state: MatchState, player: PlayerState): void {
  const mark = state.localMark;
  if (!mark) return;
  if (player.id === mark.playerId) mark.placed = true;
  else if (player.dummy) Object.assign(mark, { x: player.x, y: player.y });
}

/**
 * +0x184 follows the cell after every move with collision (0x452b93); a move that leaves it
 * clears the old cell's bit and sets the new one (0x450230: 0x4504b6, 0x450654, 0x4507f9,
 * 0x451021). Only the practice local player's bit is not already in its own cell.
 */
function noteLocalCell(state: MatchState, player: PlayerState): void {
  const mark = state.localMark;
  if (mark?.playerId !== player.id) return;
  const cell = playerCell(state, player) ?? -1;
  if (cell !== mark.lastCell) mark.entered = cell;
  mark.lastCell = cell;
}

/**
 * The flame kind under the centre point (practice 0x407d0b and 0x408144; network 0x40d2b0):
 * kind 1 kills; the water family's 2-5 reset the items, slow, blind or reverse the controls,
 * again every update the player stands in them, dummies too. The network game gates the repeat
 * (0x40d379, 0x40d3b9), but only practice has these bombs.
 */
function burnPlayer(state: MatchState, player: PlayerState, kind: number, now: number): void {
  switch (kind) {
    case 1:
      return kill(state, player);
    case 2:
      return resetAbilities(player, now);
    case 3:
      return startSlow(player, now);
    case 4:
      return startBlind(player, now);
    case 5:
      return startReverse(player, now);
  }
}

/** The death check is skipped behind the egg, in teleport flight, underground and coming up, and mid-jump (0x40d2c9-0x40d310). */
function fireproof(player: PlayerState): boolean {
  return (
    player.status.shield !== null ||
    player.flight !== null ||
    player.anim === Anim.Burrow ||
    player.anim === Anim.Emerge ||
    isJumping(player)
  );
}

/**
 * The player update (0x4525c0): the slow curse, the state timers, then (unless frozen while
 * walking) the animation and the move. A walk moves every update; a jump moves only when its
 * frame advances, including the last advance that lands it (0x45290d). A teleport flight
 * replaces the move; kick, throw and later animations do no collision at all (0x452b2f).
 */
function updatePlayer(state: MatchState, player: PlayerState, now: number): void {
  const slowFps = holdSlow(player, now, player.anim < Anim.Jump);
  expireStatus(player, now);
  emergeWhenDue(state, player, now);
  if (player.status.frozen !== null && isWalking(player)) return;
  const walked = isWalking(player);
  const jumped = isJumping(player);
  const dir = (player.anim % 4) as Dir;
  const advanced = advanceAnimation(state, player, now, slowFps);
  if (player.flight !== null) {
    flyTeleport(player);
    return;
  }
  if (player.anim >= Anim.Kick) return;
  let step = 0;
  if (walked) step = player.speed;
  else if (jumped && advanced) step = dir === Dir.Down || dir === Dir.Up ? JUMP_STEP_ALONG : JUMP_STEP_ACROSS;
  movePlayer(state, player, step);
  player.lastCell = playerCell(state, player) ?? -1;
  noteLocalCell(state, player);
}

/** A jump moves 5 px up or down or 6 px sideways a frame (table 0x452bb4): 12 frames, about two cells. */
const JUMP_STEP_ALONG = 5;
const JUMP_STEP_ACROSS = 6;

/**
 * 0x4525c0: walking frames speed up with speed; a finished walk cycle is a footstep; a finished
 * jump, kick or throw returns to standing in its direction (0x4527fd). Underground holds the
 * last frame; coming up ends facing down. A stop request takes effect here once the player is in
 * a walk or stand state (0x452897), standing in the direction the update started with (0x4528a8):
 * up when coming up ends it (0x16 & 3). Returns whether the frame advanced.
 */
function advanceAnimation(state: MatchState, player: PlayerState, now: number, slowFps: number | null): boolean {
  const walking = isWalking(player);
  const [timingFps, frames] = animTiming(player);
  const fps = slowFps ?? timingFps;
  if (!animDue(now, player.animMs, fps)) return false;
  const startDir = player.anim % 4;
  player.animMs = now;
  player.frame += 1;
  if (player.frame >= frames) {
    if (player.anim === Anim.Burrow) {
      player.frame = frames - 1;
    } else if (player.anim === Anim.Emerge) {
      player.frame = 0;
      endEmerge(player);
    } else {
      player.frame = 0;
      if (walking) state.events.push({ type: "walk-cycle", playerId: player.id });
      if (player.anim >= Anim.Jump) player.anim = Anim.Stand + (player.anim % 4);
    }
  }
  if (player.stopRequested && player.anim < Anim.Jump) {
    player.stopRequested = false;
    player.anim = Anim.Stand + startDir;
    player.frame = 0;
  }
  return true;
}

function animTiming(player: PlayerState): [fps: number, frames: number] {
  if (isWalking(player)) return [walkFps(player.speed), WALK_FRAMES];
  if (isJumping(player)) return [JUMP_FPS, JUMP_FRAMES];
  if (player.anim === Anim.Burrow || player.anim === Anim.Emerge) return [BURROW_FPS, BURROW_FRAMES];
  if (isKicking(player)) return [kickFps(player.character, player.anim % 4), KICK_FRAMES];
  if (isThrowing(player)) return [THROW_FPS, THROW_FRAMES];
  return [standFps(player.character), STAND_FRAMES];
}

function kill(state: MatchState, player: PlayerState): void {
  player.alive = false;
  player.stopRequested = false;
  player.anim = Anim.Death;
  player.frame = 0;
  // The local player's death start is the one place practice points the static at it (0x40829c).
  if (state.localMark?.playerId === player.id) Object.assign(state.localMark, { x: player.x, y: player.y });
  // The network game counts the player out as the death starts (0x40afb4, a remote death 0x45da9b).
  if (!state.rules.practice) markGone(state, player);
  state.events.push({ type: "death", playerId: player.id });
}

/**
 * Death animation; when it wraps the player drops a 소환 capsule and its items and the round is
 * decided (0x407ebe, 0x40d4d0, 0x44ea40).
 */
function advanceDeath(state: MatchState, player: PlayerState, now: number): void {
  if (!animDue(now, player.animMs, DEATH_FPS)) return;
  player.animMs = now;
  player.frame += 1;
  if (player.frame < deathFrames(player.character)) return;
  player.frame = 0;
  player.gone = true;
  // Practice still sets the bit on this frame (0x407f4d, 0x4083ad); the network game clears the
  // slot's bits at once (0x45e8a0 at 0x40ad4d, 0x40b7be).
  if (state.rules.practice) {
    state.lingering.push(player.id);
    markGone(state, player);
  }
  dropCapsule(state, player);
  scatterItems(state, player);
  decideRound(state);
}

/** 0x441110: the round's last player out (room +0x938), by a death's start or by leaving (0x4408b2). */
function markGone(state: MatchState, player: PlayerState): void {
  state.lastGoneId = player.id;
  state.lastGoneTeam = player.team;
}

/**
 * 0x441130, at each death animation's end and each leave. It counts only the players not out
 * (+0x27c clear), so one whose death has started but not ended is out already. Practice has no
 * rounds: the box comes up when the local player's death ends (0x4083be) or no dummy is left
 * (0x407b02), and the game runs on under it.
 */
function decideRound(state: MatchState): void {
  if (state.rules.practice) {
    const gone = state.players.find((p) => p.id === state.lastGoneId);
    if (!gone?.dummy || !state.players.some((p) => !p.gone && p.dummy)) state.events.push({ type: "practice-over" });
    return;
  }
  const remaining = state.players.filter((p) => p.alive);
  if (isTeamMode(state.rules.mode)) decideTeamRound(state, remaining);
  else decideIndividualRound(state, remaining);
}

/**
 * Individual modes: with one player left that player wins; with none, the last player out.
 * The match ends on the winner's third medal, or when only one player is left in the room: that
 * one wins before the out flags are read (0x4412cc), dying or not.
 */
function decideIndividualRound(state: MatchState, remaining: PlayerState[]): void {
  const alone = state.players.length === 1 ? state.players[0] : undefined;
  if (!alone && remaining.length > 1) return;
  const winner = alone ?? state.players.find((p) => p.id === (remaining.length === 1 ? remaining[0].id : state.lastGoneId));
  state.roundWinnerId = winner?.id ?? null;
  if (winner) winner.medals += 1;
  const over = winner !== undefined && (winner.medals >= state.rules.medalsToWin || state.players.length === 1);
  finishRound(state, over, winner?.id ?? null, null);
}

/**
 * Team modes: the round is over once every player still standing is on one team; with nobody
 * standing, the last player out's team wins. Every member of the winning team gets a medal, dead
 * or not (0x4410c0). The match ends on the team's third win, or when every player left in the
 * room is on the winning team.
 */
function decideTeamRound(state: MatchState, remaining: PlayerState[]): void {
  const teams = new Set(remaining.map((p) => p.team));
  if (teams.size > 1) return;
  const team = remaining.length > 0 ? remaining[0].team : state.lastGoneTeam;
  state.roundWinnerTeam = team;
  const members = state.players.filter((p) => p.team === team);
  for (const member of members) member.medals += 1;
  const wins = members[0]?.medals ?? 0;
  const over = wins >= state.rules.medalsToWin || state.players.every((p) => p.team === team);
  finishRound(state, over, null, team);
}

/**
 * Time up (0x409043 → 0x44f110): a draw, no medal, never the end of the match. Practice goes
 * straight to the my-info screen instead (0x406224-0x40622b).
 */
function timeOut(state: MatchState): void {
  if (state.rules.practice) {
    setPhase(state, "match-over");
    state.events.push({ type: "practice-time-up" });
    return;
  }
  state.draw = true;
  state.roundWinnerId = null;
  state.roundWinnerTeam = null;
  setPhase(state, "round-over");
  state.events.push({ type: "round-over", winnerId: null, winnerTeam: null });
}

function finishRound(state: MatchState, matchOver: boolean, winnerId: number | null, winnerTeam: number | null): void {
  if (matchOver) {
    state.matchWinnerId = winnerId;
    state.matchWinnerTeam = winnerTeam;
    setPhase(state, "match-over");
    state.events.push({ type: "match-over", winnerId, winnerTeam });
    return;
  }
  setPhase(state, "round-over");
  state.events.push({ type: "round-over", winnerId, winnerTeam });
}

/**
 * A player who leaves is out of the match for good. Mid-round the leaver becomes the last player
 * out (0x4408b2) and the round is judged again (0x44f341), so the last one standing wins it. On the
 * wait screen the original only frees the slot (0x44f17f) and the leaver's figure times out 5 s
 * into play (0x40bf0d); the server has no such figure and judges at once (R). In
 * the countdown and in play the leaver first drops what a death drops, unless its death animation
 * already did (0x44f2d1).
 * On the round's result screen the round is already judged; the match still ends when one player,
 * or one team, is all the room has left (0x441130), with no medal more (I).
 */
export function removePlayer(state: MatchState, playerId: number): void {
  const leaver = state.players.find((p) => p.id === playerId);
  if (!leaver) return;
  state.players = state.players.filter((p) => p !== leaver);
  if (state.phase === "waiting" || state.phase === "countdown" || state.phase === "playing") {
    if (state.phase !== "waiting" && !leaver.gone) {
      dropCapsule(state, leaver);
      scatterItems(state, leaver);
    }
    markGone(state, leaver);
    decideRound(state);
  } else if (state.phase === "round-over" && !state.rules.practice) {
    endWhenAlone(state);
  }
}

function endWhenAlone(state: MatchState): void {
  const [first] = state.players;
  if (isTeamMode(state.rules.mode)) {
    if (state.players.every((p) => p.team === first?.team)) finishRound(state, true, null, first?.team ?? null);
  } else if (state.players.length <= 1) {
    finishRound(state, true, first?.id ?? null, null);
  }
}

/** How long the final result screen stays up before returning to the room (0x410560). */
export function matchResultDone(state: MatchState): boolean {
  return state.phase === "match-over" && phaseElapsedMs(state) >= MATCH_RESULT_MS;
}

/** Practice skips the wait and the countdown: the keys work from the first frame (0x45aec8). */
function startRound(state: MatchState, round: number): void {
  state.round = round;
  setPhase(state, state.rules.practice ? "playing" : "waiting");
  state.roundWinnerId = null;
  state.roundWinnerTeam = null;
  state.draw = false;
  state.lastGoneId = null;
  state.lastGoneTeam = 0;
  state.grid = state.layout.kinds.slice();
  state.flame = state.grid.map(() => 0);
  state.bombs = [];
  state.hiddenOwners = [];
  state.lingering = [];
  clearLocalMark(state);
  state.bombSprites = [];
  state.effects = [];
  state.effectSprites = [];
  state.breaking = [];
  state.items = [];
  state.itemBitCleared = [];
  resetObjects(state);
  // The world load reseeds (0x44d77c) before the host draws the spawns and again before the brick
  // items (0x44e2a0); practice loads through its own loader, which seeds once (0x4542e4).
  if (!state.rules.practice) srandTime(state, nowMs(state.tick));
  if (state.layout.rollSpawns) drawSpawns(state);
  state.timerSeconds = state.rules.roundSeconds;
  state.timerMs = LONG_AGO_MS;
  state.hurried = false;
  state.suddenDeath = { placed: 0, active: false, lastMs: LONG_AGO_MS };
  if (!state.rules.practice) srandTime(state, nowMs(state.tick));
  rollHiddenItems(state);
  for (const player of state.players) resetPlayer(state, player);
  state.events.push({ type: "round-start", round });
}

/**
 * The words the host's comparison reads past the six slot entries (0x44dd8c-0x44dd99 runs to
 * 0x471724): 0x47171c holds a flag byte under three bytes a static initializer sets (0x4028a0,
 * so never 0..7), and 0x471720 is never written (zero-filled .bss). So point 0 never comes up.
 */
const TABLE_TAIL = [0] as const;

/**
 * The host's draw at each round's map load (0x44dd79-0x44dda2): per slot in order, rand() % 8
 * until the point is in no slot's entry nor the table's tail. The six entries are cleared only
 * when the match starts (0x4571a0), so a player never gets a point that any slot held last round.
 */
function drawSpawns(state: MatchState): void {
  const points = state.layout.spawns.length;
  for (const player of state.players) {
    let point: number;
    do point = msvcRand(state) % points;
    while (state.spawnPoints.includes(point) || (TABLE_TAIL as readonly number[]).includes(point));
    state.spawnPoints[player.slot] = point;
  }
}

function resetPlayer(state: MatchState, player: PlayerState): void {
  const { spawns, rollSpawns } = state.layout;
  const spawn = cellTopLeft(state, spawns[rollSpawns ? state.spawnPoints[player.slot] : player.slot]);
  player.x = spawn.x + SPAWN_DX;
  player.y = spawn.y + (state.rules.practice ? PRACTICE_SPAWN_DY : SPAWN_DY);
  // The sim does not update players before play starts. A network game's have stood on their
  // spawns through the countdown (I); practice builds its players at each start, and the
  // constructor leaves +0x184 at 0 (0x461f02) until the first update.
  player.lastCell = state.rules.practice ? 0 : (playerCell(state, player) ?? -1);
  player.dir = Dir.Down;
  player.anim = Anim.Stand + Dir.Down;
  player.frame = 0;
  player.animMs = nowMs(state.tick);
  player.stopRequested = false;
  player.alive = true;
  player.gone = false;
  player.bombCapacity = START_BOMBS;
  player.firePower = START_FIRE;
  player.speed = START_SPEED;
  player.bombPass = false;
  player.inv = emptyInventory();
  player.status = noStatus();
  player.savedSpeed = START_SPEED;
  player.badState = null;
  player.burrowMs = 0;
  player.flight = null;
}
