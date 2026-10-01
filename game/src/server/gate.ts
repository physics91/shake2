// The doors in front of the lobbies. The original ran an auth server (211.202.3.129:3104: login and
// the server list's rows) and a game server per row (version check, then a login with the codes of
// the ID and password). The remake runs all of them in one process on one WebSocket path: a
// connection logs in (the auth part), and a connection that names a row with its version and brings
// the login's session goes into that row's lobby (the game part). How the servers knew the player
// is not in the client, so sessions, the throttle and the refusals' causes are the remake's (R).
import type { AccountBook, AccountRecord } from "./accounts.ts";
import { GREETING_MAX_BYTES, isNick, levelFor, nameKey, NO_GUILD, REGISTERED } from "./accounts.ts";
import { cutBytes, typeable } from "./cp949.ts";
import { hasItem, ITEM_NICK } from "./items.ts";
import type { Lobby } from "./lobby.ts";
import type { ChannelRow, ClientMessage, OwnAccount, RankingRow } from "./protocol.ts";
import { GUILD_COUNT, PROTOCOL_VERSION, RANKING_PAGE_ROWS } from "./protocol.ts";
import type { Peer } from "./room.ts";

/** A session nothing has used for this long is forgotten; the client logs in again. */
export const SESSION_IDLE_MS = 12 * 60 * 60 * 1000;
/**
 * Logins are checked one at a time per address (address.ts), and after the n-th wrong one in a row
 * that address's next check waits min(LOGIN_RETRY_MS · 2^(n−1), LOGIN_RETRY_MAX_MS), as the lobby's
 * secret-room guard does. Wrong ones are forgotten LOGIN_FAILURES_KEPT_MS after the last.
 */
export const LOGIN_RETRY_MS = 500;
export const LOGIN_RETRY_MAX_MS = 30_000;
export const LOGIN_FAILURES_KEPT_MS = 600_000;
/** One sign-up per address in this long. */
export const SIGN_UP_INTERVAL_MS = 10_000;
/** The ID and nick checks, at most this often per address. */
export const CHECK_INTERVAL_MS = 250;

/** A nick changes once in this long ("1일 1회사용 가능", the nickname item's line). */
export const NICK_CHANGE_INTERVAL_MS = 24 * 60 * 60 * 1000;
/** The nickname popup's refusals (S->C 0x57, 0x44b080). */
export const NICK_ONCE = 0xfc;
export const NICK_TAKEN_CODE = 0xfd;
export const NICK_FAILED = 0xfe;

/** S->C 0x4a's refusal text (resource 36, 0x445464 for an id below −1). */
export const GUILD_FAILED = "길드 수정 실패";

/** hello's refusals (S->C 0x0a +8, 0x445970): the client's texts for 0, 2 and 3. */
export const REFUSED_LOGIN = 0;
export const REFUSED_DUPLICATE = 2;
export const REFUSED_LEVEL = 3;

/** A server list row and its lobby. */
export interface Channel {
  row: ChannelRow;
  lobby: Lobby;
  /** The players it takes; the next one is closed on before the version reply. */
  maxUsers: number;
  /** The levels it lets in, best first (1..12); any when absent. */
  levels?: readonly [number, number];
}

export interface GatePeer extends Peer {
  /** Ends the connection (a full channel's answer). */
  close(): void;
}

export interface GateConfig {
  accounts: AccountBook;
  channels: readonly Channel[];
  /** The characters an account may pick (the manifest's). */
  characters: readonly string[];
  now(): number;
  /** A fresh session token (random, unguessable). */
  token(): string;
  /** The operator's notice line (S->C 0x50), sent to each session let into a channel. */
  notice?: string;
  /** The operator's scene 5 notices (S->C 0x101), sent after each login. */
  statusNotice?: string;
}

type AuthMessage = Extract<ClientMessage, { type: "login" | "register" | "check-id" | "check-nick" }>;

interface Connection {
  peer: GatePeer;
  /** The account logged in on this connection, as its name key. */
  account: string | null;
  /** The row the version named, once the version matched. */
  channel: number | null;
  /** In the channel's lobby. */
  joined: boolean;
  /** An auth request of this connection is waiting its turn; more are dropped until it is answered. */
  waiting: boolean;
}

interface Session {
  account: string;
  lastUsed: number;
}

/** One address's auth requests: the wrong logins in a row, and the requests waiting their turn. */
interface AuthGuard {
  failures: number;
  lastFailureAt: number;
  readyAt: number;
  lastSignUpAt: number;
  busy: boolean;
  queue: { connectionId: number; message: AuthMessage }[];
}

/** The login record as the client reads it (0x448c50), for the account's owner only. */
export function ownAccount(account: AccountRecord, book: AccountBook): OwnAccount {
  const { rank, level } = book.standing(account.id);
  return {
    id: account.id,
    nick: account.nick,
    greeting: account.greeting,
    character: account.character,
    hue: account.hue,
    useId: account.useId,
    wins: account.wins,
    losses: account.losses,
    cell: account.cell,
    level,
    guild: account.guild,
    rank,
    gender: 0,
    manner: 0,
    exp: 0,
    candy: account.candy,
    items: [...account.items],
    pairs: [...account.pairs],
  };
}

function greetingText(greeting: string): string {
  return cutBytes(typeable(greeting).trim(), GREETING_MAX_BYTES).trim();
}

export class Gate {
  private readonly config: GateConfig;
  private readonly connections = new Map<number, Connection>();
  private readonly sessions = new Map<string, Session>();
  /** Each account's session token: a new login replaces the old one. */
  private readonly tokenOf = new Map<string, string>();
  /** Accounts in a channel now, by name key: the connection that holds each. */
  private readonly online = new Map<string, number>();
  private readonly guards = new Map<string, AuthGuard>();
  /** The requests being answered now (a password being hashed or checked). */
  private readonly answering = new Set<Promise<void>>();

  constructor(config: GateConfig) {
    this.config = config;
  }

  connect(peer: GatePeer): void {
    this.connections.set(peer.id, { peer, account: null, channel: null, joined: false, waiting: false });
  }

  disconnect(id: number): void {
    const connection = this.connections.get(id);
    if (!connection) return;
    this.connections.delete(id);
    if (!connection.joined || connection.channel === null) return;
    this.config.channels[connection.channel]?.lobby.disconnect(id);
    if (connection.account !== null && this.online.get(connection.account) === id) this.online.delete(connection.account);
    this.touch(connection.account);
  }

  handle(id: number, message: ClientMessage): void {
    const connection = this.connections.get(id);
    if (!connection) return;
    switch (message.type) {
      case "login":
        // The game servers' connections never log in again (the original's auth socket is its own).
        if (!connection.joined) this.enqueue(connection, message);
        return;
      case "register":
      case "check-id":
      case "check-nick":
        this.enqueue(connection, message);
        return;
      case "server-info":
        this.serverInfo(connection, message.channel);
        return;
      case "version":
        this.version(connection, message.version, message.channel);
        return;
      case "hello":
        this.hello(connection, message.token);
        return;
      case "set-greeting":
        this.setGreeting(connection, message.greeting);
        return;
      case "set-status":
        this.setStatus(connection, message.nick, message.greeting, message.useId);
        return;
      case "set-guild":
        this.setGuild(connection, message.guild);
        return;
      case "ranking":
        if (connection.account !== null) connection.peer.send({ type: "ranking", page: message.page, rows: this.rankingRows(message.page) });
        return;
      case "ranking-search":
        if (connection.account !== null) this.searchRanking(connection, message.id);
        return;
      case "set-character":
        if (!connection.joined) {
          this.setCharacter(connection, message.character, message.hue, message.useId);
          return;
        }
        break;
    }
    if (connection.joined && connection.channel !== null) {
      this.config.channels[connection.channel]?.lobby.handle(id, message);
      return;
    }
    connection.peer.send({ type: "error", message: "먼저 로그인해야 합니다." });
  }

  /** Answers the auth requests whose turn has come (called on every server tick). */
  tick(): void {
    const now = this.config.now();
    for (const [key, guard] of this.guards) {
      this.drain(guard);
      const forgotten = guard.failures === 0 || now - guard.lastFailureAt >= LOGIN_FAILURES_KEPT_MS;
      const signUpDone = now - guard.lastSignUpAt >= SIGN_UP_INTERVAL_MS;
      if (!guard.busy && guard.queue.length === 0 && forgotten && signUpDone && now >= guard.readyAt) this.guards.delete(key);
    }
  }

  /** Accounts in a channel now (for the tests and the log). */
  get onlineCount(): number {
    return this.online.size;
  }

  private rows(): ChannelRow[] {
    return this.config.channels.map((c) => ({ ...c.row }));
  }

  /** A connection's users on a row: those in its lobby and those between the version and hello. */
  private usersOn(channel: number): number {
    let users = 0;
    for (const connection of this.connections.values()) if (connection.channel === channel) users++;
    return users;
  }

  /**
   * The server list row's load query (C->S 0x4c): users / capacity · 100 (0x448410). The users are
   * the lobby's; the capacity check also counts those between their version and hello.
   */
  private serverInfo(connection: Connection, index: number): void {
    const channel = this.config.channels[index];
    if (!channel) return;
    const load = Math.min(100, Math.trunc((channel.lobby.userCount / Math.max(1, channel.maxUsers)) * 100));
    connection.peer.send({ type: "server-info", channel: index, name: channel.row.name, load });
  }

  /**
   * C->S 0x47: a full row closes before answering ("사용자가 너무 많습니다", 0x460dde); otherwise the
   * server's version goes back and the client compares (0x445378). A client of another version gets
   * the answer but no hello.
   */
  private version(connection: Connection, version: number, index: number): void {
    if (connection.channel !== null || connection.joined) return;
    const channel = this.config.channels[index];
    if (!channel || this.usersOn(index) >= channel.maxUsers) {
      connection.peer.close();
      return;
    }
    if (version === PROTOCOL_VERSION) connection.channel = index;
    connection.peer.send({ type: "version", version: PROTOCOL_VERSION });
  }

  private hello(connection: Connection, token: string): void {
    if (connection.channel === null || connection.joined) return;
    const channel = this.config.channels[connection.channel];
    const session = this.session(token);
    const account = session && this.config.accounts.get(session.account);
    const refuse = (code: number) => {
      connection.channel = null;
      connection.peer.send({ type: "refused", code });
    };
    if (!channel || !session || !account) return refuse(REFUSED_LOGIN);
    if (this.online.has(session.account)) return refuse(REFUSED_DUPLICATE);
    const own = ownAccount(account, this.config.accounts);
    if (channel.levels && (own.level < channel.levels[0] || own.level > channel.levels[1])) return refuse(REFUSED_LEVEL);
    connection.account = session.account;
    connection.joined = true;
    this.online.set(session.account, connection.peer.id);
    session.lastUsed = this.config.now();
    // When the original server sent S->C 0x50 is not known; the remake sends the operator's line on
    // entering, so it shows in the lobby in place of the F1 hint (R).
    if (this.config.notice) connection.peer.send({ type: "notice", text: this.config.notice });
    channel.lobby.join(connection.peer, own);
  }

  /**
   * A ranklist_2.asp page: 15 rows of the accounts that have finished a match, by cell point.
   * The original's server was open to anyone on port 8080 and ranked once a day; the remake's
   * answers logged-in connections, auth or lobby, and ranks as asked (R).
   */
  private rankingRows(page: number): RankingRow[] {
    const { accounts } = this.config;
    const ranking = accounts.ranking();
    const first = (page - 1) * RANKING_PAGE_ROWS;
    return ranking.slice(first, first + RANKING_PAGE_ROWS).map((account, i) => {
      const rank = first + i + 1;
      return { rank, id: account.id, cell: account.cell, wins: account.wins, level: levelFor(rank, ranking.length), guild: account.guild, gender: 0 };
    });
  }

  /** ?search=ID: the page the ID is on and its rows, or "Not Found" for an ID not ranked. */
  private searchRanking(connection: Connection, id: string): void {
    const index = this.config.accounts.rankedIndex(id);
    const page = index < 0 ? null : Math.floor(index / RANKING_PAGE_ROWS) + 1;
    connection.peer.send({ type: "ranking-search", page, rows: page === null ? [] : this.rankingRows(page) });
  }

  /** Scene 5's Go (the old C->S 0x1a) over the auth connection: the character, hue and use-ID flag. */
  private setCharacter(connection: Connection, character: string, hue: number, useId: boolean): void {
    if (connection.account === null) return;
    if (!this.config.characters.includes(character)) {
      connection.peer.send({ type: "error", message: "알 수 없는 캐릭터입니다." });
      return;
    }
    this.save(connection, { character, hue, useId });
  }

  /** The greeting popup (C->S 0x58): cut to what the login record holds. */
  private setGreeting(connection: Connection, greeting: string): void {
    if (connection.account === null) return;
    this.save(connection, { greeting: greetingText(greeting) });
  }

  /**
   * Scene 5's pw ▶ (the old C->S 0x4a): a guild.dat line past "없음", or −1 to leave (R: the lost
   * server's guilds had passwords and masters; the remake's are guild.dat's, open to all).
   */
  private setGuild(connection: Connection, guild: number): void {
    if (connection.account === null) return;
    if (guild !== NO_GUILD && (guild < 1 || guild >= GUILD_COUNT)) {
      connection.peer.send({ type: "error", message: GUILD_FAILED });
      return;
    }
    this.save(connection, { guild });
  }

  /** Scene 5's 확인 (C->S 0x48): the nick by the nickname popup's rules, then the rest with it. */
  private setStatus(connection: Connection, nick: string, greeting: string, useId: boolean): void {
    const account = connection.account === null ? undefined : this.config.accounts.get(connection.account);
    if (!account) return;
    const refusal = this.nickRefusal(account, nick);
    if (refusal !== null) {
      connection.peer.send({ type: "nick-refused", code: refusal });
      return;
    }
    const change: Partial<AccountRecord> = { greeting: greetingText(greeting), useId };
    if (nick !== account.nick) Object.assign(change, { nick, nickChangedAt: this.config.now() });
    this.save(connection, change);
  }

  /**
   * The nickname popup's rules (R: the server's are lost): the nickname item, a nick the sign-up
   * would take, once a day, and nobody else's. The same nick is no change.
   */
  private nickRefusal(account: AccountRecord, nick: string): number | null {
    if (nick === account.nick) return null;
    if (!hasItem(account.items, ITEM_NICK) || !isNick(nick)) return NICK_FAILED;
    if (account.nickChangedAt > 0 && this.config.now() - account.nickChangedAt < NICK_CHANGE_INTERVAL_MS) return NICK_ONCE;
    const holder = this.config.accounts.byNickname(nick);
    return holder && holder !== account ? NICK_TAKEN_CODE : null;
  }

  private save(connection: Connection, change: Partial<Omit<AccountRecord, "id" | "password" | "createdAt">>): void {
    const key = connection.account;
    if (key === null) return;
    if (!this.config.accounts.update(key, change)) {
      connection.peer.send({ type: "nick-refused", code: NICK_TAKEN_CODE });
      return;
    }
    this.touch(key);
    const account = this.config.accounts.get(key);
    if (!account) return;
    const own = ownAccount(account, this.config.accounts);
    connection.peer.send({ type: "saved", account: own });
    // The account's lobby connection, if any, shows the change to the others.
    const joinedId = this.online.get(key);
    const joined = joinedId === undefined ? undefined : this.connections.get(joinedId);
    if (joinedId !== undefined && joined?.channel != null) this.config.channels[joined.channel]?.lobby.accountChanged(joinedId, own);
  }

  private session(token: string): Session | undefined {
    const session = this.sessions.get(token);
    if (!session) return undefined;
    // An account in a channel is using its session, as in startSession.
    if (this.online.has(session.account) || this.config.now() - session.lastUsed < SESSION_IDLE_MS) return session;
    this.sessions.delete(token);
    if (this.tokenOf.get(session.account) === token) this.tokenOf.delete(session.account);
    return undefined;
  }

  private touch(account: string | null): void {
    const token = account === null ? undefined : this.tokenOf.get(account);
    const session = token === undefined ? undefined : this.sessions.get(token);
    if (session) session.lastUsed = this.config.now();
  }

  /** A new session for the account; its old one, if any, is no longer good. */
  private startSession(account: string): string {
    const old = this.tokenOf.get(account);
    if (old !== undefined) this.sessions.delete(old);
    for (const [token, session] of this.sessions) {
      // An account in a channel is using its session; its idle time starts when it leaves (disconnect).
      if (this.online.has(session.account)) continue;
      if (this.config.now() - session.lastUsed >= SESSION_IDLE_MS) this.session(token);
    }
    const token = this.config.token();
    this.sessions.set(token, { account, lastUsed: this.config.now() });
    this.tokenOf.set(account, token);
    return token;
  }

  private guardKey(peer: Peer): string {
    return peer.address ?? `peer:${peer.id}`;
  }

  private enqueue(connection: Connection, message: AuthMessage): void {
    if (connection.waiting) return;
    const key = this.guardKey(connection.peer);
    let guard = this.guards.get(key);
    if (!guard) {
      guard = { failures: 0, lastFailureAt: 0, readyAt: 0, lastSignUpAt: -SIGN_UP_INTERVAL_MS, busy: false, queue: [] };
      this.guards.set(key, guard);
    }
    connection.waiting = true;
    guard.queue.push({ connectionId: connection.peer.id, message });
    this.drain(guard);
  }

  /** Starts the address's next request once its turn has come and nothing of it is being checked. */
  private drain(guard: AuthGuard): void {
    const now = this.config.now();
    while (!guard.busy && guard.queue.length > 0) {
      const next = guard.queue[0];
      const readyAt = next.message.type === "register" ? Math.max(guard.readyAt, guard.lastSignUpAt + SIGN_UP_INTERVAL_MS) : guard.readyAt;
      if (now < readyAt) return;
      guard.queue.shift();
      const connection = this.connections.get(next.connectionId);
      if (!connection) continue;
      guard.busy = true;
      const answer = this.answer(guard, connection, next.message).finally(() => {
        this.answering.delete(answer);
        guard.busy = false;
        connection.waiting = false;
        this.drain(guard);
      });
      this.answering.add(answer);
    }
  }

  /** Once no request is being answered: a sign-up whose password was being hashed is in the book by then. */
  async settled(): Promise<void> {
    while (this.answering.size > 0) await Promise.allSettled([...this.answering]);
  }

  private async answer(guard: AuthGuard, connection: Connection, message: AuthMessage): Promise<void> {
    const { accounts } = this.config;
    const send = connection.peer.send.bind(connection.peer);
    switch (message.type) {
      case "check-id":
        guard.readyAt = this.config.now() + CHECK_INTERVAL_MS;
        send({ type: "checked", kind: "id", rcode: accounts.checkId(message.id) });
        return;
      case "check-nick":
        guard.readyAt = this.config.now() + CHECK_INTERVAL_MS;
        send({ type: "checked", kind: "nick", rcode: accounts.checkNick(message.nick) });
        return;
      case "register": {
        const rcode = await accounts.register(message.id, message.nick, message.password, this.config.now());
        // Only a sign-up that made an account waits out the interval; a refused one may be fixed and sent again.
        if (rcode === REGISTERED) guard.lastSignUpAt = this.config.now();
        send({ type: "registered", rcode });
        return;
      }
      case "login": {
        const account = await accounts.authenticate(message.id, message.password);
        // Gone, or gone into a channel while the password was checked: no game server's connection logs in.
        if (!this.connections.has(connection.peer.id) || connection.joined) return;
        if (!account) {
          const now = this.config.now();
          if (now - guard.lastFailureAt >= LOGIN_FAILURES_KEPT_MS) guard.failures = 0;
          guard.failures++;
          guard.lastFailureAt = now;
          guard.readyAt = now + Math.min(LOGIN_RETRY_MS * 2 ** (guard.failures - 1), LOGIN_RETRY_MAX_MS);
          send({ type: "login", ok: false });
          return;
        }
        const key = nameKey(account.id);
        connection.account = key;
        const token = this.startSession(key);
        // S->C 0x101's time is not known either: with each login, just before its answer, so scene 5
        // (which follows the login here) has the lines as it opens (R).
        if (this.config.statusNotice) send({ type: "status-notice", text: this.config.statusNotice });
        send({ type: "login", ok: true, account: ownAccount(account, accounts), token, channels: this.rows() });
        return;
      }
    }
  }
}
