import { describe, expect, it } from "vitest";

import { MAX_MESSAGE_BYTES, parseClientMessage, roomTitle, sanitizeName } from "./protocol.ts";

describe("parseClientMessage", () => {
  it("accepts well-formed messages", () => {
    expect(parseClientMessage('{"type":"input","dir":3,"bomb":true}')).toEqual({
      type: "input",
      dir: 3,
      bomb: true,
      attack: false,
      evade: false,
    });
    expect(parseClientMessage('{"type":"input","dir":null,"bomb":false,"attack":true,"evade":true}')).toEqual({
      type: "input",
      dir: null,
      bomb: false,
      attack: true,
      evade: true,
    });
    expect(parseClientMessage('{"type":"join-room","code":" abcd "}')).toEqual({ type: "join-room", code: "ABCD" });
    expect(parseClientMessage('{"type":"room-info","code":"abcd"}')).toEqual({ type: "room-info", code: "ABCD" });
    expect(parseClientMessage('{"type":"start","extra":1}')).toEqual({ type: "start" });
    expect(parseClientMessage('{"type":"set-mode","mode":7}')).toEqual({ type: "set-mode", mode: 7 });
    expect(parseClientMessage('{"type":"set-team","team":6}')).toEqual({ type: "set-team", team: 6 });
    expect(parseClientMessage('{"type":"set-map","mapId":"RANDOM"}')).toEqual({ type: "set-map", mapId: "RANDOM" });
    expect(parseClientMessage('{"type":"set-music","music":0}')).toEqual({ type: "set-music", music: 0 });
    expect(parseClientMessage('{"type":"set-music","music":14}')).toEqual({ type: "set-music", music: 14 });
    expect(parseClientMessage('{"type":"set-slot","slot":5,"open":false}')).toEqual({ type: "set-slot", slot: 5, open: false });
  });

  it("takes a room title, sanitized, or none (the create popup, 0x4300d0)", () => {
    expect(parseClientMessage('{"type":"create-room"}')).toEqual({ type: "create-room", title: "" });
    expect(parseClientMessage('{"type":"create-room","title":"  같이 해요\\u0007 "}')).toEqual({
      type: "create-room",
      title: "같이 해요",
    });
  });

  it("takes a secret room's password as its editors hold it: cp949, 10 bytes to create, 15 to join, untrimmed (0x42ff40, 0x42f500)", () => {
    expect(parseClientMessage('{"type":"create-room","title":"방","password":" 12345678901"}')).toEqual({
      type: "create-room",
      title: "방",
      password: " 123456789",
    });
    expect(parseClientMessage('{"type":"create-room","title":"방","password":"비밀번호다섯"}')).toEqual({
      type: "create-room",
      title: "방",
      password: "비밀번호다",
    });
    expect(parseClientMessage('{"type":"join-room","code":"ABCD","password":"1234567890123456"}')).toEqual({
      type: "join-room",
      code: "ABCD",
      password: "123456789012345",
    });
    // An empty password is no password: the message is the one without it.
    expect(parseClientMessage('{"type":"create-room","title":"방","password":""}')).toEqual({ type: "create-room", title: "방" });
    expect(parseClientMessage('{"type":"join-room","code":"ABCD","password":"\\u0007"}')).toEqual({ type: "join-room", code: "ABCD" });
    expect(parseClientMessage('{"type":"join-room","code":"ABCD","password":1}')).toBeNull();
    expect(parseClientMessage(`{"type":"create-room","password":"${"x".repeat(65)}"}`)).toBeNull();
  });

  it("takes a chat line the room's editor could hold: cp949 text under 45 bytes, trailing blanks cut (0x418d37, 0x446200)", () => {
    expect(parseClientMessage('{"type":"chat","text":"  안녕 \\t "}')).toEqual({ type: "chat", text: "  안녕" });
    expect(parseClientMessage(JSON.stringify({ type: "chat", text: "a".repeat(44) }))).toEqual({ type: "chat", text: "a".repeat(44) });
    expect(parseClientMessage(JSON.stringify({ type: "chat", text: "가".repeat(22) }))).toEqual({ type: "chat", text: "가".repeat(22) });
    expect(parseClientMessage(JSON.stringify({ type: "chat", text: "hi😀" }))).toEqual({ type: "chat", text: "hi" });
  });

  it("takes a game chat line the match's editor could hold: cp949 text under 37 bytes, trailing blanks cut (0x418d46, 0x446200)", () => {
    expect(parseClientMessage('{"type":"game-chat","text":" /w 안녕 \\t "}')).toEqual({ type: "game-chat", text: " /w 안녕" });
    expect(parseClientMessage(JSON.stringify({ type: "game-chat", text: "a".repeat(36) }))).toEqual({ type: "game-chat", text: "a".repeat(36) });
    expect(parseClientMessage(JSON.stringify({ type: "game-chat", text: "가".repeat(18) }))).toEqual({ type: "game-chat", text: "가".repeat(18) });
  });

  it("takes a server list row's load query with the row (C->S 0x4c)", () => {
    expect(parseClientMessage('{"type":"server-info","channel":2}')).toEqual({ type: "server-info", channel: 2 });
    expect(parseClientMessage('{"type":"server-info"}')).toBeNull();
    expect(parseClientMessage('{"type":"server-info","channel":80}')).toBeNull();
  });

  it("takes a character to save with its hue and ID check (C->S 0x1a)", () => {
    expect(parseClientMessage('{"type":"set-character","character":"doona","hue":-180,"useId":false}')).toEqual({
      type: "set-character",
      character: "doona",
      hue: -180,
      useId: false,
    });
    expect(parseClientMessage('{"type":"set-character","character":"doona","hue":181,"useId":false}')).toBeNull();
    expect(parseClientMessage('{"type":"set-character","character":"doona"}')).toBeNull();
  });

  it("takes the login, the sign-up and the checks as short strings; the server checks the rest", () => {
    expect(parseClientMessage('{"type":"login","id":"tester","password":"pass1"}')).toEqual({ type: "login", id: "tester", password: "pass1" });
    expect(parseClientMessage('{"type":"login","id":"tester"}')).toBeNull();
    expect(parseClientMessage(JSON.stringify({ type: "login", id: "x".repeat(33), password: "p" }))).toBeNull();
    expect(parseClientMessage('{"type":"register","id":"a","nick":"b","password":"c"}')).toEqual({ type: "register", id: "a", nick: "b", password: "c" });
    expect(parseClientMessage('{"type":"check-id","id":"abcd"}')).toEqual({ type: "check-id", id: "abcd" });
    expect(parseClientMessage('{"type":"check-nick","nick":1}')).toBeNull();
  });

  it("takes the version with its row, then hello with the session (C->S 0x47, 0x0a)", () => {
    expect(parseClientMessage('{"type":"version","version":11,"channel":0}')).toEqual({ type: "version", version: 11, channel: 0 });
    expect(parseClientMessage('{"type":"version","version":11}')).toBeNull();
    expect(parseClientMessage('{"type":"hello","token":"abc"}')).toEqual({ type: "hello", token: "abc" });
    expect(parseClientMessage(JSON.stringify({ type: "hello", token: "t".repeat(65) }))).toBeNull();
  });

  it("takes scene 5's 확인 and the greeting popup (C->S 0x48, 0x58)", () => {
    expect(parseClientMessage('{"type":"set-status","nick":"닉","greeting":"안녕","useId":true}')).toEqual({
      type: "set-status",
      nick: "닉",
      greeting: "안녕",
      useId: true,
    });
    expect(parseClientMessage('{"type":"set-status","nick":"닉","greeting":"안녕"}')).toBeNull();
    expect(parseClientMessage('{"type":"set-greeting","greeting":"안녕"}')).toEqual({ type: "set-greeting", greeting: "안녕" });
  });

  it("takes the typing flag as a boolean (state packet +0x2c)", () => {
    expect(parseClientMessage('{"type":"typing","on":true}')).toEqual({ type: "typing", on: true });
    expect(parseClientMessage('{"type":"typing","on":false}')).toEqual({ type: "typing", on: false });
  });

  it("takes the option window's friend requests (C->S 0x63, 0x64, 0x65): IDs of cp949, 10 bytes at most", () => {
    expect(parseClientMessage('{"type":"friends"}')).toEqual({ type: "friends" });
    // The popup sends an empty ID too, and the server answers it (-4).
    expect(parseClientMessage('{"type":"add-friend","name":""}')).toEqual({ type: "add-friend", name: "" });
    expect(parseClientMessage(JSON.stringify({ type: "add-friend", name: "가나다라마" }))).toEqual({ type: "add-friend", name: "가나다라마" });
    expect(parseClientMessage(JSON.stringify({ type: "delete-friend", name: "abc" }))).toEqual({ type: "delete-friend", name: "abc" });
  });

  it("takes the chat commands' requests (C->S 0x04 by index, 0x07, 0x4c, 0x60)", () => {
    expect(parseClientMessage('{"type":"join-number","number":-1}')).toEqual({ type: "join-number", number: -1 });
    expect(parseClientMessage('{"type":"join-number","number":1.5}')).toBeNull();
    // The message keeps its leading blanks as typed; trailing ones go, like chat.
    expect(parseClientMessage(JSON.stringify({ type: "whisper", to: "둘", text: "  안녕 " }))).toEqual({ type: "whisper", to: "둘", text: "  안녕" });
    expect(parseClientMessage(JSON.stringify({ type: "whisper", to: "둘", text: "   " }))).toBeNull();
    expect(parseClientMessage(JSON.stringify({ type: "whisper", to: "둘", text: "가".repeat(23) }))).toBeNull();
    expect(parseClientMessage('{"type":"users"}')).toEqual({ type: "users" });
    expect(parseClientMessage('{"type":"whisper-allow","on":false}')).toEqual({ type: "whisper-allow", on: false });
    expect(parseClientMessage('{"type":"whisper-allow","on":0}')).toBeNull();
    expect(parseClientMessage('{"type":"kick","slot":5}')).toEqual({ type: "kick", slot: 5 });
    expect(parseClientMessage('{"type":"kick","slot":6}')).toBeNull();
  });

  it("takes the panel bars' ping record and the values a state packet carries (action 0x15, +0x24, +0x28)", () => {
    expect(parseClientMessage('{"type":"ping","at":123456}')).toEqual({ type: "ping", at: 123456 });
    for (const at of ["-1", "1.5", '"1"', "1e300"]) expect(parseClientMessage(`{"type":"ping","at":${at}}`)).toBeNull();
    expect(parseClientMessage('{"type":"stats","fps":30,"ping":0}')).toEqual({ type: "stats", fps: 30, ping: 0 });
    expect(parseClientMessage('{"type":"stats","fps":1001,"ping":0}')).toBeNull();
    expect(parseClientMessage('{"type":"stats","fps":30,"ping":-1}')).toBeNull();
    expect(parseClientMessage('{"type":"stats","fps":30}')).toBeNull();
  });

  it.each([
    ["not json", "{"],
    ["array", "[]"],
    ["unknown type", '{"type":"admin"}'],
    ["dir out of range", '{"type":"input","dir":4,"bomb":false}'],
    ["dir as string", '{"type":"input","dir":"1","bomb":false}'],
    ["bomb as number", '{"type":"input","dir":null,"bomb":1}'],
    ["attack as string", '{"type":"input","dir":null,"bomb":false,"attack":"1"}'],
    ["evade as number", '{"type":"input","dir":null,"bomb":false,"evade":1}'],
    ["bad room code", '{"type":"join-room","code":"AB0O"}'],
    ["room info without a code", '{"type":"room-info"}'],
    ["ready as string", '{"type":"set-ready","ready":"yes"}'],
    ["mode out of range", '{"type":"set-mode","mode":8}'],
    ["negative mode", '{"type":"set-mode","mode":-1}'],
    ["fractional mode", '{"type":"set-mode","mode":1.5}'],
    ["mode as string", '{"type":"set-mode","mode":"1"}'],
    ["team 0", '{"type":"set-team","team":0}'],
    ["team 7", '{"type":"set-team","team":7}'],
    ["team as string", '{"type":"set-team","team":"2"}'],
    ["music out of range", '{"type":"set-music","music":100}'],
    ["negative music", '{"type":"set-music","music":-1}'],
    ["music as string", '{"type":"set-music","music":"1"}'],
    ["slot 6", '{"type":"set-slot","slot":6,"open":true}'],
    ["fractional slot", '{"type":"set-slot","slot":0.5,"open":true}'],
    ["open as number", '{"type":"set-slot","slot":1,"open":1}'],
    ["title as number", '{"type":"create-room","title":5}'],
    ["blank chat", '{"type":"chat","text":" \\t "}'],
    ["chat of 45 bytes", JSON.stringify({ type: "chat", text: "a".repeat(45) })],
    ["chat of 46 bytes", JSON.stringify({ type: "chat", text: "가".repeat(23) })],
    ["chat as number", '{"type":"chat","text":1}'],
    ["blank game chat", '{"type":"game-chat","text":"   "}'],
    ["game chat of 37 bytes", JSON.stringify({ type: "game-chat", text: "a".repeat(37) })],
    ["game chat of 38 bytes", JSON.stringify({ type: "game-chat", text: "가".repeat(19) })],
    ["game chat as number", '{"type":"game-chat","text":1}'],
    ["typing as number", '{"type":"typing","on":1}'],
    ["character as number", '{"type":"set-character","character":3}'],
    ["character too long", JSON.stringify({ type: "set-character", character: "x".repeat(33) })],
    ["typing without a flag", '{"type":"typing"}'],
    ["add without an ID", '{"type":"add-friend"}'],
    ["add of 11 bytes", JSON.stringify({ type: "add-friend", name: "가나다라마a" })],
    ["add with a control character", JSON.stringify({ type: "add-friend", name: "x\u0007" })],
    ["add of a number", '{"type":"add-friend","name":5}'],
    ["delete of an empty ID", '{"type":"delete-friend","name":""}'],
    ["delete of 11 bytes", JSON.stringify({ type: "delete-friend", name: "a".repeat(11) })],
    ["hello without version", '{"type":"hello","name":"a","character":"bobo"}'],
    ["oversized", JSON.stringify({ type: "hello", version: 1, name: "x".repeat(MAX_MESSAGE_BYTES), character: "bobo" })],
  ])("rejects %s", (_label, raw) => {
    expect(parseClientMessage(raw)).toBeNull();
  });
});

describe("roomTitle", () => {
  it("keeps cp949 text, trims it and cuts it to 19 bytes without splitting a character (0x4300d0)", () => {
    expect(roomTitle(" 가나다라마바사아자차 ")).toBe("가나다라마바사아자");
    expect(roomTitle("abcdefghijklmnopqrstuvwxyz")).toBe("abcdefghijklmnopqrs");
    expect(roomTitle("방\u0000제목😀")).toBe("방제목");
    expect(roomTitle("  ")).toBe("");
  });
});

describe("sanitizeName", () => {
  it("strips control characters and limits length", () => {
    expect(sanitizeName("  쉐이크\u0000‮왕  ")).toBe("쉐이크왕");
    expect(sanitizeName("abcdefghijklmnop")).toBe("abcdefghijkl");
    expect(sanitizeName("\u0007")).toBe("플레이어");
  });
});
