import { describe, expect, it } from "vitest";

import { fromWireState, toWireState, userCard } from "./protocol.ts";
import type { ServerMessage } from "./protocol.ts";
import { Room } from "./room.ts";
import type { InputMap } from "../sim/match.ts";
import { nowMs } from "../sim/constants.ts";
import { layoutFromAscii, VERSUS } from "../sim/testing.ts";
import { Anim, Dir, ItemKind } from "../sim/types.ts";
import type { GameMode } from "../sim/types.ts";

type Snapshot = Extract<ServerMessage, { type: "snapshot" }>;

function summonRoom(mode: GameMode, teams: number[]) {
  const layout = layoutFromAscii(["1..2...3.......", ...Array<string>(14).fill("...............")]);
  const seed = 71;
  let clock = seed * 1000;
  let packet: Snapshot | null = null;
  const peers = [1, 2, 3].map((id) => ({ id, send(message: ServerMessage) {
    if (id === 1 && message.type === "snapshot") packet = JSON.parse(JSON.stringify(message));
  } }));
  function profile(id: number) {
    const name = `P${id}`;
    return { name, nick: name, useId: true, character: "shaky", hue: 0,
      card: userCard({ id: name, nick: name, greeting: "", character: "shaky", hue: 0, useId: true,
        wins: 0, losses: 0, cell: 0, level: 12, guild: -1, rank: 0, gender: 0, manner: 0,
        exp: 0, candy: 0, items: [0], pairs: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9] }),
    };
  }
  const room = new Room({ code: "TEST", number: 1, title: "TEST", password: "" }, peers[0], profile(1), {
    maps: ["test"], layoutFor: () => layout, musicCount: 0,
    rules: { ...VERSUS, mode }, now: () => clock, changed() {},
  });
  for (const peer of peers.slice(1)) expect(room.join(peer, profile(peer.id))).toBeNull();
  expect(room.setMode(1, mode)).toBeNull();
  for (const peer of peers) expect(room.setTeam(peer.id, teams[peer.id - 1])).toBeNull();
  for (const peer of peers.slice(1)) room.setReady(peer.id, true);
  expect(room.start(1)).toBeNull();
  function snapshot(): Snapshot {
    if (!packet) throw new Error("missing Room snapshot");
    return packet;
  }
  const state = () => fromWireState(snapshot().state, layout);
  function run(n: number, inputs: InputMap = {}) {
    for (const peer of peers) {
      const input = inputs[peer.id];
      room.input(peer.id, input?.dir ?? null, {
        bomb: input?.bomb ?? false, attack: input?.attack ?? false, evade: input?.evade ?? false,
      });
    }
    for (let i = 0; i < n; i++) {
      clock = seed * 1000 + nowMs(state().tick);
      room.tick();
      const current = state();
      expect(fromWireState(JSON.parse(JSON.stringify(toWireState(current))), layout)).toEqual(current);
    }
  }
  const player = (id: number) => state().players.find((p) => p.id === id)!;
  function dropCapsule(victimId: number) {
    run(150);
    run(1, { [victimId]: { dir: null, bomb: true } });
    run(116);
    expect(player(victimId)).toMatchObject({ alive: false, gone: true, bombPass: true });
    expect(state().items).toContainEqual(expect.objectContaining({ kind: ItemKind.Capsule }));
    expect(state().phase).toBe("playing");
  }
  function takeCapsule(pickerId: number, dir: Dir) {
    for (let i = 0; i < 30; i++) {
      run(1, { [pickerId]: { dir, bomb: false } });
      if (snapshot().events.some((e) => e.type === "item-picked" && e.kind === ItemKind.Capsule)) return;
    }
    throw new Error("capsule not reached by Room input");
  }
  return { seed, state, player, run, snapshot, dropCapsule, takeCapsule };
}

describe("normal Room summon input against the original revival (0x453d00)", () => {
  it.each([
    [6, 1, 2], [6, 2, 1], [7, 1, 2], [7, 2, 1],
  ] as const)("clears a completed death stop before revival in mode %i (victim %i, picker %i)", (mode, victimId, pickerId) => {
    const game = summonRoom(mode, [1, 1, 2]);
    game.run(150);
    game.run(1, { [victimId]: { dir: null, bomb: true } });
    game.run(59);
    game.run(1, { [victimId]: { dir: Dir.Left, bomb: false } });
    game.run(1);
    expect(game.player(victimId)).toMatchObject({ alive: false, gone: false, stopRequested: true });
    for (let i = 0; i < 200 && !game.player(victimId).gone; i++) game.run(1);
    expect(game.player(victimId)).toMatchObject({ gone: true, stopRequested: true });

    game.run(1, { [victimId]: { dir: null, bomb: true, attack: true, evade: true } });
    expect(game.player(victimId)).toMatchObject({ gone: true, stopRequested: false, actionLatch: false });
    game.takeCapsule(pickerId, pickerId === 1 ? Dir.Right : Dir.Left);
    expect(game.player(victimId)).toMatchObject({ alive: true, gone: false, stopRequested: false });
    const x = game.player(victimId).x;
    game.run(1, { [victimId]: { dir: Dir.Right, bomb: false } });
    expect(game.player(victimId)).toMatchObject({ x: x + 5, anim: Anim.Walk + Dir.Right, frame: victimId === 1 ? 1 : 0 });
  });

  it.each([6, 7] as const)("reseeds even when the enemy capsule has nobody to revive, mode %i", (mode) => {
    const game = summonRoom(mode, [1, 2, 2]);
    game.dropCapsule(2);
    game.takeCapsule(1, Dir.Right);

    expect(game.player(2)).toMatchObject({ alive: false, gone: true });
    expect(game.state().items).toEqual([]);
    expect(game.snapshot().events.some((e) => e.type === "revived")).toBe(false);
    // The native function calls time/srand before scanning its six slots, and never rand here.
    expect(game.state().rng).toBe(Math.floor((game.seed * 1000 + nowMs(game.state().tick)) / 1000));
  });

  it.each([
    [6, 1, 2], [6, 2, 1], [7, 1, 2], [7, 2, 1],
  ] as const)("keeps the death clock in mode %i when picker %i revives %i", (mode, pickerId, victimId) => {
    const game = summonRoom(mode, [1, 1, 2]);
    game.dropCapsule(victimId);
    const deathClock = game.player(victimId).animMs;
    game.takeCapsule(pickerId, pickerId === 1 ? Dir.Right : Dir.Left);

    const revived = game.player(victimId);
    expect(revived).toMatchObject({ alive: true, gone: false, anim: Anim.Stand + Dir.Down });
    // A later slot runs its standing update in this same tick. An earlier slot waits one tick.
    if (victimId > pickerId) {
      expect(revived).toMatchObject({ frame: 1, animMs: nowMs(game.state().tick) });
    } else {
      expect(revived).toMatchObject({ frame: 0, animMs: deathClock });
      game.run(1);
      expect(game.player(victimId)).toMatchObject({ frame: 1, animMs: nowMs(game.state().tick) });
    }
  });

  it.each([6, 7] as const)("preserves the victim's own-bomb pass flag after reviving, mode %i", (mode) => {
    const game = summonRoom(mode, [1, 1, 2]);
    game.dropCapsule(2);
    game.takeCapsule(1, Dir.Right);

    expect(game.player(2)).toMatchObject({ alive: true, gone: false, bombPass: true });
  });
});
