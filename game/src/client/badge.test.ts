import { describe, expect, it } from "vitest";
import { badgeOf, NO_BADGE, shownName } from "../server/protocol.ts";
import { GUILD_COUNT, guildLines, guildMark, guildName, LEVEL_TITLES, levelBadge, levelTitle } from "./badge.ts";

describe("badge", () => {
  it("draws a guild mark for 0 ≤ g below guild.dat's line count, none for −1", () => {
    expect(guildMark(-1)).toBeNull();
    expect(guildMark(0)).toEqual([0, 0, 15, 13]);
    expect(guildMark(16)).toEqual([15, 13, 30, 26]);
    expect(guildMark(GUILD_COUNT - 1)).not.toBeNull();
    expect(guildMark(GUILD_COUNT)).toBeNull();
    expect(guildMark(1.5)).toBeNull();
  });

  it("draws the level badges 1..12 from mark.shk, none for 0 or 13", () => {
    expect(levelBadge(0)).toBeNull();
    expect(levelBadge(1)).toEqual([0, 19, 15, 32]);
    expect(levelBadge(12)).toEqual([165, 19, 180, 32]);
    expect(levelBadge(13)).toBeNull();
    expect(levelBadge(NO_BADGE.level)).toBeNull();
  });

  it("names the levels as 0x469ca0 does", () => {
    expect(LEVEL_TITLES).toHaveLength(13);
    expect(levelTitle(1)).toBe("쉐이크 마스터");
    expect(levelTitle(12)).toBe("루 키 ");
    expect(levelTitle(13)).toBe("");
    expect(levelTitle(-1)).toBe("");
  });

  it("reads guild.dat's lines and names a guild by its line", () => {
    const lines = guildLines("무소속\r\n나이츠\r\n코벱\r\n");
    expect(lines).toEqual(["무소속", "나이츠", "코벱"]);
    expect(guildName(lines, 1)).toBe("나이츠");
    expect(guildName(lines, -1)).toBe("");
    expect(guildName(lines, 9)).toBe("");
  });

  it("shows the ID when the player asked for it or has no nickname, the nickname otherwise", () => {
    expect(shownName({ name: "tester1", nick: "닉", useId: false })).toBe("닉");
    expect(shownName({ name: "tester1", nick: "닉", useId: true })).toBe("tester1");
    expect(shownName({ name: "tester1", nick: "", useId: false })).toBe("tester1");
  });

  it("keeps only the badge's fields from a card", () => {
    expect(badgeOf({ guild: 3, level: 7, nick: "x" } as never)).toEqual({ guild: 3, level: 7 });
  });
});
