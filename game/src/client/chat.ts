// Practice's chat (scene 9). The line is shake.exe's own IME line editor (object 0x4714f8), drawn
// by 0x418550; Enter keeps the text on the local player and the bubble beside its face shows it
// for 5 s (0x446200, 0x418940). Nothing is sent: practice has no server.
import type { Rect } from "../assets/types.ts";
import { cp949Bytes, cutBytes } from "../server/cp949.ts";

export { cp949Bytes, trimChat, typeable } from "../server/cp949.ts";

/** 0x418cd0 sets the editor's limit to 37 bytes for scenes 8 and 9. */
export const CHAT_LIMIT = 37;
/** The line (0x418550): 굴림체 13 at (91,540); the caret at 7 px per byte before it, 14 px high, 3 px wide. */
export const CHAT_LINE = { x: 91, y: 540, byteWidth: 7, caretHeight: 14 };
/** The bubble (0x418940): mark.shk's frame, 굴림체 12 lines 15 px apart; placed by slot (matchChat.balloonAt). */
export const CHAT_BUBBLE = { src: [0, 32, 83, 86] as Rect, lineStep: 15 };
export const BUBBLE_MS = 5000;
/** images.shk's thought balloon over the own player while the line is open (0x408cc1-0x408d0a). */
export const TYPING_MARK = { src: [746, 120, 777, 143] as Rect, dx: 20, dy: -50 };

const BUBBLE_COLUMNS = 12;
const BUBBLE_LINES = 3;

/** An insert is refused unless the whole line stays under the limit (0x403ca8, 0x4033f7): 36 bytes at most in a game. */
export function fitsChat(text: string, limit = CHAT_LIMIT): boolean {
  return cp949Bytes(text) < limit;
}

/** An IME composition in progress: where it starts in the line and its text. */
export interface Composition {
  start: number;
  text: string;
}

/**
 * The line as drawn (0x403d30): the text before the caret, the composing syllable, the rest. The
 * syllable is left out while it would not fit after the text before the caret (0x4034c2), and the
 * caret stands before it (0x403e40 counts only the bytes before the caret).
 */
export function chatView(
  value: string,
  composition: Composition | null,
  caret = value.length,
  limit = CHAT_LIMIT,
): { text: string; caret: number } {
  if (!composition) return { text: value, caret: cp949Bytes(value.slice(0, caret)) };
  const before = value.slice(0, composition.start);
  const after = value.slice(composition.start + composition.text.length);
  const shown = fitsChat(before + composition.text, limit) ? composition.text : "";
  return { text: before + shown + after, caret: cp949Bytes(before) };
}

/**
 * 0x418940's lines: 12 bytes each, a double-byte character that would start at the 12th byte goes
 * to the next line, and the text past three lines is not shown.
 */
export function bubbleLines(text: string): string[] {
  const lines: string[] = [];
  let line = "";
  let bytes = 0;
  for (const char of text) {
    const size = cp949Bytes(char);
    if (bytes + size > BUBBLE_COLUMNS) {
      lines.push(line);
      if (lines.length === BUBBLE_LINES) return lines;
      line = "";
      bytes = 0;
    }
    line += char;
    bytes += size;
  }
  if (line) lines.push(line);
  return lines.slice(0, BUBBLE_LINES);
}

/**
 * The caret's blink (0x41858d-0x418636, from [0x46b06c] = 1 and [0x4939bc] = 0): shown until more
 * than 500 ms have passed, then hidden until more than 250 ms have; the frame that flips it draws
 * no caret either way.
 */
export class CaretBlink {
  private visible = true;
  private since = 0;

  shown(now: number): boolean {
    const limit = this.visible ? 500 : 250;
    if (now - this.since > limit) {
      this.since = now;
      this.visible = !this.visible;
      return false;
    }
    return this.visible;
  }
}

/** The Down key's commands (0x470924). */
export const DOWN_COMMANDS = ["/stat", "/w", "/n"] as const;

/** Where the Down key is in its commands ([0x497f24]); the lobby and the room share one. */
export class CommandCycle {
  private index = 0;

  /** An open chat line gets the next command, "/w" first (0x460181). */
  next(): string {
    this.index = (this.index + 1) % DOWN_COMMANDS.length;
    return DOWN_COMMANDS[this.index];
  }

  /** The room's closed line opens with the command the cycle is on (0x460206). */
  current(): string {
    return DOWN_COMMANDS[this.index];
  }

  /** A new program's place: "/stat", so the first Down gives "/w". */
  reset(): void {
    this.index = 0;
  }
}

export const commandCycle = new CommandCycle();

/**
 * [0x497d00]: the program's one recall line. Enter on an open chat line copies its text there in
 * every scene, lobby, room, match and practice alike (0x45fb60), and nothing empties it; Up on an
 * open line puts it back (0x4600d9).
 */
export const chatRecall = { line: "" };

/** Enter on an open line (0x45fb56-0x45fb60): any text but an empty one, blanks too, before 0x446200 drops a blank line. */
export function keepRecall(text: string): void {
  if (text) chatRecall.line = text;
}

/**
 * Up in a match or practice: the recall line, cut to the 36 bytes the game's editor holds. The
 * original copies it whole (0x4600d9 → 0x403db0): a lobby or room line of up to 39 bytes goes out
 * in the match's chat record and a longer one overruns it (0x446356). The remake cuts it instead.
 */
export function gameRecall(): string {
  return cutBytes(chatRecall.line, CHAT_LIMIT - 1);
}

/**
 * Whether a key opens the lobby's closed chat line (the default case, 0x4602f5). Space, F1-F9, F12,
 * Esc, Up and Down have their own cases; Up and Down open the line in the room only (0x4600ff, 0x4601d1).
 */
export function lobbyKeyOpensChat(event: Pick<KeyboardEvent, "code" | "key" | "ctrlKey" | "metaKey" | "altKey">): boolean {
  if (event.ctrlKey || event.metaKey || event.altKey) return false;
  return event.code !== "Space" && event.code !== "ArrowUp" && event.code !== "ArrowDown" && !/^F\d+$/.test(event.key);
}
