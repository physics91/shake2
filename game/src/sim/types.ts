/** Facing / movement direction; order matches the character sprite animation order (front, left, back, right). */
export const Dir = { Down: 0, Left: 1, Up: 2, Right: 3 } as const;
export type Dir = (typeof Dir)[keyof typeof Dir];

export const CellKind = { Empty: 0, Fixed: 1, Brick: 2 } as const;
export type CellKind = (typeof CellKind)[keyof typeof CellKind];

/**
 * Item kinds: the item type of shake.exe (pickup table 0x451618) and the animation index in
 * item.spr. Mine to panda are only laid out by practice (0x455000); the others are the ones a
 * network game can make (item constructor callers of 0x441c30).
 */
export const ItemKind = {
  Bomb: 0,
  Fire: 1,
  Speed: 2,
  Glove: 3,
  Kick: 4,
  Jump: 5,
  Nuke: 6,
  Power: 7,
  Missile: 8,
  Timer: 9,
  Line: 10,
  Mystery: 11,
  Switch: 12,
  Teleport: 14,
  Double: 15,
  Burrow: 17,
  Shake: 19,
  XBomb: 20,
  Mine: 21,
  Pumpkin: 22,
  Tnt: 23,
  Water: 26,
  Poop: 28,
  Apple: 29,
  Panda: 30,
  /** 소환캡슐 0x21: laid by a death in the 소환 modes (0x453270), never rolled. */
  Capsule: 33,
  Candy: 39,
} as const;
export type ItemKind = (typeof ItemKind)[keyof typeof ItemKind];

/** An item as the host stores it per brick: the kind in the low byte, a question mark's sub value in the high byte. */
export type ItemWord = number;

/** Character .spr animation indices used by the simulation (each group has one per direction). */
export const Anim = { Walk: 0, Stand: 4, Jump: 8, Kick: 12, Throw: 16, Death: 20, Burrow: 21, Emerge: 22 } as const;

/**
 * Bomb types (+0x18): the bomb sheet's animation, the rolling one being the next (odd) index.
 * Water, poop, apple and panda (12-18) are the water family: special fire and flame kinds 2-5.
 */
export const BombKind = { Normal: 0, Timer: 2, Nuke: 4, X: 6, Mine: 8, Tnt: 10, Water: 12, Poop: 14, Apple: 16, Panda: 18 } as const;
export type BombKind = (typeof BombKind)[keyof typeof BombKind];

/**
 * One logic frame of a player's keys. The original reads a single action per frame with the
 * priority key 1 > key 2 > key 3 (0x402090): Space places bombs, Left Ctrl uses attack items
 * and Z evasion items (manual "키사용법"; the keys are configurable in the original).
 */
export interface InputFrame {
  dir: Dir | null;
  bomb: boolean;
  attack?: boolean;
  evade?: boolean;
}

/** The action buttons of an input frame. */
export type Buttons = Required<Omit<InputFrame, "dir">>;

/** A brick's crumbling animation (anim 1 of its brick .spr). */
export interface BreakAnim {
  frames: number;
  fps: number;
}

export interface LevelLayout {
  id: string;
  width: number;
  height: number;
  cellW: number;
  cellH: number;
  kinds: CellKind[];
  /** Per cell: crumbling animation of the brick there, null for other cells. */
  breakAnims: (BreakAnim | null)[];
  spawns: number[];
  /** The host draws a spawn point per slot each round (a room map); otherwise slot n takes spawns[n]. */
  rollSpawns: boolean;
  /** Tile flag words per cell: A (raw[4] | raw[5] << 16, tile +8) and B (raw[6] | raw[7] << 16, tile +0xc). */
  tileA: number[];
  tileB: number[];
  /** Map objects in file order, and each cell's object index (raw[2], tile +4; -1 for none). */
  objects: MapObject[];
  objectAt: number[];
}

/** A map object record (loader 0x411198); where it is drawn stays with the map file's rect. */
export interface MapObject {
  cell: number;
  /** Object_A, Object_B or Object_C.spr (record +0xc, the file's unknown_a). */
  sheet: number;
  anim: number;
  /** Record +0xa (the file's kind_flag): loops; otherwise still until triggered, then plays once. */
  loop: boolean;
}

/**
 * A map object this round (records are reloaded with the map every round): its cell (-1 once
 * a sudden-death block covers it, 0x4015ff), frame (+0x10), last advance (+0x14), the loop or,
 * on Object_A anim 14, blast flag (+0xa) and the play-once flag (+0x1a).
 */
export interface ObjectState {
  cell: number;
  frame: number;
  lastMs: number;
  active: boolean;
  play: boolean;
}

export interface PlayerSetup {
  id: number;
  name: string;
  character: string;
  /** Room slot team (+0x74), 1..6; it counts only in the team modes. */
  team?: number;
  /** Room slot 0..5 (+0x6c), which stays put when an earlier player leaves; the setup's index when absent. */
  slot?: number;
}

export interface PlayerState {
  id: number;
  slot: number;
  name: string;
  character: string;
  /** Room slot team (+0x74), 1..6, or 0 when the room gave none. Read only in the team modes. */
  team: number;
  /** Body centre in whole pixels from the play area's top-left. */
  x: number;
  y: number;
  dir: Dir;
  /** Character animation index (0-3 walk, 4-7 stand, 20 death), its frame and last advance time. */
  anim: number;
  frame: number;
  animMs: number;
  /** Direction key released while walking; switches to standing at the next frame advance. */
  stopRequested: boolean;
  alive: boolean;
  /** Death animation finished: the player no longer takes part in the round. */
  gone: boolean;
  bombCapacity: number;
  firePower: number;
  speed: number;
  medals: number;
  /** Action latch (0x48c294): set by an action, cleared only when no action key is down. */
  actionLatch: boolean;
  /** Set on placing a bomb: may move inside and out of a bomb's cell (+0x1b4). */
  bombPass: boolean;
  /**
   * +0x184: the cell after the last move with collision (0x452b93), each walk, stand or jump
   * update; a teleport flight, a kick, a throw or death leaves it. The spawn cell as a round starts.
   */
  lastCell: number;
  /** Special items held (pickup 0x451100). */
  inv: Inventory;
  /** Timed states, by the tick-time (ms) they began; null when off. */
  status: StatusTimers;
  /** Speed to return to when the slow curse ends (+0x1cc). */
  savedSpeed: number;
  /** Dizzy stars over the head (+0x2a8, start +0x2b0, length +0x2ac); null when off. */
  badState: { start: number; length: number } | null;
  /** When the player went underground (+0x278). */
  burrowMs: number;
  /** 순간이동 flight (+0x1c4): phase 1 up, 2 down onto the target (+0x1bc, +0x1c0); null on the ground. */
  flight: { phase: 1 | 2; x: number; y: number } | null;
  /** Candy picked up this match ([0x49285e] counts the local player's). */
  candy: number;
  /** A practice dummy (0x407bb0): no keys, no AI; it stands until a flame takes it. */
  dummy: boolean;
}

/** Special items and their player fields in shake.exe. */
export interface Inventory {
  /** 손 +0x1b5: throw a bomb you stand on. */
  glove: boolean;
  /** 발 +0x1b6: kick bombs. */
  kick: boolean;
  /** 스페셜 +0x1f8: line of bombs from the one you stand on. */
  line: boolean;
  /** 점프 +0x1ac, 순간이동 +0x1b8 (0 or 1) and 버로우 +0x274: the Z key, one of the three. */
  jump: number;
  teleport: number;
  burrow: boolean;
  /** 파워 +0x1fc: bombs with the longest fire, up to the bomb count. */
  power: number;
  /** One special bomb kind at a time: 핵 +0x1b0 (max 3), 직격 +0x1a8 (max 1), 시한 +0x1a4, 엑스 +0x284, TNT +0x288, 지뢰 +0x28c. */
  nuke: number;
  missile: number;
  timer: number;
  xbomb: number;
  tnt: number;
  mine: number;
  /** 더블 +0x1f0 (0 or 1) or 호박 +0x1f4, never both. */
  double: number;
  pumpkin: number;
  /** One of the water family at a time: 물 +0x2a0, 똥 +0x294, 사과 +0x298, 팬더 +0x29c. */
  water: number;
  poop: number;
  apple: number;
  panda: number;
}

/** Start time (ms) of each timed state, null when off. */
export interface StatusTimers {
  /** Question mark 33 (+0x1e0). */
  slow: number | null;
  /** Question mark 35 (+0x1d8). */
  noBomb: number | null;
  /** Question mark 36 (+0x1d0). */
  reverse: number | null;
  /** Egg shield: 쉐이크 or question mark 37 (+0x1e8). */
  shield: number | null;
  /** Question mark 38 (+0x188). */
  invisible: number | null;
  /** Picking up the bomb switch (+0x2b5). */
  frozen: number | null;
  /** Apple flame (+0x264, start +0x268): the screen shows only a window around the player. */
  blind: number | null;
}

export interface BombState {
  id: number;
  owner: number;
  /** Cell under the anchor (+0x9c), followed while the bomb moves. */
  cell: number;
  /** Anchor in play-area pixels (+0x38, +0x3c): (cellX + 20, cellY + 28) at rest. */
  x: number;
  y: number;
  kind: BombKind;
  /** Sheet animation (+0x18: kind, or kind + 1 while rolling), its frame (+0x1c) and last advance (+0x2c). */
  anim: number;
  frame: number;
  frameMs: number;
  power: number;
  /** Fuse start (+0x10), refreshed while the bomb moves, and length (+0x14). */
  placedMs: number;
  fuseMs: number;
  /** 0 at rest, 1-4 rolling and 5-8 flying in direction `motion - 1` / `motion - 5` (+0x28). */
  motion: number;
  /** 직격탄: rolls at double speed and explodes where it stops (+0xa5). */
  fast: boolean;
  /** Player who last kicked or fired it (+0xb4); rolling passes that player's cell. */
  kicker: number | null;
  /** Cells a kicked bomb may still roll before it goes off (+0x40). */
  rollLeft: number;
  /** Blocked ahead: stops or explodes at the next cell centre (+0xe1). */
  braking: boolean;
  /** Flight distance left (+0x50 across, +0x54 up or down) and whether it is the throw or a bounce (+0x4e). */
  flightLeft: number;
  firstFlight: boolean;
  /** 더블: the fire animation runs a second time (+0xac). */
  double: boolean;
  /** 호박: the fire animation loops for 2.5 s from the blast, then runs once more (+0xad). */
  pumpkin: boolean;
  /** TNT: moves left and their direction (+0xd4, +0xd8). */
  tntLeft: number;
  tntDir: Dir;
  /** Set by flame, a remote detonation or the bomb switch; it explodes at its next cell centre (+0xa4). */
  triggered: boolean;
  /** Another fire's end took the bomb bit off its cell (0x407392); it holds a cell again once it rolls into one or lands. */
  bitCleared: boolean;
  exploded: boolean;
  explodedTick: number;
  /** Cells the fire covers, in the order the fire draw writes them. */
  fireCells: number[];
  fireFrame: number;
  /** Last fire frame advance (+0x30); the constructor leaves it at the start of time. */
  fireMs: number;
}

/**
 * An entry of the effect list [0x492740] (constructor 0x401000): a burrow's dust, one-shot, the
 * egg around a shielded player, which follows the player and lasts `lifeMs`, or a revived
 * player's one-shot revival.spr, which follows it.
 */
export interface Effect {
  kind: EffectKind;
  owner: number;
  x: number;
  y: number;
  follow: boolean;
  /** 0 for one-shot (+0x14 = 0): gone after its last frame. */
  lifeMs: number;
  start: number;
  frame: number;
  frameMs: number;
  alive: boolean;
}

export type EffectKind = "ground" | "egg" | "revival";

/** What the effect pass drew this update, before the effects advanced. */
export interface EffectSprite {
  kind: EffectKind;
  x: number;
  y: number;
  frame: number;
}

/**
 * What the bomb loop drew this update, in list order (0x406508): a bomb before it moved, or a
 * fire on all its cells before its frame advanced. A bomb that explodes is not drawn that update.
 */
export type BombSprite =
  | { type: "bomb"; owner: number; x: number; y: number; anim: number; frame: number }
  | { type: "fire"; cells: number[]; anim: number; frame: number };

export interface BreakingBrick {
  cell: number;
  frame: number;
  frames: number;
  fps: number;
  lastMs: number;
  /** Item hidden in the brick, revealed when the animation ends. */
  item: ItemWord | null;
}

export interface ItemState {
  cell: number;
  kind: ItemKind;
  /** A question mark's hidden effect (rand() % 39, item +0x1c); 0 for other kinds. */
  sub?: number;
  tick: number;
  /** Dropped by a dying player: drawn one pixel higher (0x453690). */
  dropped: boolean;
}

export type Phase = "waiting" | "countdown" | "playing" | "round-over" | "match-over";

export type SimEvent =
  | { type: "round-start"; round: number }
  | { type: "start-shown" }
  | { type: "go" }
  | { type: "hurry" }
  | { type: "sudden-death" }
  | { type: "bomb-placed"; cell: number; owner: number }
  | { type: "bomb-kicked"; playerId: number }
  | { type: "bomb-thrown"; playerId: number }
  | { type: "missile-fired"; playerId: number }
  | { type: "jumped"; playerId: number }
  | { type: "teleported"; playerId: number }
  | { type: "warped"; playerId: number }
  | { type: "pad-jumped"; playerId: number }
  | { type: "zone-blast" }
  | { type: "explode"; cell: number }
  | { type: "brick-broken"; cell: number }
  | { type: "item-picked"; playerId: number; kind: ItemKind }
  | { type: "walk-cycle"; playerId: number }
  | { type: "death"; playerId: number }
  /** 소환: a capsule brought this player back (0x453d00). */
  | { type: "revived"; playerId: number }
  /** The winning player in the individual modes, the winning team in the team modes; both null on a draw. */
  | { type: "round-over"; winnerId: number | null; winnerTeam: number | null }
  | { type: "match-over"; winnerId: number | null; winnerTeam: number | null }
  /** Practice: every dummy is gone or the local player's death ended; the box comes up (0x407b02, 0x4083be). */
  | { type: "practice-over" }
  /** Practice: the 150 s ran out; the game leaves for the my-info screen at once (0x40622b). */
  | { type: "practice-time-up" };

/**
 * The room's game mode (+0x14c; names table 0x469954): 0 개인전, 1 자유 팀 매치, 2 매너 팀 매치,
 * 3 화력 개인전, 4 화력 자유 팀매치, 5 화력 매너 팀매치, 6 소환 자유 팀매치, 7 소환 매너 팀매치.
 */
export type GameMode = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;

export interface Rules {
  practice: boolean;
  roundSeconds: number;
  medalsToWin: number;
  mode: GameMode;
}

export interface SuddenDeath {
  /** Bricks placed so far from SUDDEN_DEATH_ORDER. */
  placed: number;
  active: boolean;
  lastMs: number;
}

/**
 * The practice loop sets the local player's bit (0x40840a) at a static position (0x4929a4) that
 * every dummy's update overwrites with its own (0x407fd2) and only the local player's death start
 * points at the local player (0x40829c). A move that changes cells also sets the new cell (0x450230
 * against +0x184).
 */
export interface LocalMark {
  playerId: number;
  /** The static position: (0, 0) at first use (0x406009), then kept from update to update. */
  x: number;
  y: number;
  /** Whether this player loop has set the local player's bit yet (0x45e9a0 clears it first). */
  placed: boolean;
  /** +0x184: the cell after the last move with collision (0x452b93); 0 from the constructor (0x461f02). */
  lastCell: number;
  /** The cell this player loop's move entered, whose bit that move set, or null. */
  entered: number | null;
}

export interface MatchState {
  tick: number;
  phase: Phase;
  /** Tick at which the current phase began. */
  phaseTick: number;
  round: number;
  rules: Rules;
  layout: LevelLayout;
  grid: CellKind[];
  /** Flame kind per cell (tile +0): 1 while a fire or a sudden-death block covers it. */
  flame: number[];
  /** Item hidden under each brick cell, rolled at round start. */
  hidden: (ItemWord | null)[];
  players: PlayerState[];
  /** Spawn point drawn per room slot (0x471704), -1 until drawn; kept from round to round. */
  spawnPoints: number[];
  bombs: BombState[];
  /**
   * Occupancy bits cleared since the last player loop (0x45e9a0 clears all, each player sets its
   * own): a fire's end hides its owner in these cells from the bombs after it in the list.
   */
  hiddenOwners: { cell: number; playerId: number }[];
  /** Practice: players whose death ended since the last player loop still hold their cell. */
  lingering: number[];
  /** Practice: where the local player's occupancy bit goes (null outside practice). */
  localMark: LocalMark | null;
  bombSprites: BombSprite[];
  effects: Effect[];
  effectSprites: EffectSprite[];
  breaking: BreakingBrick[];
  items: ItemState[];
  objects: ObjectState[];
  timerSeconds: number;
  timerMs: number;
  hurried: boolean;
  suddenDeath: SuddenDeath;
  rng: number;
  /** The host's wall clock at tick 0, in ms: what time(0) reads when shake.exe reseeds rand(). */
  clockMs: number;
  nextBombId: number;
  /** Last player whose death animation finished, or who left, this round (room +0x938), and that player's team. */
  lastGoneId: number | null;
  lastGoneTeam: number;
  roundWinnerId: number | null;
  roundWinnerTeam: number | null;
  draw: boolean;
  matchWinnerId: number | null;
  matchWinnerTeam: number | null;
  events: SimEvent[];
}
