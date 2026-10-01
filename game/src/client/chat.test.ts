import { describe, expect, it } from "vitest";

import { bubbleLines, CaretBlink, chatRecall, chatView, CommandCycle, cp949Bytes, fitsChat, gameRecall, keepRecall, lobbyKeyOpensChat, trimChat, typeable } from "./chat.ts";

describe("practice chat line (editor 0x4714f8)", () => {
  it("counts cp949 bytes: one for ASCII, two for Hangul and the other double-byte characters", () => {
    expect(cp949Bytes("abc")).toBe(3);
    expect(cp949Bytes("가나")).toBe(4);
    expect(cp949Bytes("a가※")).toBe(5);
  });

  it("takes an insert only while the line stays under the limit of 37 bytes (0x403ca8, 0x4033f7)", () => {
    expect(fitsChat("a".repeat(36))).toBe(true);
    expect(fitsChat("a".repeat(37))).toBe(false);
    expect(fitsChat("가".repeat(18))).toBe(true);
    expect(fitsChat(`${"가".repeat(18)}a`)).toBe(false);
  });

  it("keeps only what a cp949 line can hold", () => {
    expect(typeable("안녕 똠방각하 ㈜ ①")).toBe("안녕 똠방각하 ㈜ ①");
    expect(typeable("hi😀\tthere\u0001")).toBe("hithere");
  });

  it("shows a composing syllable only while it fits after the text before the caret (0x4034c2)", () => {
    expect(chatView("가나다", { start: 1, text: "나" })).toEqual({ text: "가나다", caret: 2 });
    const full = `${"a".repeat(35)}b`;
    expect(chatView(`${full.slice(0, 35)}가b`, { start: 35, text: "가" })).toEqual({ text: full, caret: 35 });
    expect(chatView("abc", null, 2)).toEqual({ text: "abc", caret: 2 });
  });

  it("drops trailing spaces and tabs when sending, and a blank line sends nothing (0x446200)", () => {
    expect(trimChat("  hi \t ")).toBe("  hi");
    expect(trimChat(" \t ")).toBe("");
  });
});

describe("practice chat bubble (0x418940)", () => {
  it("breaks lines at 12 bytes", () => {
    expect(bubbleLines("abcdefghijklmnop")).toEqual(["abcdefghijkl", "mnop"]);
    expect(bubbleLines("가나다라마바")).toEqual(["가나다라마바"]);
  });

  it("moves a two-byte character that would start at the 12th byte to the next line", () => {
    expect(bubbleLines("abcdefghijk가")).toEqual(["abcdefghijk", "가"]);
    expect(bubbleLines("a가나다라마바")).toEqual(["a가나다라마", "바"]);
  });

  it("shows three lines at most", () => {
    expect(bubbleLines("x".repeat(40))).toEqual(["x".repeat(12), "x".repeat(12), "x".repeat(12)]);
  });
});

describe("chat caret blink (0x41858d)", () => {
  it("shows the caret until more than 500 ms pass and hides it until more than 250 ms, drawing nothing on the flip", () => {
    const blink = new CaretBlink();
    expect(blink.shown(400)).toBe(true);
    expect(blink.shown(500)).toBe(true);
    expect(blink.shown(501)).toBe(false); // hides
    expect(blink.shown(751)).toBe(false);
    expect(blink.shown(752)).toBe(false); // shows again, from the next frame
    expect(blink.shown(760)).toBe(true);
    expect(blink.shown(1253)).toBe(false);
  });
});

describe("the Down key's command cycle (0x460161, list 0x470924, place [0x497f24])", () => {
  it("puts the next command in an open line, /w first, round and round", () => {
    const cycle = new CommandCycle();
    expect([cycle.next(), cycle.next(), cycle.next(), cycle.next()]).toEqual(["/w", "/n", "/stat", "/w"]);
  });

  it("gives the room's closed line the command it is on, without moving on (0x460206)", () => {
    const cycle = new CommandCycle();
    expect(cycle.current()).toBe("/stat");
    cycle.next();
    expect([cycle.current(), cycle.current()]).toEqual(["/w", "/w"]);
    expect(cycle.next()).toBe("/n");
  });
});

describe("Enter on an open line keeps the recall line (0x45fb56-0x45fb60)", () => {
  it("takes a blank line as typed, though nothing is sent, and leaves the line on an empty one", () => {
    keepRecall("hello");
    keepRecall("   ");
    expect(chatRecall.line).toBe("   ");
    keepRecall("");
    expect(chatRecall.line).toBe("   ");
    chatRecall.line = "";
  });
});

describe("Up in a match or practice (0x4600d9)", () => {
  it("puts back the recall line whole when the game's editor holds it", () => {
    chatRecall.line = "y".repeat(36);
    expect(gameRecall()).toBe("y".repeat(36));
  });

  it("cuts a longer lobby or room line to 36 bytes, never splitting a double-byte character", () => {
    chatRecall.line = "x".repeat(44);
    expect(gameRecall()).toBe("x".repeat(36));
    chatRecall.line = "a" + "가".repeat(20);
    expect(gameRecall()).toBe("a" + "가".repeat(17));
    expect(chatRecall.line).toBe("a" + "가".repeat(20)); // the recall line itself stays as said
    chatRecall.line = "";
  });
});

describe("keys that open the lobby's closed chat line (0x4602f5)", () => {
  const key = (code: string, key = code, mods: Partial<Record<"ctrlKey" | "metaKey" | "altKey", boolean>> = {}) => ({
    code,
    key,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    ...mods,
  });

  it("opens on letters and other keys", () => {
    expect(lobbyKeyOpensChat(key("KeyA", "a"))).toBe(true);
    expect(lobbyKeyOpensChat(key("ArrowLeft"))).toBe(true);
  });

  it("not on Space, the F keys, Up and Down (their own cases, which do nothing in the lobby), nor with Ctrl, Alt or Meta", () => {
    for (const code of ["Space", "F1", "F5", "F12", "ArrowUp", "ArrowDown"]) expect(lobbyKeyOpensChat(key(code))).toBe(false);
    expect(lobbyKeyOpensChat(key("KeyC", "c", { ctrlKey: true }))).toBe(false);
  });
});
