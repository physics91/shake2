import { randomBytes, randomInt } from "node:crypto";
import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { createServer } from "node:http";
import type { IncomingMessage, RequestListener, Server as HttpServer } from "node:http";
import { createServer as createTlsServer } from "node:https";
import type { Server as HttpsServer } from "node:https";
import type { AddressInfo, Socket } from "node:net";
import { basename, dirname, join } from "node:path";

import type { WebSocket } from "ws";
import { WebSocketServer } from "ws";

import type { LevelMeta, Manifest } from "../assets/types.ts";
import { MEDALS_TO_WIN, ROUND_SECONDS, TICK_RATE } from "../sim/constants.ts";
import { isRoomMap, layoutFromLevel } from "../sim/level.ts";
import { openAccountFile } from "./accountFile.ts";
import type { AccountDefaults } from "./accounts.ts";
import { AccountBook, LOWEST_LEVEL, PAIR_COUNT } from "./accounts.ts";
import { addressKey, clientAddress, isLoopbackHost } from "./address.ts";
import { cp949Bytes, cutBytes, typeable } from "./cp949.ts";
import { openFriendFile } from "./friendFile.ts";
import { FriendBook } from "./friends.ts";
import type { Channel } from "./gate.ts";
import { Gate } from "./gate.ts";
import { ITEM_ALL } from "./items.ts";
import type { PlayableMap } from "./lobby.ts";
import { Lobby } from "./lobby.ts";
import type { ServerMessage } from "./protocol.ts";
import {
  MAX_CHANNELS,
  MAX_MESSAGE_BYTES,
  NOTICE_BYTES,
  parseClientMessage,
  ROOM_CODE_ALPHABET,
  ROOM_CODE_LENGTH,
  STATUS_NOTICE_BYTES,
  STATUS_NOTICE_LINE_BYTES,
} from "./protocol.ts";

export interface ServerOptions {
  host: string;
  port: number;
  /** Folder holding manifest.json and maps/ (public/assets after `npm run sync-assets`). */
  assetsDir: string;
  /** Extra browser origins allowed besides same-host and localhost. */
  allowedOrigins: readonly string[];
  /** Rooms per channel. */
  maxRooms: number;
  /** Players per channel; the next one is turned away before the version reply. */
  maxUsers?: number;
  /** The server list's rows, each a lobby of its own; one white "복원판 채널" without them. */
  channels?: readonly ChannelSpec[];
  /** The JSON file the friend lists are kept in; without one they last until the server stops. */
  friendsFile?: string;
  /** The JSON file the accounts are kept in; without one they last until the server stops. */
  accountsFile?: string;
  /** What a new account owns: item slots (hasItem) and character pairs. */
  defaultItems?: readonly number[];
  defaultPairs?: readonly number[];
  /** PEM files to speak wss:// with; without them the server speaks plain ws://. */
  tls?: TlsFiles;
  /** Proxies whose X-Forwarded-For is believed besides loopback ones (address.ts). */
  trustedProxies?: readonly string[];
  /** The notice line sent to each session let into a channel (noticeText). */
  notice?: string;
  /** Scene 5's notices sent after each login (statusNoticeText). */
  statusNotice?: string;
  log?: (line: string) => void;
}

export interface TlsFiles {
  certFile: string;
  keyFile: string;
}

/** TLS_CERT and TLS_KEY: both or neither; one alone is a mistake the server will not start with. */
export function tlsFiles(certFile: string | undefined, keyFile: string | undefined): TlsFiles | undefined {
  if (!certFile && !keyFile) return undefined;
  if (!certFile) throw new Error("TLS_KEY is set without TLS_CERT");
  if (!keyFile) throw new Error("TLS_CERT is set without TLS_KEY");
  return { certFile, keyFile };
}

/** Account and secret-room passwords cross the network as they were typed unless the server speaks TLS. */
export function startupWarning(host: string, tls: boolean): string | null {
  if (tls || isLoopbackHost(host)) return null;
  return `warning: ${host} is reachable from other machines over plain ws://, so account and room passwords travel unencrypted; set TLS_CERT and TLS_KEY (or put a TLS proxy in front) for wss://`;
}

const DEFAULT_CHANNEL = "복원판 채널";
/** The banner box holds about 16 bytes of 굴림 12 from (84,39). */
const CHANNEL_BYTES = 16;
const DEFAULT_COLOUR = "#ffffff";
export const DEFAULT_MAX_USERS = 200;

export function channelName(raw: string | undefined): string {
  return cutBytes(typeable(raw ?? "").trim(), CHANNEL_BYTES).trim() || DEFAULT_CHANNEL;
}

/** A server list row as the operator gives it. */
export interface ChannelSpec {
  name: string;
  /** "#rrggbb": the row's name and load (0x456e10). */
  colour: string;
  /** The levels let in, best first; any when absent. */
  levels?: readonly [number, number];
}

/**
 * CHANNELS: rows separated by ",", each "name", "name|#rrggbb" or "name|#rrggbb|best-worst" (levels
 * 1..12). Empty for the one default row. Throws on a row it cannot read.
 */
export function parseChannels(raw: string | undefined): ChannelSpec[] {
  const rows = (raw ?? "")
    .split(",")
    .map((row) => row.trim())
    .filter(Boolean);
  if (rows.length > MAX_CHANNELS) throw new Error(`CHANNELS has ${rows.length} rows; the server list holds ${MAX_CHANNELS}`);
  return rows.map((row) => {
    const [name, colour = DEFAULT_COLOUR, levels] = row.split("|").map((part) => part.trim());
    if (!/^#[0-9a-fA-F]{6}$/.test(colour)) throw new Error(`CHANNELS: "${row}" has no #rrggbb colour`);
    const spec: ChannelSpec = { name: channelName(name), colour: colour.toLowerCase() };
    if (levels === undefined) return spec;
    const match = /^(\d{1,2})-(\d{1,2})$/.exec(levels);
    const [best, worst] = match ? [Number(match[1]), Number(match[2])] : [0, 0];
    if (!match || best < 1 || worst > LOWEST_LEVEL || best > worst) throw new Error(`CHANNELS: "${row}" has no levels best-worst in 1..${LOWEST_LEVEL}`);
    return { ...spec, levels: [best, worst] };
  });
}

/** NOTICE_TEXT: the notice line every session let into a channel is sent (S->C 0x50); none when blank. */
export function noticeText(raw: string | undefined): string | undefined {
  const text = (raw ?? "").trim();
  if (!text) return undefined;
  if (typeable(text) !== text) throw new Error("NOTICE_TEXT has a character outside cp949's printable ones");
  const bytes = cp949Bytes(text);
  if (bytes > NOTICE_BYTES) throw new Error(`NOTICE_TEXT is ${bytes} bytes; the notice line holds ${NOTICE_BYTES}`);
  return text;
}

/**
 * STATUS_NOTICE_FILE's text: scene 5's notices, sent after each login (S->C 0x101). Lines end with
 * "\n" (a CR before it is cut; a last line without one is not shown), each at most 255 bytes and
 * 1023 in all, as the original client holds them. None when empty.
 */
export function statusNoticeText(raw: string): string | undefined {
  if (!raw) return undefined;
  const lines = raw.split("\n").map((line) => line.replace(/\r$/, ""));
  const odd = lines.find((line) => typeable(line) !== line);
  if (odd !== undefined) throw new Error(`STATUS_NOTICE_FILE has a character outside cp949's printable ones: "${odd}"`);
  const long = lines.find((line) => cp949Bytes(line) > STATUS_NOTICE_LINE_BYTES);
  if (long !== undefined) throw new Error(`STATUS_NOTICE_FILE has a line over ${STATUS_NOTICE_LINE_BYTES} bytes: "${long.slice(0, 20)}…"`);
  const bytes = cp949Bytes(raw);
  if (bytes > STATUS_NOTICE_BYTES) throw new Error(`STATUS_NOTICE_FILE is ${bytes} bytes; scene 5 holds ${STATUS_NOTICE_BYTES}`);
  return raw;
}

/** DEFAULT_ITEMS / DEFAULT_PAIRS: comma-separated numbers below `count`; the fallback when unset. */
export function parseIndexList(raw: string | undefined, count: number, fallback: readonly number[], what: string): number[] {
  if (raw === undefined || raw.trim() === "") return [...fallback];
  const parts = raw.split(",").map((part) => part.trim());
  const list = parts.map(Number);
  if (!parts.every((part, i) => /^\d+$/.test(part) && list[i] < count)) throw new Error(`${what} takes numbers 0..${count - 1}`);
  return [...new Set(list)];
}

/** A new account plays 루키, the first of the first pair (0x484718), as a new account is a 루키 (I). */
export const NEW_ACCOUNT_CHARACTER = "rookie";

/** Every character pair (0..9) and the item pack that holds every item (R: nothing can be bought). */
export const DEFAULT_ITEMS: readonly number[] = [ITEM_ALL];
export const DEFAULT_PAIRS: readonly number[] = Array.from({ length: PAIR_COUNT }, (_, k) => k);

export interface RunningServer {
  port: number;
  close(): Promise<void>;
}

const MESSAGES_PER_SECOND = 120;
const CLOSE_AFTER_MESSAGES_PER_SECOND = 360;
const SLOW_CLIENT_BUFFER = 256 * 1024;
const HEARTBEAT_MS = 15_000;
const MAX_CATCH_UP_TICKS = 10;

export function loadPlayableMaps(assetsDir: string): { maps: PlayableMap[]; music: string[]; characters: string[] } {
  const manifest = JSON.parse(readFileSync(join(assetsDir, "manifest.json"), "utf-8")) as Manifest;
  const maps = manifest.maps
    .filter((m) => isRoomMap(m.id))
    .map((m) => {
      const meta = JSON.parse(readFileSync(join(assetsDir, "maps", `${m.id}.json`), "utf-8")) as LevelMeta;
      return { id: m.id, title: m.title, layout: layoutFromLevel(m.id, meta) };
    });
  if (maps.length === 0) throw new Error(`no playable maps in ${assetsDir}`);
  const music = (manifest.music ?? []).filter((t) => t.role === "game").map((t) => t.name);
  return { maps, music, characters: manifest.characters };
}

export function isOriginAllowed(origin: string | undefined, hostHeader: string | undefined, extra: readonly string[]): boolean {
  if (!origin) return true; // non-browser clients do not send Origin
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return false;
  }
  if (extra.includes(url.origin)) return true;
  if (hostHeader && url.host === hostHeader) return true;
  return url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]";
}

function randomRoomCode(): string {
  return Array.from({ length: ROOM_CODE_LENGTH }, () => ROOM_CODE_ALPHABET[randomInt(ROOM_CODE_ALPHABET.length)]).join("");
}

/** Resolve existing links in a storage path, including parents of a file not created yet. */
function canonicalStorePath(path: string): string {
  try {
    return realpathSync(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    const parent = dirname(path);
    if (parent === path) throw error;
    return join(canonicalStorePath(parent), basename(path));
  }
}

function checkStoreFiles(accountsFile?: string, friendsFile?: string): void {
  if (!accountsFile || !friendsFile) return;
  const accounts = canonicalStorePath(accountsFile), friends = canonicalStorePath(friendsFile);
  let shared = accounts === friends;
  if (!shared && existsSync(accounts) && existsSync(friends)) {
    const a = statSync(accounts, { bigint: true }), f = statSync(friends, { bigint: true });
    shared = a.dev === f.dev && a.ino === f.ino;
  }
  if (shared) throw new Error("ACCOUNTS_FILE and FRIENDS_FILE must use different files");
}

export function startServer(options: ServerOptions): Promise<RunningServer> {
  const log = options.log ?? (() => undefined);
  // Check before either book can move an incompatible file aside or schedule a save over it.
  checkStoreFiles(options.accountsFile, options.friendsFile);
  const { maps, music, characters } = loadPlayableMaps(options.assetsDir);
  const friendFile = options.friendsFile ? openFriendFile(options.friendsFile, log) : null;
  const friends = friendFile?.book ?? new FriendBook();
  const defaults: AccountDefaults = {
    character: characters.includes(NEW_ACCOUNT_CHARACTER) ? NEW_ACCOUNT_CHARACTER : characters[0],
    items: options.defaultItems ?? DEFAULT_ITEMS,
    pairs: options.defaultPairs ?? DEFAULT_PAIRS,
  };
  const accountFile = options.accountsFile ? openAccountFile(options.accountsFile, defaults, log) : null;
  const accounts = accountFile?.book ?? new AccountBook(undefined, defaults);
  // Shutdown keeps earned candy; a match it cuts short is nobody's leave or win.
  let closing = false;
  const specs = options.channels?.length ? options.channels : [{ name: DEFAULT_CHANNEL, colour: DEFAULT_COLOUR }];
  const channels: Channel[] = specs.map((spec) => ({
    row: { name: spec.name, colour: spec.colour },
    levels: spec.levels,
    maxUsers: options.maxUsers ?? DEFAULT_MAX_USERS,
    lobby: new Lobby({
      maps,
      music,
      characters,
      rules: { practice: false, roundSeconds: ROUND_SECONDS, medalsToWin: MEDALS_TO_WIN, mode: 0 },
      maxRooms: options.maxRooms,
      channel: spec.name,
      friends,
      saveCharacter: (name, choice) => accounts.update(name, choice),
      recordMatch: (name, record) => {
        if (closing) {
          if (record.candy > 0) accounts.recordMatch(name, { cell: 0, won: false, lost: false, candy: record.candy });
        } else {
          accounts.recordMatch(name, record);
        }
      },
      badgeOf: (name) => {
        const account = accounts.get(name);
        return account ? { guild: account.guild, level: accounts.standing(account.id).level } : null;
      },
      accountId: (name) => accounts.get(name)?.id,
      // A friend in another channel: that channel's name, lobby or room (a room's number is that channel's).
      locate: (name) => channels.find((channel) => channel.lobby.presence(name))?.row.name ?? "",
      now: () => Date.now(),
      roomCode: randomRoomCode,
    }),
  }));
  const gate = new Gate({
    accounts,
    channels,
    characters,
    now: () => Date.now(),
    token: () => randomBytes(32).toString("base64url"),
    notice: options.notice,
    statusNotice: options.statusNotice,
  });

  const respond: RequestListener = (req, res) => {
    if (req.url === "/health") {
      res.writeHead(200, { "content-type": "text/plain; charset=utf-8" }).end("ok");
      return;
    }
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" }).end("not found");
  };
  const tls = options.tls;
  const http: HttpServer | HttpsServer = tls
    ? createTlsServer({ cert: readFileSync(tls.certFile), key: readFileSync(tls.keyFile) }, respond)
    : createServer(respond);
  // Every TCP socket from its accept on. close() destroys them: on wss:// one still in its TLS
  // handshake is not among the connections closeAllConnections() knows.
  const sockets = new Set<Socket>();
  http.on("connection", (socket: Socket) => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
  });
  const trustedProxies = options.trustedProxies ?? [];
  const wss = new WebSocketServer({
    server: http,
    path: "/ws",
    maxPayload: MAX_MESSAGE_BYTES,
    verifyClient: ({ origin, req }: { origin: string; req: IncomingMessage }) =>
      isOriginAllowed(origin, req.headers.host, options.allowedOrigins),
  });

  let nextPeerId = 1;
  const alive = new WeakMap<WebSocket, boolean>();
  wss.on("connection", (socket, req) => {
    const id = nextPeerId++;
    const address = addressKey(clientAddress(req.socket.remoteAddress, req.headers["x-forwarded-for"], trustedProxies));
    alive.set(socket, true);
    const send = (message: ServerMessage) => {
      if (socket.readyState !== socket.OPEN) return;
      if (message.type === "snapshot" && socket.bufferedAmount > SLOW_CLIENT_BUFFER) return;
      socket.send(JSON.stringify(message));
    };
    gate.connect({ id, send, address, close: () => socket.close(1013, "full") });
    log(`peer ${id} connected (${wss.clients.size} online)`);

    let windowStart = Date.now();
    let count = 0;
    socket.on("message", (data, isBinary) => {
      const now = Date.now();
      if (now - windowStart >= 1000) {
        windowStart = now;
        count = 0;
      }
      count += 1;
      if (count > CLOSE_AFTER_MESSAGES_PER_SECOND) {
        socket.close(1008, "rate limit");
        return;
      }
      if (count > MESSAGES_PER_SECOND) return;
      const message = isBinary ? null : parseClientMessage(data.toString());
      if (!message) {
        send({ type: "error", message: "잘못된 메시지입니다." });
        return;
      }
      gate.handle(id, message);
    });
    socket.on("pong", () => alive.set(socket, true));
    socket.on("close", () => {
      gate.disconnect(id);
      log(`peer ${id} left (${wss.clients.size} online)`);
    });
    socket.on("error", () => socket.terminate());
  });

  const heartbeat = setInterval(() => {
    for (const socket of wss.clients) {
      if (!alive.get(socket)) {
        socket.terminate();
        continue;
      }
      alive.set(socket, false);
      socket.ping();
    }
  }, HEARTBEAT_MS);

  const stepMs = 1000 / TICK_RATE;
  let last = performance.now();
  let pending = 0;
  const clock = setInterval(() => {
    const now = performance.now();
    pending += now - last;
    last = now;
    let steps = 0;
    while (pending >= stepMs && steps < MAX_CATCH_UP_TICKS) {
      for (const channel of channels) channel.lobby.tick();
      pending -= stepMs;
      steps += 1;
    }
    if (steps === MAX_CATCH_UP_TICKS) pending = 0;
    if (steps > 0) gate.tick();
  }, 4);

  return new Promise((resolve, reject) => {
    // A port that cannot be had: wss passes the error on (with no listener of its own it would throw
    // past http's), and the timers go, so nothing is left running. A port listen() refuses at once
    // (out of range, not a number) is thrown instead of emitted.
    const failed = (error: Error) => {
      clearInterval(clock);
      clearInterval(heartbeat);
      reject(error);
    };
    http.once("error", failed);
    wss.once("error", failed);
    const listening = () => {
      http.off("error", failed);
      wss.off("error", failed);
      const port = (http.address() as AddressInfo).port;
      log(`shake2 server on ${tls ? "wss" : "ws"}://${options.host}:${port}/ws (${maps.length} maps, ${channels.length} channels, ${accounts.size} accounts)`);
      const warning = startupWarning(options.host, tls !== undefined);
      if (warning) log(warning);
      resolve({
        port,
        close: () =>
          new Promise<void>((done) => {
            clearInterval(clock);
            clearInterval(heartbeat);
            closing = true;
            for (const socket of wss.clients) socket.terminate();
            // wss calls back once every socket's close has run; save after those and after the sign-ups
            // being hashed, so nothing is left to write.
            wss.close(() => {
              void gate.settled().then(() => {
                friendFile?.flush();
                accountFile?.flush();
                http.close(() => done());
                // close() waits for every connection, and Node's request and TLS handshake timeouts
                // stop with it: a client that sent nothing or half a request would hold the exit.
                for (const socket of sockets) socket.destroy();
              });
            });
          }),
      });
    };
    try {
      http.listen(options.port, options.host, listening);
    } catch (error) {
      failed(error as Error);
    }
  });
}
