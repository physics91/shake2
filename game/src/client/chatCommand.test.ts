import { describe, expect, it } from "vitest";

import { atoi, banSlot, chatSubmit, ChatTimers, targetWhisper, USERS_INTERVAL_MS } from "./chatCommand.ts";

describe("chat commands (0x446200)", () => {
  it("sends a line that does not start with / as chat, trailing blanks cut and leading ones kept", () => {
    expect(chatSubmit("안녕  \t", false)).toEqual({ kind: "chat", text: "안녕" });
    expect(chatSubmit(" /w 둘 안녕", false)).toEqual({ kind: "chat", text: " /w 둘 안녕" });
    expect(chatSubmit(" \t", false)).toEqual({ kind: "none" });
  });

  it("never sends an unknown command, or / alone, as chat", () => {
    expect(chatSubmit("/xyz", false)).toEqual({ kind: "none" });
    expect(chatSubmit("/", false)).toEqual({ kind: "none" });
    expect(chatSubmit("/   ", true)).toEqual({ kind: "none" });
    expect(chatSubmit("/refresh", false)).toEqual({ kind: "none" });
  });

  it("matches names with ASCII case folded, after strtok's leading blanks", () => {
    expect(chatSubmit("/W 둘 안녕", false)).toEqual({ kind: "whisper", line: { to: "둘", text: "안녕" } });
    expect(chatSubmit("/  CLS", true)).toEqual({ kind: "clear" });
    expect(chatSubmit("/Clear", false)).toEqual({ kind: "clear" });
    expect(chatSubmit("/USERS", true)).toEqual({ kind: "users" });
  });

  it("reads /w's ID up to a blank and keeps the rest as typed", () => {
    expect(chatSubmit("/w  둘   안녕  하세요", false)).toEqual({ kind: "whisper", line: { to: "둘", text: "  안녕  하세요" } });
    // No ID, or nothing after it: the timer is still stamped, and nothing goes.
    expect(chatSubmit("/w", false)).toEqual({ kind: "whisper", line: null });
    expect(chatSubmit("/w 둘", false)).toEqual({ kind: "whisper", line: null });
    expect(chatSubmit("/w 둘   ", false)).toEqual({ kind: "whisper", line: null });
  });

  it("switches whispers with /wyes and /wno", () => {
    expect(chatSubmit("/wyes", false)).toEqual({ kind: "whisper-allow", on: true });
    expect(chatSubmit("/wno", true)).toEqual({ kind: "whisper-allow", on: false });
  });

  it("joins room n - 1 with /go in the lobby, and does nothing with it in the room", () => {
    expect(chatSubmit("/go 3", false)).toEqual({ kind: "go", index: 2 });
    expect(chatSubmit("/go abc", false)).toEqual({ kind: "go", index: -1 });
    expect(chatSubmit("/go", false)).toEqual({ kind: "none" });
    expect(chatSubmit("/go 3", true)).toEqual({ kind: "none" });
  });

  it("sends nothing for the commands that need the account server", () => {
    for (const line of ["/정보 둘", "/stat 둘", "/n 새이름", "/mask 둘", "/unmask"]) {
      expect(chatSubmit(line, true)).toEqual({ kind: "none" });
    }
  });

  it("reads /ban's ID in the room only (scene 7), and picks the first slot whose name matches", () => {
    expect(chatSubmit("/BAN  Dul extra", true)).toEqual({ kind: "ban", name: "Dul" });
    expect(chatSubmit("/ban", true)).toEqual({ kind: "none" });
    expect(chatSubmit("/ban 둘", false)).toEqual({ kind: "none" });
    const players = [
      { slot: 3, name: "dul" },
      { slot: 1, name: "DUL" },
      { slot: 0, name: "하나" },
    ];
    expect(banSlot(players, "Dul")).toBe(1);
    expect(banSlot(players, "하나")).toBe(0);
    expect(banSlot(players, "셋")).toBeNull();
  });

  it("reads numbers as msvcrt's atoi does", () => {
    expect(atoi("12abc")).toBe(12);
    expect(atoi("-4")).toBe(-4);
    expect(atoi("x1")).toBe(0);
  });
});

describe("chat timers ([0x497158], [0x49715c])", () => {
  it("drops a repeated line or one within 2000 ms, and stamps only what goes out", () => {
    const timers = new ChatTimers();
    expect(timers.chat("하나", 0)).toBe(true);
    expect(timers.chat("둘", 1999)).toBe(false);
    expect(timers.chat("하나", 2000)).toBe(false);
    expect(timers.chat("둘", 2000)).toBe(true);
  });

  it("lets /w through on the 2000 ms alone and stamps it for chat too", () => {
    const timers = new ChatTimers();
    expect(timers.chat("하나", 0)).toBe(true);
    expect(timers.whisper(1000)).toBe(false);
    expect(timers.whisper(2000)).toBe(true);
    // The whisper's stamp holds chat back, but it is no line sent: the last line is still 하나.
    expect(timers.chat("둘", 3999)).toBe(false);
    expect(timers.chat("하나", 4000)).toBe(false);
    expect(timers.chat("둘", 4000)).toBe(true);
  });

  it("gives /users its own 5 s", () => {
    const timers = new ChatTimers();
    expect(timers.users(0)).toBe(true);
    expect(timers.chat("하나", 1)).toBe(true);
    expect(timers.users(USERS_INTERVAL_MS - 1)).toBe(false);
    expect(timers.users(USERS_INTERVAL_MS)).toBe(true);
  });
});

describe("the whisper target ([0x4927c8], 0x4468f6)", () => {
  it("sends a chat line to the target as a whisper too, and leaves commands alone", () => {
    expect(targetWhisper("tester2", chatSubmit("안녕  ", false))).toEqual({ to: "tester2", text: "안녕" });
    expect(targetWhisper("tester2", chatSubmit("/users", true))).toBeNull();
    expect(targetWhisper("tester2", chatSubmit("/w tester3 hi", true))).toBeNull();
    expect(targetWhisper("", chatSubmit("안녕", false))).toBeNull();
  });
});
