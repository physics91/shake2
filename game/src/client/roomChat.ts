// The room's chat log (hidden listbox 0x48c21c, drawn by 0x427810). Lines are kept as the original
// stores them, with the "sys" mark on system lines, so the colour test reads them the same way.
import type { ChatKind } from "../server/protocol.ts";

export type ChatLineClass = "system" | "own" | "police" | "normal";

/**
 * The log line for a chat message. Entering and leaving use the room's strings (0x46edf0 and
 * 0x46edcc, 0x446ae0 kinds 2 and 3); a host's leave, S->C 0x40's (0x46ef34). A spoken line's format is not known: "[nick] text" (R), after
 * the own-line test, which looks for "[" and the own nickname.
 */
export function chatEntry(message: { kind: ChatKind; name: string; text: string }): string {
  switch (message.kind) {
    case "enter":
      return `sys★★ ${message.name}님이 입장하셨습니다★★`;
    case "leave":
      return `sys★★ ${message.name}님이 퇴장하셨습니다★★`;
    case "host-leave":
      return `sys★★ ${message.name}님이 퇴장하셨습니다 ★★`;
    case "talk":
      return `[${message.name}] ${message.text}`;
  }
}

/** 0x427810's colour tests, in order; the own test is a prefix test, so "[하나둘" counts for 하나. */
export function chatLineClass(line: string, ownName: string): ChatLineClass {
  if (line.startsWith("sys")) return "system";
  if (line.startsWith(`[${ownName}`)) return "own";
  if (line.startsWith("[사이버경찰")) return "police";
  return "normal";
}

/** A system line is drawn from its fourth byte, past the "sys" mark. */
export function shownChat(line: string): string {
  return line.startsWith("sys") ? line.slice(3) : line;
}

/** S->C 0x07 (0x444ec2): a whisper is two system lines, the sender's then the message (0x46ed28, 0x46ed18). */
export function whisperLines(from: string, text: string): string[] {
  return [`sys★★ ${from}님이 보낸 메시지입니다 ★★`, `sys★★ ${text} ★★`];
}

/** S->C 0x44 for another slot (0x44a228, 0x46eee8). */
export function kickLine(name: string): string {
  return `sys★★ ${name}님이 강퇴 당했습니다.★★`;
}

/** S->C 0x4c in the lobby or the room (0x44554c, 0x46ecc4). */
export function usersLine(count: number): string {
  return `sys★★ 총사용자 ${count}명 ★★`;
}

/** S->C 0x60 (0x445746): the whisper switch's answer, without the system mark (0x46ec88, 0x46ec64). */
export function whisperAllowLine(on: boolean): string {
  return on ? "귓말을 허용하도록 설정되었습니다" : "귓말을 받지않도록 설정되었습니다";
}
