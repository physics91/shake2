import { describe, expect, it } from "vitest";

import type { Manifest } from "../assets/types.ts";
import { RANDOM_MAP } from "../server/protocol.ts";
import { answerLocal, LOCAL_IDS, localLists, localRoom, nextCharacter } from "./localRoom.ts";

const MANIFEST = {
  characters: ["bobo", "doona", "shark"],
  maps: [
    { id: "space01", title: "04스페이스코벱", objects: 0 },
    { id: "practice", title: "practice", objects: 0 },
    { id: "bella01", title: "13벨라트릭스코벱", objects: 0 },
    { id: "Mizar01", title: "01미자르코벱", objects: 0 },
  ],
  music: [
    { name: "tbwait11", role: "lobby" },
    { name: "Shake02", role: "game" },
    { name: "boss", role: "game" },
  ],
} as unknown as Manifest;

describe("local room lists", () => {
  it("are the server's: room maps by title and game tunes by name, both case-blind", () => {
    const lists = localLists(MANIFEST);
    expect(lists.maps.map((m) => m.id)).toEqual(["Mizar01", "space01", "bella01"]);
    expect(lists.music).toEqual(["boss", "Shake02"]);
  });
});

describe("local room", () => {
  const lists = localLists(MANIFEST);

  it("seats 1P (host) and 2P, both ready, and closes the other four slots", () => {
    const room = localRoom(lists, ["shark", "doona"]);
    expect(room.hostId).toBe(LOCAL_IDS[0]);
    expect(room.players.map((p) => [p.id, p.name, p.character, p.slot, p.ready])).toEqual([
      [LOCAL_IDS[0], "1P", "shark", 0, true],
      [LOCAL_IDS[1], "2P", "doona", 1, true],
    ]);
    expect(room.closed).toEqual([false, false, true, true, true, true]);
    expect(room.mapId).toBe("Mizar01");
    expect(room.music).toBe(0);
    expect(room.mode).toBe(0);
  });

  it("uses the same room with a ready AI opponent in the second slot", () => {
    const room = localRoom(lists, ["shark", "doona"], "ai");
    expect(room.title).toBe("AI 대전");
    expect(room.players.map((p) => [p.name, p.character, p.ready])).toEqual([
      ["1P", "shark", true], ["AI", "doona", true],
    ]);
    expect(room.closed).toEqual([false, false, true, true, true, true]);
    expect(answerLocal(room, lists, { type: "start" }, 0)).toEqual({ kind: "start", mapId: "Mizar01", music: 1 });
  });

  it("takes the host's map and tune within the lists and leaves slots, teams and mode as they are", () => {
    const room = localRoom(lists, ["shark", "doona"]);
    expect(answerLocal(room, lists, { type: "set-map", mapId: "bella01" })).toEqual({ kind: "changed" });
    expect(room.mapId).toBe("bella01");
    expect(answerLocal(room, lists, { type: "set-map", mapId: RANDOM_MAP })).toEqual({ kind: "changed" });
    expect(answerLocal(room, lists, { type: "set-map", mapId: "practice" })).toBeNull();
    expect(room.mapId).toBe(RANDOM_MAP);
    expect(answerLocal(room, lists, { type: "set-music", music: 2 })).toEqual({ kind: "changed" });
    expect(answerLocal(room, lists, { type: "set-music", music: 3 })).toBeNull();
    expect(room.music).toBe(2);
    for (const message of [
      { type: "set-slot", slot: 3, open: true },
      { type: "set-team", team: 4 },
      { type: "set-mode", mode: 1 },
      { type: "set-ready", ready: false },
    ] as const) {
      expect(answerLocal(room, lists, message)).toBeNull();
    }
    expect(room.closed[3]).toBe(true);
    expect(room.mode).toBe(0);
  });

  it("starts on START as the server would: a RANDOM map, then a RANDOM tune, each from one rand()", () => {
    const room = localRoom(lists, ["shark", "doona"]);
    // srand(time(0)) at 0 s: the first rand() is 38, and the map is set, so the tune is 38 % 2 + 1.
    expect(answerLocal(room, lists, { type: "start" }, 0)).toEqual({ kind: "start", mapId: "Mizar01", music: 1 });
    room.mapId = RANDOM_MAP;
    room.music = 2;
    // At 12 s the first rand() is 77: entry 77 % 3 of the maps, and the set tune stays.
    expect(answerLocal(room, lists, { type: "start" }, 12_000)).toEqual({ kind: "start", mapId: "bella01", music: 2 });
  });

  it("leaves on the EXIT box's YES", () => {
    const room = localRoom(lists, ["shark", "doona"]);
    expect(answerLocal(room, lists, { type: "leave-room" })).toEqual({ kind: "leave" });
  });
});

describe("nextCharacter", () => {
  it("goes round the list, and from a missing name to the first", () => {
    expect(nextCharacter(["bobo", "doona", "shark"], "doona")).toBe("shark");
    expect(nextCharacter(["bobo", "doona", "shark"], "shark")).toBe("bobo");
    expect(nextCharacter(["bobo", "doona", "shark"], "gone")).toBe("bobo");
  });
});
