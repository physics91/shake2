import { describe, expect, it } from "vitest";

import type { Manifest } from "../assets/types.ts";
import type { MusicTrack } from "./audio.ts";
import { gameTracks, listedTrack, pickGameTrack } from "./music.ts";

const TRACKS: MusicTrack[] = ["a", "b", "c"].map((file) => ({ file, loopEnd: 0 }));

describe("game track", () => {
  it("picks the roll modulo the track count", () => {
    expect(pickGameTrack(TRACKS, 4)?.file).toBe("b");
    expect(pickGameTrack(TRACKS, -2)?.file).toBe("c");
  });

  it("plays nothing without tracks or with a roll that is not a finite number", () => {
    expect(pickGameTrack([], 1)).toBeNull();
    expect(pickGameTrack(TRACKS, Number.NaN)).toBeNull();
    expect(pickGameTrack(TRACKS, "1" as unknown as number)).toBeNull();
  });
});

describe("the room's music list (0x404200)", () => {
  const manifest = {
    music: [
      { name: "Red's thema", role: "game", file: "Red's thema.flac", loopEnd: 1 },
      { name: "red", role: "game", file: "red.flac", loopEnd: 2 },
      { name: "tbwait22", role: "room", file: "tbwait22.flac", loopEnd: 3 },
      { name: "Red thema", role: "game", file: "Red thema.flac", loopEnd: 4 },
    ],
  } as unknown as Manifest;

  it("sorts the game tunes by file name the way _stricmp does: case folded, then by byte", () => {
    expect(gameTracks(manifest).map((t) => t.file)).toEqual(["red.flac", "Red thema.flac", "Red's thema.flac"]);
  });

  it("plays entry n of the server's list (entry 0 is RANDOM, which the server has already rolled)", () => {
    const names = ["red", "Red thema", "Red's thema"];
    expect(listedTrack(manifest, names, 3)).toEqual({ file: "Red's thema.flac", loopEnd: 1 });
    expect(listedTrack(manifest, names, 0)).toBeNull();
    expect(listedTrack(manifest, names, 4)).toBeNull();
    expect(listedTrack(manifest, ["gone"], 1)).toBeNull();
  });
});
