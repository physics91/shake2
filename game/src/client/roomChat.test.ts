import { describe, expect, it } from "vitest";

import { chatEntry, chatLineClass, shownChat, usersLine, whisperAllowLine, whisperLines } from "./roomChat.ts";

describe("room chat log (0x427810)", () => {
  it("writes the room's system strings for entering and leaving (0x46edf0, 0x46edcc)", () => {
    expect(chatEntry({ kind: "enter", name: "둘", text: "" })).toBe("sys★★ 둘님이 입장하셨습니다★★");
    expect(chatEntry({ kind: "leave", name: "둘", text: "" })).toBe("sys★★ 둘님이 퇴장하셨습니다★★");
    // S->C 0x40 (0x44ab30): the same words with one more space before the last stars.
    expect(chatEntry({ kind: "host-leave", name: "하나", text: "" })).toBe("sys★★ 하나님이 퇴장하셨습니다 ★★");
    expect(chatEntry({ kind: "talk", name: "둘", text: "안녕" })).toBe("[둘] 안녕");
  });

  it("colours a line by how it starts: system, own, police, the rest", () => {
    expect(chatLineClass("sys★★ 둘님이 입장하셨습니다★★", "하나")).toBe("system");
    expect(chatLineClass("[하나] 안녕", "하나")).toBe("own");
    expect(chatLineClass("[하나둘] 안녕", "하나")).toBe("own");
    expect(chatLineClass("[사이버경찰] 공지", "하나")).toBe("police");
    expect(chatLineClass("[둘] 안녕", "하나")).toBe("normal");
  });

  it("draws a system line from its fourth byte", () => {
    expect(shownChat("sys★★ 둘님이 입장하셨습니다★★")).toBe("★★ 둘님이 입장하셨습니다★★");
    expect(shownChat("[둘] sys")).toBe("[둘] sys");
  });
});

describe("command replies", () => {
  it("writes the whisper, user count and whisper switch lines as the original formats them", () => {
    expect(whisperLines("둘", "안녕")).toEqual(["sys★★ 둘님이 보낸 메시지입니다 ★★", "sys★★ 안녕 ★★"]);
    expect(usersLine(3)).toBe("sys★★ 총사용자 3명 ★★");
    // No "sys" mark: drawn in the normal colour, whole.
    expect(chatLineClass(whisperAllowLine(true), "하나")).toBe("normal");
    expect(whisperAllowLine(false)).toBe("귓말을 받지않도록 설정되었습니다");
  });
});
