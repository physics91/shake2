import { existsSync } from "node:fs";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { WebSocket as WsClient } from "ws";

import type { ServerMessage } from "./protocol.ts";
import { PROTOCOL_VERSION } from "./protocol.ts";
import type { RunningServer } from "./server.ts";
import { channelName, isOriginAllowed, startServer } from "./server.ts";

const ASSETS = join(import.meta.dirname, "..", "..", "public", "assets");

class Client {
  readonly messages: ServerMessage[] = [];
  readonly socket: WebSocket;
  private waiters: (() => void)[] = [];

  constructor(url: string) {
    this.socket = new WebSocket(url);
    this.socket.addEventListener("message", (event) => {
      this.messages.push(JSON.parse(String(event.data)) as ServerMessage);
      for (const wake of this.waiters) wake();
    });
  }

  opened(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.socket.addEventListener("open", () => resolve(), { once: true });
      this.socket.addEventListener("error", () => reject(new Error("socket error")), { once: true });
    });
  }

  send(message: unknown): void {
    this.socket.send(JSON.stringify(message));
  }

  waitFor<T extends ServerMessage>(match: (m: ServerMessage) => m is T, timeoutMs = 10_000): Promise<T> {
    return new Promise((resolve, reject) => {
      const check = () => {
        const found = this.messages.find(match);
        if (found) {
          clearTimeout(timer);
          this.waiters = this.waiters.filter((w) => w !== check);
          resolve(found);
        }
      };
      const timer = setTimeout(() => reject(new Error("timed out waiting for message")), timeoutMs);
      this.waiters.push(check);
      check();
    });
  }
}

const isType =
  <K extends ServerMessage["type"]>(type: K) =>
  (m: ServerMessage): m is Extract<ServerMessage, { type: K }> =>
    m.type === type;

describe("isOriginAllowed", () => {
  it("allows same host, localhost and listed origins only", () => {
    expect(isOriginAllowed(undefined, "example.org", [])).toBe(true);
    expect(isOriginAllowed("http://example.org", "example.org", [])).toBe(true);
    expect(isOriginAllowed("http://localhost:5173", "127.0.0.1:8787", [])).toBe(true);
    expect(isOriginAllowed("https://evil.test", "127.0.0.1:8787", [])).toBe(false);
    expect(isOriginAllowed("https://friend.test", "127.0.0.1:8787", ["https://friend.test"])).toBe(true);
    expect(isOriginAllowed("not a url", "127.0.0.1:8787", [])).toBe(false);
  });
});

describe("channelName", () => {
  it("keeps what fits the banner (16 bytes of cp949 text) and falls back to the default", () => {
    expect(channelName("  초보 채널  ")).toBe("초보 채널");
    expect(channelName("가나다라마바사아자차")).toBe("가나다라마바사아");
    expect(channelName("\u202e😀")).toBe("복원판 채널");
    expect(channelName(undefined)).toBe("복원판 채널");
  });
});

describe.skipIf(!existsSync(join(ASSETS, "manifest.json")))("room server over WebSocket", () => {
  let server: RunningServer;
  let url: string;

  beforeAll(async () => {
    server = await startServer({ host: "127.0.0.1", port: 0, assetsDir: ASSETS, allowedOrigins: [], maxRooms: 5 });
    url = `ws://127.0.0.1:${server.port}/ws`;
  });

  afterAll(async () => {
    await server.close();
  });

  it("plays one round between two clients until someone wins a medal", async () => {
    const a = new Client(url);
    const b = new Client(url);
    await Promise.all([a.opened(), b.opened()]);
    a.send({ type: "hello", version: PROTOCOL_VERSION, name: "에이", character: "bobo" });
    b.send({ type: "hello", version: PROTOCOL_VERSION, name: "비", character: "doona" });
    const [welcomeA, welcomeB] = await Promise.all([a.waitFor(isType("welcome")), b.waitFor(isType("welcome"))]);

    a.send({ type: "create-room", title: "" });
    const created = await a.waitFor((m): m is Extract<ServerMessage, { type: "room" }> => m.type === "room" && m.room !== null);
    b.send({ type: "join-room", code: created.room?.code });
    await a.waitFor((m): m is ServerMessage => m.type === "room" && m.room?.players.length === 2);
    b.send({ type: "set-ready", ready: true });
    const guestReady = (m: ServerMessage) =>
      m.type === "room" && m.room?.players.find((p) => p.id === welcomeB.playerId)?.ready === true;
    await a.waitFor((m): m is ServerMessage => guestReady(m));
    a.send({ type: "start" });
    await Promise.all([a.waitFor(isType("match-start")), b.waitFor(isType("match-start"))]);

    const playing = (m: ServerMessage) => m.type === "snapshot" && m.state.phase === "playing";
    await a.waitFor((m): m is ServerMessage => playing(m));
    a.send({ type: "input", dir: null, bomb: true });
    a.send({ type: "input", dir: null, bomb: false });

    const roundOver = (m: ServerMessage): m is Extract<ServerMessage, { type: "snapshot" }> =>
      m.type === "snapshot" && m.events.some((e) => e.type === "round-over");
    const [overA, overB] = await Promise.all([a.waitFor(roundOver), b.waitFor(roundOver)]);
    for (const snapshot of [overA, overB]) {
      expect(snapshot.events).toContainEqual({ type: "round-over", winnerId: welcomeB.playerId, winnerTeam: null });
      expect(snapshot.state.players.find((p) => p.id === welcomeB.playerId)?.medals).toBe(1);
      expect(snapshot.state.players.find((p) => p.id === welcomeA.playerId)?.alive).toBe(false);
    }

    const nextRound = (m: ServerMessage) => m.type === "snapshot" && m.events.some((e) => e.type === "round-start" && e.round === 2);
    await b.waitFor((m): m is ServerMessage => nextRound(m));
    a.socket.close();
    b.socket.close();
  }, 20_000);

  it("answers malformed messages with an error and keeps serving", async () => {
    const c = new Client(url);
    await c.opened();
    c.send({ type: "input", dir: 9, bomb: "yes" });
    c.socket.send("not json");
    await c.waitFor(isType("error"));
    c.send({ type: "hello", version: PROTOCOL_VERSION, name: "시험", character: "bobo" });
    expect((await c.waitFor(isType("welcome"))).playerId).toBeGreaterThan(0);
    c.socket.close();
  });

  it("closes connections that send oversized frames", async () => {
    const c = new Client(url);
    await c.opened();
    const closed = new Promise<number>((resolve) => c.socket.addEventListener("close", (e) => resolve(e.code)));
    c.socket.send("x".repeat(64 * 1024));
    expect(await closed).toBe(1009);
  });

  it("rejects browsers from other origins", async () => {
    const socket = new WsClient(url, { origin: "https://evil.test" });
    const outcome = await new Promise<string>((resolve) => {
      socket.on("open", () => resolve("open"));
      socket.on("unexpected-response", (_req, res) => resolve(`http ${res.statusCode}`));
      socket.on("error", () => resolve("error"));
    });
    expect(outcome).not.toBe("open");
    socket.terminate();
  });
});
