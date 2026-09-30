// Accounts, which the original kept on its auth server and web site (hanpanthe.net); both are lost,
// so the rules here are the remake's (R) unless an address or the site's archived pages give them.
// Pure but for the password hashing: the file they are kept in is accountFile.ts's.
import { cp949Bytes, typeable } from "./cp949.ts";
import { checkPassword, decoyHash, hashPassword, isPasswordHash } from "./passwords.ts";

/** The sign-up window's editors (0x41bd70) hold 10 bytes; 0x45f280 wants an ID of 4..10. */
export const ID_MIN_BYTES = 4;
export const ID_MAX_BYTES = 10;
export const NICK_MAX_BYTES = 10;
/** "비밀번호는 4글자 이상입니다." (0x41b3ee); the editor holds 10. */
export const PASSWORD_MIN_BYTES = 4;
export const PASSWORD_MAX_BYTES = 10;
/** The login record's greeting is a string under 36 bytes (0x448c50). */
export const GREETING_MAX_BYTES = 35;
/** Levels 1..12, 1 the best (0x469ca0); a new account is a 루키 (I). */
export const LOWEST_LEVEL = 12;
/** The guild of an account in none: no icon (0x441940 draws 0..264). */
export const NO_GUILD = -1;
/** Character pairs (0x484718): 0 루키/토피 … 9 한복두나/한복루키; the item slots hasItem reads (0x471754). */
export const PAIR_COUNT = 10;
export const ITEM_COUNT = 30;

/** Regist_UP_shake2.asp's rcode as the client words it (0x41bae8). */
export const REGISTERED = 0;
export const ID_UNUSABLE = 1;
export const ID_TAKEN = 4;
export const NICK_TAKEN = 5;
export const REGISTER_FAILED = 7;
export const ID_NOT_ALNUM = 8;
export const ID_DIGIT_FIRST = 9;

/**
 * Names no one may take: the sign-up page's (regist.js, 2002-02: shake, webmaster, gamemaster,
 * hanpanthe, master, admin, gm), the remake's own few, and "sys", which the chat's system lines
 * start with. Any case.
 */
const RESERVED = ["shake", "webmaster", "gamemaster", "hanpanthe", "master", "admin", "gm", "administrator", "operator", "guest", "system", "sysop", "aozora"];

/** 0x45f280 as the server checks it again: null for a good ID, else the rcode the client shows. */
export function idProblem(id: string): number | null {
  if (id.length < ID_MIN_BYTES || id.length > ID_MAX_BYTES) return REGISTER_FAILED;
  if (!/^[0-9A-Za-z]+$/.test(id)) return ID_NOT_ALNUM;
  if (/^[0-9]/.test(id)) return ID_DIGIT_FIRST;
  if (RESERVED.includes(id.toLowerCase()) || id.toLowerCase().startsWith("sys")) return ID_UNUSABLE;
  return null;
}

/** The client strips blanks (0x41c210) and the editor holds 10 bytes of cp949. */
export function isNick(nick: string): boolean {
  if (nick === "" || nick !== typeable(nick) || /\s/.test(nick) || cp949Bytes(nick) > NICK_MAX_BYTES) return false;
  const lower = nick.toLowerCase();
  return !RESERVED.includes(lower) && !lower.startsWith("sys");
}

export function isPassword(password: string): boolean {
  const bytes = cp949Bytes(password);
  return password === typeable(password) && !/\s/.test(password) && bytes >= PASSWORD_MIN_BYTES && bytes <= PASSWORD_MAX_BYTES;
}

/** IDs and nicks are one whichever their case, as the ranking's search compares them (_stricmp). */
export function nameKey(name: string): string {
  return name.toLowerCase();
}

export interface AccountRecord {
  /** The login ID as it was signed up. */
  id: string;
  nick: string;
  /** passwords.ts's hash. */
  password: string;
  greeting: string;
  /** A character id of the manifest. */
  character: string;
  /** −180..180 (login record field 20). */
  hue: number;
  /** Show the ID rather than the nick (login field 10). */
  useId: boolean;
  /** A guild.dat line, NO_GUILD for none (login field 12). */
  guild: number;
  wins: number;
  losses: number;
  /** 마이트너셀 포인트: what the ranking orders by. */
  cell: number;
  /** Candy picked up in play (item 0x27, login field 23). */
  candy: number;
  /** Item slots k owned (hasItem 0x45f140; the wire id is k + 1). */
  items: number[];
  /** Character pairs owned. */
  pairs: number[];
  /** When the nickname window last changed the nick; 0 never. */
  nickChangedAt: number;
  createdAt: number;
}

export interface AccountData {
  accounts: AccountRecord[];
}

export interface AccountDefaults {
  character: string;
  items: readonly number[];
  pairs: readonly number[];
}

/** Where an account stands among those that have finished a match. */
export interface Standing {
  /** 순위, 1 the first; 0 for an account not ranked yet. */
  rank: number;
  level: number;
}

/**
 * 한판더넷's level table (shake.hanpanthe.net/ranking/ranking.html, 2002-02-14): 1위, 8위까지,
 * 85위까지, then the top 1, 3, 5, 10, 20, 40, 60 and 80 %, and 루키 for the rest.
 */
export function levelFor(rank: number, ranked: number): number {
  if (rank <= 0 || ranked <= 0) return LOWEST_LEVEL;
  if (rank === 1) return 1;
  if (rank <= 8) return 2;
  if (rank <= 85) return 3;
  const percents = [1, 3, 5, 10, 20, 40, 60, 80];
  const step = percents.findIndex((percent) => rank <= (ranked * percent) / 100);
  return step < 0 ? LOWEST_LEVEL : 4 + step;
}

/** The ranking's order: cell points, then more wins, then the ID. */
function rankingOrder(a: AccountRecord, b: AccountRecord): number {
  return b.cell - a.cell || b.wins - a.wins || (nameKey(a.id) < nameKey(b.id) ? -1 : nameKey(a.id) > nameKey(b.id) ? 1 : 0);
}

function isRanked(account: AccountRecord): boolean {
  return account.wins + account.losses > 0;
}

export class AccountBook {
  private readonly byId = new Map<string, AccountRecord>();
  private readonly byNick = new Map<string, AccountRecord>();
  private readonly defaults: AccountDefaults;
  private readonly changed: () => void;
  private ranked: AccountRecord[] | null = null;

  constructor(data: AccountData | undefined, defaults: AccountDefaults, changed: () => void = () => undefined) {
    this.defaults = defaults;
    this.changed = changed;
    for (const account of data?.accounts ?? []) {
      const id = nameKey(account.id);
      const nick = nameKey(account.nick);
      // A later record with a taken ID or nick is dropped: the file was edited by hand.
      if (this.byId.has(id) || this.byNick.has(nick)) continue;
      this.byId.set(id, account);
      this.byNick.set(nick, account);
    }
  }

  get size(): number {
    return this.byId.size;
  }

  get(id: string): AccountRecord | undefined {
    return this.byId.get(nameKey(id));
  }

  byNickname(nick: string): AccountRecord | undefined {
    return this.byNick.get(nameKey(nick));
  }

  /** idcheck.asp mode 1: 0 when the ID could be signed up now, 1 when not. */
  checkId(id: string): number {
    return idProblem(id) === null && !this.byId.has(nameKey(id)) ? 0 : 1;
  }

  /** idcheck.asp mode 2. */
  checkNick(nick: string): number {
    return isNick(nick) && !this.byNick.has(nameKey(nick)) ? 0 : 1;
  }

  /** Regist_UP_shake2.asp: the rcode (0 signed up). */
  async register(id: string, nick: string, password: string, now: number): Promise<number> {
    const problem = idProblem(id);
    if (problem !== null) return problem;
    if (!isNick(nick) || !isPassword(password)) return REGISTER_FAILED;
    if (this.byId.has(nameKey(id))) return ID_TAKEN;
    if (this.byNick.has(nameKey(nick))) return NICK_TAKEN;
    const hash = await hashPassword(password);
    // Another sign-up may have taken either while the hash was made.
    if (this.byId.has(nameKey(id))) return ID_TAKEN;
    if (this.byNick.has(nameKey(nick))) return NICK_TAKEN;
    const account: AccountRecord = {
      id,
      nick,
      password: hash,
      greeting: "",
      character: this.defaults.character,
      hue: 0,
      useId: true,
      guild: NO_GUILD,
      wins: 0,
      losses: 0,
      cell: 0,
      candy: 0,
      items: [...this.defaults.items],
      pairs: [...this.defaults.pairs],
      nickChangedAt: 0,
      createdAt: now,
    };
    this.byId.set(nameKey(id), account);
    this.byNick.set(nameKey(nick), account);
    this.changed();
    return REGISTERED;
  }

  /** The account whose password this is, or null; an unknown ID takes as long as a wrong password. */
  async authenticate(id: string, password: string): Promise<AccountRecord | null> {
    const account = this.byId.get(nameKey(id));
    const matches = await checkPassword(password, account?.password ?? (await decoyHash()));
    return account && matches ? account : null;
  }

  /** Changes an account's fields; a new nick must be free. Returns false when it is taken. */
  update(id: string, change: Partial<Omit<AccountRecord, "id" | "password" | "createdAt">>): boolean {
    const account = this.byId.get(nameKey(id));
    if (!account) return false;
    if (change.nick !== undefined && nameKey(change.nick) !== nameKey(account.nick)) {
      if (this.byNick.has(nameKey(change.nick))) return false;
      this.byNick.delete(nameKey(account.nick));
      this.byNick.set(nameKey(change.nick), account);
    }
    Object.assign(account, change);
    if (change.cell !== undefined || change.wins !== undefined || change.losses !== undefined) this.ranked = null;
    this.changed();
    return true;
  }

  /** The accounts that have finished a match, in the ranking's order. */
  ranking(): readonly AccountRecord[] {
    this.ranked ??= [...this.byId.values()].filter(isRanked).sort(rankingOrder);
    return this.ranked;
  }

  standing(id: string): Standing {
    const account = this.byId.get(nameKey(id));
    const ranking = this.ranking();
    const rank = account && isRanked(account) ? ranking.indexOf(account) + 1 : 0;
    return { rank, level: levelFor(rank, ranking.length) };
  }

  data(): AccountData {
    return { accounts: [...this.byId.values()] };
  }
}

const isInt = (value: unknown, min: number, max: number): value is number =>
  typeof value === "number" && Number.isInteger(value) && value >= min && value <= max;

const indexList = (value: unknown, count: number): number[] | null =>
  Array.isArray(value) && value.every((k) => isInt(k, 0, count - 1)) ? [...new Set(value as number[])].sort((a, b) => a - b) : null;

/** One saved account, checked; null when it is not one this server could have written. */
function parseAccount(value: unknown): AccountRecord | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const a = value as Record<string, unknown>;
  const items = indexList(a.items, ITEM_COUNT);
  const pairs = indexList(a.pairs, PAIR_COUNT);
  if (typeof a.id !== "string" || idProblem(a.id) !== null) return null;
  if (typeof a.nick !== "string" || !isNick(a.nick) || !isPasswordHash(a.password)) return null;
  if (typeof a.greeting !== "string" || cp949Bytes(a.greeting) > GREETING_MAX_BYTES || typeof a.character !== "string") return null;
  if (!isInt(a.hue, -180, 180) || typeof a.useId !== "boolean" || !isInt(a.guild, -1, 0xffff)) return null;
  const counts = [a.wins, a.losses, a.candy, a.nickChangedAt, a.createdAt];
  if (!counts.every((n) => isInt(n, 0, Number.MAX_SAFE_INTEGER)) || !isInt(a.cell, -0x80000000, 0x7fffffff)) return null;
  if (!items || !pairs) return null;
  return {
    id: a.id,
    nick: a.nick,
    password: a.password,
    greeting: a.greeting,
    character: a.character,
    hue: a.hue,
    useId: a.useId,
    guild: a.guild,
    wins: a.wins as number,
    losses: a.losses as number,
    cell: a.cell,
    candy: a.candy as number,
    items,
    pairs,
    nickChangedAt: a.nickChangedAt as number,
    createdAt: a.createdAt as number,
  };
}

/** A saved book, checked: null when it is not one. Records this server could not have written are dropped. */
export function parseAccountData(text: string): AccountData | null {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof data !== "object" || data === null || !Array.isArray((data as { accounts?: unknown }).accounts)) return null;
  const accounts = (data as { accounts: unknown[] }).accounts.map(parseAccount).filter((a): a is AccountRecord => a !== null);
  return { accounts };
}
