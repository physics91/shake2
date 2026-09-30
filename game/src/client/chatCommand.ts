// CHAT_submit (0x446200) in the lobby and the room (scenes 4 and 7). A line whose first character
// is "/" is a command and is never sent as chat: the name is strtok(text + 1, " "), matched with
// _stricmp (ASCII case only) in the order 정보, stat, w, cls, clear, refresh, ban, users, n, unmask,
// wno, wyes, go, mask. An unknown name, or "/" alone, sends nothing and logs nothing. Every
// command clears the line, and none writes a line of its own.
import type { LobbyPlayer } from "../server/protocol.ts";
import { CHAT_INTERVAL_MS } from "../server/protocol.ts";
import { trimChat } from "../server/cp949.ts";

/** /users has its own timer ([0x49715c]): once in 5 s. */
export const USERS_INTERVAL_MS = 5000;

export type ChatSubmit =
  /** Nothing to send: an empty line, an unknown command, or one this remake has no server for. */
  | { kind: "none" }
  | { kind: "chat"; text: string }
  /** /w id msg (C->S 0x07): the 2000 ms timer is stamped first, so a line without a message still stamps it. */
  | { kind: "whisper"; line: { to: string; text: string } | null }
  /** /cls, /clear (0x418c60): both chat logs. */
  | { kind: "clear" }
  /** /users (C->S 0x4c). */
  | { kind: "users" }
  /** /wyes, /wno (C->S 0x60). */
  | { kind: "whisper-allow"; on: boolean }
  /** /go n (C->S 0x04 with the room index n - 1); nothing in the room. */
  | { kind: "go"; index: number }
  /** /ban id in the room (C->S 0x44): the host's kick, by the slot's ID. */
  | { kind: "ban"; name: string };

/** strtok over one line: skips leading delimiters, ends a token at the next one. */
class Tokens {
  private at = 0;
  /** Where the last token ended: at its delimiter, or at the end of the line. */
  end = 0;

  private readonly text: string;

  constructor(text: string) {
    this.text = text;
  }

  next(delimiters: string): string | null {
    let start = this.at;
    while (start < this.text.length && delimiters.includes(this.text[start])) start++;
    if (start >= this.text.length) {
      this.at = start;
      return null;
    }
    let stop = start;
    while (stop < this.text.length && !delimiters.includes(this.text[stop])) stop++;
    this.end = stop;
    this.at = Math.min(stop + 1, this.text.length);
    return this.text.slice(start, stop);
  }
}

/** _stricmp's C locale: only A-Z fold. */
function sameName(a: string, b: string): boolean {
  const fold = (s: string) => s.replace(/[A-Z]/g, (c) => c.toLowerCase());
  return fold(a) === fold(b);
}

/** msvcrt atoi: optional blanks and sign, then digits; anything else stops it. */
export function atoi(text: string): number {
  const match = /^[ \t\n\v\f\r]*([+-]?\d+)/.exec(text);
  return match ? Number.parseInt(match[1], 10) | 0 : 0;
}

/** What a line typed in the lobby or the room does, before any timer is read. */
export function chatSubmit(raw: string, inRoom: boolean): ChatSubmit {
  // Trailing blanks and tabs go; leading ones stay, so " /w" is chat.
  const text = trimChat(raw);
  if (!text) return { kind: "none" };
  if (!text.startsWith("/")) return { kind: "chat", text };
  const tokens = new Tokens(text.slice(1));
  const name = tokens.next(" ");
  if (name === null) return { kind: "none" };
  const is = (...names: string[]) => names.some((n) => sameName(name, n));
  if (is("w")) {
    const to = tokens.next(" ");
    if (to === null) return { kind: "whisper", line: null };
    // The message is the rest after the one blank past the ID, as typed. With nothing after the ID
    // the original reads past the line's end (stale bytes); here that sends nothing.
    const message = text.slice(1).slice(tokens.end + 1);
    return { kind: "whisper", line: message ? { to, text: message } : null };
  }
  if (is("cls", "clear")) return { kind: "clear" };
  if (is("users")) return { kind: "users" };
  if (is("wno")) return { kind: "whisper-allow", on: false };
  if (is("wyes")) return { kind: "whisper-allow", on: true };
  if (is("go")) {
    if (inRoom) return { kind: "none" };
    const number = tokens.next(" ");
    return number === null ? { kind: "none" } : { kind: "go", index: atoi(number) - 1 };
  }
  if (is("ban")) {
    const id = inRoom ? tokens.next(" ") : null;
    return id === null ? { kind: "none" } : { kind: "ban", name: id };
  }
  // 정보/stat (C->S 0x0e: the account's score, wins and level), n (the nickname), mask and unmask
  // (account items) ask a server this remake has no data for; refresh does nothing.
  return { kind: "none" };
}

/**
 * The whisper target ([0x4927c8], set by a slot's whisper icon): a chat line goes to it as C->S 0x07
 * first, past no timer, and then on as chat with the chat's own checks (0x4468f6). Commands do not.
 */
export function targetWhisper(target: string, submit: ChatSubmit): { to: string; text: string } | null {
  return target && submit.kind === "chat" ? { to: target, text: submit.text } : null;
}

/**
 * /ban's slot (0x446512): the first taken slot, from 0, whose ID matches with _stricmp; the host's
 * own counts too. Null when none does, and then nothing is sent.
 */
export function banSlot(players: readonly Pick<LobbyPlayer, "slot" | "name">[], name: string): number | null {
  const bySlot = [...players].sort((a, b) => a.slot - b.slot);
  return bySlot.find((p) => sameName(p.name, name))?.slot ?? null;
}

/**
 * The timers of 0x446200 ([0x497158], shared by chat and /w): chat is dropped when it repeats the
 * last line sent (case-sensitive) or comes within 2000 ms of the last stamp, and stamps only when
 * it goes out; /w checks the 2000 ms alone and stamps before its ID and message are read.
 */
export class ChatTimers {
  private stamped = Number.NEGATIVE_INFINITY;
  private lastLine: string | null = null;
  private usersAt = Number.NEGATIVE_INFINITY;

  /** A chat line: true when it goes out. */
  chat(text: string, now: number): boolean {
    if (text === this.lastLine || now - this.stamped < CHAT_INTERVAL_MS) return false;
    this.stamped = now;
    this.lastLine = text;
    return true;
  }

  /** /w: true when the timer lets it through, which stamps it. */
  whisper(now: number): boolean {
    if (now - this.stamped < CHAT_INTERVAL_MS) return false;
    this.stamped = now;
    return true;
  }

  /** /users: its own 5 s. */
  users(now: number): boolean {
    if (now - this.usersAt < USERS_INTERVAL_MS) return false;
    this.usersAt = now;
    return true;
  }
}
