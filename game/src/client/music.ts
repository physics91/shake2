import type { Manifest } from "../assets/types.ts";
import { compareIgnoreCase } from "../server/cp949.ts";
import type { MusicTrack, SoundBank } from "./audio.ts";

/** DirectMusic SetRepeats: 10 in a round (0x43fc40), 10000 for the lobby and room tunes. */
export const GAME_REPEATS = 10;
export const LOBBY_REPEATS = 10_000;

/** Game tunes in the order of the host's list: file names sorted with _stricmp (0x404200, 0x45ed40). */
export function gameTracks(manifest: Manifest): MusicTrack[] {
  return (manifest.music ?? [])
    .filter((t) => t.role === "game")
    .sort((a, b) => compareIgnoreCase(a.name, b.name))
    .map((t) => ({ file: t.file, loopEnd: t.loopEnd }));
}

/** Online: entry `music` of the server's list, whose entry 0 is RANDOM; anything else plays nothing. */
export function listedTrack(manifest: Manifest, names: readonly string[], music: number): MusicTrack | null {
  const name = Number.isInteger(music) && music >= 1 ? names[music - 1] : undefined;
  const track = (manifest.music ?? []).find((t) => t.role === "game" && t.name === name);
  return track ? { file: track.file, loopEnd: track.loopEnd } : null;
}

/**
 * RANDOM picks entry rand() % 14 + 1 of the list, whose entry 0 is RANDOM itself (0x45a7c4); the
 * local game rolls it here. Anything but a finite number means no music.
 */
export function pickGameTrack(tracks: readonly MusicTrack[], roll: number): MusicTrack | null {
  if (tracks.length === 0 || typeof roll !== "number" || !Number.isFinite(roll)) return null;
  return tracks[Math.abs(Math.trunc(roll)) % tracks.length];
}

/** tbwait11 plays on the login and lobby screens, tbwait22 in a room (0x460add, 0x444e44). */
export function playWaitingMusic(sounds: SoundBank, manifest: Manifest, place: "lobby" | "room"): void {
  const track = (manifest.music ?? []).find((t) => t.role === place);
  if (track) sounds.playMusic({ file: track.file, loopEnd: track.loopEnd }, LOBBY_REPEATS);
}
