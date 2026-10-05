import { describe, expect, it } from "vitest";

import { fromWireState, toWireState, userCard } from "./protocol.ts";
import type { ServerMessage } from "./protocol.ts";
import { Room } from "./room.ts";
import { nowMs } from "../sim/constants.ts";
import type { InputMap } from "../sim/match.ts";
import { layoutFromAscii, VERSUS } from "../sim/testing.ts";
import { Anim, Dir } from "../sim/types.ts";
import type { GameMode } from "../sim/types.ts";

type Snapshot = Extract<ServerMessage, { type: "snapshot" }>;

function countdownRoom(character: string, mode: GameMode) {
  const layout = layoutFromAscii(Array.from({ length: 15 }, (_, y) =>
    y === 7 ? ".......1.....2." : ".".repeat(15)));
  let clock = 23_000;
  let packet: Snapshot | undefined;
  const peers = [1, 2].map((id) => ({ id, send(message: ServerMessage) {
    if (id === 1 && message.type === "snapshot") packet = JSON.parse(JSON.stringify(message));
  } }));
  function profile(id: number) {
    const name = `P${id}`, body = id === 1 ? character : "rookie";
    return { name, nick: name, useId: true, character: body, hue: 0,
      card: userCard({ id: name, nick: name, greeting: "", character: body, hue: 0, useId: true,
        wins: 0, losses: 0, cell: 0, level: 12, guild: -1, rank: 0, gender: 0, manner: 0,
        exp: 0, candy: 0, items: [0], pairs: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9] }),
    };
  }
  const room = new Room({ code: "TEST", number: 1, title: "TEST", password: "" }, peers[0], profile(1), {
    maps: ["test"], layoutFor: () => layout, musicCount: 0,
    rules: { ...VERSUS, mode }, now: () => clock, changed() {},
  });
  expect(room.join(peers[1], profile(2))).toBeNull();
  expect(room.setMode(1, mode)).toBeNull();
  if (mode === 7) {
    expect(room.setTeam(1, 1)).toBeNull();
    expect(room.setTeam(2, 2)).toBeNull();
  }
  room.setReady(2, true);
  expect(room.start(1)).toBeNull();
  function state() {
    if (!packet) throw new Error("missing Room snapshot");
    return fromWireState(packet.state, layout);
  }
  function run(n: number, inputs: InputMap = {}) {
    for (const peer of peers) {
      const input = inputs[peer.id];
      room.input(peer.id, input?.dir ?? null, {
        bomb: input?.bomb ?? false, attack: input?.attack ?? false, evade: input?.evade ?? false,
      });
    }
    for (let i = 0; i < n; i++) {
      clock = 23_000 + nowMs(state().tick);
      room.tick();
      const current = state();
      expect(fromWireState(JSON.parse(JSON.stringify(toWireState(current))), layout)).toEqual(current);
    }
  }
  return { state, run };
}

// Native 0x408e37 enters the field under the countdown flag; 0x40b1ce runs CMM.
// These first two standing-frame times come from 0x4525c0 with the extracted sheets.
describe.each([
  ["rookie", 0, 7], ["shaky", 0, 5], ["bobo", 7, 4], ["milky", 7, 5],
] as const)("Room countdown body: %s, mode %i", (character, mode, nextFrameTicks) => {
  it("animates the body after fade-out while held keys and the game clock stay gated", () => {
    const game = countdownRoom(character, mode);
    const keys = { 1: { dir: Dir.Right, bomb: true, attack: true, evade: true } };
    game.run(40, keys);
    expect(game.state().phase).toBe("countdown");
    expect(game.state().players[0]).toMatchObject({ anim: Anim.Stand, frame: 0, x: 300, y: 240 });
    game.run(1, keys);
    expect(game.state().players[0]).toMatchObject({
      anim: Anim.Stand, frame: 1, animMs: 1366, x: 300, y: 240, actionLatch: false,
    });
    game.run(nextFrameTicks - 1, keys);
    expect(game.state().players[0].frame).toBe(1);
    game.run(1, keys);
    expect(game.state().players[0].frame).toBe(2);
    expect(game.state().timerSeconds).toBe(VERSUS.roundSeconds);
    expect(game.state().bombs).toEqual([]);
    game.run(150 - game.state().tick, keys);
    expect(game.state().phase).toBe("playing");
    expect(game.state().players[0].actionLatch).toBe(false);
    game.run(1, { 1: { dir: null, bomb: true } });
    expect(game.state().bombs).toHaveLength(1);
    expect(game.state().players[0]).toMatchObject({ x: 300, y: 240 });
  });

  it("restarts the standing animation through a naturally won next round", () => {
    const game = countdownRoom(character, mode);
    game.run(150);
    game.run(1, { 1: { dir: null, bomb: true } });
    for (let i = 0; game.state().round === 1 && i < 300; i++) game.run(1);
    expect(game.state()).toMatchObject({ round: 2, phase: "waiting" });
    const startTick = game.state().tick;
    expect(game.state().players[0]).toMatchObject({ anim: Anim.Stand, frame: 0, alive: true });
    game.run(40);
    expect(game.state().players[0].frame).toBe(0);
    game.run(1);
    expect(game.state().players[0]).toMatchObject({
      anim: Anim.Stand, frame: 1, animMs: nowMs(startTick + 41), x: 300, y: 240,
    });
    expect(game.state().players[1].medals).toBe(1);
    expect(game.state().bombs).toEqual([]);
    expect(game.state().effects).toEqual([]);
  });
});
