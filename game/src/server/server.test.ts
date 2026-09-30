import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { WebSocket as WsClient } from "ws";

import type { ServerMessage } from "./protocol.ts";
import { PROTOCOL_VERSION } from "./protocol.ts";
import type { RunningServer } from "./server.ts";
import { channelName, isOriginAllowed, startServer, startupWarning, tlsFiles } from "./server.ts";

const ASSETS = join(import.meta.dirname, "..", "..", "public", "assets");
const HAS_ASSETS = existsSync(join(ASSETS, "manifest.json"));
const HAS_OPENSSL = spawnSync("openssl", ["version"], { stdio: "ignore" }).status === 0;

class Client {
  readonly messages: ServerMessage[] = [];
  readonly socket: WebSocket;
  private waiters: (() => void)[] = [];

  /** A URL for Node's own WebSocket, or a ws client made with what that one cannot set (headers, CA). */
  constructor(target: string | WsClient) {
    this.socket = typeof target === "string" ? new WebSocket(target) : (target as unknown as WebSocket);
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

describe("tlsFiles", () => {
  it("takes both PEM files or neither, and will not start on one alone", () => {
    expect(tlsFiles(undefined, undefined)).toBeUndefined();
    expect(tlsFiles("", "")).toBeUndefined();
    expect(tlsFiles("cert.pem", "key.pem")).toEqual({ certFile: "cert.pem", keyFile: "key.pem" });
    expect(() => tlsFiles("cert.pem", undefined)).toThrow("TLS_KEY");
    expect(() => tlsFiles("", "key.pem")).toThrow("TLS_CERT");
  });
});

describe("startupWarning", () => {
  it("warns when other machines can reach the server without TLS", () => {
    expect(startupWarning("0.0.0.0", false)).toContain("TLS_CERT");
    expect(startupWarning("192.168.0.2", false)).toContain("unencrypted");
    expect(startupWarning("0.0.0.0", true)).toBeNull();
    expect(startupWarning("127.0.0.1", false)).toBeNull();
    expect(startupWarning("localhost", false)).toBeNull();
  });
});

describe.skipIf(!HAS_ASSETS)("room server over WebSocket", () => {
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

  it("checks one address's passwords one at a time, by the address a local proxy forwards", async () => {
    const from = (address: string) => new Client(new WsClient(url, { headers: { "x-forwarded-for": address } }));
    const host = new Client(url);
    const guesser = from("203.0.113.5");
    const sameLine = from("::ffff:203.0.113.5");
    const elsewhere = from("198.51.100.7");
    const clients = [host, guesser, sameLine, elsewhere];
    await Promise.all(clients.map((c) => c.opened()));
    for (const [i, c] of clients.entries()) c.send({ type: "hello", version: PROTOCOL_VERSION, name: `주소${i}`, character: "bobo" });
    await Promise.all(clients.map((c) => c.waitFor(isType("welcome"))));
    host.send({ type: "create-room", title: "", password: "1234" });
    const created = await host.waitFor((m): m is Extract<ServerMessage, { type: "room" }> => m.type === "room" && m.room !== null);
    const code = created.room?.code;

    guesser.send({ type: "join-room", code, password: "0000" });
    await guesser.waitFor(isType("join-password"));
    const answered = Date.now();
    sameLine.send({ type: "join-room", code, password: "1234" });
    elsewhere.send({ type: "join-room", code, password: "1234" });
    const entered = (c: Client) =>
      c.waitFor((m): m is ServerMessage => m.type === "room" && m.room?.code === code).then(() => c);
    expect(await Promise.race([entered(sameLine), entered(elsewhere)])).toBe(elsewhere);
    await entered(sameLine);
    expect(Date.now() - answered).toBeGreaterThanOrEqual(400);
    for (const c of clients) c.socket.close();
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

describe.skipIf(!HAS_ASSETS || !HAS_OPENSSL)("room server over TLS", () => {
  const logged: string[] = [];
  let server: RunningServer;
  let dir: string;
  let cert: Buffer;

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "shake2-tls-"));
    const certFile = join(dir, "cert.pem");
    const keyFile = join(dir, "key.pem");
    const made = spawnSync(
      "openssl",
      ["req", "-x509", "-newkey", "ec", "-pkeyopt", "ec_paramgen_curve:prime256v1", "-nodes", "-days", "1"]
        .concat(["-subj", "/CN=localhost", "-addext", "subjectAltName=IP:127.0.0.1", "-keyout", keyFile, "-out", certFile]),
      { stdio: "ignore" },
    );
    if (made.status !== 0) throw new Error("openssl did not make a certificate");
    cert = readFileSync(certFile);
    server = await startServer({
      host: "127.0.0.1",
      port: 0,
      assetsDir: ASSETS,
      allowedOrigins: [],
      maxRooms: 5,
      tls: { certFile, keyFile },
      log: (line) => logged.push(line),
    });
  });

  afterAll(async () => {
    await server?.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("speaks wss:// with a certificate the client checks", async () => {
    // No plaintext warning on TLS.
    expect(logged).toHaveLength(1);
    expect(logged[0]).toMatch(`shake2 server on wss://127.0.0.1:${server.port}/ws (`);
    const c = new Client(new WsClient(`wss://127.0.0.1:${server.port}/ws`, { ca: cert }));
    await c.opened();
    c.send({ type: "hello", version: PROTOCOL_VERSION, name: "암호", character: "bobo" });
    expect((await c.waitFor(isType("welcome"))).playerId).toBeGreaterThan(0);
    c.socket.close();
  });

  it("does not open for plain ws://, nor for a certificate the client does not trust", async () => {
    for (const scheme of ["ws", "wss"]) {
      const socket = new WsClient(`${scheme}://127.0.0.1:${server.port}/ws`);
      const outcome = await new Promise<string>((resolve) => {
        socket.on("open", () => resolve("open"));
        socket.on("unexpected-response", (_req, res) => resolve(`http ${res.statusCode}`));
        socket.on("error", () => resolve("error"));
      });
      expect(outcome).not.toBe("open");
      socket.terminate();
    }
  });
});
