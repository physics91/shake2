import { MAX_PLAYERS, nowMs } from "../sim/constants.ts";
import type { InputMap } from "../sim/match.ts";
import { createMatch, matchResultDone, removePlayer, step } from "../sim/match.ts";
import { msvcRand, srandTime } from "../sim/rng.ts";
import { isTeamMode } from "../sim/modes.ts";
import type { Buttons, Dir, GameMode, InputFrame, LevelLayout, MatchState, Rules, SimEvent } from "../sim/types.ts";
import type { MatchRecord } from "./accounts.ts";
import { PeerButtons } from "./buttons.ts";
import type { Badge, ChatKind, PanelBar, RoomChange, RoomInfo, RoomStatus, RoomSummary, ServerMessage, UserCard } from "./protocol.ts";
import { badgeOf, CHAT_INTERVAL_MS, RANDOM_MAP, shownName, SNAPSHOT_EVERY, START_BARS, toWireState, typingPacketDue } from "./protocol.ts";
import { cellShares, LEAVE_PENALTY } from "./results.ts";

export interface Peer {
  readonly id: number;
  /** The connection's address key (address.ts), shared by one address's connections. */
  readonly address?: string;
  send(message: ServerMessage): void;
}

/** A player as its account shows it; `name` is the login ID, which the lobby's lists always show. */
export interface Profile {
  name: string;
  nick: string;
  /** What the others see of the account: the user list's card, the slot's and the panel's badges. */
  card: UserCard;
  /** The room shows the ID rather than the nick (slot +0x68). */
  useId: boolean;
  character: string;
  /** −180..180: the room slot's +0x90. */
  hue: number;
}

export interface RoomDeps {
  /** The map ids in list order (entry 1.. of the room's list; entry 0 is RANDOM). */
  maps: readonly string[];
  layoutFor(mapId: string): LevelLayout | undefined;
  /** How many game tunes follow RANDOM in the music list. */
  musicCount: number;
  rules: Rules;
  now(): number;
  /** The room's state changed; the lobby may show it differently. */
  changed(): void;
  /** A player's account gets a match's result, by login ID. */
  recorded?(name: string, record: MatchRecord): void;
}

export interface RoomIdentity {
  code: string;
  number: number;
  title: string;
  /** "" for none; any other makes the room secret. */
  password: string;
}

export interface ChatSent {
  text: string;
  at: number;
}

/** The original client's send rule (0x43f7a0): not the same line again, and not within 2000 ms. */
export function chatAllowed(last: ChatSent | null | undefined, text: string, now: number): boolean {
  return !last || (last.text !== text && now - last.at >= CHAT_INTERVAL_MS);
}

/** The host sends a ping record back no oftener than this, well under the client's 5 s (0x40c663). */
export const PING_ECHO_MS = 1000;

interface Member {
  peer: Peer;
  profile: Profile;
  ready: boolean;
  team: number;
  slot: number;
  dir: Dir | null;
  buttons: PeerButtons;
  /** The client returns before its input poll under help, the exit box or chat (0x45aec8). */
  inputPaused: boolean;
  /** The match's chat line is open ([0x48c0e8]): the keys go unread (0x45aec8) and the "chat" mark shows. */
  typing: boolean;
  /** What the peers last took from this player's state packet (remote +0x2c8, 0x45d300). */
  shownTyping: boolean;
  /** When this player's last state packet went out, in match time. */
  typingSentMs: number;
  /** The frames per second and ping its client last reported. */
  stats: Omit<PanelBar, "id">;
  /** Its bars as the peers last took them from its state packet. */
  shownBars: Omit<PanelBar, "id">;
  /** When its last ping record was sent back, on the server's clock. */
  pingedAt: number;
}

export class Room {
  readonly code: string;
  readonly number: number;
  readonly title: string;
  /** Kept here only: no message about the room carries it. */
  readonly #password: string;
  hostId: number;
  mapId: string;
  /** 0 = RANDOM. The server's default is not known; RANDOM is the list's first entry (R). */
  music = 0;
  /** The server's default is not known; the create popup has no mode choice, so 개인전 (0) (R). */
  mode: GameMode = 0;
  /** Slots the host closed (+0x8c); they stay closed when the host changes. */
  private readonly closed: boolean[] = Array.from({ length: MAX_PLAYERS }, () => false);
  private readonly deps: RoomDeps;
  private readonly members = new Map<number, Member>();
  private match: MatchState | null = null;
  private pendingEvents: SimEvent[] = [];
  /** Players as the first round's countdown ended (0x4413e0), which the individual pool is 100 a head of. */
  private startCount = 0;
  private startCounted = false;
  /** The match's results went to the accounts: a leave from here on is no longer fined. */
  private settled = false;

  constructor(identity: RoomIdentity, host: Peer, profile: Profile, deps: RoomDeps) {
    this.code = identity.code;
    this.number = identity.number;
    this.title = identity.title;
    this.#password = identity.password;
    // The first map of the list; the server's default is not known (R).
    this.mapId = deps.maps[0];
    this.hostId = host.id;
    this.deps = deps;
    // The creator starts on team 1 (0x444dbe).
    this.addMember(host, profile, 1);
    this.broadcastRoom();
  }

  get playing(): boolean {
    return this.match !== null;
  }

  get size(): number {
    return this.members.size;
  }

  /** +0x28: the room list's secret door, and a join that must bring the password. */
  get secret(): boolean {
    return this.#password !== "";
  }

  admits(password: string): boolean {
    return password === this.#password;
  }

  info(): RoomInfo {
    return {
      code: this.code,
      number: this.number,
      title: this.title,
      hostId: this.hostId,
      mapId: this.mapId,
      music: this.music,
      mode: this.mode,
      closed: [...this.closed],
      playing: this.playing,
      players: this.bySlot().map((m) => ({
        id: m.peer.id,
        name: m.profile.name,
        nick: m.profile.nick,
        useId: m.profile.useId,
        character: m.profile.character,
        hue: m.profile.hue,
        wins: m.profile.card.wins,
        cell: m.profile.card.cell,
        badge: badgeOf(m.profile.card),
        ready: m.ready,
        team: m.team,
        slot: m.slot,
      })),
    };
  }

  /** The room's line in the lobby. Its open slots are the ones the host has not closed (R). */
  summary(): RoomSummary {
    return {
      code: this.code,
      number: this.number,
      title: this.title,
      mapId: this.mapId,
      mode: this.mode,
      players: this.members.size,
      max: this.closed.filter((closed) => !closed).length,
      playing: this.playing,
      secret: this.secret,
    };
  }

  /** The room info popup's data (S->C 0x55): the players' slots, IDs and badges; its stars are not known (R). */
  detail(): { status: RoomStatus; round: number; players: { slot: number; name: string; badge: Badge }[] } {
    const match = this.match;
    const status: RoomStatus = !match ? "waiting" : match.phase === "match-over" ? "over" : "round";
    return {
      status,
      round: match?.round ?? 0,
      players: this.bySlot().map((m) => ({ slot: m.slot, name: m.profile.name, badge: badgeOf(m.profile.card) })),
    };
  }

  /** Returns an error message (the lobby's join replies 1 and 2), or null when the peer joined. */
  join(peer: Peer, profile: Profile): string | null {
    if (this.playing) return "이미 시작 되었습니다.";
    if (this.freeSlot() === null) return "정원 초과 입니다.";
    this.addMember(peer, profile, this.joinerTeam());
    this.broadcastRoom();
    this.broadcastChat("enter", shownName(profile), "");
    return null;
  }

  leave(peerId: number): void {
    const member = this.members.get(peerId);
    if (!member) return;
    this.members.delete(peerId);
    member.peer.send({ type: "room", room: null });
    if (this.match) {
      const leaver = this.match.players.find((p) => p.id === peerId);
      // ranking.html's fine, and the candy its client would have reported as it went (C->S 0x66).
      if (leaver && !this.settled) {
        this.deps.recorded?.(member.profile.name, { cell: -LEAVE_PENALTY, won: false, lost: true, candy: leaver.candy });
      }
      const seen = this.match.events.length;
      removePlayer(this.match, peerId);
      this.pendingEvents.push(...this.match.events.slice(seen));
      this.settle();
    }
    // In the room only S->C 0x40 moves the host (0x440590's other callers are entering and creating
    // a room), and it logs the leave with its own line (0x44ab30), not kind 3's.
    let kind: ChatKind = "leave";
    if (this.hostId === peerId) {
      const next = this.bySlot()[0];
      if (next) {
        this.hostId = next.peer.id;
        // The host has no ready state; a ready player who takes over would be locked out of SELECTTEAM (R).
        next.ready = false;
        kind = "host-leave";
      }
    }
    this.broadcastRoom();
    this.broadcastChat(kind, shownName(member.profile), "");
  }

  /**
   * The host's /ban (C->S 0x44). S->C 0x44 goes to everyone in the room, the one put out too: the
   * others log it and free the slot (0x44a207), the one put out keeps the room on screen under
   * "강퇴 당했습니다." (0x44a1db). No leave line follows. The original server's rules are not known
   * (R): the host, while waiting, a taken slot not its own; a refusal goes back to the host alone.
   * Returns the id of the player put out.
   */
  kick(peerId: number, slot: number): number | null {
    const member = this.members.get(peerId);
    if (!member) return null;
    const target = this.bySlot().find((m) => m.slot === slot);
    if (peerId !== this.hostId || this.playing || !target || target === member) {
      member.peer.send({ type: "kick", slot, ok: false });
      return null;
    }
    this.broadcast({ type: "kick", slot, ok: true });
    this.members.delete(target.peer.id);
    target.peer.send({ type: "room", room: null });
    this.broadcastRoom();
    return target.peer.id;
  }

  /** A guest's START (C->S 0x4b). The host's START starts the match instead (0x45a412). */
  setReady(peerId: number, ready: boolean): void {
    const member = this.members.get(peerId);
    if (!member || this.playing || peerId === this.hostId) return;
    member.ready = ready;
    this.broadcastRoom();
  }

  setMap(peerId: number, mapId: string): string | null {
    if (peerId !== this.hostId) return "방장만 맵을 바꿀 수 있습니다.";
    if (this.playing) return "게임 중에는 맵을 바꿀 수 없습니다.";
    if (mapId !== RANDOM_MAP && !this.deps.maps.includes(mapId)) return "알 수 없는 맵입니다.";
    this.mapId = mapId;
    this.broadcastRoom();
    return null;
  }

  setMusic(peerId: number, music: number): string | null {
    if (peerId !== this.hostId) return "방장만 배경음악을 바꿀 수 있습니다.";
    if (this.playing) return "게임 중에는 배경음악을 바꿀 수 없습니다.";
    if (music > this.deps.musicCount) return "알 수 없는 배경음악입니다.";
    this.music = music;
    this.broadcastRoom();
    return null;
  }

  /** The host's click on an empty slot (C->S 0x45); the own and taken slots take no click (0x428a30). */
  setSlot(peerId: number, slot: number, open: boolean): string | null {
    if (peerId !== this.hostId) return "방장만 자리를 열고 닫을 수 있습니다.";
    if (this.playing) return "게임 중에는 자리를 바꿀 수 없습니다.";
    if (this.bySlot().some((m) => m.slot === slot)) return "빈 자리만 열고 닫을 수 있습니다.";
    this.closed[slot] = !open;
    this.broadcastRoom("slot");
    return null;
  }

  /**
   * A room chat line (the lobby has checked the send rule), false when it goes nowhere.
   * Every room line names the player as the slot does (+0x68: 0x446c5d, 0x44a212, 0x427a3c).
   */
  chat(peerId: number, text: string): boolean {
    const member = this.members.get(peerId);
    if (!member || this.playing) return false;
    this.broadcastChat("talk", shownName(member.profile), text);
    return true;
  }

  setMode(peerId: number, mode: GameMode): string | null {
    if (peerId !== this.hostId) return "방장만 게임 방식을 바꿀 수 있습니다.";
    if (this.playing) return "게임 중에는 게임 방식을 바꿀 수 없습니다.";
    // Teams stay as they are (0x440520 leaves +0x74 alone).
    this.mode = mode;
    this.broadcastRoom();
    return null;
  }

  /**
   * SELECTTEAM (0x427f60): only in the team modes and never while the player is ready (0x448970);
   * the host only while another player in an open slot is not ready (0x428108-0x428159).
   */
  setTeam(peerId: number, team: number): string | null {
    const member = this.members.get(peerId);
    if (!member) return "방에 들어가 있지 않습니다.";
    if (this.playing) return "게임 중에는 팀을 바꿀 수 없습니다.";
    if (!isTeamMode(this.mode)) return "팀전에서만 팀을 고를 수 있습니다.";
    if (member.ready) return "준비 중에는 팀을 바꿀 수 없습니다.";
    if (peerId === this.hostId && !this.bySlot().some((m) => m.peer.id !== peerId && !m.ready)) {
      return "준비하지 않은 참가자가 있을 때만 방장이 팀을 바꿀 수 있습니다.";
    }
    member.team = team;
    this.broadcastRoom("team");
    return null;
  }

  start(peerId: number): string | null {
    if (peerId !== this.hostId) return "방장만 시작할 수 있습니다.";
    if (this.playing) return "이미 게임 중입니다.";
    if (this.members.size < 2) return "2명 이상이어야 시작할 수 있습니다.";
    if ([...this.members.values()].some((m) => m.peer.id !== this.hostId && !m.ready)) {
      return "모두 준비해야 시작할 수 있습니다.";
    }
    // The server's start reply code 4 (0x44a2c3); its rule is not known. A room all on one team
    // would end at once (0x441130), so at least two teams are needed.
    if (isTeamMode(this.mode) && new Set([...this.members.values()].map((m) => m.team)).size < 2) {
      return "팀 구성이 적합하지 않습니다.";
    }
    // The host's START (0x45a6f3): srand(time(0)), then a RANDOM map becomes entry rand() % n + 1
    // and after it a RANDOM tune likewise, each rand() only when it is RANDOM.
    const { maps, musicCount } = this.deps;
    const clockMs = this.deps.now();
    const rng = { rng: 0, clockMs };
    srandTime(rng, 0);
    const mapId = this.mapId === RANDOM_MAP ? maps[msvcRand(rng) % maps.length] : this.mapId;
    const music = this.music === 0 && musicCount > 0 ? (msvcRand(rng) % musicCount) + 1 : this.music;
    const layout = this.deps.layoutFor(mapId);
    if (!layout) return "알 수 없는 맵입니다.";
    // Player index = room slot (0x44dcb4): the match runs the players in slot order.
    const setups = this.bySlot().map((m) => ({
      id: m.peer.id,
      name: m.profile.name,
      character: m.profile.character,
      team: m.team,
      slot: m.slot,
    }));
    this.match = createMatch(layout, setups, { ...this.deps.rules, mode: this.mode }, Math.floor(clockMs / 1000), clockMs);
    this.pendingEvents = [...this.match.events];
    this.startCount = setups.length;
    this.startCounted = false;
    this.settled = false;
    // The start (S->C 0x25) closes every chat line (0x44a3db).
    for (const member of this.members.values()) {
      member.dir = null;
      member.buttons.clear();
      member.inputPaused = false;
      member.typing = false;
    }
    this.resetBars();
    this.broadcast({ type: "match-start", layout, music });
    this.broadcastRoom();
    this.broadcastSnapshot();
    return null;
  }

  input(peerId: number, dir: Dir | null, buttons: Buttons, paused = false): void {
    const member = this.members.get(peerId);
    if (!member) return;
    member.dir = dir;
    member.inputPaused = paused;
    // A tap made while the poll is skipped must not survive a resume before the next tick.
    if (paused) member.buttons.clear();
    else member.buttons.set(buttons);
  }

  /**
   * A line said in the match (0x446200): dropped on the wait and result screens (0x4462e4), the
   * countdown included otherwise; no slash commands, repeat check or 2 s rule there. Everyone in the
   * match gets it, the speaker too, as the host's relay sends it back (0x446a20).
   */
  gameChat(peerId: number, text: string): void {
    const member = this.members.get(peerId);
    const phase = this.match?.phase;
    if (!member || (phase !== "countdown" && phase !== "playing")) return;
    this.broadcast({ type: "game-chat", playerId: peerId, text });
  }

  typing(peerId: number, on: boolean): void {
    const member = this.members.get(peerId);
    if (member && this.playing) member.typing = on;
  }

  /** The host sends a ping record straight back (0x444915 → 0x444929); the client measures the trip. */
  ping(peerId: number, at: number): void {
    const member = this.members.get(peerId);
    const now = this.deps.now();
    if (!member || !this.playing || now - member.pingedAt < PING_ECHO_MS) return;
    member.pingedAt = now;
    member.peer.send({ type: "pong", at });
  }

  /** What the client's next state packet would carry for its bars (+0x24, +0x28). */
  stats(peerId: number, fps: number, ping: number): void {
    const member = this.members.get(peerId);
    if (member && this.playing) member.stats = { fps, ping };
  }

  /** Advance the running match by one tick and broadcast on snapshot ticks. */
  tick(): void {
    const match = this.match;
    if (!match) return;
    step(match, this.collectInputs());
    this.pendingEvents.push(...match.events);
    if (match.events.some((event) => event.type === "round-start")) this.resetBars();
    this.sendTypingFlags(match);
    if (!this.startCounted && match.phase === "playing") {
      this.startCount = match.players.length;
      this.startCounted = true;
    }
    this.settle();

    if (matchResultDone(match)) {
      this.broadcastSnapshot();
      this.endMatch();
      return;
    }
    if (match.tick % SNAPSHOT_EVERY === 0) this.broadcastSnapshot();
  }

  private collectInputs(): InputMap {
    const inputs: Record<number, InputFrame | null> = {};
    for (const member of this.members.values()) {
      const buttons = member.buttons.take();
      inputs[member.peer.id] = member.typing || member.inputPaused ? null : { dir: member.dir, ...buttons };
    }
    return inputs;
  }

  /**
   * Each player's state packet as its own client would send it; the peers take the flag only while
   * the player is alive (0x45d300), and the world load clears it (0x44fc50), so none in the countdown.
   */
  private sendTypingFlags(match: MatchState): void {
    const now = nowMs(match.tick);
    for (const member of this.members.values()) {
      const player = match.players.find((p) => p.id === member.peer.id);
      if (!player || match.phase !== "playing") {
        member.shownTyping = false;
        continue;
      }
      if (!typingPacketDue(match.phase, player, now, member.typingSentMs)) continue;
      member.typingSentMs = now;
      if (!player.alive) continue;
      member.shownTyping = member.typing;
      member.shownBars = { ...member.stats };
    }
  }

  /**
   * Each world load (0x44fc50, 0x44eee0) puts every bar back: A to 30, B to 0. The own ping goes
   * to 0 with the table on each PC, so the reported one does too; the frame count is not reset.
   */
  private resetBars(): void {
    for (const member of this.members.values()) {
      member.stats = { ...member.stats, ping: START_BARS.ping };
      member.shownBars = { ...START_BARS };
    }
  }

  /**
   * The match is over: each player still in the room gets the share the host's client worked out
   * (0x440a90) and reported (0x4e), a win or (R) a loss, and the candy picked up.
   */
  private settle(): void {
    const match = this.match;
    if (!match || this.settled || match.phase !== "match-over") return;
    this.settled = true;
    const shares = cellShares({
      mode: match.rules.mode,
      round: match.round,
      startCount: this.startCount,
      finishers: match.players,
      winnerId: match.matchWinnerId,
      winnerTeam: match.matchWinnerTeam,
    });
    for (const player of match.players) {
      const member = this.members.get(player.id);
      const share = shares.get(player.id);
      if (!member || !share) continue;
      this.deps.recorded?.(member.profile.name, { cell: share.cell, won: share.won, lost: !share.won, candy: player.candy });
    }
  }

  private endMatch(): void {
    this.match = null;
    this.pendingEvents = [];
    for (const member of this.members.values()) {
      member.ready = false;
      member.typing = false;
      member.shownTyping = false;
      member.typingSentMs = Number.NEGATIVE_INFINITY;
    }
    this.broadcast({ type: "match-end" });
    this.broadcastRoom();
  }

  /** The lowest slot neither taken nor closed, or null when the room is full. */
  private freeSlot(): number | null {
    const taken = new Set([...this.members.values()].map((m) => m.slot));
    for (let slot = 0; slot < MAX_PLAYERS; slot += 1) {
      if (!taken.has(slot) && !this.closed[slot]) return slot;
    }
    return null;
  }

  private addMember(peer: Peer, profile: Profile, team: number): void {
    const slot = this.freeSlot() ?? 0;
    const member: Member = {
      peer,
      profile,
      ready: false,
      team,
      slot,
      dir: null,
      buttons: new PeerButtons(),
      inputPaused: false,
      typing: false,
      shownTyping: false,
      typingSentMs: Number.NEGATIVE_INFINITY,
      stats: { ...START_BARS },
      shownBars: { ...START_BARS },
      pingedAt: Number.NEGATIVE_INFINITY,
    };
    this.members.set(peer.id, member);
  }

  /** Members in room slot order. */
  private bySlot(): Member[] {
    return [...this.members.values()].sort((a, b) => a.slot - b.slot);
  }

  /**
   * RECONSTRUCTION: the server picks a joiner's team (0x446c16) by a rule not known. Here it is the
   * smaller of teams 1 and 2, team 1 on a tie, so a room fills up as two even teams.
   */
  private joinerTeam(): number {
    const count = (team: number) => [...this.members.values()].filter((m) => m.team === team).length;
    return count(2) < count(1) ? 2 : 1;
  }

  private broadcastSnapshot(): void {
    if (!this.match) return;
    const members = this.bySlot();
    const typing = members.filter((m) => m.shownTyping).map((m) => m.peer.id);
    const bars = members.map((m) => ({ id: m.peer.id, ...m.shownBars }));
    this.broadcast({ type: "snapshot", state: toWireState(this.match), events: this.pendingEvents, typing, bars });
    this.pendingEvents = [];
  }

  private broadcastChat(kind: ChatKind, name: string, text: string): void {
    this.broadcast({ type: "chat", kind, name, text });
  }

  /** A member's account changed (its nick, its ID check): the room shows it, between matches. */
  profileChanged(): void {
    if (!this.playing) this.broadcastRoom();
  }

  private broadcastRoom(change: RoomChange = "other"): void {
    this.broadcast({ type: "room", room: this.info(), change });
    this.deps.changed();
  }

  private broadcast(message: ServerMessage): void {
    for (const member of this.members.values()) member.peer.send(message);
  }
}
