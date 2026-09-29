// The option window's friend lists, which the original's account server kept and judged (S->C 0x64,
// 0x65). The server code is lost, so its rules here are this remake's (R). Without accounts a
// player is the name it said hello with. Pure: the file it is kept in is friendFile.ts's.
import { isFriendId, MAX_FRIENDS, sanitizeName } from "./protocol.ts";

/** The names kept; past this, the oldest one no list holds or has a list is forgotten. */
export const MAX_KNOWN_NAMES = 4096;

/** The add's results (S->C 0x64): 1, or the refusal the table at 0x44c19c words. */
export const ADDED = 1;
export const ADD_FAILED = -1;
export const ALREADY_LISTED = -2;
export const LIST_FULL = -3;
export const NO_SUCH_ID = -4;
export const OWN_ID = -5;
/** The delete's results (S->C 0x65): anything but 1 is "삭제 실패". */
export const DELETED = 1;
export const NOT_LISTED = 0;

export interface FriendData {
  /** Every name that said hello, the one least recently first. */
  known: string[];
  /** Each name's friend IDs in the order they were added. */
  lists: Record<string, string[]>;
}

export class FriendBook {
  private readonly known = new Set<string>();
  private readonly lists = new Map<string, string[]>();
  /** How many lists hold each name: those are never forgotten. */
  private readonly held = new Map<string, number>();
  private readonly changed: () => void;

  constructor(data: FriendData = { known: [], lists: {} }, changed: () => void = () => undefined) {
    this.changed = changed;
    for (const name of data.known.slice(-MAX_KNOWN_NAMES)) this.known.add(name);
    for (const [owner, ids] of Object.entries(data.lists)) {
      if (!this.known.has(owner)) continue;
      const list = [...new Set(ids)].filter((id) => id !== owner && this.known.has(id)).slice(0, MAX_FRIENDS);
      if (list.length === 0) continue;
      this.lists.set(owner, list);
      for (const id of list) this.hold(id, 1);
    }
  }

  /** A name said hello: it can be found from now on. */
  meet(name: string): void {
    if (this.known.has(name)) {
      // The most recently seen go last, so the forgotten ones are those long gone.
      this.known.delete(name);
      this.known.add(name);
      return;
    }
    if (this.known.size >= MAX_KNOWN_NAMES && !this.forgetOne()) return;
    this.known.add(name);
    this.changed();
  }

  list(owner: string): readonly string[] {
    return this.lists.get(owner) ?? [];
  }

  /** C->S 0x64. */
  add(owner: string, id: string): number {
    if (id === "") return NO_SUCH_ID;
    if (id === owner) return OWN_ID;
    if (!this.known.has(id)) return NO_SUCH_ID;
    const list = this.lists.get(owner) ?? [];
    if (list.includes(id)) return ALREADY_LISTED;
    if (list.length >= MAX_FRIENDS) return LIST_FULL;
    // A name the book could not keep has nowhere to keep a list.
    if (!this.known.has(owner)) return ADD_FAILED;
    this.lists.set(owner, [...list, id]);
    this.hold(id, 1);
    this.changed();
    return ADDED;
  }

  /** C->S 0x65. */
  remove(owner: string, id: string): number {
    const list = this.lists.get(owner) ?? [];
    if (!list.includes(id)) return NOT_LISTED;
    const rest = list.filter((name) => name !== id);
    if (rest.length > 0) this.lists.set(owner, rest);
    else this.lists.delete(owner);
    this.hold(id, -1);
    this.changed();
    return DELETED;
  }

  data(): FriendData {
    return { known: [...this.known], lists: Object.fromEntries(this.lists) };
  }

  private hold(name: string, by: number): void {
    const count = (this.held.get(name) ?? 0) + by;
    if (count > 0) this.held.set(name, count);
    else this.held.delete(name);
  }

  private forgetOne(): boolean {
    for (const name of this.known) {
      if (this.lists.has(name) || this.held.has(name)) continue;
      this.known.delete(name);
      return true;
    }
    return false;
  }
}

/** A saved book, checked: null when it is not one. Entries a hello or an add could not have made are dropped. */
export function parseFriendData(text: string): FriendData | null {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof data !== "object" || data === null || Array.isArray(data)) return null;
  const { known, lists } = data as Record<string, unknown>;
  if (!Array.isArray(known) || typeof lists !== "object" || lists === null || Array.isArray(lists)) return null;
  const names = known.filter((name): name is string => typeof name === "string" && sanitizeName(name) === name);
  // fromEntries, not assignment: a player may be called "__proto__".
  const kept = Object.entries(lists).flatMap(([owner, ids]) => (Array.isArray(ids) ? [[owner, ids.filter(isFriendId)] as const] : []));
  return { known: names, lists: Object.fromEntries(kept) };
}
