import { describe, expect, it } from "vitest";

import { ADD_REFUSALS, addedMessage, addReply, deletedMessage, deleteReply, isFriendId } from "./friends.ts";

describe("friend list answers (S->C 0x64/0x65)", () => {
  it("says an add, words the refusals of the table at 0x44c19c and keeps quiet on the rest", () => {
    expect(addReply(1, "철수")).toEqual({ message: "☞ 철수님이 친구로\n등록되었습니다", askAgain: true });
    expect(addReply(-3, "영희")).toEqual({ message: "12명까지만 등록 가능합니다.", askAgain: false });
    expect(addReply(-5, "나").message).toBe("자기 아이디는 등록되지 않습니다.");
    expect(addReply(0, "영희")).toEqual({ message: null, askAgain: false });
    expect(addReply(-6, "영희")).toEqual({ message: null, askAgain: false });
    expect(addReply(1, "")).toEqual({ message: null, askAgain: false });
    expect(Object.keys(ADD_REFUSALS)).toHaveLength(5);
  });

  it("says a delete; anything but 1 is 삭제 실패", () => {
    expect(deleteReply(1, "철수")).toEqual({ message: "☞ 철수님이 친구목록에서\n삭제 되었습니다", askAgain: true });
    expect(deleteReply(0, "철수")).toEqual({ message: "삭제 실패", askAgain: false });
    expect(deleteReply(-1, "철수").message).toBe("삭제 실패");
  });

  it("says a change in two lines of the message box", () => {
    expect(addedMessage("철수")).toBe("☞ 철수님이 친구로\n등록되었습니다");
    expect(deletedMessage("철수")).toBe("☞ 철수님이 친구목록에서\n삭제 되었습니다");
  });

  it("keeps IDs the popup could type: 10 cp949 bytes", () => {
    expect(isFriendId("가나다라마")).toBe(true);
    expect(isFriendId("가나다라마바")).toBe(false);
    expect(isFriendId("abcdefghij")).toBe(true);
    expect(isFriendId("")).toBe(false);
    expect(isFriendId("a\u0000")).toBe(false);
  });
});
