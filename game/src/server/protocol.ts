// Messages between the browser client and the room server (JSON over WebSocket).
// Shared by src/server and src/client/online.ts; must stay free of DOM and Node APIs.
import { MAX_PLAYERS } from "../sim/constants.ts";
import { isGameMode, TEAM_COUNT } from "../sim/modes.ts";
import type { Dir, GameMode, LevelLayout, MatchState, Phase, PlayerState, SimEvent } from "../sim/types.ts";
import { cp949Bytes, cutBytes, trimChat, trimSpaces, typeable } from "./cp949.ts";

/**
 * 19: room update kinds (slot/team replies reset the cursor even for identical state).
 * 18: server load request IDs (late replies). 17: ranking request IDs (late replies).
 * 16: the input poll's paused flag (help, exit box, chat).
 * 15: the notices (notice, status-notice). 14: the ranking (ranking, ranking-search). 13: scene 5's
 * guild (set-guild). 12: account cards (the user list's card, the room's nick, hue and
 * badges, the room info's and the friend list's badges). 11: accounts (login, sign-up, the version
 * check, hello with a session and a channel).
 */
export const PROTOCOL_VERSION = 19;
/** A room snapshot's originating packet: 0x45, 0x2e, or news that preserves the cursor. */
export type RoomChange = "slot" | "team" | "other";
export const MAX_MESSAGE_BYTES = 4096;
export const MAX_NAME_LENGTH = 12;
export const ROOM_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const ROOM_CODE_LENGTH = 4;
/** The server broadcasts a snapshot every this many simulation ticks: every 30 Hz logic frame. */
export const SNAPSHOT_EVERY = 1;
/** Entry 0 of the room's map and music lists (0x4046c9, 0x40489c). */
export const RANDOM_MAP = "RANDOM";
/** The room chat editor holds under 45 bytes in scenes 4 and 7 (0x418d37). */
export const ROOM_CHAT_LIMIT = 45;
/** 0x418cd0 sets the editor's limit to 37 bytes in a match (scenes 8 and 9): a line holds 36. */
export const GAME_CHAT_LIMIT = 37;
/** The create popup trims the title and cuts it to 19 bytes (0x4300d0). */
export const ROOM_TITLE_BYTES = 19;
/** The create popup's password editor is set to 11 (0x42ff40) and holds 10 bytes. */
export const ROOM_PASSWORD_BYTES = 10;
/** The password popup's editor is set to 16 (0x42f500) and holds 15 bytes. */
export const JOIN_PASSWORD_BYTES = 15;
/** A line is not sent within 2000 ms of the last one (0x43f7a0). */
export const CHAT_INTERVAL_MS = 2000;
/** The friend popup's ID editor holds 10 bytes (0x422c40: 0xb). */
export const FRIEND_ID_BYTES = 10;
/** The friend list's rows; the original server refuses the thirteenth (S->C 0x64 -3). */
export const MAX_FRIENDS = 12;

/** S->C 0x50's text (0x44579f: 0x411b60(pkt, 0, 0x64)): with its NUL in 100 bytes, 99 at most. */
export const NOTICE_BYTES = 99;
/** S->C 0x101's text, as the packet buffer holds it (about 0x400 bytes with its NUL). */
export const STATUS_NOTICE_BYTES = 0x3ff;
/** A line of it goes through a 0x100-byte stack buffer with no bound check (0x41cdd0): 255 bytes. */
export const STATUS_NOTICE_LINE_BYTES = 0xff;

/** The server list holds 80 rows (0x497190 + 0x1c·i up to the count at 0x497a50). */
export const MAX_CHANNELS = 80;

/** A channel's row in the server list: its name and the colour the auth server gives it (0x456e10). */
export interface ChannelRow {
  name: string;
  /** "#rrggbb". */
  colour: string;
}

/**
 * The own account as the login record carries it (S->C 0x0a, 0x448c50). Gender, manner and exp have
 * no source in the remake and stay 0 (R).
 */
export interface OwnAccount {
  id: string;
  nick: string;
  greeting: string;
  character: string;
  hue: number;
  useId: boolean;
  wins: number;
  losses: number;
  cell: number;
  level: number;
  guild: number;
  /** 순위, 0 for none yet. */
  rank: number;
  gender: number;
  manner: number;
  exp: number;
  candy: number;
  /** Item slots k owned (the wire's id is k + 1). */
  items: number[];
  /** Character pairs owned (0x484718). */
  pairs: number[];
}

/**
 * The icons drawn by a player's name in the lists, the room and the game: the guild mark (0x441940,
 * guild.dat line, −1 none) and the level badge (0x442900, 1..12). The gender icon before them is
 * drawn for 1 and 2 only, and every remake account's gender is 0, so it is not sent (R).
 */
export interface Badge {
  guild: number;
  level: number;
}

/** Another player's account as the user info window shows it (S->C 0x16's record), without its name and e-mail (R). */
export interface UserCard extends Badge {
  nick: string;
  greeting: string;
  /** 전적 "%d / %d". */
  wins: number;
  losses: number;
  cell: number;
  /** 순위, 0 for none yet. */
  rank: number;
  manner: number;
  exp: number;
}

export function userCard(account: OwnAccount): UserCard {
  const { nick, greeting, wins, losses, cell, rank, manner, exp, guild, level } = account;
  return { nick, greeting, wins, losses, cell, rank, manner, exp, guild, level };
}

/** The name a room slot and the game's panel show: the ID with the ID check on (+0x68), else the nick. */
export function shownName(player: { name: string; nick: string; useId: boolean }): string {
  return player.useId || !player.nick ? player.name : player.nick;
}

/** guild.dat's lines (0x4416f0 counts them into [0x496c8c]): marks 0..264. */
export const GUILD_COUNT = 265;

/** The ranking art's boxes: 15 rows a page (new_ranking.shk, ranking.shk; ranking.jpg @2002-03-25 shows 1..15). */
export const RANKING_PAGE_ROWS = 15;

/**
 * A ranklist_2.asp row as 0x447290 reads it: rank, ID, cell point, wins, level, a field never read
 * (not sent), guild, gender. The remake's genders are all 0 (R).
 */
export interface RankingRow {
  rank: number;
  id: string;
  cell: number;
  wins: number;
  level: number;
  guild: number;
  gender: number;
}

/** A player with no account (two on one keyboard): no guild mark, no level badge (0x442900 draws 1..12). */
export const NO_BADGE: Badge = { guild: -1, level: 0 };

export function badgeOf(card: Badge): Badge {
  return { guild: card.guild, level: card.level };
}

export type ClientMessage =
  /** The login's OK to the auth server (C->S 0x0a, 0x44f920): ID and password. */
  | { type: "login"; id: string; password: string }
  /** 가입하기 (Regist_UP_shake2.asp): the sign-up window's ID, nick and password. */
  | { type: "register"; id: string; nick: string; password: string }
  /** 아이디검색 and 닉네임검색 (idcheck.asp modes 1 and 2). */
  | { type: "check-id"; id: string }
  | { type: "check-nick"; nick: string }
  /**
   * The game server's first word (C->S 0x47): the client's version, and the server list row it
   * connected to (the original's rows are each a host and port of their own).
   */
  | { type: "version"; version: number; channel: number }
  /** After the version (C->S 0x0a to the game server): the login's session. */
  | { type: "hello"; token: string }
  /** Title from the create popup; empty for the server's default. A password makes the room secret (C->S 0x03). */
  | { type: "create-room"; title: string; password?: string }
  /** A room's line, or the password popup's OK with the password typed (C->S 0x04). */
  | { type: "join-room"; code: string; password?: string }
  /** /go n (0x446747): C->S 0x04 with the room's index, n - 1, as the list's own join sends it. */
  | { type: "join-number"; number: number }
  /** A right click on a room's line: its status and players (C->S 0x55). */
  | { type: "room-info"; code: string }
  | { type: "leave-room" }
  | { type: "set-ready"; ready: boolean }
  /** A map id or RANDOM_MAP (C->S 0x53). */
  | { type: "set-map"; mapId: string }
  /** Host only: the room's tune, 0 for RANDOM or 1.. into the welcome's list (C->S 0x54). */
  | { type: "set-music"; music: number }
  /** Host only: close or open an empty slot (C->S 0x45). */
  | { type: "set-slot"; slot: number; open: boolean }
  /** One chat line (0x43f7a0): to the room, or to the lobby outside a room. */
  | { type: "chat"; text: string }
  /** Host only: the room's game mode (C->S 0x56). */
  | { type: "set-mode"; mode: GameMode }
  /** Own team 1..6 (SELECTTEAM, C->S 0x2e). */
  | { type: "set-team"; team: number }
  | { type: "start" }
  | { type: "input"; dir: Dir | null; bomb: boolean; attack: boolean; evade: boolean; paused?: boolean }
  /** One line in a match (0x446200: record type 0x14 to the host, which passes it on). */
  | { type: "game-chat"; text: string }
  /** A server list row's load query (C->S 0x4c, 0x448410); taken before hello. */
  | { type: "server-info"; channel: number; requestId: number }
  /**
   * The my-info window's O (C->S 0x1a) in the lobby, or scene 5's Go (the old 0x1a) over the auth
   * connection: the character to play with, its hue and whether the ID is shown.
   */
  | { type: "set-character"; character: string; hue: number; useId: boolean }
  /** Scene 5's 확인 (C->S 0x48, 0x4480c0): the ID check, the nick and the greeting. */
  | { type: "set-status"; nick: string; greeting: string; useId: boolean }
  /** The my-info window's greeting popup (C->S 0x58, 0x44b120). */
  | { type: "set-greeting"; greeting: string }
  /**
   * Scene 5's pw ▶ (the old C->S 0x4a, 0x448290): the guild.dat line to join, −1 to leave. The
   * remake's guilds have no passwords, so none is sent (R).
   */
  | { type: "set-guild"; guild: number }
  /** The ranking's page (ranklist_2.asp?page=N, 0x447290), 1 the first: scene 5's and the lobby's ranking window. */
  | { type: "ranking"; page: number; requestId: number }
  /** FIND (ranklist_2.asp?search=ID, 0x447700): the page the ID is on. */
  | { type: "ranking-search"; id: string; requestId: number }
  /** The own chat line is open or closed: the keys go unread and the "chat" mark shows (state packet +0x2c). */
  | { type: "typing"; on: boolean }
  /** The option window's friend list (C->S 0x63): the own list and where each friend is now. */
  | { type: "friends" }
  /** The friend popup's O on an empty row (C->S 0x64); "" is sent too, as the popup sends it. */
  | { type: "add-friend"; name: string }
  /** The friend popup's O on a row with an ID (C->S 0x65). */
  | { type: "delete-friend"; name: string }
  /** /w id msg (C->S 0x07): the message to one player, by name. */
  | { type: "whisper"; to: string; text: string }
  /** /users (C->S 0x4c): how many are connected. */
  | { type: "users" }
  /** /wyes, /wno (C->S 0x60): whether whispers reach this player. */
  | { type: "whisper-allow"; on: boolean }
  /** /ban id (C->S 0x44): the host puts the player in that slot out of the room. */
  | { type: "kick"; slot: number }
  /** A match's ping record (action 0x15, 0x40c689): the sender's clock, sent back as it came. */
  | { type: "ping"; at: number }
  /** What the own state packet carries for the panel's bars: frames per second (+0x24) and ping (+0x28). */
  | { type: "stats"; fps: number; ping: number };

/** A player's state packet (type 0xa) goes out no oftener than this ([0x492b0c], 0x40c5b2). */
export const TYPING_PACKET_MS = 300;

/**
 * The sender's rule for its state packet, which carries the "chat" mark (+0x2c): the round is being
 * played (no result, wait or countdown flag), the player is not gone and not in a 순간이동 flight
 * (+0x1c4), and 300 ms have passed since the last one (0x40c4e8-0x40c5b8). Its `anim / 4 != 8` test
 * is left out: no known setter gives a player anim 32-35, and a character sheet has at most 24.
 */
export function typingPacketDue(phase: Phase, player: Pick<PlayerState, "gone" | "flight">, now: number, sentAt: number): boolean {
  return phase === "playing" && !player.gone && player.flight === null && now - sentAt >= TYPING_PACKET_MS;
}

/** A world load sets every player's bar A to 30 (0x44fd3f) and clears bar B's table (0x44ef7b). */
export const START_BARS = { fps: 30, ping: 0 } as const;

/** A player's two panel bars as the peers last took them from its state packet (0x45d3dc, 0x45d3ea). */
export interface PanelBar {
  id: number;
  /** Bar A (`+0x234`): the frames its screen drew in the last second. */
  fps: number;
  /** Bar B (`[0x48be58 + 4·slot]`): its round trip to the host in ms. */
  ping: number;
}

export interface LobbyPlayer {
  id: number;
  /** The login ID (+0). */
  name: string;
  /** +0x14; the slot and the game's panel show it unless `useId` (+0x68). */
  nick: string;
  useId: boolean;
  character: string;
  /** −180..180 (+0x90). */
  hue: number;
  /** 전적's first number at the join (+0x28). */
  wins: number;
  cell: number;
  badge: Badge;
  ready: boolean;
  /** Room slot team (+0x74), 1..6; kept in every mode. */
  team: number;
  /** Room slot 0..5 (+0x6c); players are listed in slot order. */
  slot: number;
}

export interface RoomInfo {
  code: string;
  /** The server's room index; the room shows "%03d" of number + 1 (0x440660). */
  number: number;
  title: string;
  hostId: number;
  /** A map id or RANDOM_MAP. */
  mapId: string;
  /** 0 = RANDOM, else entry music - 1 of the welcome's list. */
  music: number;
  mode: GameMode;
  /** Per slot 0..5: closed by the host (+0x8c). */
  closed: boolean[];
  players: LobbyPlayer[];
  playing: boolean;
}

/** A room's line in the lobby's list (the record at 0x484730 + 0x34 i). */
export interface RoomSummary {
  code: string;
  number: number;
  title: string;
  /** A map id or RANDOM_MAP (+0x18). */
  mapId: string;
  mode: GameMode;
  /** Players in the room (+0x1c). */
  players: number;
  /** Open slots (+0x20); "Full" when every one is taken. */
  max: number;
  /** +0x24 = 0. */
  playing: boolean;
  /** +0x28: a password guards it; the password itself never leaves the server. */
  secret: boolean;
}

/** A player in the lobby's user list (0x470bf0 + 0xe0 i): the row shows the ID, a click the card. */
export interface LobbyUser {
  id: number;
  name: string;
  card: UserCard;
}

/** The room info's status (+0xc): a round in play, the match over, or waiting. */
export type RoomStatus = "round" | "over" | "waiting";

export type ChatKind = "talk" | "enter" | "leave" | "host-leave";

/** Match state without the parts that never change during a match or are sent separately. */
export type WireState = Omit<MatchState, "layout" | "events">;

export type ServerMessage =
  | {
      type: "welcome";
      playerId: number;
      /** The login record as this channel sends it (S->C 0x0a): the account now. */
      account: OwnAccount;
      /** The room's map list without RANDOM, in its order (_stricmp of the titles). */
      maps: { id: string; title: string }[];
      /** The game tunes without RANDOM, in the list's order (_stricmp of the file names). */
      music: string[];
      characters: string[];
    }
  /** What the lobby shows; sent to the players in the lobby when it changes. `channel` is the banner's name. */
  | { type: "lobby"; channel: string; rooms: RoomSummary[]; users: LobbyUser[] }
  /** The room info popup's data (S->C 0x55): a match's round, or waiting, and the players by slot. */
  | { type: "room-info"; code: string; status: RoomStatus; round: number; players: { slot: number; name: string; badge: Badge }[] }
  /** One lobby chat line. */
  | { type: "lobby-chat"; name: string; text: string }
  /** Slot/team replies apply their cursor setting even if the room state did not change. */
  | { type: "room"; room: RoomInfo | null; change?: RoomChange }
  /** `music` is the tune picked for the match: 1.. into the welcome's list, 0 for none. */
  | { type: "match-start"; layout: LevelLayout; music: number }
  /**
   * A room chat line; `enter` and `leave` carry the player's name only (0x446ae0 kinds 2 and 3),
   * `host-leave` the leaving host's, as S->C 0x40 does when it hands the room to a new host.
   */
  | { type: "chat"; kind: ChatKind; name: string; text: string }
  /** `typing`: the players whose chat line is open (state packet +0x2c); `bars`: the panel's bars by slot. */
  | { type: "snapshot"; state: WireState; events: SimEvent[]; typing: number[]; bars: PanelBar[] }
  /** The ping record back (0x444929), for the round trip (0x44497c). */
  | { type: "pong"; at: number }
  /** The saved character (S->C 0x1a): the my-info window's "수정 되었습니다.". */
  | { type: "profile"; character: string; hue: number; useId: boolean }
  /** A server list row's data (S->C 0x4c): the channel's name and its load in percent. */
  | { type: "server-info"; channel: number; name: string; load: number; requestId: number }
  /** The auth server's answer (S->C 0x0a): the account, the session for the game servers and their rows. */
  | { type: "login"; ok: true; account: OwnAccount; token: string; channels: ChannelRow[] }
  /** "로그인 실패": the client has no other auth message (0x448ad4). */
  | { type: "login"; ok: false }
  /** The sign-up's rcode (0x41bae8). */
  | { type: "registered"; rcode: number }
  /** A check's rcode: 0 free, anything else taken. */
  | { type: "checked"; kind: "id" | "nick"; rcode: number }
  /** The game server's version (S->C 0x47); a server with no room closes before sending it. */
  | { type: "version"; version: number }
  /** hello refused (S->C 0x0a result): 0 "로그인 실패", 2 "이미 로그인 되어 있습니다", 3 "레벨이 맞지 않습니다". */
  | { type: "refused"; code: number }
  /** A ranking page's rows, none past the last page (the client then keeps the list it has). */
  | { type: "ranking"; page: number; rows: RankingRow[]; requestId: number }
  /** FIND's answer: the ID's page and its rows, or null ("Not Found") for an ID not ranked. */
  | { type: "ranking-search"; page: number | null; rows: RankingRow[]; requestId: number }
  /** The notice line (S->C 0x50): the lobby's, the room's and the match's bottom text for 60 s. */
  | { type: "notice"; text: string }
  /** Scene 5's notices (S->C 0x101): lines each ended by "\n", drawn down its right side. */
  | { type: "status-notice"; text: string }
  /** A save taken (scene 5's Go and 확인, the greeting popup's S->C 0x58): the account now. */
  | { type: "saved"; account: OwnAccount }
  /** A nick not taken (S->C 0x57, 0x44b080): 0xfc once a day, 0xfd taken by another, 0xfe any other failure. */
  | { type: "nick-refused"; code: number }
  /** A line said in the match, to everyone in it, the speaker too (0x444500 → 0x45ec00). */
  | { type: "game-chat"; playerId: number; text: string }
  | { type: "match-end" }
  /**
   * The friend list (S->C 0x63), in the order asked: the channel's name for one in the lobby,
   * "%03d번 방" for one in a room, "" for one not connected; the badge null for an ID no account has.
   */
  | { type: "friends"; friends: { name: string; location: string; badge: Badge | null }[] }
  /** The add's result (S->C 0x64): 1, or -1..-5 for the refusals of the table at 0x44c19c. */
  | { type: "friend-added"; result: number; name: string }
  /** The delete's result (S->C 0x65): 1, or anything else for "삭제 실패". */
  | { type: "friend-deleted"; result: number; name: string }
  /** A whisper (S->C 0x07): the sender's name and the message; the sender gets nothing back. */
  | { type: "whisper"; from: string; text: string }
  /** /users's answer (S->C 0x4c): the players connected. */
  | { type: "users"; count: number }
  /** /wyes or /wno taken (S->C 0x60). */
  | { type: "whisper-allowed"; on: boolean }
  /**
   * S->C 0x44: `ok` (+0x10 = 1) to everyone in the room, the one put out too; a refusal to the
   * host alone. Either way it ends the host's busy cursor.
   */
  | { type: "kick"; slot: number; ok: boolean }
  /** Join reply 3 (S->C 0x04, 0x444ffd): the room wants its password; the password popup opens for it. */
  | { type: "join-password"; code: string }
  | { type: "error"; message: string };

export function toWireState(state: MatchState): WireState {
  const { layout: _layout, events: _events, ...rest } = state;
  return rest;
}

export function fromWireState(wire: WireState, layout: LevelLayout): MatchState {
  return { ...wire, layout, events: [] };
}

type Json = Record<string, unknown>;

function isObject(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isDir(value: unknown): value is Dir | null {
  return value === null || value === 0 || value === 1 || value === 2 || value === 3;
}

function isInt(value: unknown, min: number, max: number): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= min && value <= max;
}

/** An ID, nick or password as an editor could send it: a string of at most 32 characters; the server checks the rest. */
function shortText(value: unknown): value is string {
  return typeof value === "string" && value.length <= 32;
}

function isTeam(value: unknown): value is number {
  return isInt(value, 1, TEAM_COUNT);
}

/** Strip control characters, trim, and cap to MAX_NAME_LENGTH code points. */
export function sanitizeName(raw: string): string {
  const cleaned = [...raw.replace(/\p{Cc}|\p{Cf}/gu, "").trim()].slice(0, MAX_NAME_LENGTH).join("");
  return cleaned || "플레이어";
}

/** A room title as the create popup sends it: cp949 text, spaces trimmed (0x4300d0), at most 19 bytes. */
export function roomTitle(raw: string): string {
  return trimSpaces(cutBytes(trimSpaces(typeable(raw)), ROOM_TITLE_BYTES));
}

/**
 * A password as an editor holds it (cp949, at most `limit` bytes, not trimmed); "" for none, and
 * null for anything that is not a string of at most 64 characters.
 */
function password(raw: unknown, limit: number): string | null {
  if (raw === undefined) return "";
  return typeof raw === "string" && raw.length <= 64 ? cutBytes(typeable(raw), limit) : null;
}

/** A chat line the room's editor could have held, trailing spaces and tabs cut (0x446200); null if there is nothing to send. */
export function chatLine(raw: string): string | null {
  const text = trimChat(typeable(raw));
  return text !== "" && cp949Bytes(text) < ROOM_CHAT_LIMIT ? text : null;
}

/** A chat line the match's editor could have held, trailing spaces and tabs cut (0x446200); null if there is nothing to send. */
export function gameChatLine(raw: string): string | null {
  const text = trimChat(typeable(raw));
  return text !== "" && cp949Bytes(text) < GAME_CHAT_LIMIT ? text : null;
}

/** An ID the friend popup or the ranking's FIND could have typed (editors of 0xb): cp949, 1 to 10 bytes. */
export function isFriendId(value: unknown): value is string {
  return typeof value === "string" && value !== "" && typeable(value) === value && cp949Bytes(value) <= FRIEND_ID_BYTES;
}

export function isRoomCode(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length === ROOM_CODE_LENGTH &&
    [...value].every((ch) => ROOM_CODE_ALPHABET.includes(ch))
  );
}

/** Parse and validate one client message; anything unexpected yields null. */
export function parseClientMessage(raw: string): ClientMessage | null {
  if (raw.length > MAX_MESSAGE_BYTES) return null;
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isObject(data) || typeof data.type !== "string") return null;
  switch (data.type) {
    case "login":
      return shortText(data.id) && shortText(data.password) ? { type: "login", id: data.id, password: data.password } : null;
    case "register":
      return shortText(data.id) && shortText(data.nick) && shortText(data.password)
        ? { type: "register", id: data.id, nick: data.nick, password: data.password }
        : null;
    case "check-id":
      return shortText(data.id) ? { type: "check-id", id: data.id } : null;
    case "check-nick":
      return shortText(data.nick) ? { type: "check-nick", nick: data.nick } : null;
    case "version":
      return isInt(data.version, 0, 0xffff) && isInt(data.channel, 0, MAX_CHANNELS - 1)
        ? { type: "version", version: data.version, channel: data.channel }
        : null;
    case "hello":
      return typeof data.token === "string" && data.token.length <= 64 ? { type: "hello", token: data.token } : null;
    case "set-greeting":
      return typeof data.greeting === "string" && data.greeting.length <= 64 ? { type: "set-greeting", greeting: data.greeting } : null;
    case "set-guild":
      return isInt(data.guild, -0x8000, 0x7fff) ? { type: "set-guild", guild: data.guild } : null;
    case "ranking":
      return isInt(data.page, 1, 0x7fffffff) && isInt(data.requestId, 1, Number.MAX_SAFE_INTEGER)
        ? { type: "ranking", page: data.page, requestId: data.requestId }
        : null;
    case "ranking-search":
      return isFriendId(data.id) && isInt(data.requestId, 1, Number.MAX_SAFE_INTEGER)
        ? { type: "ranking-search", id: data.id, requestId: data.requestId }
        : null;
    case "set-status":
      return shortText(data.nick) && typeof data.greeting === "string" && data.greeting.length <= 64 && typeof data.useId === "boolean"
        ? { type: "set-status", nick: data.nick, greeting: data.greeting, useId: data.useId }
        : null;
    case "create-room": {
      const title = data.title ?? "";
      const secret = password(data.password, ROOM_PASSWORD_BYTES);
      if (typeof title !== "string" || title.length > 64 || secret === null) return null;
      return { type: "create-room", title: roomTitle(title), ...(secret && { password: secret }) };
    }
    case "leave-room":
    case "start":
      return { type: data.type };
    case "join-room": {
      const code = typeof data.code === "string" ? data.code.trim().toUpperCase() : null;
      const secret = password(data.password, JOIN_PASSWORD_BYTES);
      if (!isRoomCode(code) || secret === null) return null;
      return { type: "join-room", code, ...(secret && { password: secret }) };
    }
    case "room-info": {
      const code = typeof data.code === "string" ? data.code.trim().toUpperCase() : null;
      return isRoomCode(code) ? { type: "room-info", code } : null;
    }
    case "set-ready":
      return typeof data.ready === "boolean" ? { type: "set-ready", ready: data.ready } : null;
    case "set-map":
      return typeof data.mapId === "string" && data.mapId.length <= 32 ? { type: "set-map", mapId: data.mapId } : null;
    case "set-mode":
      return isGameMode(data.mode) ? { type: "set-mode", mode: data.mode } : null;
    case "set-team":
      return isTeam(data.team) ? { type: "set-team", team: data.team } : null;
    case "set-music":
      return isInt(data.music, 0, 99) ? { type: "set-music", music: data.music } : null;
    case "set-slot":
      return isInt(data.slot, 0, MAX_PLAYERS - 1) && typeof data.open === "boolean"
        ? { type: "set-slot", slot: data.slot, open: data.open }
        : null;
    case "chat": {
      const text = typeof data.text === "string" && data.text.length <= 200 ? chatLine(data.text) : null;
      return text === null ? null : { type: "chat", text };
    }
    case "game-chat": {
      const text = typeof data.text === "string" && data.text.length <= 200 ? gameChatLine(data.text) : null;
      return text === null ? null : { type: "game-chat", text };
    }
    case "server-info":
      return isInt(data.channel, 0, MAX_CHANNELS - 1) && isInt(data.requestId, 1, Number.MAX_SAFE_INTEGER)
        ? { type: "server-info", channel: data.channel, requestId: data.requestId } : null;
    case "set-character":
      return typeof data.character === "string" && data.character.length <= 32 && isInt(data.hue, -180, 180) && typeof data.useId === "boolean"
        ? { type: "set-character", character: data.character, hue: data.hue, useId: data.useId }
        : null;
    case "typing":
      return typeof data.on === "boolean" ? { type: "typing", on: data.on } : null;
    case "friends":
      return { type: "friends" };
    case "add-friend":
      return data.name === "" || isFriendId(data.name) ? { type: "add-friend", name: data.name } : null;
    case "delete-friend":
      return isFriendId(data.name) ? { type: "delete-friend", name: data.name } : null;
    case "join-number":
      return isInt(data.number, -0x80000000, 0x7fffffff) ? { type: "join-number", number: data.number } : null;
    case "whisper": {
      // The ID is only compared with the names said in hello, never passed on.
      if (typeof data.to !== "string" || typeof data.text !== "string" || data.to.length > 64 || data.text.length > 200) return null;
      const text = chatLine(data.text);
      return text === null ? null : { type: "whisper", to: data.to, text };
    }
    case "users":
      return { type: "users" };
    case "whisper-allow":
      return typeof data.on === "boolean" ? { type: "whisper-allow", on: data.on } : null;
    case "kick":
      return isInt(data.slot, 0, MAX_PLAYERS - 1) ? { type: "kick", slot: data.slot } : null;
    case "ping":
      return isInt(data.at, 0, Number.MAX_SAFE_INTEGER) ? { type: "ping", at: data.at } : null;
    case "stats":
      return isInt(data.fps, 0, 1000) && isInt(data.ping, 0, 0x7fffffff) ? { type: "stats", fps: data.fps, ping: data.ping } : null;
    case "input": {
      const attack = data.attack ?? false;
      const evade = data.evade ?? false;
      if (!isDir(data.dir) || typeof data.bomb !== "boolean") return null;
      if (typeof attack !== "boolean" || typeof evade !== "boolean") return null;
      if (data.paused !== undefined && typeof data.paused !== "boolean") return null;
      return { type: "input", dir: data.dir, bomb: data.bomb, attack, evade, ...(data.paused !== undefined && { paused: data.paused }) };
    }
    default:
      return null;
  }
}
