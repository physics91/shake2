// Local versus modes, remake features (AGENTS.md): the GAME ROOM screen over a room kept in
// the page. The screen sends what it would send the server; this answers as the server's room does
// for its host, and starts the match on this PC. 1P is the host in slot 0, 2P a ready guest in
// slot 1, and the other slots stay closed; the mode is 개인전.
import type { Manifest } from "../assets/types.ts";
import { compareIgnoreCase } from "../server/cp949.ts";
import type { ClientMessage, RoomInfo } from "../server/protocol.ts";
import { NO_BADGE, RANDOM_MAP } from "../server/protocol.ts";
import { MAX_PLAYERS, MEDALS_TO_WIN, ROUND_SECONDS } from "../sim/constants.ts";
import { msvcRand, srandTime } from "../sim/rng.ts";
import type { Rules } from "../sim/types.ts";
import { playableMaps } from "./menu.ts";

/** The player ids 1P and 2P play under. */
export const LOCAL_IDS = [1, 2] as const;

export type LocalMode = "versus" | "ai";

export const VERSUS_RULES: Rules = { practice: false, roundSeconds: ROUND_SECONDS, medalsToWin: MEDALS_TO_WIN, mode: 0 };

/** The room's lists as the server makes them (lobby.ts): maps by title, tunes by name, _stricmp. */
export interface LocalLists {
  maps: { id: string; title: string }[];
  music: string[];
}

export function localLists(manifest: Manifest): LocalLists {
  const maps = playableMaps(manifest)
    .map(({ id, title }) => ({ id, title }))
    .sort((a, b) => compareIgnoreCase(a.title, b.title));
  const music = (manifest.music ?? [])
    .filter((t) => t.role === "game")
    .map((t) => t.name)
    .sort(compareIgnoreCase);
  return { maps, music };
}

export function localRoom(lists: LocalLists, characters: readonly [string, string], mode: LocalMode = "versus"): RoomInfo {
  return {
    code: "",
    number: 0,
    title: mode === "ai" ? "AI 대전" : "2인 대전",
    hostId: LOCAL_IDS[0],
    // The server's room starts on the first map too (room.ts).
    mapId: lists.maps[0]?.id ?? RANDOM_MAP,
    music: 0,
    mode: 0,
    closed: Array.from({ length: MAX_PLAYERS }, (_, slot) => slot >= LOCAL_IDS.length),
    players: LOCAL_IDS.map((id, slot) => {
      const name = mode === "ai" && slot === 1 ? "AI" : `${slot + 1}P`;
      return { id, name, nick: name, useId: true, character: characters[slot], hue: 0, wins: 0, cell: 0, badge: NO_BADGE, ready: true, team: slot + 1, slot };
    }),
    playing: false,
  };
}

export type LocalAnswer = { kind: "changed" } | { kind: "start"; mapId: string; music: number } | { kind: "leave" } | null;

/** What the room does with a message from its screen; null when nothing changes. */
export function answerLocal(room: RoomInfo, lists: LocalLists, message: ClientMessage, clockMs = Date.now()): LocalAnswer {
  switch (message.type) {
    case "set-map":
      if (message.mapId !== RANDOM_MAP && !lists.maps.some((m) => m.id === message.mapId)) return null;
      room.mapId = message.mapId;
      return { kind: "changed" };
    case "set-music":
      if (!Number.isInteger(message.music) || message.music < 0 || message.music > lists.music.length) return null;
      room.music = message.music;
      return { kind: "changed" };
    case "start": {
      // The host's START (0x45a6f3, room.ts): srand(time(0)), a RANDOM map from one rand(), then a RANDOM tune.
      const rng = { rng: 0, clockMs };
      srandTime(rng, 0);
      const mapId = room.mapId === RANDOM_MAP ? lists.maps[msvcRand(rng) % lists.maps.length].id : room.mapId;
      const music = room.music === 0 && lists.music.length > 0 ? (msvcRand(rng) % lists.music.length) + 1 : room.music;
      return { kind: "start", mapId, music };
    }
    case "leave-room":
      return { kind: "leave" };
    default:
      return null;
  }
}

/** A player's slot clicked in the local room: the next character (R, the remake's way to choose). */
export function nextCharacter(characters: readonly string[], current: string): string {
  const at = characters.indexOf(current);
  return characters[(at + 1) % characters.length];
}
