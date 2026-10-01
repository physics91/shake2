import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { WebSocket as WsClient } from "ws";

import { openAccountFile } from "./accountFile.ts";
import type { ServerMessage } from "./protocol.ts";
import { PROTOCOL_VERSION } from "./protocol.ts";
import type { RunningServer } from "./server.ts";
import {
  channelName,
  DEFAULT_ITEMS,
  DEFAULT_PAIRS,
  isOriginAllowed,
  noticeText,
  parseChannels,
  parseIndexList,
  startServer,
  statusNoticeText,
  startupWarning,
  tlsFiles,
} from "./server.ts";

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

const PASSWORD = "pass1234";
const folders: string[] = [];

afterAll(() => {
  for (const path of folders) rmSync(path, { recursive: true, force: true });
});

/** An account file holding these IDs (nick = ID), all with PASSWORD. */
async function accountsFileWith(ids: readonly string[]): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), "shake2-server-"));
  folders.push(dir);
  const path = join(dir, "accounts.json");
  const file = openAccountFile(path, { character: "bobo", items: DEFAULT_ITEMS, pairs: DEFAULT_PAIRS }, undefined, 60_000);
  await Promise.all(ids.map((id) => file.book.register(id, id, PASSWORD, 0)));
  file.flush();
  return path;
}

type LoginOk = Extract<ServerMessage, { type: "login"; ok: true }>;
const isLoginOk = (m: ServerMessage): m is LoginOk => m.type === "login" && m.ok;

/** The auth server's login, then the game server's version and hello, on one connection. */
async function enter(c: Client, id: string, channel = 0) {
  c.send({ type: "login", id, password: PASSWORD });
  const login = await c.waitFor(isLoginOk);
  c.send({ type: "version", version: PROTOCOL_VERSION, channel });
  await c.waitFor(isType("version"));
  c.send({ type: "hello", token: login.token });
  return c.waitFor(isType("welcome"));
}

const closed = (c: Client) => new Promise<number>((resolve) => c.socket.addEventListener("close", (e) => resolve(e.code)));

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

describe("NOTICE_TEXT and STATUS_NOTICE_FILE", () => {
  it("takes a notice line of up to 99 cp949 bytes, none when blank, and refuses the rest", () => {
    expect(noticeText(undefined)).toBeUndefined();
    expect(noticeText("   ")).toBeUndefined();
    expect(noticeText(" 서버 점검은 새벽 4시입니다. ")).toBe("서버 점검은 새벽 4시입니다.");
    expect(noticeText("가".repeat(49) + "a")).toBe("가".repeat(49) + "a");
    expect(() => noticeText("가".repeat(50))).toThrow(/99/);
    expect(() => noticeText("점검😀")).toThrow(/cp949/);
    expect(() => noticeText("한\n줄")).toThrow(/cp949/);
  });

  it("takes scene 5's notice text by lines of up to 255 bytes, 1023 bytes in all, CRLF or LF", () => {
    expect(statusNoticeText("")).toBeUndefined();
    expect(statusNoticeText("첫 줄\r\n둘째 줄\n")).toBe("첫 줄\r\n둘째 줄\n");
    expect(() => statusNoticeText("a".repeat(256) + "\n")).toThrow(/255/);
    expect(() => statusNoticeText(("a".repeat(200) + "\n").repeat(6))).toThrow(/1023/);
    expect(() => statusNoticeText("탭\t안 됨\n")).toThrow(/cp949/);
  });
});

describe("parseChannels and parseIndexList", () => {
  it("reads CHANNELS rows with their colours and levels, and refuses what it cannot read", () => {
    expect(parseChannels(undefined)).toEqual([]);
    expect(parseChannels(" 초보 채널|#00FF00|8-12 , 자유 ")).toEqual([
      { name: "초보 채널", colour: "#00ff00", levels: [8, 12] },
      { name: "자유", colour: "#ffffff" },
    ]);
    expect(() => parseChannels("a|green")).toThrow("#rrggbb");
    expect(() => parseChannels("a|#ffffff|12-1")).toThrow("levels");
    expect(() => parseChannels("a|#ffffff|0-3")).toThrow("levels");
    expect(() => parseChannels(Array.from({ length: 81 }, (_, i) => `c${i}`).join(","))).toThrow("80");
  });

  it("reads DEFAULT_ITEMS and DEFAULT_PAIRS as numbers below the count", () => {
    expect(parseIndexList(undefined, 30, [12], "DEFAULT_ITEMS")).toEqual([12]);
    expect(parseIndexList("2, 3,3", 30, [12], "DEFAULT_ITEMS")).toEqual([2, 3]);
    expect(() => parseIndexList("30", 30, [12], "DEFAULT_ITEMS")).toThrow("0..29");
    expect(() => parseIndexList("x", 10, [0], "DEFAULT_PAIRS")).toThrow("DEFAULT_PAIRS");
    expect(() => parseIndexList("2,", 30, [12], "DEFAULT_ITEMS")).toThrow("0..29");
    expect(() => parseIndexList("5,,6", 10, [0], "DEFAULT_PAIRS")).toThrow("0..9");
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
    expect(startupWarning("192.168.0.2", false)).toContain("account");
    expect(startupWarning("0.0.0.0", true)).toBeNull();
    expect(startupWarning("127.0.0.1", false)).toBeNull();
    expect(startupWarning("localhost", false)).toBeNull();
  });
});

describe.skipIf(!HAS_ASSETS)("room server over WebSocket", () => {
  let server: RunningServer;
  let url: string;

  beforeAll(async () => {
    const accountsFile = await accountsFileWith(["alpha", "bravo", "charlie", "addr0", "addr1", "addr2", "addr3", "twice"]);
    server = await startServer({ host: "127.0.0.1", port: 0, assetsDir: ASSETS, allowedOrigins: [], maxRooms: 5, accountsFile });
    url = `ws://127.0.0.1:${server.port}/ws`;
  });

  afterAll(async () => {
    await server.close();
  });

  it("plays one round between two clients until someone wins a medal", async () => {
    const a = new Client(url);
    const b = new Client(url);
    await Promise.all([a.opened(), b.opened()]);
    const [welcomeA, welcomeB] = await Promise.all([enter(a, "alpha"), enter(b, "bravo")]);

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
    expect((await enter(c, "charlie")).playerId).toBeGreaterThan(0);
    c.socket.close();
  });

  it("logs in only with the right password, lists the channel, and lets an account in once", async () => {
    const c = new Client(url);
    const again = new Client(url);
    await Promise.all([c.opened(), again.opened()]);
    c.send({ type: "login", id: "twice", password: "wrong1" });
    expect(await c.waitFor(isType("login"))).toEqual({ type: "login", ok: false });
    c.messages.length = 0;
    // The wrong password holds this address's next login back (LOGIN_RETRY_MS).
    const welcome = await enter(c, "twice");
    expect(welcome.account).toMatchObject({ id: "twice", nick: "twice", character: "bobo", level: 12, items: [12] });
    const login = c.messages.find(isLoginOk);
    expect(login?.channels).toEqual([{ name: "복원판 채널", colour: "#ffffff" }]);
    expect(login?.token).toMatch(/^[\w-]{43}$/);

    again.send({ type: "server-info", channel: 0 });
    expect(await again.waitFor(isType("server-info"))).toEqual({ type: "server-info", channel: 0, name: "복원판 채널", load: 0 });
    again.send({ type: "login", id: "TWICE", password: PASSWORD });
    const second = await again.waitFor(isLoginOk);
    again.send({ type: "version", version: PROTOCOL_VERSION, channel: 0 });
    await again.waitFor(isType("version"));
    again.send({ type: "hello", token: second.token });
    expect(await again.waitFor(isType("refused"))).toEqual({ type: "refused", code: 2 });
    c.socket.close();
    again.socket.close();
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
    await Promise.all(clients.map((c, i) => enter(c, `addr${i}`)));
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

describe.skipIf(!HAS_ASSETS)("a full channel", () => {
  it("closes on the next player before the version reply, and on nobody else's row", async () => {
    const accountsFile = await accountsFileWith(["first", "second"]);
    const server = await startServer({
      host: "127.0.0.1",
      port: 0,
      assetsDir: ASSETS,
      allowedOrigins: [],
      maxRooms: 5,
      maxUsers: 1,
      channels: [
        { name: "하나", colour: "#ff0000" },
        { name: "둘", colour: "#00ff00" },
      ],
      accountsFile,
    });
    const url = `ws://127.0.0.1:${server.port}/ws`;
    try {
      const first = new Client(url);
      const second = new Client(url);
      await Promise.all([first.opened(), second.opened()]);
      await enter(first, "first", 0);
      const shut = closed(second);
      second.send({ type: "version", version: PROTOCOL_VERSION, channel: 0 });
      expect(await shut).toBe(1013);
      expect(second.messages.some((m) => m.type === "version")).toBe(false);

      const other = new Client(url);
      await other.opened();
      expect((await enter(other, "second", 1)).account.id).toBe("second");
      other.send({ type: "server-info", channel: 0 });
      expect((await other.waitFor(isType("server-info"))).load).toBe(100);
      first.socket.close();
      other.socket.close();
    } finally {
      await server.close();
    }
  });
});

describe.skipIf(!HAS_ASSETS)("friends across channels", () => {
  it("shows a friend in another channel by that channel's name, in its lobby or a room", async () => {
    const accountsFile = await accountsFileWith(["first", "second"]);
    const server = await startServer({
      host: "127.0.0.1",
      port: 0,
      assetsDir: ASSETS,
      allowedOrigins: [],
      maxRooms: 5,
      channels: [
        { name: "하나", colour: "#ff0000" },
        { name: "둘", colour: "#00ff00" },
      ],
      accountsFile,
    });
    const url = `ws://127.0.0.1:${server.port}/ws`;
    try {
      const first = new Client(url);
      const second = new Client(url);
      await Promise.all([first.opened(), second.opened()]);
      await enter(first, "first", 0);
      await enter(second, "second", 1);
      first.send({ type: "add-friend", name: "second" });
      expect((await first.waitFor(isType("friend-added"))).result).toBe(1);
      first.send({ type: "friends" });
      expect((await first.waitFor(isType("friends"))).friends).toEqual([{ name: "second", location: "둘", badge: { guild: -1, level: 12 } }]);
      second.send({ type: "create-room", title: "" });
      await second.waitFor(isType("room"));
      first.messages.length = 0;
      first.send({ type: "friends" });
      expect((await first.waitFor(isType("friends"))).friends[0].location).toBe("둘");
      first.socket.close();
      second.socket.close();
    } finally {
      await server.close();
    }
  });
});

describe.skipIf(!HAS_ASSETS)("shutting down", () => {
  it("records no leave for the matches it cuts short, and leaves nothing to write after close()", async () => {
    const accountsFile = await accountsFileWith(["alpha", "bravo"]);
    const server = await startServer({ host: "127.0.0.1", port: 0, assetsDir: ASSETS, allowedOrigins: [], maxRooms: 5, accountsFile });
    const url = `ws://127.0.0.1:${server.port}/ws`;
    const a = new Client(url);
    const b = new Client(url);
    await Promise.all([a.opened(), b.opened()]);
    await enter(a, "alpha");
    const guest = await enter(b, "bravo");
    a.send({ type: "create-room", title: "" });
    const created = await a.waitFor((m): m is Extract<ServerMessage, { type: "room" }> => m.type === "room" && m.room !== null);
    b.send({ type: "join-room", code: created.room?.code });
    b.send({ type: "set-ready", ready: true });
    await a.waitFor((m): m is ServerMessage => m.type === "room" && m.room?.players.find((p) => p.id === guest.playerId)?.ready === true);
    a.send({ type: "start" });
    await a.waitFor((m): m is ServerMessage => m.type === "snapshot" && m.state.phase === "playing");
    const before = readFileSync(accountsFile, "utf8");

    await server.close();
    const atClose = readFileSync(accountsFile, "utf8");
    // Past the account file's one-second save: main.ts exits on close(), so nothing may come later.
    await new Promise((resolve) => setTimeout(resolve, 1500));

    expect(atClose).toBe(before);
    expect(readFileSync(accountsFile, "utf8")).toBe(before);
  }, 20_000);
});

describe.skipIf(!HAS_ASSETS || !HAS_OPENSSL)("room server over TLS", () => {
  const logged: string[] = [];
  let server: RunningServer;
  let dir: string;
  let cert: Buffer;

  beforeAll(async () => {
    const accountsFile = await accountsFileWith(["secure"]);
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
      accountsFile,
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
    expect((await enter(c, "secure")).playerId).toBeGreaterThan(0);
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
