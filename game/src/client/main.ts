import "./style.css";

import type { Manifest } from "../assets/types.ts";
import { loadFonts, loadManifest } from "./assets.ts";
import { playWaitingMusic } from "./music.ts";
import { mountOnline } from "./online.ts";
import { isCurrent, leave, mount, setCleanup, sounds } from "./shell.ts";
import { installFonts } from "./text.ts";
import { h } from "./ui.ts";
import { mountViewer } from "./viewer.ts";

const manifestPromise = loadManifest();
// The original's letters are GDI drawing gulim.ttc's bitmaps; without them the browser's font stands in.
const fontsReady = manifestPromise.then(
  (manifest) =>
    loadFonts(manifest)
      .then(installFonts)
      .catch((error: unknown) => console.warn(`글꼴 비트맵을 불러오지 못해 브라우저 글꼴로 그립니다: ${(error as Error).message}`)),
  () => undefined,
);

/**
 * The page is the Shake2 program from its logo on (AGENTS.md); practice and two players on one
 * keyboard are reached inside it. The asset viewer is a developer tool, reached by its address only.
 */
async function route(): Promise<void> {
  const id = leave();
  let manifest: Manifest;
  try {
    manifest = await manifestPromise;
    await fontsReady;
  } catch (error) {
    mount(errorScreen(`에셋 목록을 불러오지 못했습니다: ${(error as Error).message}. npm run sync-assets를 먼저 실행하세요.`));
    return;
  }
  if (!isCurrent(id)) return;
  const path = location.hash.replace(/^#/, "") || "/";
  if (path === "/viewer") {
    playWaitingMusic(sounds, manifest, "lobby");
    setCleanup(id, mountViewer(manifest, sounds));
    return;
  }
  // The old menu's addresses (#/online, #/practice, #/versus) open the program as well.
  if (path !== "/") history.replaceState(null, "", "#/");
  setCleanup(id, mountOnline(manifest));
}

/** Without the asset list no original picture can be drawn, so this one screen is plain text. */
function errorScreen(message: string): HTMLElement {
  return h("main", { class: "screen" }, h("h1", { tabindex: "-1" }, "오류"), h("p", { role: "alert" }, message));
}

window.addEventListener("hashchange", () => void route());
void route();
