// The option window's friend list (친구등록): the server keeps each player's friends and answers
// C->S 0x64 (add) and 0x65 (delete) with a result (0x44c050, 0x44c220); the window only says it.
import { isFriendId, MAX_FRIENDS } from "../server/protocol.ts";

export { isFriendId, MAX_FRIENDS };

/** S->C 0x64's results, by the table at 0x44c19c. */
export const ADD_REFUSALS: Readonly<Record<number, string>> = {
  [-1]: "아이디 등록이 실패하였습니다.",
  [-2]: "이미 등록된 아이디입니다.",
  [-3]: "12명까지만 등록 가능합니다.",
  [-4]: "존재하지 않는 아이디입니다.",
  [-5]: "자기 아이디는 등록되지 않습니다.",
};

export function addedMessage(name: string): string {
  return `☞ ${name}님이 친구로\n등록되었습니다`;
}

export function deletedMessage(name: string): string {
  return `☞ ${name}님이 친구목록에서\n삭제 되었습니다`;
}

export const DELETE_FAILED = "삭제 실패";

/** What the window does with an answer, after its popup closes and the wait ends. */
export interface FriendReply {
  /** The message box's text, or none. */
  message: string | null;
  /** The list changed: ask for it again (C->S 0x63) and wait. */
  askAgain: boolean;
}

/** S->C 0x64 (0x4458d3 → 0x44c050): 1 with an ID says it; -1..-5 are refused in words; the rest is silent. */
export function addReply(result: number, name: string): FriendReply {
  if (result === 1) return name ? { message: addedMessage(name), askAgain: true } : { message: null, askAgain: false };
  return { message: ADD_REFUSALS[result] ?? null, askAgain: false };
}

/** S->C 0x65 (0x44c220): 1 with an ID says it; anything but 1 is "삭제 실패". */
export function deleteReply(result: number, name: string): FriendReply {
  if (result !== 1) return { message: DELETE_FAILED, askAgain: false };
  return name ? { message: deletedMessage(name), askAgain: true } : { message: null, askAgain: false };
}
