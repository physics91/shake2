import type { LevelLayout, Rules } from "../sim/types.ts";
import type { MatchRecord } from "./accounts.ts";
import { compareIgnoreCase } from "./cp949.ts";
import type { FriendBook } from "./friends.ts";
import type { Badge, ClientMessage, OwnAccount, ServerMessage } from "./protocol.ts";
import { roomTitle, shownName, userCard } from "./protocol.ts";
import type { ChatSent, Peer, Profile, RoomDeps } from "./room.ts";
import { chatAllowed, Room } from "./room.ts";

type LobbyMessage = Extract<ServerMessage, { type: "lobby" }>;

/**
 * A remake's guard against guessing (R): secret-room passwords are checked one at a time per
 * address (address.ts), and after the n-th wrong one in a row that address's next check waits
 * min(PASSWORD_RETRY_MS · 2^(n−1), PASSWORD_RETRY_MAX_MS). A wrong one is answered at once; the
 * client waits for the answer anyway (0x448800), so an honest player is only ever kept waiting.
 */
export const PASSWORD_RETRY_MS = 500;
export const PASSWORD_RETRY_MAX_MS = 30_000;
/** An address's wrong passwords are forgotten this long after its last one. A right one undoes none. */
export const PASSWORD_FAILURES_KEPT_MS = 600_000;

const ROOM_NOT_FOUND = "방을 찾을 수 없습니다"; // 0x46ed00, no full stop

/** One address's password checks: the wrong ones in a row, and the players waiting their turn. */
interface PasswordGuard {
  failures: number;
  lastFailureAt: number;
  readyAt: number;
  /** One attempt per player, in the order they came. */
  queue: { peerId: number; code: string; password: string }[];
}

export interface PlayableMap {
  id: string;
  title: string;
  layout: LevelLayout;
}

export interface LobbyConfig {
  maps: readonly PlayableMap[];
  /** Game tune names (file names without the extension). */
  music: readonly string[];
  characters: readonly string[];
  rules: Rules;
  maxRooms: number;
  /** The banner's channel name (the last string of S->C 0x0a). */
  channel: string;
  /** The my-info window's O was taken: the account keeps the character, hue and use-ID flag. */
  saveCharacter?(name: string, choice: { character: string; hue: number; useId: boolean }): void;
  /** A match's result for a player's account, by login ID: at the match's end, or on leaving it. */
  recordMatch?(name: string, record: MatchRecord): void;
  /** A login ID's guild and level for the friend list, connected or not; null for none. */
  badgeOf?(name: string): Badge | null;
  /** A login ID typed in any case as its account spells it; undefined when no account has it. */
  accountId?(name: string): string | undefined;
  /** Where a player not in this channel is, in another channel's words; blank when nowhere. */
  locate?(name: string): string;
  /** The option window's friend lists, by the name each player said hello with. */
  friends: FriendBook;
  /** Milliseconds: the chat interval, and the host clock the match's rand() reseeds read. */
  now(): number;
  /** Returns a fresh room code candidate (uniqueness is checked by the lobby). */
  roomCode(): string;
}

/** Connection-level state: profiles, room membership and routing of client messages. */
export class Lobby {
  private readonly config: LobbyConfig;
  /** The room's lists (0x404200): maps sorted by title, tunes by file name, both with _stricmp. */
  private readonly maps: readonly PlayableMap[];
  private readonly music: readonly string[];
  private readonly roomDeps: RoomDeps;
  private readonly peers = new Map<number, Peer>();
  private readonly profiles = new Map<number, Profile>();
  private readonly roomOf = new Map<number, Room>();
  private readonly rooms = new Map<string, Room>();
  /** Each player's last chat line, the lobby's or the room's: the client keeps one ([0x4937bc]). */
  private readonly lastChat = new Map<number, ChatSent>();
  /** Players who turned whispers off with /wno. */
  private readonly noWhispers = new Set<number>();
  /** Secret-room password checks by address key. */
  private readonly passwordGuards = new Map<string, PasswordGuard>();
  /** Something the lobby shows may have changed since it was last sent. */
  private dirty = false;
  /** The lobby as last sent, to send it again only when it changes. */
  private shown = "";
  /** Players who came into the lobby and have not been sent it yet. */
  private readonly arrived = new Set<number>();

  constructor(config: LobbyConfig) {
    this.config = config;
    this.maps = [...config.maps].sort((a, b) => compareIgnoreCase(a.title, b.title));
    this.music = [...config.music].sort(compareIgnoreCase);
    this.roomDeps = {
      maps: this.maps.map((m) => m.id),
      layoutFor: (mapId) => this.maps.find((m) => m.id === mapId)?.layout,
      musicCount: this.music.length,
      rules: config.rules,
      now: config.now,
      changed: () => {
        this.dirty = true;
      },
      recorded: (name, record) => config.recordMatch?.(name, record),
    };
  }

  get roomCount(): number {
    return this.rooms.size;
  }

  /** The players in the channel, in rooms or not. */
  get userCount(): number {
    return this.profiles.size;
  }

  /**
   * The game server's login (C->S 0x0a after the version): the player comes into the lobby with its
   * account's profile. A character the server no longer has falls back to the first (R).
   */
  join(peer: Peer, account: OwnAccount): void {
    if (this.peers.has(peer.id)) return;
    const character = this.config.characters.includes(account.character) ? account.character : this.config.characters[0];
    const profile: Profile = { name: account.id, nick: account.nick, card: userCard(account), useId: account.useId, character, hue: account.hue };
    this.peers.set(peer.id, peer);
    this.profiles.set(peer.id, profile);
    this.config.friends.meet(profile.name);
    this.arrived.add(peer.id);
    this.dirty = true;
    peer.send({
      type: "welcome",
      playerId: peer.id,
      account: { ...account, character },
      maps: this.maps.map((m) => ({ id: m.id, title: m.title })),
      music: [...this.music],
      characters: [...this.config.characters],
    });
    this.flushLobby();
  }

  /**
   * The account changed by a save over the auth connection (the greeting popup's, scene 5's): the
   * lists show the new card from their next send, as the original's did from its next page (0x16).
   * The record (전적, 셀, 순위, 레벨) stays as at login, which a match's result changes only from the
   * next one (FIDELITY 경기 결과: 반영 시점).
   */
  accountChanged(peerId: number, account: OwnAccount): void {
    const profile = this.profiles.get(peerId);
    if (!profile) return;
    const { nick, greeting, guild } = userCard(account);
    Object.assign(profile, { nick, useId: account.useId, card: { ...profile.card, nick, greeting, guild } });
    this.dirty = true;
    this.roomOf.get(peerId)?.profileChanged();
  }

  disconnect(peerId: number): void {
    this.leaveRoom(peerId);
    this.dropPasswordAttempt(peerId);
    this.peers.delete(peerId);
    this.profiles.delete(peerId);
    this.lastChat.delete(peerId);
    this.noWhispers.delete(peerId);
    this.dirty = true;
    this.flushLobby();
  }

  handle(peerId: number, message: ClientMessage): void {
    this.route(peerId, message);
    this.flushLobby();
  }

  private route(peerId: number, message: ClientMessage): void {
    const peer = this.peers.get(peerId);
    if (!peer) return;
    const fail = (text: string | null) => {
      if (text) peer.send({ type: "error", message: text });
    };
    const profile = this.profiles.get(peerId);
    if (!profile) {
      fail("먼저 로그인해야 합니다.");
      return;
    }
    const room = this.roomOf.get(peerId);
    switch (message.type) {
      case "create-room":
        fail(this.createRoom(peer, profile, message.title, message.password ?? ""));
        break;
      case "join-room":
        fail(this.joinRoom(peer, profile, message.code, message.password ?? ""));
        break;
      case "join-number": {
        // /go sends no password (0x446747): a secret room answers with its password popup.
        const asked = [...this.rooms.values()].find((r) => r.number === message.number);
        fail(asked ? this.joinRoom(peer, profile, asked.code, "") : ROOM_NOT_FOUND);
        break;
      }
      case "leave-room":
        this.leaveRoom(peerId);
        break;
      case "room-info": {
        // An unknown room gets no reply: the popup keeps its zeroed record, "ROUND 1" and no rows.
        const asked = this.rooms.get(message.code);
        if (asked) peer.send({ type: "room-info", code: asked.code, ...asked.detail() });
        break;
      }
      case "set-ready":
        room?.setReady(peerId, message.ready);
        break;
      case "set-map":
        fail(room ? room.setMap(peerId, message.mapId) : "방에 들어가 있지 않습니다.");
        break;
      case "set-mode":
        fail(room ? room.setMode(peerId, message.mode) : "방에 들어가 있지 않습니다.");
        break;
      case "set-team":
        fail(room ? room.setTeam(peerId, message.team) : "방에 들어가 있지 않습니다.");
        break;
      case "set-music":
        fail(room ? room.setMusic(peerId, message.music) : "방에 들어가 있지 않습니다.");
        break;
      case "set-slot":
        fail(room ? room.setSlot(peerId, message.slot, message.open) : "방에 들어가 있지 않습니다.");
        break;
      case "kick": {
        if (!room) {
          fail("방에 들어가 있지 않습니다.");
          break;
        }
        const out = room.kick(peerId, message.slot);
        if (out !== null) {
          this.roomOf.delete(out);
          this.dirty = true;
        }
        break;
      }
      case "chat":
        this.chat(peerId, room, shownName(profile), message.text);
        break;
      case "start":
        fail(room ? room.start(peerId) : "방에 들어가 있지 않습니다.");
        break;
      case "input":
        room?.input(peerId, message.dir, { bomb: message.bomb, attack: message.attack, evade: message.evade }, message.paused);
        break;
      case "game-chat":
        room?.gameChat(peerId, message.text);
        break;
      case "set-character":
        fail(this.setCharacter(peer, profile, message, room !== undefined));
        break;
      case "typing":
        room?.typing(peerId, message.on);
        break;
      case "ping":
        room?.ping(peerId, message.at);
        break;
      case "stats":
        room?.stats(peerId, message.fps, message.ping);
        break;
      case "friends": {
        const names = this.config.friends.list(profile.name);
        const friends = names.map((name) => ({ name, location: this.locationOf(name), badge: this.config.badgeOf?.(name) ?? null }));
        peer.send({ type: "friends", friends });
        break;
      }
      case "add-friend":
        peer.send({ type: "friend-added", result: this.config.friends.add(profile.name, this.loginId(message.name)), name: message.name });
        break;
      case "delete-friend":
        peer.send({ type: "friend-deleted", result: this.config.friends.remove(profile.name, this.loginId(message.name)), name: message.name });
        break;
      case "whisper":
        this.whisper(profile.name, this.loginId(message.to), message.text);
        break;
      case "users":
        // The original's count is its server's (R): here, everyone who said hello.
        peer.send({ type: "users", count: this.profiles.size });
        break;
      case "whisper-allow":
        if (message.on) this.noWhispers.delete(peerId);
        else this.noWhispers.add(peerId);
        peer.send({ type: "whisper-allowed", on: message.on });
        break;
    }
  }

  tick(): void {
    for (const room of this.rooms.values()) room.tick();
    this.checkAllPasswords();
    this.flushLobby();
  }

  /** Whether the player is connected in this channel, and in which room's list place if in one. */
  presence(name: string): { room: number | null } | null {
    for (const [id, profile] of this.profiles) {
      if (profile.name !== name || !this.peers.has(id)) continue;
      return { room: this.roomOf.get(id)?.number ?? null };
    }
    return null;
  }

  /**
   * Where a friend is, as the option window's LOCATION column shows it. The original's words are
   * its server's and unknown (R): the channel in the lobby, the room's number in a room, another
   * channel's words for a friend there, else blank.
   */
  private locationOf(name: string): string {
    const here = this.presence(name);
    if (!here) return this.config.locate?.(name) ?? "";
    return here.room === null ? this.config.channel : `${String(here.room + 1).padStart(3, "0")}번 방`;
  }

  /** The my-info window's save (0x44af80): a known character, from the lobby only (0x459cbe). */
  private setCharacter(peer: Peer, profile: Profile, choice: { character: string; hue: number; useId: boolean }, inRoom: boolean): string | null {
    if (!this.config.characters.includes(choice.character)) return "알 수 없는 캐릭터입니다.";
    if (inRoom) return "로비에서만 바꿀 수 있습니다.";
    const { character, hue, useId } = choice;
    Object.assign(profile, { character, hue, useId });
    this.config.saveCharacter?.(profile.name, { character, hue, useId });
    peer.send({ type: "profile", character, hue, useId });
    return null;
  }

  private createRoom(peer: Peer, profile: Profile, title: string, password: string): string | null {
    this.leaveRoom(peer.id);
    this.dropPasswordAttempt(peer.id);
    if (this.rooms.size >= this.config.maxRooms) return "서버의 방이 가득 찼습니다.";
    const code = this.uniqueCode();
    if (!code) return "방 코드를 만들지 못했습니다.";
    // The original popup sends nothing without a title; this remake's default names the creator (R).
    // The original server's rule for a secret room is not known (I): here, one made with a password.
    const identity = { code, number: this.freeNumber(), title: title || roomTitle(`${profile.name}의 방`), password };
    const room = new Room(identity, peer, profile, this.roomDeps);
    this.rooms.set(code, room);
    this.roomOf.set(peer.id, room);
    this.dirty = true;
    return null;
  }

  private joinRoom(peer: Peer, profile: Profile, code: string, password: string): string | null {
    const room = this.rooms.get(code);
    if (!room) return ROOM_NOT_FOUND;
    if (this.roomOf.get(peer.id) === room) return null;
    // The password comes before the room's own refusals (I: the server's order is not known).
    if (room.secret) {
      this.tryPassword(peer, room.code, password);
      return null;
    }
    return this.enter(peer, profile, room);
  }

  private enter(peer: Peer, profile: Profile, room: Room): string | null {
    this.leaveRoom(peer.id);
    const error = room.join(peer, profile);
    if (!error) {
      this.roomOf.set(peer.id, room);
      this.dropPasswordAttempt(peer.id);
    }
    this.dirty = true;
    return error;
  }

  private guardKey(peer: Peer): string {
    return peer.address ?? `peer:${peer.id}`;
  }

  /**
   * A secret room's join: none asks for the password at once (join reply 3); a password waits its
   * address's turn, and a player's further ones are dropped until it has been checked.
   */
  private tryPassword(peer: Peer, code: string, password: string): void {
    if (password === "") {
      peer.send({ type: "join-password", code });
      return;
    }
    const key = this.guardKey(peer);
    let guard = this.passwordGuards.get(key);
    if (!guard) {
      guard = { failures: 0, lastFailureAt: 0, readyAt: 0, queue: [] };
      this.passwordGuards.set(key, guard);
    }
    if (guard.queue.some((attempt) => attempt.peerId === peer.id)) return;
    guard.queue.push({ peerId: peer.id, code, password });
    this.checkPasswords(guard);
  }

  /** Checks the address's waiting passwords while its turn has come. */
  private checkPasswords(guard: PasswordGuard): void {
    const now = this.config.now();
    while (now >= guard.readyAt) {
      const attempt = guard.queue.shift();
      if (!attempt) return;
      const peer = this.peers.get(attempt.peerId);
      const profile = this.profiles.get(attempt.peerId);
      if (!peer || !profile) continue;
      const room = this.rooms.get(attempt.code);
      if (!room) {
        peer.send({ type: "error", message: ROOM_NOT_FOUND });
        continue;
      }
      if (room.admits(attempt.password)) {
        const error = this.enter(peer, profile, room);
        if (error) peer.send({ type: "error", message: error });
        continue;
      }
      if (now - guard.lastFailureAt >= PASSWORD_FAILURES_KEPT_MS) guard.failures = 0;
      guard.failures++;
      guard.lastFailureAt = now;
      guard.readyAt = now + Math.min(PASSWORD_RETRY_MS * 2 ** (guard.failures - 1), PASSWORD_RETRY_MAX_MS);
      peer.send({ type: "join-password", code: room.code });
    }
  }

  /** Checks every address whose turn has come, and forgets those with nothing left to hold. */
  private checkAllPasswords(): void {
    const now = this.config.now();
    for (const [key, guard] of this.passwordGuards) {
      this.checkPasswords(guard);
      const forgotten = guard.failures === 0 || now - guard.lastFailureAt >= PASSWORD_FAILURES_KEPT_MS;
      if (guard.queue.length === 0 && forgotten) this.passwordGuards.delete(key);
    }
  }

  /** A player who went, or who went into a room, no longer waits for a password check. */
  private dropPasswordAttempt(peerId: number): void {
    const peer = this.peers.get(peerId);
    const guard = peer && this.passwordGuards.get(this.guardKey(peer));
    if (guard) guard.queue = guard.queue.filter((attempt) => attempt.peerId !== peerId);
  }

  private leaveRoom(peerId: number): void {
    const room = this.roomOf.get(peerId);
    if (!room) return;
    this.roomOf.delete(peerId);
    room.leave(peerId);
    if (room.size === 0) this.rooms.delete(room.code);
    // Leaving a room goes back to the lobby (0x449fa6).
    this.arrived.add(peerId);
    this.dirty = true;
  }

  /**
   * A chat line in the room or the lobby, dropped as the original client drops it: a repeat of the
   * last line, or within 2 s of it (0x43f7a0), whichever of the two the last went to. A lobby line
   * names the speaker as the room does: the lobby's own-line test reads the shown name too (0x42d393).
   */
  private chat(peerId: number, room: Room | undefined, name: string, text: string): void {
    const now = this.config.now();
    if (!chatAllowed(this.lastChat.get(peerId), text, now)) return;
    if (room) {
      if (!room.chat(peerId, text)) return;
    } else {
      for (const peer of this.lobbyPeers()) peer.send({ type: "lobby-chat", name, text });
    }
    this.lastChat.set(peerId, { text, at: now });
  }

  /** A typed ID as the account spells it, since IDs are one whichever their case; as typed when no account has it. */
  private loginId(name: string): string {
    return this.config.accountId?.(name) ?? name;
  }

  /**
   * /w (C->S 0x07 → S->C 0x07). The original server's rules are its own (R): the first player
   * connected under that name gets it, unless whispers are off there; nobody hears of a miss, and
   * the sender gets no copy. No interval here: the client paces /w with its chat timer, but sends the
   * whisper target's copy of every line without one (0x4468f6), so only the connection's message
   * cap bounds it.
   */
  private whisper(from: string, to: string, text: string): void {
    for (const [id, profile] of this.profiles) {
      if (profile.name !== to) continue;
      const target = this.peers.get(id);
      if (!target) continue;
      if (!this.noWhispers.has(id)) target.send({ type: "whisper", from, text });
      return;
    }
  }

  /** Players who said hello and are in no room, in the order they first said it (R: the server's order is not known). */
  private *lobbyPeers(): Generator<Peer> {
    for (const id of this.profiles.keys()) {
      const peer = this.peers.get(id);
      if (peer && !this.roomOf.has(id)) yield peer;
    }
  }

  private lobbyMessage(): LobbyMessage {
    return {
      type: "lobby",
      channel: this.config.channel,
      rooms: [...this.rooms.values()].sort((a, b) => a.number - b.number).map((room) => room.summary()),
      users: [...this.lobbyPeers()].flatMap((peer) => {
        const profile = this.profiles.get(peer.id);
        return profile ? [{ id: peer.id, name: profile.name, card: profile.card }] : [];
      }),
    };
  }

  /** Send the lobby to everyone in it when it changed, and to players who just came in. */
  private flushLobby(): void {
    if (!this.dirty) return;
    this.dirty = false;
    const message = this.lobbyMessage();
    const shown = JSON.stringify(message);
    const changed = shown !== this.shown;
    this.shown = shown;
    for (const peer of this.lobbyPeers()) {
      if (changed || this.arrived.has(peer.id)) peer.send(message);
    }
    this.arrived.clear();
  }

  /** The lowest room number no room holds (R: the server's rule is not known). */
  private freeNumber(): number {
    const taken = new Set([...this.rooms.values()].map((r) => r.number));
    let number = 0;
    while (taken.has(number)) number += 1;
    return number;
  }

  private uniqueCode(): string | null {
    for (let attempt = 0; attempt < 50; attempt += 1) {
      const code = this.config.roomCode();
      if (!this.rooms.has(code)) return code;
    }
    return null;
  }
}
