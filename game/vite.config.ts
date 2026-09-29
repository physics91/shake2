import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

// The room server (npm run server) listens on 8787; the browser reaches it same-origin at /ws.
const roomServer = { "/ws": { target: "ws://127.0.0.1:8787", ws: true } };
// The room server keeps its friend lists in data/ (FRIENDS_FILE's default), inside this root: the
// dev server must not hand them out. A deny list replaces Vite's own, so those come first.
const serverData = `${fileURLToPath(new URL("./data", import.meta.url)).replaceAll("\\", "/")}/**`;
const deny = [".env", ".env.*", "*.{crt,pem,key,p12,pfx,cer,der}", ".npmrc", ".yarnrc.yml", "**/.git/**", serverData];

export default defineConfig({
  server: { port: 5173, proxy: roomServer, fs: { deny } },
  preview: { proxy: roomServer },
  // public/assets holds the extracted originals; keep the bundle out of that folder.
  build: { assetsDir: "bundle" },
  test: { include: ["src/**/*.test.ts"] },
});
