// Room server for online play. Run with `npm run server` (Node 24 runs the TypeScript directly).
//   HOST (default 127.0.0.1; use 0.0.0.0 for LAN play), PORT (default 8787),
//   ALLOWED_ORIGINS (comma-separated extra browser origins), MAX_ROOMS (default 50),
//   CHANNEL (the lobby banner's channel name, default "복원판 채널"),
//   FRIENDS_FILE (where the friend lists are kept, default data/friends.json beside public/).
import { join } from "node:path";

import { startServer } from "./server.ts";

const server = await startServer({
  host: process.env.HOST ?? "127.0.0.1",
  port: Number(process.env.PORT ?? 8787),
  assetsDir: join(import.meta.dirname, "..", "..", "public", "assets"),
  allowedOrigins: (process.env.ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
  maxRooms: Number(process.env.MAX_ROOMS ?? 50),
  channel: process.env.CHANNEL,
  friendsFile: process.env.FRIENDS_FILE || join(import.meta.dirname, "..", "..", "data", "friends.json"),
  log: (line) => console.log(line),
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => void server.close().then(() => process.exit(0)));
}
