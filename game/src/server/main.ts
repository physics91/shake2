// Room server for online play. Run with `npm run server` (Node 24 runs the TypeScript directly).
//   HOST (default 127.0.0.1; use 0.0.0.0 for LAN play), PORT (default 8787),
//   ALLOWED_ORIGINS (comma-separated extra browser origins), MAX_ROOMS (per channel, default 50),
//   MAX_USERS (players per channel, default 200),
//   CHANNELS (the server list's rows: "name|#rrggbb|best-worst level" separated by commas, colour and
//   levels optional) or CHANNEL (one row's name; default one white "복원판 채널"),
//   ACCOUNTS_FILE (where the accounts are kept, default data/accounts.json beside public/),
//   DEFAULT_ITEMS and DEFAULT_PAIRS (what a new account owns: item slots, default 12 = every item,
//   and character pairs, default 0..9),
//   FRIENDS_FILE (where the friend lists are kept, default data/friends.json beside public/),
//   TLS_CERT and TLS_KEY (PEM files: both make it wss://), TRUST_PROXY (comma-separated addresses
//   of proxies whose X-Forwarded-For is believed; loopback ones always are),
//   NOTICE_TEXT (the notice line shown for 60 s on entering a channel: at most 99 cp949 bytes),
//   STATUS_NOTICE_FILE (a text file of scene 5's notices, shown after each login: lines ended by
//   a newline, at most 255 bytes each and 1023 in all). Both are read at start.
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { ITEM_COUNT, PAIR_COUNT } from "./accounts.ts";
import {
  channelName,
  DEFAULT_ITEMS,
  DEFAULT_PAIRS,
  noticeText,
  parseChannels,
  parseIndexList,
  startServer,
  statusNoticeText,
  tlsFiles,
} from "./server.ts";

const list = (value: string | undefined) =>
  (value ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

/** A positive whole number, or undefined when unset. */
const count = (value: string | undefined, name: string) => {
  if (value === undefined || value.trim() === "") return undefined;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) throw new Error(`${name} takes a whole number of at least 1`);
  return n;
};

const server = await startServer({
  // A blank HOST= or PORT= line is unset, not "every interface" or "any port".
  host: process.env.HOST?.trim() || "127.0.0.1",
  port: process.env.PORT?.trim() ? Number(process.env.PORT) : 8787,
  assetsDir: join(import.meta.dirname, "..", "..", "public", "assets"),
  allowedOrigins: list(process.env.ALLOWED_ORIGINS),
  maxRooms: count(process.env.MAX_ROOMS, "MAX_ROOMS") ?? 50,
  maxUsers: count(process.env.MAX_USERS, "MAX_USERS"),
  // A blank CHANNELS= line is unset too, so CHANNEL still names the one row.
  channels: process.env.CHANNELS?.trim()
    ? parseChannels(process.env.CHANNELS)
    : process.env.CHANNEL
      ? [{ name: channelName(process.env.CHANNEL), colour: "#ffffff" }]
      : undefined,
  accountsFile: process.env.ACCOUNTS_FILE || join(import.meta.dirname, "..", "..", "data", "accounts.json"),
  defaultItems: parseIndexList(process.env.DEFAULT_ITEMS, ITEM_COUNT, DEFAULT_ITEMS, "DEFAULT_ITEMS"),
  defaultPairs: parseIndexList(process.env.DEFAULT_PAIRS, PAIR_COUNT, DEFAULT_PAIRS, "DEFAULT_PAIRS"),
  friendsFile: process.env.FRIENDS_FILE || join(import.meta.dirname, "..", "..", "data", "friends.json"),
  tls: tlsFiles(process.env.TLS_CERT, process.env.TLS_KEY),
  trustedProxies: list(process.env.TRUST_PROXY),
  notice: noticeText(process.env.NOTICE_TEXT),
  statusNotice: process.env.STATUS_NOTICE_FILE ? statusNoticeText(readFileSync(process.env.STATUS_NOTICE_FILE, "utf8")) : undefined,
  log: (line) => console.log(line),
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => void server.close().then(() => process.exit(0)));
}
