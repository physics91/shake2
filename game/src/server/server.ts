import { randomInt } from "node:crypto";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import type { IncomingMessage, RequestListener, Server as HttpServer } from "node:http";
import { createServer as createTlsServer } from "node:https";
import type { Server as HttpsServer } from "node:https";
import type { AddressInfo } from "node:net";
import { join } from "node:path";

import type { WebSocket } from "ws";
import { WebSocketServer } from "ws";

import type { LevelMeta, Manifest } from "../assets/types.ts";
import { MEDALS_TO_WIN, ROUND_SECONDS, TICK_RATE } from "../sim/constants.ts";
import { isRoomMap, layoutFromLevel } from "../sim/level.ts";
import { addressKey, clientAddress, isLoopbackHost } from "./address.ts";
import { cutBytes, typeable } from "./cp949.ts";
import { openFriendFile } from "./friendFile.ts";
import { FriendBook } from "./friends.ts";
import type { PlayableMap } from "./lobby.ts";
import { Lobby } from "./lobby.ts";
import type { ServerMessage } from "./protocol.ts";
import { MAX_MESSAGE_BYTES, parseClientMessage, ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH } from "./protocol.ts";

export interface ServerOptions {
  host: string;
  port: number;
  /** Folder holding manifest.json and maps/ (public/assets after `npm run sync-assets`). */
  assetsDir: string;
  /** Extra browser origins allowed besides same-host and localhost. */
  allowedOrigins: readonly string[];
  maxRooms: number;
  /** The lobby banner's channel name; cut to what fits there. */
  channel?: string;
  /** The JSON file the friend lists are kept in; without one they last until the server stops. */
  friendsFile?: string;
  /** PEM files to speak wss:// with; without them the server speaks plain ws://. */
  tls?: TlsFiles;
  /** Proxies whose X-Forwarded-For is believed besides loopback ones (address.ts). */
  trustedProxies?: readonly string[];
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

/** Secret-room passwords cross the network as they were typed unless the server speaks TLS. */
export function startupWarning(host: string, tls: boolean): string | null {
  if (tls || isLoopbackHost(host)) return null;
  return `warning: ${host} is reachable from other machines over plain ws://, so room passwords travel unencrypted; set TLS_CERT and TLS_KEY (or put a TLS proxy in front) for wss://`;
}

const DEFAULT_CHANNEL = "복원판 채널";
/** The banner box holds about 16 bytes of 굴림 12 from (84,39). */
const CHANNEL_BYTES = 16;

export function channelName(raw: string | undefined): string {
  return cutBytes(typeable(raw ?? "").trim(), CHANNEL_BYTES).trim() || DEFAULT_CHANNEL;
}

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

export function startServer(options: ServerOptions): Promise<RunningServer> {
  const log = options.log ?? (() => undefined);
  const { maps, music, characters } = loadPlayableMaps(options.assetsDir);
  const friendFile = options.friendsFile ? openFriendFile(options.friendsFile, log) : null;
  const lobby = new Lobby({
    maps,
    music,
    characters,
    rules: { practice: false, roundSeconds: ROUND_SECONDS, medalsToWin: MEDALS_TO_WIN, mode: 0 },
    maxRooms: options.maxRooms,
    channel: channelName(options.channel),
    friends: friendFile?.book ?? new FriendBook(),
    now: () => Date.now(),
    roomCode: randomRoomCode,
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
    lobby.connect({ id, send, address });
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
      lobby.handle(id, message);
    });
    socket.on("pong", () => alive.set(socket, true));
    socket.on("close", () => {
      lobby.disconnect(id);
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
      lobby.tick();
      pending -= stepMs;
      steps += 1;
    }
    if (steps === MAX_CATCH_UP_TICKS) pending = 0;
  }, 4);

  return new Promise((resolve, reject) => {
    http.once("error", reject);
    http.listen(options.port, options.host, () => {
      const port = (http.address() as AddressInfo).port;
      log(`shake2 server on ${tls ? "wss" : "ws"}://${options.host}:${port}/ws (${maps.length} maps)`);
      const warning = startupWarning(options.host, tls !== undefined);
      if (warning) log(warning);
      resolve({
        port,
        close: () =>
          new Promise<void>((done) => {
            clearInterval(clock);
            clearInterval(heartbeat);
            friendFile?.flush();
            for (const socket of wss.clients) socket.terminate();
            wss.close(() => http.close(() => done()));
          }),
      });
    });
  });
}
