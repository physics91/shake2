// The room's game modes. The client branches on three predicates only (every caller of
// 0x440680): 자유 and 매너 are never told apart outside the server (original/FIDELITY.md §12).
import type { GameMode } from "./types.ts";

/** Mode names as the room's dropdown lists them (table 0x469954). */
export const MODE_NAMES: readonly string[] = [
  "개 인 전",
  "자유 팀 매치",
  "매너 팀 매치",
  "화력 개인전",
  "화력 자유 팀매치",
  "화력 매너 팀매치",
  "소환 자유 팀매치",
  "소환 매너 팀매치",
];

/** Teams a room slot can pick (SELECTTEAM buttons 1..6). */
export const TEAM_COUNT = 6;

/**
 * The original names no team; its buttons, bars and names only show the colour. These names of
 * the colours (purple, blue, green, pink, red, yellow) are this remake's, for text and screen readers.
 */
const TEAM_NAMES = ["보라", "파랑", "초록", "분홍", "빨강", "노랑"];

export function teamName(team: number): string {
  return `${TEAM_NAMES[team - 1] ?? team} 팀`;
}

export function isGameMode(value: unknown): value is GameMode {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value < MODE_NAMES.length;
}

/** mode != 0 && mode != 3 (0x40a9f6, 0x441130 and the rest). */
export function isTeamMode(mode: GameMode): boolean {
  return mode !== 0 && mode !== 3;
}

/** 화력 3..5: other brick and generator tables (0x44e47f, 0x417f00). */
export function isFirepowerMode(mode: GameMode): boolean {
  return mode >= 3 && mode <= 5;
}

/** 소환 6 and 7: the revive capsule (0x453270). */
export function isSummonMode(mode: GameMode): boolean {
  return mode === 6 || mode === 7;
}
