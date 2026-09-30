// A player's guild mark and level badge, as every list, the room, the game's panel and the result
// screens draw them by the name (0x441940, 0x442900), and the level's title and the guild's name.
import type { Rect } from "../assets/types.ts";
import type { Badge } from "../server/protocol.ts";
import { guildRect, rankRect } from "./hudLayout.ts";
import type { Point } from "./roomLayout.ts";
import { blit } from "./sprite.ts";

/** guild.dat's lines (0x4416f0 counts them into [0x496c8c]): marks 0..264. */
export const GUILD_COUNT = 265;
/** 0x442900's badges: 1 쉐이크 마스터 .. 12 루키; 13's art is blank and 0 a negative rect. */
export const LEVELS = 12;

/** 0x469ca0: the level titles by level, as the user info and my-info windows show them. */
export const LEVEL_TITLES = [
  "닉네임", "쉐이크 마스터", "쉐이크 히어로", "쉐이크 나이츠", "골드 나이츠", "실버 나이츠",
  "나이츠 ", "골드 워리어", "실버 워리어", "파이터 ", "베테랑 ", "솔 져 ", "루 키 ",
] as const;

/** The guild's mark in guild.shk, or none: 0x441940 draws 0 ≤ g below the guild count. */
export function guildMark(guild: number): Rect | null {
  return Number.isInteger(guild) && guild >= 0 && guild < GUILD_COUNT ? guildRect(guild) : null;
}

/** The level's badge in mark.shk, or none outside 1..12. */
export function levelBadge(level: number): Rect | null {
  return Number.isInteger(level) && level >= 1 && level <= LEVELS ? rankRect(level) : null;
}

export function levelTitle(level: number): string {
  return Number.isInteger(level) && level >= 0 && level <= LEVELS ? LEVEL_TITLES[level] : "";
}

/** The guild's name: guild.dat's line g, the one the mark's cell is (0x42dc93); none for −1. */
export function guildName(lines: readonly string[], guild: number): string {
  return guild >= 0 ? (lines[guild] ?? "") : "";
}

/** guild.dat as the loader reads it: cp949 lines, text mode. */
export function guildLines(text: string): string[] {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  if (lines.at(-1) === "") lines.pop();
  return lines;
}

export interface BadgeImages {
  /** guild.shk. */
  guild: HTMLImageElement;
  /** mark.shk. */
  mark: HTMLImageElement;
}

/** Both icons, each where it goes; nothing for a player with no account or a mark it has not. */
export function drawBadge(ctx: CanvasRenderingContext2D, images: BadgeImages, badge: Badge | null | undefined, guildAt: Point, levelAt: Point): void {
  if (!badge) return;
  const mark = guildMark(badge.guild);
  if (mark) blit(ctx, images.guild, mark, guildAt.x, guildAt.y);
  const level = levelBadge(badge.level);
  if (level) blit(ctx, images.mark, level, levelAt.x, levelAt.y);
}
