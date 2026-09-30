import { describe, expect, it } from "vitest";

import { TICK_RATE } from "../sim/constants.ts";
import { msvcRand } from "../sim/rng.ts";
import { layoutFromAscii, VERSUS } from "../sim/testing.ts";
import { FriendBook } from "./friends.ts";
import type { LobbyConfig } from "./lobby.ts";
import { Lobby, PASSWORD_FAILURES_KEPT_MS, PASSWORD_RETRY_MAX_MS, PASSWORD_RETRY_MS } from "./lobby.ts";
import type { RoomInfo, ServerMessage } from "./protocol.ts";
import { PROTOCOL_VERSION, START_BARS, TYPING_PACKET_MS, typingPacketDue } from "./protocol.ts";
import { PING_ECHO_MS } from "./room.ts";

const LAYOUT = layoutFromAscii(["1....", ".....", "....2"]);
/** Wait (1 s) and countdown (4 s) before play. */
const TO_PLAY = 5 * TICK_RATE;

function makeLobby(overrides: Partial<LobbyConfig> = {}) {
  let codes = 0;
  const clock = { now: 0 };
  const lobby = new Lobby({
    maps: [
      { id: "arena", title: "01아레나", layout: { ...LAYOUT, id: "arena" } },
      { id: "other", title: "02다른 맵", layout: { ...LAYOUT, id: "other" } },
    ],
    music: ["b tune", "A tune", "c tune"],
    characters: ["bobo", "doona"],
    rules: { ...VERSUS, medalsToWin: 1 },
    maxRooms: 2,
    channel: "시험 채널",
    friends: new FriendBook(),
    now: () => clock.now,
    roomCode: () => ["ABCD", "EFGH", "JKLM"][codes++ % 3],
    ...overrides,
  });
  const inbox = new Map<number, ServerMessage[]>();
  const connect = (id: number, name = `P${id}`, character = "bobo", address?: string) => {
    inbox.set(id, []);
    lobby.connect({ id, send: (m) => inbox.get(id)?.push(m), address });
    lobby.handle(id, { type: "hello", version: PROTOCOL_VERSION, name, character });
  };
  const last = <T extends ServerMessage["type"]>(id: number, type: T) =>
    (inbox.get(id) ?? []).filter((m): m is Extract<ServerMessage, { type: T }> => m.type === type).at(-1);
  const room = (id: number): RoomInfo | null | undefined => last(id, "room")?.room;
  const chats = (id: number) =>
    (inbox.get(id) ?? []).filter((m): m is Extract<ServerMessage, { type: "chat" }> => m.type === "chat");
  const lobbyOf = (id: number) => last(id, "lobby");
  const lobbyChats = (id: number) =>
    (inbox.get(id) ?? []).filter((m): m is Extract<ServerMessage, { type: "lobby-chat" }> => m.type === "lobby-chat");
  const count = (id: number, type: ServerMessage["type"]) => (inbox.get(id) ?? []).filter((m) => m.type === type).length;
  return { lobby, inbox, connect, last, room, chats, clock, lobbyOf, lobbyChats, count };
}

function startTwoPlayerMatch() {
  const t = makeLobby();
  t.connect(1);
  t.connect(2, "둘", "doona");
  t.lobby.handle(1, { type: "create-room", title: "" });
  t.lobby.handle(2, { type: "join-room", code: "ABCD" });
  t.lobby.handle(2, { type: "set-ready", ready: true });
  t.lobby.handle(1, { type: "start" });
  return t;
}

function hostAndGuestOf(t: ReturnType<typeof makeLobby>) {
  t.connect(1);
  t.connect(2, "둘");
  t.lobby.handle(1, { type: "create-room", title: "" });
  t.lobby.handle(2, { type: "join-room", code: "ABCD" });
  return t;
}

describe("Lobby", () => {
  it("greets a player and lets a second one join the room by code", () => {
    const t = makeLobby();
    t.connect(1);
    expect(t.last(1, "welcome")).toMatchObject({ playerId: 1, characters: ["bobo", "doona"] });

    t.lobby.handle(1, { type: "create-room", title: "" });
    t.connect(2, "둘", "doona");
    t.lobby.handle(2, { type: "join-room", code: "ABCD" });

    expect(t.room(1)).toMatchObject({ code: "ABCD", hostId: 1, mapId: "arena", playing: false });
    expect(t.room(1)?.players.map((p) => [p.id, p.name, p.character])).toEqual([
      [1, "P1", "bobo"],
      [2, "둘", "doona"],
    ]);
  });

  it("answers the server list's load query before hello: the channel and rooms / max rooms (C->S 0x4c)", () => {
    const t = makeLobby();
    t.inbox.set(9, []);
    t.lobby.connect({ id: 9, send: (m) => t.inbox.get(9)?.push(m) });
    t.lobby.handle(9, { type: "server-info" });
    expect(t.last(9, "server-info")).toEqual({ type: "server-info", name: "시험 채널", load: 0 });
    expect(t.last(9, "error")).toBeUndefined();
    expect(t.last(9, "welcome")).toBeUndefined();

    t.connect(1);
    t.lobby.handle(1, { type: "create-room", title: "" });
    t.lobby.handle(9, { type: "server-info" });
    expect(t.last(9, "server-info")?.load).toBe(50);
    // The asker is not a lobby user until its hello.
    t.connect(2);
    expect(t.lobbyOf(2)?.users.map((u) => u.id)).toEqual([2]);
  });

  it("requires hello, a known character and a known room", () => {
    const t = makeLobby();
    t.inbox.set(9, []);
    t.lobby.connect({ id: 9, send: (m) => t.inbox.get(9)?.push(m) });
    t.lobby.handle(9, { type: "create-room", title: "" });
    expect(t.last(9, "error")).toBeDefined();

    t.lobby.handle(9, { type: "hello", version: PROTOCOL_VERSION, name: "x", character: "nobody" });
    expect(t.last(9, "error")?.message).toContain("캐릭터");

    t.connect(1);
    t.lobby.handle(1, { type: "join-room", code: "ZZZZ" });
    expect(t.last(1, "error")?.message).toContain("찾을 수 없");
  });

  it("only lets the host start, once every other player is ready", () => {
    const t = makeLobby();
    t.connect(1);
    t.connect(2);
    t.lobby.handle(1, { type: "create-room", title: "" });
    t.lobby.handle(1, { type: "set-ready", ready: true });
    t.lobby.handle(1, { type: "start" });
    expect(t.last(1, "error")?.message).toContain("2명");

    t.lobby.handle(2, { type: "join-room", code: "ABCD" });
    t.lobby.handle(2, { type: "start" });
    expect(t.last(2, "error")?.message).toContain("방장");
    t.lobby.handle(1, { type: "start" });
    expect(t.last(1, "error")?.message).toContain("준비");

    t.lobby.handle(2, { type: "set-ready", ready: true });
    t.lobby.handle(1, { type: "set-map", mapId: "other" });
    t.lobby.handle(1, { type: "start" });
    expect(t.last(2, "match-start")?.layout.width).toBe(5);
    expect(t.room(2)).toMatchObject({ playing: true, mapId: "other" });
  });

  it("lets only the host change the game mode, and not during a match", () => {
    const t = makeLobby();
    t.connect(1);
    t.connect(2);
    t.lobby.handle(1, { type: "create-room", title: "" });
    t.lobby.handle(2, { type: "join-room", code: "ABCD" });
    expect(t.room(1)?.mode).toBe(0);

    t.lobby.handle(2, { type: "set-mode", mode: 1 });
    expect(t.last(2, "error")?.message).toContain("방장");
    t.lobby.handle(1, { type: "set-mode", mode: 6 });
    expect(t.room(2)?.mode).toBe(6);
  });

  it("puts the creator on team 1 and joiners on the smaller of teams 1 and 2, and keeps teams across mode changes", () => {
    const t = makeLobby();
    for (const id of [1, 2, 3, 4]) t.connect(id);
    t.lobby.handle(1, { type: "create-room", title: "" });
    for (const id of [2, 3, 4]) t.lobby.handle(id, { type: "join-room", code: "ABCD" });
    expect(t.room(1)?.players.map((p) => p.team)).toEqual([1, 2, 1, 2]);

    t.lobby.handle(1, { type: "set-mode", mode: 1 });
    t.lobby.handle(3, { type: "set-team", team: 5 });
    t.lobby.handle(1, { type: "set-mode", mode: 0 });
    t.lobby.handle(1, { type: "set-mode", mode: 2 });
    expect(t.room(1)?.players.map((p) => p.team)).toEqual([1, 2, 5, 2]);
  });

  it("changes teams only in the team modes and never while ready (0x4280e3, 0x448970)", () => {
    const t = makeLobby();
    t.connect(1);
    t.connect(2);
    t.lobby.handle(1, { type: "create-room", title: "" });
    t.lobby.handle(2, { type: "join-room", code: "ABCD" });

    t.lobby.handle(2, { type: "set-team", team: 3 });
    expect(t.last(2, "error")?.message).toContain("팀전");
    t.lobby.handle(1, { type: "set-mode", mode: 4 });
    t.lobby.handle(2, { type: "set-ready", ready: true });
    t.lobby.handle(2, { type: "set-team", team: 3 });
    expect(t.last(2, "error")?.message).toContain("준비");
    t.lobby.handle(2, { type: "set-ready", ready: false });
    t.lobby.handle(2, { type: "set-team", team: 3 });
    expect(t.room(1)?.players.map((p) => p.team)).toEqual([1, 3]);
  });

  it("refuses a team-mode start with everyone on one team, then plays it with the room's teams and mode", () => {
    const t = makeLobby();
    t.connect(1);
    t.connect(2);
    t.lobby.handle(1, { type: "create-room", title: "" });
    t.lobby.handle(2, { type: "join-room", code: "ABCD" });
    t.lobby.handle(1, { type: "set-mode", mode: 6 });
    t.lobby.handle(2, { type: "set-team", team: 1 });
    t.lobby.handle(1, { type: "set-ready", ready: true });
    t.lobby.handle(2, { type: "set-ready", ready: true });

    t.lobby.handle(1, { type: "start" });
    expect(t.last(1, "error")?.message).toBe("팀 구성이 적합하지 않습니다.");
    expect(t.room(1)?.playing).toBe(false);

    t.lobby.handle(2, { type: "set-ready", ready: false });
    t.lobby.handle(2, { type: "set-team", team: 4 });
    t.lobby.handle(2, { type: "set-ready", ready: true });
    t.lobby.handle(1, { type: "start" });
    const snapshot = t.last(2, "snapshot");
    expect(snapshot?.state.rules.mode).toBe(6);
    expect(snapshot?.state.players.map((p) => p.team)).toEqual([1, 4]);
    t.lobby.handle(1, { type: "set-mode", mode: 0 });
    expect(t.last(1, "error")?.message).toContain("게임 중");
  });

  it("keeps each player's room slot when an earlier one leaves, and fills the lowest free slot (+0x6c)", () => {
    const t = makeLobby();
    for (const id of [1, 2, 3, 4]) t.connect(id);
    t.lobby.handle(1, { type: "create-room", title: "" });
    t.lobby.handle(2, { type: "join-room", code: "ABCD" });
    t.lobby.handle(3, { type: "join-room", code: "ABCD" });
    t.lobby.handle(2, { type: "leave-room" });
    expect(t.room(1)?.players.map((p) => [p.id, p.slot])).toEqual([
      [1, 0],
      [3, 2],
    ]);

    t.lobby.handle(4, { type: "join-room", code: "ABCD" });
    expect(t.room(1)?.players.map((p) => [p.id, p.slot])).toEqual([
      [1, 0],
      [4, 1],
      [3, 2],
    ]);
  });

  it("plays the match in the room's slots, gaps included", () => {
    const layout = layoutFromAscii(["1...2", ".....", "3...."]);
    const t = makeLobby({ maps: [{ id: "arena", title: "아레나", layout }] });
    for (const id of [1, 2, 3]) t.connect(id);
    t.lobby.handle(1, { type: "create-room", title: "" });
    t.lobby.handle(2, { type: "join-room", code: "ABCD" });
    t.lobby.handle(3, { type: "join-room", code: "ABCD" });
    t.lobby.handle(2, { type: "leave-room" });
    t.lobby.handle(1, { type: "set-ready", ready: true });
    t.lobby.handle(3, { type: "set-ready", ready: true });
    t.lobby.handle(1, { type: "start" });

    expect(t.last(3, "snapshot")?.state.players.map((p) => [p.id, p.slot])).toEqual([
      [1, 0],
      [3, 2],
    ]);
  });

  it("caps the number of rooms", () => {
    const t = makeLobby();
    for (const id of [1, 2, 3]) {
      t.connect(id);
      t.lobby.handle(id, { type: "create-room", title: "" });
    }
    expect(t.lobby.roomCount).toBe(2);
    expect(t.last(3, "error")?.message).toContain("가득");
  });

  it("broadcasts a snapshot every 30 Hz logic frame with the events of every tick", () => {
    const t = startTwoPlayerMatch();
    const snapshots = () => (t.inbox.get(2) ?? []).filter((m) => m.type === "snapshot");
    const before = snapshots().length;
    for (let i = 0; i < TICK_RATE; i++) t.lobby.tick();

    expect(snapshots().length - before).toBe(TICK_RATE);
    const events = snapshots().flatMap((m) => (m.type === "snapshot" ? m.events : []));
    expect(events.map((e) => e.type)).toEqual(["round-start"]);
  });

  it("keeps a bomb tap that starts and ends between two ticks", () => {
    const t = startTwoPlayerMatch();
    for (let i = 0; i < TO_PLAY; i++) t.lobby.tick();
    expect(t.last(1, "snapshot")?.state.phase).toBe("playing");

    t.lobby.handle(1, { type: "input", dir: null, bomb: true, attack: false, evade: false });
    t.lobby.handle(1, { type: "input", dir: null, bomb: false, attack: false, evade: false });
    t.lobby.tick();
    t.lobby.tick();

    expect(t.last(1, "snapshot")?.state.bombs).toHaveLength(1);
  });

  it("plays a round to the end: a player caught by their own bomb hands the medal to the other", () => {
    const t = startTwoPlayerMatch();
    for (let i = 0; i < TO_PLAY; i++) t.lobby.tick();
    t.lobby.handle(1, { type: "input", dir: null, bomb: true, attack: false, evade: false });
    const seen: string[] = [];
    let medals: number[] = [];
    for (let i = 0; i < 7 * TICK_RATE; i++) {
      t.lobby.tick();
      const snap = t.last(2, "snapshot");
      if (snap) {
        seen.push(...snap.events.map((e) => e.type));
        medals = snap.state.players.map((p) => p.medals);
      }
      t.inbox.set(2, []);
    }

    expect(seen).toEqual(expect.arrayContaining(["bomb-placed", "explode", "death", "match-over"]));
    expect(medals).toEqual([0, 1]);
  });

  it("returns everyone to the room after the match and clears ready flags", () => {
    const t = startTwoPlayerMatch();
    for (let i = 0; i < TO_PLAY; i++) t.lobby.tick();
    t.lobby.handle(1, { type: "leave-room" });
    expect(t.last(2, "snapshot")?.state.phase).toBe("playing");
    t.lobby.tick();
    expect(t.last(2, "snapshot")?.state).toMatchObject({ phase: "match-over", matchWinnerId: 2 });

    for (let i = 0; i < 5 * TICK_RATE - 2; i++) t.lobby.tick();
    expect(t.last(2, "match-end")).toBeUndefined();
    t.lobby.tick();

    expect(t.last(1, "room")?.room).toBeNull();
    expect(t.last(2, "match-end")).toBeDefined();
    expect(t.room(2)).toMatchObject({ hostId: 2, playing: false });
    expect(t.room(2)?.players.every((p) => !p.ready)).toBe(true);
  });

  it("dissolves a room when its last player disconnects", () => {
    const t = startTwoPlayerMatch();
    t.lobby.disconnect(1);
    t.lobby.disconnect(2);
    expect(t.lobby.roomCount).toBe(0);
  });
});

describe("Room (scene 7)", () => {
  function hostAndGuest(overrides: Partial<LobbyConfig> = {}) {
    const t = makeLobby(overrides);
    t.connect(1);
    t.connect(2, "둘");
    t.lobby.handle(1, { type: "create-room", title: "한판" });
    t.lobby.handle(2, { type: "join-room", code: "ABCD" });
    return t;
  }

  it("gives the host no ready state: START sends start, not ready (0x45a412)", () => {
    const t = hostAndGuest();
    t.lobby.handle(1, { type: "set-ready", ready: true });
    expect(t.room(1)?.players.map((p) => p.ready)).toEqual([false, false]);

    t.lobby.handle(2, { type: "set-ready", ready: true });
    t.lobby.handle(1, { type: "start" });
    expect(t.room(1)?.playing).toBe(true);
  });

  it("clears the ready flag of a player who becomes host", () => {
    const t = hostAndGuest();
    t.lobby.handle(2, { type: "set-ready", ready: true });
    t.lobby.handle(1, { type: "leave-room" });
    expect(t.room(2)?.hostId).toBe(2);
    expect(t.room(2)?.players[0].ready).toBe(false);
  });

  it("lets the host change team only while another player in an open slot is not ready (0x428108)", () => {
    const t = makeLobby();
    t.connect(1);
    t.connect(2);
    t.lobby.handle(1, { type: "create-room", title: "" });
    t.lobby.handle(1, { type: "set-mode", mode: 1 });
    t.lobby.handle(1, { type: "set-team", team: 3 });
    expect(t.last(1, "error")?.message).toBe("준비하지 않은 참가자가 있을 때만 방장이 팀을 바꿀 수 있습니다.");

    t.lobby.handle(2, { type: "join-room", code: "ABCD" });
    t.lobby.handle(1, { type: "set-team", team: 3 });
    expect(t.room(1)?.players[0].team).toBe(3);

    t.lobby.handle(2, { type: "set-ready", ready: true });
    t.lobby.handle(1, { type: "set-team", team: 4 });
    expect(t.room(1)?.players[0].team).toBe(3);
  });

  it("lists the maps and tunes in _stricmp order (0x45ed40, 0x45f120)", () => {
    const t = makeLobby({
      maps: [
        { id: "late", title: "02나중", layout: LAYOUT },
        { id: "early", title: "01먼저", layout: LAYOUT },
      ],
    });
    t.connect(1);
    expect(t.last(1, "welcome")?.maps.map((m) => m.id)).toEqual(["early", "late"]);
    expect(t.last(1, "welcome")?.music).toEqual(["A tune", "b tune", "c tune"]);
    t.lobby.handle(1, { type: "create-room", title: "" });
    expect(t.room(1)?.mapId).toBe("early");
  });

  it("numbers rooms with the lowest free number and keeps the title", () => {
    const t = makeLobby();
    for (const id of [1, 2, 3]) t.connect(id, `P${id}`);
    t.lobby.handle(1, { type: "create-room", title: "첫 방" });
    t.lobby.handle(2, { type: "create-room", title: "" });
    expect(t.room(1)).toMatchObject({ number: 0, title: "첫 방" });
    expect(t.room(2)).toMatchObject({ number: 1, title: "P2의 방" });

    t.lobby.handle(1, { type: "leave-room" });
    t.lobby.handle(3, { type: "create-room", title: "셋" });
    expect(t.room(3)).toMatchObject({ number: 0, title: "셋" });
  });

  it("starts on the chosen map and tune", () => {
    const t = hostAndGuest();
    expect(t.room(1)?.music).toBe(0);
    t.lobby.handle(1, { type: "set-map", mapId: "other" });
    t.lobby.handle(1, { type: "set-music", music: 3 });
    t.lobby.handle(2, { type: "set-ready", ready: true });
    t.lobby.handle(1, { type: "start" });
    expect(t.last(2, "match-start")).toMatchObject({ layout: { id: "other" }, music: 3 });
  });

  it("rolls a RANDOM map and tune at the start after srand(time) and keeps RANDOM in the room (0x45a705: rand() % n + 1)", () => {
    const t = hostAndGuest();
    t.lobby.handle(1, { type: "set-map", mapId: "RANDOM" });
    t.lobby.handle(2, { type: "set-ready", ready: true });
    t.clock.now = 1_700_000_000_999;
    t.lobby.handle(1, { type: "start" });
    // srand(1700000000): the map takes the first rand(), the tune the second.
    const rng = { rng: 1_700_000_000 };
    const map = ["arena", "other"][msvcRand(rng) % 2];
    const music = (msvcRand(rng) % 3) + 1;
    expect(t.last(2, "match-start")).toMatchObject({ layout: { id: map }, music });
    expect(t.room(2)?.mapId).toBe("RANDOM");
  });

  it("rolls the tune with the first rand() when only the tune is RANDOM", () => {
    const t = hostAndGuest();
    t.lobby.handle(2, { type: "set-ready", ready: true });
    t.clock.now = 1_700_000_003_000;
    t.lobby.handle(1, { type: "start" });
    expect(t.last(2, "match-start")).toMatchObject({ music: (msvcRand({ rng: 1_700_000_003 }) % 3) + 1 });
  });

  it("lets only the host pick the tune, from RANDOM (0) to the last one", () => {
    const t = hostAndGuest();
    t.lobby.handle(2, { type: "set-music", music: 1 });
    expect(t.last(2, "error")?.message).toContain("방장");
    t.lobby.handle(1, { type: "set-music", music: 4 });
    expect(t.last(1, "error")?.message).toContain("배경음악");
    t.lobby.handle(1, { type: "set-music", music: 3 });
    expect(t.room(2)?.music).toBe(3);
  });

  it("lets the host close and open empty slots; joiners take the lowest open slot or are refused (0x45)", () => {
    const t = makeLobby();
    for (const id of [1, 2, 3, 4]) t.connect(id);
    t.lobby.handle(1, { type: "create-room", title: "" });
    t.lobby.handle(1, { type: "set-slot", slot: 1, open: false });
    t.lobby.handle(2, { type: "join-room", code: "ABCD" });
    expect(t.room(1)?.closed).toEqual([false, true, false, false, false, false]);
    expect(t.room(1)?.players.map((p) => p.slot)).toEqual([0, 2]);

    t.lobby.handle(2, { type: "set-slot", slot: 3, open: false });
    expect(t.last(2, "error")?.message).toContain("방장");
    t.lobby.handle(1, { type: "set-slot", slot: 2, open: false });
    expect(t.last(1, "error")?.message).toContain("빈 자리");

    for (const slot of [3, 4, 5]) t.lobby.handle(1, { type: "set-slot", slot, open: false });
    t.lobby.handle(3, { type: "join-room", code: "ABCD" });
    expect(t.last(3, "error")?.message).toBe("정원 초과 입니다.");

    t.lobby.handle(1, { type: "leave-room" });
    expect(t.room(2)?.closed).toEqual([false, true, false, true, true, true]);
    t.lobby.handle(2, { type: "set-slot", slot: 4, open: true });
    t.lobby.handle(4, { type: "join-room", code: "ABCD" });
    expect(t.room(4)?.players.map((p) => [p.id, p.slot])).toEqual([
      [4, 0],
      [2, 2],
    ]);
  });

  it("refuses to join a room that is playing, with the original's message (res#15)", () => {
    const t = startTwoPlayerMatch();
    t.connect(3);
    t.lobby.handle(3, { type: "join-room", code: "ABCD" });
    expect(t.last(3, "error")?.message).toBe("이미 시작 되었습니다.");
  });

  it("relays chat and tells the room who entered and left", () => {
    const t = hostAndGuest();
    expect(t.chats(1)).toEqual([{ type: "chat", kind: "enter", name: "둘", text: "" }]);
    expect(t.chats(2)).toEqual([{ type: "chat", kind: "enter", name: "둘", text: "" }]);

    t.lobby.handle(2, { type: "chat", text: "안녕" });
    expect(t.chats(1).at(-1)).toEqual({ type: "chat", kind: "talk", name: "둘", text: "안녕" });
    expect(t.chats(2).at(-1)).toEqual({ type: "chat", kind: "talk", name: "둘", text: "안녕" });

    t.lobby.handle(2, { type: "leave-room" });
    expect(t.chats(1).at(-1)).toEqual({ type: "chat", kind: "leave", name: "둘", text: "" });
  });

  it("tells the room a host left with the host-change line, whose name goes to the new host (S->C 0x40)", () => {
    const t = hostAndGuest();
    t.lobby.handle(1, { type: "leave-room" });
    expect(t.room(2)?.hostId).toBe(2);
    expect(t.chats(2).at(-1)).toEqual({ type: "chat", kind: "host-leave", name: "P1", text: "" });
  });

  it("drops a line that repeats the last one or comes under 2 s after it (0x43f7a0)", () => {
    const t = hostAndGuest();
    const talk = () => t.chats(1).filter((m) => m.kind === "talk").map((m) => m.text);
    t.lobby.handle(2, { type: "chat", text: "하나" });
    t.clock.now = 1999;
    t.lobby.handle(2, { type: "chat", text: "둘" });
    t.clock.now = 2000;
    t.lobby.handle(2, { type: "chat", text: "하나" });
    t.clock.now = 4000;
    t.lobby.handle(2, { type: "chat", text: "셋" });
    t.lobby.handle(1, { type: "chat", text: "방장" });
    expect(talk()).toEqual(["하나", "셋", "방장"]);
  });

  it("takes no chat during a match", () => {
    const t = startTwoPlayerMatch();
    t.lobby.handle(2, { type: "chat", text: "게임 중" });
    expect(t.chats(1).filter((m) => m.kind === "talk")).toEqual([]);
  });

  it("relays a game chat line to everyone in the match, sender included, from the countdown on (0x446200, 0x444500)", () => {
    const t = startTwoPlayerMatch();
    const gameChats = (id: number) => (t.inbox.get(id) ?? []).filter((m) => m.type === "game-chat");
    // The wait screen drops the line before it is sent (0x4462e4).
    t.lobby.handle(2, { type: "game-chat", text: "대기 중" });
    expect(gameChats(1)).toEqual([]);

    for (let i = 0; i < TICK_RATE; i++) t.lobby.tick();
    expect(t.last(1, "snapshot")?.state.phase).toBe("countdown");
    // No slash commands, no repeat check and no 2 s rule in a match.
    t.lobby.handle(2, { type: "game-chat", text: "/w 하나" });
    t.lobby.handle(2, { type: "game-chat", text: "/w 하나" });
    expect(gameChats(1)).toEqual([
      { type: "game-chat", playerId: 2, text: "/w 하나" },
      { type: "game-chat", playerId: 2, text: "/w 하나" },
    ]);
    expect(gameChats(2)).toEqual(gameChats(1));
  });

  it("drops game chat on the result screens and outside a match", () => {
    const t = startTwoPlayerMatch();
    for (let i = 0; i < TO_PLAY; i++) t.lobby.tick();
    t.lobby.handle(1, { type: "leave-room" });
    t.lobby.tick();
    expect(t.last(2, "snapshot")?.state.phase).toBe("match-over");
    t.lobby.handle(2, { type: "game-chat", text: "끝" });
    expect(t.last(2, "game-chat")).toBeUndefined();

    const room = hostAndGuestOf(makeLobby());
    room.lobby.handle(2, { type: "game-chat", text: "방" });
    expect(room.last(1, "game-chat")).toBeUndefined();
  });

  it("leaves a chatting player's keys unread, so a walk goes on, and lists them as typing (0x45aec8, +0x2c)", () => {
    const t = startTwoPlayerMatch();
    for (let i = 0; i < TO_PLAY; i++) t.lobby.tick();
    const me = () => t.last(1, "snapshot")!.state.players.find((p) => p.id === 1)!;
    t.lobby.handle(1, { type: "input", dir: 3, bomb: false, attack: false, evade: false });
    t.lobby.tick();
    t.lobby.handle(1, { type: "typing", on: true });
    // Keys let go and pressed while the line is open are not read.
    t.lobby.handle(1, { type: "input", dir: null, bomb: true, attack: false, evade: false });
    const x = me().x;
    for (let i = 0; i < 10; i++) t.lobby.tick();
    expect(me().x).toBeGreaterThan(x);
    expect(t.last(1, "snapshot")?.state.bombs).toEqual([]);
    expect(t.last(2, "snapshot")?.typing).toEqual([1]);

    t.lobby.handle(1, { type: "typing", on: false });
    t.lobby.tick();
    expect(t.last(1, "snapshot")?.state.bombs).toHaveLength(1);
    for (let i = 0; i < 10; i++) t.lobby.tick();
    expect(t.last(2, "snapshot")?.typing).toEqual([]);
  });

  it("sends the typing flag at most every 300 ms, so peers see a change up to that late (0x40c5b2)", () => {
    const t = startTwoPlayerMatch();
    for (let i = 0; i < TO_PLAY; i++) t.lobby.tick();
    const seen = () => t.last(2, "snapshot")!.typing;
    t.lobby.handle(1, { type: "typing", on: true });
    let ticks = 0;
    do {
      t.lobby.tick();
      ticks += 1;
    } while (seen().length === 0);
    expect(ticks).toBeLessThanOrEqual(10);
    // The flag has just gone out: the next packet waits 300 ms.
    t.lobby.handle(1, { type: "typing", on: false });
    let held = 0;
    do {
      t.lobby.tick();
      held += 1;
    } while (seen().length > 0);
    expect(held).toBe(Math.ceil((TYPING_PACKET_MS * TICK_RATE) / 1000));
  });

  it("starts every round with nobody typing, shows nobody in the countdown and forgets a player who leaves", () => {
    const t = startTwoPlayerMatch();
    t.lobby.handle(2, { type: "typing", on: true });
    t.lobby.tick();
    expect(t.last(1, "snapshot")?.typing).toEqual([]);
    for (let i = 0; i < TO_PLAY; i++) t.lobby.tick();
    expect(t.last(1, "snapshot")?.typing).toEqual([2]);
    t.lobby.handle(2, { type: "leave-room" });
    t.lobby.tick();
    expect(t.last(1, "snapshot")?.typing).toEqual([]);
  });

  it("sends the state packet only while the round is played and the sender is not gone nor in a 순간이동 flight (0x40c4e8-0x40c5b8)", () => {
    const ground = { gone: false, flight: null };
    expect(typingPacketDue("playing", ground, 1300, 1000)).toBe(true);
    expect(typingPacketDue("playing", ground, 1299, 1000)).toBe(false);
    for (const phase of ["waiting", "countdown", "round-over", "match-over"] as const) {
      expect(typingPacketDue(phase, ground, 5000, 0)).toBe(false);
    }
    expect(typingPacketDue("playing", { gone: true, flight: null }, 5000, 0)).toBe(false);
    expect(typingPacketDue("playing", { gone: false, flight: { phase: 1, x: 0, y: 0 } }, 5000, 0)).toBe(false);
  });
});

describe("panel bars (0x40f9a0)", () => {
  const barsOf = (t: ReturnType<typeof makeLobby>, id: number) => t.last(1, "snapshot")!.bars.find((b) => b.id === id);
  const tickUntil = (t: ReturnType<typeof makeLobby>, done: () => boolean, limit = 30 * TICK_RATE) => {
    for (let i = 0; i < limit && !done(); i++) t.lobby.tick();
    expect(done()).toBe(true);
  };

  it("sends a ping record straight back in a match, once a second at most (0x444929)", () => {
    const room = hostAndGuestOf(makeLobby());
    room.lobby.handle(2, { type: "ping", at: 5 });
    expect(room.last(2, "pong")).toBeUndefined();

    const t = startTwoPlayerMatch();
    t.lobby.handle(2, { type: "ping", at: 7 });
    expect(t.last(2, "pong")).toEqual({ type: "pong", at: 7 });
    expect(t.last(1, "pong")).toBeUndefined();
    t.clock.now += PING_ECHO_MS - 1;
    t.lobby.handle(2, { type: "ping", at: 8 });
    expect(t.count(2, "pong")).toBe(1);
    t.clock.now += 1;
    t.lobby.handle(2, { type: "ping", at: 9 });
    expect(t.last(2, "pong")).toEqual({ type: "pong", at: 9 });
  });

  it("shows 30 and 0 until a player's state packet carries what its client reported", () => {
    const t = startTwoPlayerMatch();
    t.lobby.tick();
    expect(t.last(1, "snapshot")!.bars).toEqual([
      { id: 1, ...START_BARS },
      { id: 2, ...START_BARS },
    ]);
    // The countdown sends no state packet.
    t.lobby.handle(2, { type: "stats", fps: 17, ping: 250 });
    for (let i = 0; i < TO_PLAY - 2; i++) t.lobby.tick();
    expect(barsOf(t, 2)).toEqual({ id: 2, ...START_BARS });
    tickUntil(t, () => barsOf(t, 2)?.fps === 17, 3);
    expect(barsOf(t, 2)).toEqual({ id: 2, fps: 17, ping: 250 });
    // The packet has just gone: a new value waits for the next one, 300 ms on.
    t.lobby.handle(2, { type: "stats", fps: 12, ping: 90 });
    let held = 0;
    do {
      t.lobby.tick();
      held += 1;
    } while (barsOf(t, 2)?.fps !== 12 && held < TICK_RATE);
    expect(held).toBe(Math.ceil((TYPING_PACKET_MS * TICK_RATE) / 1000));
  });

  it("keeps a dead player's bars and starts the next round at 30 and 0, with the own ping cleared", () => {
    const t = makeLobby({ rules: { ...VERSUS, medalsToWin: 2 } });
    t.connect(1);
    t.connect(2, "둘", "doona");
    t.lobby.handle(1, { type: "create-room", title: "" });
    t.lobby.handle(2, { type: "join-room", code: "ABCD" });
    t.lobby.handle(2, { type: "set-ready", ready: true });
    t.lobby.handle(1, { type: "start" });
    for (let i = 0; i < TO_PLAY; i++) t.lobby.tick();
    t.lobby.handle(1, { type: "stats", fps: 20, ping: 120 });
    tickUntil(t, () => barsOf(t, 1)?.fps === 20);
    // Player 1 bombs its own spot and stays on it.
    t.lobby.handle(1, { type: "input", dir: null, bomb: true, attack: false, evade: false });
    const alive = () => t.last(1, "snapshot")!.state.players.find((p) => p.id === 1)!.alive;
    tickUntil(t, () => !alive());
    t.lobby.handle(1, { type: "stats", fps: 5, ping: 999 });
    for (let i = 0; i < TICK_RATE; i++) t.lobby.tick();
    expect(barsOf(t, 1)).toEqual({ id: 1, fps: 20, ping: 120 });
    tickUntil(t, () => t.last(1, "snapshot")!.state.round === 2);
    expect(t.last(1, "snapshot")!.bars).toEqual([
      { id: 1, ...START_BARS },
      { id: 2, ...START_BARS },
    ]);
    tickUntil(t, () => t.last(1, "snapshot")!.state.phase === "playing" && barsOf(t, 1)?.fps === 5);
    expect(barsOf(t, 1)).toEqual({ id: 1, fps: 5, ping: 0 });
  });
});

describe("Lobby (scene 4)", () => {
  it("puts a greeted player in the lobby with the channel, the rooms and the users there", () => {
    const t = makeLobby();
    t.connect(1, "하나");
    expect(t.lobbyOf(1)).toEqual({ type: "lobby", channel: "시험 채널", rooms: [], users: [{ id: 1, name: "하나" }] });
    t.connect(2, "둘");
    expect(t.lobbyOf(1)?.users).toEqual([
      { id: 1, name: "하나" },
      { id: 2, name: "둘" },
    ]);
    expect(t.lobbyOf(2)?.users.map((u) => u.id)).toEqual([1, 2]);
  });

  it("does not count a connection that has not said hello", () => {
    const t = makeLobby();
    t.inbox.set(9, []);
    t.lobby.connect({ id: 9, send: (m) => t.inbox.get(9)?.push(m) });
    t.connect(1);
    expect(t.lobbyOf(1)?.users.map((u) => u.id)).toEqual([1]);
    expect(t.lobbyOf(9)).toBeUndefined();
  });

  it("lists a room by its number and takes its players out of the lobby", () => {
    const t = makeLobby();
    t.connect(1, "하나");
    t.connect(2, "둘");
    t.lobby.handle(1, { type: "create-room", title: "빨리" });
    expect(t.lobbyOf(2)).toMatchObject({
      rooms: [{ code: "ABCD", number: 0, title: "빨리", mapId: "arena", mode: 0, players: 1, max: 6, playing: false, secret: false }],
      users: [{ id: 2, name: "둘" }],
    });
  });

  it("keeps a room's line up to date: closed slots, map, mode, players and a match", () => {
    const t = makeLobby();
    t.connect(1);
    t.connect(2);
    t.connect(3);
    t.lobby.handle(1, { type: "create-room", title: "" });
    t.lobby.handle(1, { type: "set-slot", slot: 5, open: false });
    t.lobby.handle(1, { type: "set-map", mapId: "RANDOM" });
    t.lobby.handle(1, { type: "set-mode", mode: 1 });
    expect(t.lobbyOf(3)?.rooms[0]).toMatchObject({ mapId: "RANDOM", mode: 1, players: 1, max: 5 });

    t.lobby.handle(2, { type: "join-room", code: "ABCD" });
    expect(t.lobbyOf(3)?.rooms[0]).toMatchObject({ players: 2, playing: false });
    t.lobby.handle(1, { type: "set-mode", mode: 0 });
    t.lobby.handle(2, { type: "set-ready", ready: true });
    t.lobby.handle(1, { type: "start" });
    expect(t.lobbyOf(3)?.rooms[0].playing).toBe(true);
  });

  it("sends the lobby again only when what it shows changes", () => {
    const t = makeLobby();
    t.connect(1);
    t.connect(2);
    t.connect(3);
    t.lobby.handle(1, { type: "create-room", title: "" });
    t.lobby.handle(2, { type: "join-room", code: "ABCD" });
    const before = t.count(3, "lobby");
    const inRoom = t.count(1, "lobby");
    t.lobby.handle(2, { type: "set-ready", ready: true });
    t.lobby.handle(2, { type: "set-ready", ready: false });
    t.lobby.handle(1, { type: "set-music", music: 2 });
    t.lobby.tick();
    expect(t.count(3, "lobby")).toBe(before);
    t.connect(4);
    expect(t.count(3, "lobby")).toBe(before + 1);
    expect(t.count(1, "lobby")).toBe(inRoom);
  });

  it("brings a player who leaves a room back to the lobby, and drops an empty room", () => {
    const t = makeLobby();
    t.connect(1);
    t.connect(2);
    t.lobby.handle(1, { type: "create-room", title: "" });
    t.lobby.handle(1, { type: "leave-room" });
    expect(t.room(1)).toBeNull();
    expect(t.lobbyOf(1)).toMatchObject({ rooms: [], users: [{ id: 1 }, { id: 2 }] });
    expect(t.lobbyOf(2)?.rooms).toEqual([]);
  });

  it("takes a disconnected player out of the lobby", () => {
    const t = makeLobby();
    t.connect(1);
    t.connect(2);
    t.lobby.disconnect(1);
    expect(t.lobbyOf(2)?.users.map((u) => u.id)).toEqual([2]);
  });

  it("relays lobby chat to the lobby only, with the room chat's send rule (0x43f7a0)", () => {
    const t = makeLobby();
    t.connect(1, "하나");
    t.connect(2, "둘");
    t.connect(3, "셋");
    t.lobby.handle(3, { type: "create-room", title: "" });
    t.lobby.handle(1, { type: "chat", text: "안녕" });
    t.lobby.handle(1, { type: "chat", text: "또" });
    t.clock.now = 2000;
    t.lobby.handle(1, { type: "chat", text: "안녕" });
    t.clock.now = 4000;
    t.lobby.handle(2, { type: "chat", text: "반가워" });
    const lines = [
      { type: "lobby-chat", name: "하나", text: "안녕" },
      { type: "lobby-chat", name: "둘", text: "반가워" },
    ];
    expect(t.lobbyChats(1)).toEqual(lines);
    expect(t.lobbyChats(2)).toEqual(lines);
    expect(t.lobbyChats(3)).toEqual([]);
    expect(t.chats(3)).toEqual([]);
  });

  it("saves the character from the my-info window in the lobby and answers with it (C->S / S->C 0x1a)", () => {
    const t = makeLobby();
    t.connect(1, "하나", "bobo");
    t.lobby.handle(1, { type: "set-character", character: "doona" });
    expect(t.last(1, "profile")).toEqual({ type: "profile", character: "doona" });

    t.lobby.handle(1, { type: "set-character", character: "nobody" });
    expect(t.last(1, "error")?.message).toBe("알 수 없는 캐릭터입니다.");
    t.lobby.handle(1, { type: "create-room", title: "" });
    expect(t.room(1)?.players[0].character).toBe("doona");

    // My-info opens only from the lobby (0x459cbe).
    t.lobby.handle(1, { type: "set-character", character: "bobo" });
    expect(t.last(1, "error")?.message).toBe("로비에서만 바꿀 수 있습니다.");
    expect(t.count(1, "profile")).toBe(1);
  });

  it("answers a right click's room info (C->S 0x55): the status, the round and who sits where", () => {
    const t = makeLobby();
    t.connect(1, "하나");
    t.connect(2, "둘");
    t.connect(3, "셋");
    t.lobby.handle(1, { type: "create-room", title: "" });
    t.lobby.handle(2, { type: "join-room", code: "ABCD" });
    t.lobby.handle(3, { type: "room-info", code: "ABCD" });
    expect(t.last(3, "room-info")).toEqual({
      type: "room-info",
      code: "ABCD",
      status: "waiting",
      round: 0,
      players: [
        { slot: 0, name: "하나" },
        { slot: 1, name: "둘" },
      ],
    });
    t.lobby.handle(2, { type: "set-ready", ready: true });
    t.lobby.handle(1, { type: "start" });
    t.lobby.handle(3, { type: "room-info", code: "ABCD" });
    expect(t.last(3, "room-info")).toMatchObject({ status: "round", round: 1 });
    t.lobby.handle(3, { type: "room-info", code: "ZZZZ" });
    expect(t.count(3, "room-info")).toBe(2);
  });

  it("answers the option window's friend list (S->C 0x63): the channel in the lobby, the room's number in a room, blank when not on", () => {
    const t = makeLobby();
    t.connect(1, "하나");
    t.connect(2, "둘");
    t.connect(3, "셋");
    t.connect(4, "넷");
    t.lobby.handle(2, { type: "create-room", title: "" });
    for (const name of ["셋", "둘", "넷"]) t.lobby.handle(1, { type: "add-friend", name });
    t.lobby.disconnect(4);
    t.lobby.handle(1, { type: "friends" });
    expect(t.last(1, "friends")).toEqual({
      type: "friends",
      friends: [
        { name: "셋", location: "시험 채널" },
        { name: "둘", location: "001번 방" },
        { name: "넷", location: "" },
      ],
    });
    // Each name has its own list.
    t.lobby.handle(3, { type: "friends" });
    expect(t.last(3, "friends")?.friends).toEqual([]);
  });

  it("judges the adds and deletes on the server (S->C 0x64, 0x65) and keeps the list past a reconnect", () => {
    const t = makeLobby();
    t.connect(1, "하나");
    t.connect(2, "둘");
    const add = (name: string) => {
      t.lobby.handle(1, { type: "add-friend", name });
      return t.last(1, "friend-added");
    };
    expect(add("둘")).toEqual({ type: "friend-added", result: 1, name: "둘" });
    expect(add("둘")?.result).toBe(-2);
    expect(add("하나")?.result).toBe(-5);
    expect(add("")?.result).toBe(-4);
    expect(add("없음")?.result).toBe(-4);
    t.lobby.disconnect(1);
    t.connect(5, "하나");
    t.lobby.handle(5, { type: "friends" });
    expect(t.last(5, "friends")?.friends).toEqual([{ name: "둘", location: "시험 채널" }]);
    t.lobby.handle(5, { type: "delete-friend", name: "둘" });
    expect(t.last(5, "friend-deleted")).toEqual({ type: "friend-deleted", result: 1, name: "둘" });
    t.lobby.handle(5, { type: "delete-friend", name: "둘" });
    expect(t.last(5, "friend-deleted")?.result).toBe(0);
  });
});

describe("secret rooms (+0x28)", () => {
  it("makes a room secret when it is made with a password, and lets nobody see the password", () => {
    const t = makeLobby();
    t.connect(1, "하나");
    t.connect(2, "둘");
    t.connect(3, "셋");
    t.lobby.handle(1, { type: "create-room", title: "비밀", password: "zq9!" });
    t.lobby.handle(3, { type: "create-room", title: "열린 방" });
    expect(t.room(1)?.code).toBe("ABCD");
    expect(t.lobbyOf(2)?.rooms.map((r) => [r.title, r.secret])).toEqual([
      ["비밀", true],
      ["열린 방", false],
    ]);
    t.lobby.handle(2, { type: "room-info", code: "ABCD" });
    t.lobby.handle(2, { type: "join-room", code: "ABCD", password: "zq9!" });
    // A password to a room without one is not asked for.
    t.lobby.handle(2, { type: "join-room", code: "EFGH", password: "x" });
    expect(t.room(2)?.code).toBe("EFGH");
    for (const id of [1, 2, 3]) expect(JSON.stringify(t.inbox.get(id))).not.toContain("zq9!");
  });

  it("answers a join without the password with the password popup's reply, and lets the password in (S->C 0x04 failure 3)", () => {
    const t = makeLobby();
    t.connect(1);
    t.connect(2);
    t.lobby.handle(1, { type: "create-room", title: "", password: "1234" });
    t.lobby.handle(2, { type: "join-room", code: "ABCD" });
    expect(t.last(2, "join-password")).toEqual({ type: "join-password", code: "ABCD" });
    expect(t.last(2, "error")).toBeUndefined();
    expect(t.room(2)).toBeUndefined();
    t.lobby.handle(2, { type: "join-room", code: "ABCD", password: "1234" });
    expect(t.room(2)?.players.map((p) => p.id)).toEqual([1, 2]);
  });

  it("answers a wrong password at once, and checks the next only 500 ms later", () => {
    const t = makeLobby();
    t.connect(1);
    t.connect(2);
    t.lobby.handle(1, { type: "create-room", title: "", password: "1234" });
    t.lobby.handle(2, { type: "join-room", code: "ABCD", password: "0000" });
    expect(t.count(2, "join-password")).toBe(1);
    t.clock.now = PASSWORD_RETRY_MS - 1;
    t.lobby.handle(2, { type: "join-room", code: "ABCD", password: "1234" });
    t.lobby.tick();
    expect(t.room(2)).toBeUndefined();
    t.clock.now = PASSWORD_RETRY_MS;
    t.lobby.tick();
    expect(t.room(2)?.code).toBe("ABCD");
    expect(t.count(2, "join-password")).toBe(1);
  });

  it("holds every connection from one address, and one that comes back later, to the same checks", () => {
    const t = makeLobby();
    t.connect(1);
    t.connect(2, "둘", "bobo", "203.0.113.5");
    t.connect(3, "셋", "bobo", "203.0.113.5");
    t.connect(4, "넷", "bobo", "198.51.100.7");
    t.lobby.handle(1, { type: "create-room", title: "", password: "1234" });
    t.lobby.handle(2, { type: "join-room", code: "ABCD", password: "0000" });
    t.lobby.handle(3, { type: "join-room", code: "ABCD", password: "1234" });
    // Another address is not held.
    t.lobby.handle(4, { type: "join-room", code: "ABCD", password: "1234" });
    expect(t.room(4)?.code).toBe("ABCD");
    t.lobby.tick();
    expect(t.room(3)).toBeUndefined();
    expect(t.count(3, "join-password")).toBe(0);
    t.clock.now = PASSWORD_RETRY_MS;
    t.lobby.tick();
    expect(t.room(3)?.code).toBe("ABCD");

    // Coming back on a new connection keeps the count: the second wrong one in a row holds 1 s.
    t.lobby.disconnect(2);
    t.connect(5, "다섯", "bobo", "203.0.113.5");
    t.clock.now = 600;
    t.lobby.handle(5, { type: "join-room", code: "ABCD", password: "0000" });
    expect(t.count(5, "join-password")).toBe(1);
    t.clock.now = 600 + 2 * PASSWORD_RETRY_MS - 1;
    t.lobby.handle(5, { type: "join-room", code: "ABCD", password: "1234" });
    t.lobby.tick();
    expect(t.room(5)).toBeUndefined();
    t.clock.now = 600 + 2 * PASSWORD_RETRY_MS;
    t.lobby.tick();
    expect(t.room(5)?.code).toBe("ABCD");
  });

  it("doubles the hold for each wrong password in a row up to 30 s, and a right one does not undo it", () => {
    const t = makeLobby();
    t.connect(1);
    t.connect(2, "둘", "bobo", "203.0.113.5");
    t.lobby.handle(1, { type: "create-room", title: "", password: "1234" });
    const holds = [500, 1000, 2000, 4000, 8000, 16000, 30000, 30000];
    expect(holds.at(-1)).toBe(PASSWORD_RETRY_MAX_MS);
    let at = 0;
    t.lobby.handle(2, { type: "join-room", code: "ABCD", password: "0000" });
    for (const [i, hold] of holds.entries()) {
      t.clock.now = at + hold - 1;
      t.lobby.handle(2, { type: "join-room", code: "ABCD", password: "0000" });
      t.lobby.tick();
      expect(t.count(2, "join-password")).toBe(i + 1);
      at += hold;
      t.clock.now = at;
      t.lobby.tick();
      expect(t.count(2, "join-password")).toBe(i + 2);
    }
    // The right password waits out the last hold like any other, and leaves the count as it was.
    t.clock.now = at + PASSWORD_RETRY_MAX_MS;
    t.lobby.handle(2, { type: "join-room", code: "ABCD", password: "1234" });
    expect(t.room(2)?.code).toBe("ABCD");
    t.lobby.handle(2, { type: "leave-room" });
    at = t.clock.now;
    t.lobby.handle(2, { type: "join-room", code: "ABCD", password: "0000" });
    t.clock.now = at + PASSWORD_RETRY_MAX_MS - 1;
    t.lobby.handle(2, { type: "join-room", code: "ABCD", password: "1234" });
    t.lobby.tick();
    expect(t.room(2)).toBeNull();
  });

  it("forgets an address's wrong passwords 10 minutes after the last one", () => {
    const t = makeLobby();
    t.connect(1);
    t.connect(2, "둘", "bobo", "203.0.113.5");
    t.lobby.handle(1, { type: "create-room", title: "", password: "1234" });
    t.lobby.handle(2, { type: "join-room", code: "ABCD", password: "0000" });
    t.clock.now = 500;
    t.lobby.handle(2, { type: "join-room", code: "ABCD", password: "0000" });
    t.clock.now = 1500;
    t.lobby.handle(2, { type: "join-room", code: "ABCD", password: "0000" });
    expect(t.count(2, "join-password")).toBe(3);
    t.clock.now = 1500 + PASSWORD_FAILURES_KEPT_MS;
    t.lobby.tick();
    t.lobby.handle(2, { type: "join-room", code: "ABCD", password: "0000" });
    expect(t.count(2, "join-password")).toBe(4);
    t.clock.now += PASSWORD_RETRY_MS;
    t.lobby.handle(2, { type: "join-room", code: "ABCD", password: "1234" });
    expect(t.room(2)?.code).toBe("ABCD");
  });

  it("takes one password at a time from a player, and skips a player who went without spending a check", () => {
    const t = makeLobby();
    t.connect(1);
    t.connect(2, "둘", "bobo", "203.0.113.5");
    t.connect(3, "셋", "bobo", "203.0.113.5");
    t.connect(4, "넷", "bobo", "203.0.113.5");
    t.lobby.handle(1, { type: "create-room", title: "", password: "1234" });
    t.lobby.handle(2, { type: "join-room", code: "ABCD", password: "0000" });
    t.lobby.handle(2, { type: "join-room", code: "ABCD", password: "0001" });
    t.lobby.handle(2, { type: "join-room", code: "ABCD", password: "1234" });
    t.lobby.handle(3, { type: "join-room", code: "ABCD", password: "0002" });
    t.lobby.handle(4, { type: "join-room", code: "ABCD", password: "1234" });
    t.lobby.disconnect(3);
    t.clock.now = PASSWORD_RETRY_MS;
    t.lobby.tick();
    // 2's second password was checked; its third was dropped, and 3's turn went to 4 unspent.
    expect(t.count(2, "join-password")).toBe(2);
    expect(t.room(2)).toBeUndefined();
    t.clock.now = PASSWORD_RETRY_MS + 2 * PASSWORD_RETRY_MS;
    t.lobby.tick();
    expect(t.room(4)?.code).toBe("ABCD");
    expect(t.count(3, "error")).toBe(0);
  });

  it("asks for the password before the room says it is full", () => {
    const t = makeLobby();
    t.connect(1);
    t.connect(2);
    t.lobby.handle(1, { type: "create-room", title: "", password: "1234" });
    for (const slot of [1, 2, 3, 4, 5]) t.lobby.handle(1, { type: "set-slot", slot, open: false });
    t.lobby.handle(2, { type: "join-room", code: "ABCD" });
    expect(t.last(2, "join-password")?.code).toBe("ABCD");
    expect(t.last(2, "error")).toBeUndefined();
    t.lobby.handle(2, { type: "join-room", code: "ABCD", password: "1234" });
    expect(t.last(2, "error")?.message).toBe("정원 초과 입니다.");
  });
});

describe("chat commands", () => {
  it("passes a whisper to the named player only, with no copy to the sender (S->C 0x07)", () => {
    const t = makeLobby();
    t.connect(1, "하나");
    t.connect(2, "둘");
    t.connect(3, "셋");
    t.lobby.handle(1, { type: "whisper", to: "둘", text: "안녕" });
    expect(t.last(2, "whisper")).toEqual({ type: "whisper", from: "하나", text: "안녕" });
    expect(t.count(1, "whisper")).toBe(0);
    expect(t.count(3, "whisper")).toBe(0);
    // Nobody under that name: nothing, and no refusal.
    t.clock.now += 2000;
    t.lobby.handle(1, { type: "whisper", to: "없음", text: "안녕" });
    expect(t.count(1, "error")).toBe(0);
  });

  it("reaches a player in a room too, and not within 2000 ms of the sender's last", () => {
    const t = makeLobby();
    t.connect(1, "하나");
    t.connect(2, "둘");
    t.lobby.handle(2, { type: "create-room", title: "" });
    t.lobby.handle(1, { type: "whisper", to: "둘", text: "하나" });
    t.clock.now = 1999;
    t.lobby.handle(1, { type: "whisper", to: "둘", text: "둘" });
    t.clock.now = 2000;
    t.lobby.handle(1, { type: "whisper", to: "둘", text: "셋" });
    expect((t.inbox.get(2) ?? []).filter((m) => m.type === "whisper").map((m) => m.type === "whisper" && m.text)).toEqual(["하나", "셋"]);
  });

  it("drops whispers to a player who turned them off with /wno, until /wyes (S->C 0x60)", () => {
    const t = makeLobby();
    t.connect(1, "하나");
    t.connect(2, "둘");
    t.lobby.handle(2, { type: "whisper-allow", on: false });
    expect(t.last(2, "whisper-allowed")).toEqual({ type: "whisper-allowed", on: false });
    t.lobby.handle(1, { type: "whisper", to: "둘", text: "안녕" });
    expect(t.count(2, "whisper")).toBe(0);
    t.lobby.handle(2, { type: "whisper-allow", on: true });
    t.clock.now += 2000;
    t.lobby.handle(1, { type: "whisper", to: "둘", text: "안녕" });
    expect(t.count(2, "whisper")).toBe(1);
  });

  it("counts everyone connected for /users (S->C 0x4c)", () => {
    const t = makeLobby();
    t.connect(1, "하나");
    t.connect(2, "둘");
    t.lobby.handle(2, { type: "create-room", title: "" });
    t.lobby.handle(1, { type: "users" });
    expect(t.last(1, "users")).toEqual({ type: "users", count: 2 });
    t.lobby.disconnect(2);
    t.lobby.handle(1, { type: "users" });
    expect(t.last(1, "users")?.count).toBe(1);
  });

  it("joins by the room's index for /go, and refuses a missing one (S->C 0x04 failure 4)", () => {
    const t = makeLobby();
    t.connect(1, "하나");
    t.connect(2, "둘");
    t.lobby.handle(1, { type: "create-room", title: "" });
    t.lobby.handle(2, { type: "join-number", number: 1 });
    expect(t.last(2, "error")?.message).toBe("방을 찾을 수 없습니다");
    t.lobby.handle(2, { type: "join-number", number: 0 });
    expect(t.room(2)?.code).toBe("ABCD");
  });

  it("answers /go to a secret room with its password popup, and joins it with the password (S->C 0x04 failure 3)", () => {
    const t = makeLobby();
    t.connect(1, "하나");
    t.connect(2, "둘");
    t.lobby.handle(1, { type: "create-room", title: "비밀", password: "1234" });
    t.lobby.handle(2, { type: "join-number", number: 0 });
    expect(t.last(2, "join-password")).toEqual({ type: "join-password", code: "ABCD" });
    expect(t.room(2)).toBeUndefined();
    t.lobby.handle(2, { type: "join-room", code: "ABCD", password: "1234" });
    expect(t.room(2)?.code).toBe("ABCD");
  });

  it("lets the host put a player out with /ban: S->C 0x44 to the whole room, the slot freed, no leave line", () => {
    const t = makeLobby();
    t.connect(1, "하나");
    t.connect(2, "둘");
    t.connect(3, "셋");
    t.lobby.handle(1, { type: "create-room", title: "" });
    t.lobby.handle(2, { type: "join-room", code: "ABCD" });
    t.lobby.handle(3, { type: "join-room", code: "ABCD" });
    const slotOf2 = t.room(1)?.players.find((p) => p.id === 2)?.slot ?? -1;
    const chatsBefore = t.chats(3).length;
    t.lobby.handle(1, { type: "kick", slot: slotOf2 });
    for (const id of [1, 2, 3]) expect(t.last(id, "kick")).toEqual({ type: "kick", slot: slotOf2, ok: true });
    expect(t.room(2)).toBeNull();
    expect(t.room(1)?.players.map((p) => p.id)).toEqual([1, 3]);
    expect(t.chats(3).length).toBe(chatsBefore);
    // Put out, the player is in the lobby again and may come back.
    expect(t.lobbyOf(2)?.users.map((u) => u.name)).toContain("둘");
    t.lobby.handle(2, { type: "join-room", code: "ABCD" });
    expect(t.room(2)?.code).toBe("ABCD");
  });

  it("refuses a kick from a guest, of the host's own slot, of an empty slot and in a match, to the asker alone", () => {
    const t = makeLobby();
    t.connect(1, "하나");
    t.connect(2, "둘");
    t.lobby.handle(1, { type: "create-room", title: "" });
    t.lobby.handle(2, { type: "join-room", code: "ABCD" });
    t.lobby.handle(2, { type: "kick", slot: 0 });
    expect(t.last(2, "kick")).toEqual({ type: "kick", slot: 0, ok: false });
    expect(t.count(1, "kick")).toBe(0);
    t.lobby.handle(1, { type: "kick", slot: 0 });
    t.lobby.handle(1, { type: "kick", slot: 5 });
    expect((t.inbox.get(1) ?? []).filter((m) => m.type === "kick")).toEqual([
      { type: "kick", slot: 0, ok: false },
      { type: "kick", slot: 5, ok: false },
    ]);
    expect(t.room(1)?.players.length).toBe(2);
    const m = startTwoPlayerMatch();
    m.lobby.handle(1, { type: "kick", slot: 1 });
    expect(m.last(1, "kick")?.ok).toBe(false);
    expect(m.room(2)?.code).toBe("ABCD");
  });
});
