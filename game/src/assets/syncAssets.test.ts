import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

const folders: string[] = [];
const originalManifest = '{"build":"working"}';

afterEach(() => {
  for (const path of folders.splice(0)) rmSync(path, { recursive: true, force: true });
});

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "shake2-sync-assets-"));
  folders.push(root);
  const game = join(root, "game"), assets = join(game, "public", "assets");
  const extracted = join(root, "assets", "extracted");
  const original = join(root, "original", "extracted", "Shake0311_20020323", "files", "App_Executables");
  const script = join(game, "scripts", "sync-assets.mjs");
  function put(path: string, contents: string) {
    mkdirSync(join(path, ".."), { recursive: true });
    writeFileSync(path, contents);
  }
  mkdirSync(join(game, "scripts"), { recursive: true });
  cpSync(join(import.meta.dirname, "..", "..", "scripts", "sync-assets.mjs"), script);
  for (const dir of ["character", "bomb", "brick", "item", "object", "w_character"]) {
    mkdirSync(join(extracted, "spr_data", dir), { recursive: true });
  }
  put(join(extracted, "spr_data", "character", "bobo.json"), '{"name":"bobo"}');
  put(join(extracted, "spr_data", "character", "bobo.png"), "new portrait bytes");
  put(join(extracted, "spr_data", "character", "bobo.rgb.png"), "new tint bytes");
  put(join(extracted, "map_data", "level.json"), '{"title":"시험","objects":[]}');
  put(join(extracted, "map_data", "background.png"), "new background bytes");
  put(join(extracted, "map_data", "level.preview.png"), "new preview bytes");
  put(join(extracted, "image", "cursor.json"), '{"name":"cursor"}');
  put(join(extracted, "image", "cursor.png"), "new cursor bytes");
  put(join(extracted, "image", "shake_logo.png"), "new logo bytes");
  put(join(extracted, "image", "shake1_status.png"), "new status bytes");
  put(join(extracted, "index.json"), JSON.stringify({
    entries: [
      { kind: "spr", output: "spr_data/character/bobo.png", metadata: "spr_data/character/bobo.json", rgb: "spr_data/character/bobo.rgb.png" },
      { kind: "spr", output: "image/cursor.png", metadata: "image/cursor.json" },
      { kind: "map", metadata: "map_data/level.json", preview: "map_data/level.preview.png" },
      { kind: "shk", output: "map_data/background.png" },
      { kind: "shk", output: "image/shake_logo.png" },
    ],
    borrowed: [{ kind: "shk", output: "image/shake1_status.png" }],
  }));
  put(join(extracted, "font", "index.json"), JSON.stringify({ strikes: [
    { id: "gulimche-12", file: "gulimche-12.bin", ppem: 12, ascent: 10, descent: 2 },
  ] }));
  put(join(extracted, "font", "gulimche-12.bin"), "new font bytes");
  put(join(extracted, "bgm", "index.json"), JSON.stringify({ tracks: [
    { name: "Waiting", role: "lobby", file: "tbwait11.wav", loop_end: 20 },
  ] }));
  put(join(extracted, "bgm", "tbwait11.wav"), "new music bytes");
  put(join(original, "guild.dat"), "guild list");
  put(join(original, "sound", "menu2.wav"), "new sound bytes");
  put(join(assets, "manifest.json"), originalManifest);
  put(join(assets, "old.png"), "previous image bytes");
  return {
    game, assets, extracted, original,
    run: (options: string[] = []) => spawnSync(process.execPath, [...options, script], { cwd: game, encoding: "utf8" }),
  };
}

describe("asset synchronization", () => {
  it.each(["MENU2.WAV", "Menu2.WaV"])("publishes %s at the lowercase path the game requests", (name) => {
    const t = fixture();
    renameSync(join(t.original, "sound", "menu2.wav"), join(t.original, "sound", name));
    const run = t.run();
    expect(run.status, run.stderr).toBe(0);
    const manifest = JSON.parse(readFileSync(join(t.assets, "manifest.json"), "utf8"));
    expect(manifest.sounds).toEqual(["menu2"]);
    expect(readFileSync(join(t.assets, "sound", "menu2.wav"), "utf8")).toBe("new sound bytes");
    expect(readdirSync(join(t.assets, "sound"))).toEqual(["menu2.wav"]);
  });

  it.each([
    "spr_data/character/bobo.png", "image/cursor.png", "image/shake_logo.png", "image/shake1_status.png",
    "map_data/background.png", "map_data/level.preview.png", "font/gulimche-12.bin", "bgm/tbwait11.wav",
    "spr_data/character/bobo.json", "spr_data/character/bobo.rgb.png", "image/cursor.json", "map_data/level.json",
  ])("refuses a missing declared %s without replacing the working assets", (missing) => {
    const t = fixture();
    rmSync(join(t.extracted, missing));
    const run = t.run();
    expect(run.status).not.toBe(0);
    expect(run.stderr).toContain(missing);
    expect(readFileSync(join(t.assets, "manifest.json"), "utf8")).toBe(originalManifest);
    expect(readFileSync(join(t.assets, "old.png"), "utf8")).toBe("previous image bytes");
    expect(readdirSync(t.assets).sort()).toEqual(["manifest.json", "old.png"]);
    expect(readdirSync(t.game).sort()).toEqual(["public", "scripts"]);
  });

  it("refuses an export that recorded a failed conversion", () => {
    const t = fixture();
    const index = join(t.extracted, "index.json");
    const inventory = JSON.parse(readFileSync(index, "utf8"));
    inventory.entries.push({ source: "image/missing.shk", kind: "shk", error: "bad header" });
    writeFileSync(index, JSON.stringify(inventory));
    const run = t.run();
    expect(run.status).not.toBe(0);
    expect(run.stderr).toContain("image/missing.shk");
    expect(run.stderr).toContain("bad header");
    expect(readFileSync(join(t.assets, "manifest.json"), "utf8")).toBe(originalManifest);
    expect(readFileSync(join(t.assets, "old.png"), "utf8")).toBe("previous image bytes");
    expect(readdirSync(t.game).sort()).toEqual(["public", "scripts"]);
  });

  it("allows optional fonts and music to be absent when no index declares them", () => {
    const t = fixture();
    rmSync(join(t.extracted, "font"), { recursive: true });
    rmSync(join(t.extracted, "bgm"), { recursive: true });
    const run = t.run();
    expect(run.status, run.stderr).toBe(0);
    const manifest = JSON.parse(readFileSync(join(t.assets, "manifest.json"), "utf8"));
    expect(manifest.fonts).toEqual([]);
    expect(manifest.music).toEqual([]);
  });

  it.each(["missing guild", "invalid map"])("keeps the working assets when synchronization fails on %s", (failure) => {
    const t = fixture();
    if (failure === "missing guild") rmSync(join(t.original, "guild.dat"));
    else writeFileSync(join(t.extracted, "map_data", "level.json"), "{invalid map");
    const run = t.run();
    expect(run.status).not.toBe(0);
    expect(existsSync(join(t.assets, "manifest.json"))).toBe(true);
    expect(readFileSync(join(t.assets, "manifest.json"), "utf8")).toBe(originalManifest);
    expect(readFileSync(join(t.assets, "old.png"), "utf8")).toBe("previous image bytes");
    expect(readdirSync(t.assets).sort()).toEqual(["manifest.json", "old.png"]);
    expect(readdirSync(t.game).sort()).toEqual(["public", "scripts"]);
  });

  it("publishes the complete new assets and removes obsolete files after a successful sync", () => {
    const t = fixture(), run = t.run();
    expect(run.status, run.stderr).toBe(0);
    const manifest = JSON.parse(readFileSync(join(t.assets, "manifest.json"), "utf8"));
    expect(manifest.characters).toEqual(["bobo"]);
    expect(manifest.maps).toEqual([{ id: "level", title: "시험", objects: 0 }]);
    expect(manifest.sounds).toEqual(["menu2"]);
    expect(readFileSync(join(t.assets, "font", "gulimche-12.bin"), "utf8")).toBe("new font bytes");
    expect(readFileSync(join(t.assets, "bgm", "tbwait11.wav"), "utf8")).toBe("new music bytes");
    expect(readFileSync(join(t.assets, "spr", "character", "bobo.png"), "utf8")).toBe("new portrait bytes");
    expect(readFileSync(join(t.assets, "guild.dat"), "utf8")).toBe("guild list");
    expect(existsSync(join(t.assets, "old.png"))).toBe(false);
    expect(readdirSync(t.game).sort()).toEqual(["public", "scripts"]);
    expect(run.stdout).toContain(t.assets);
  });

  it.each([false, true])("preserves the previous assets if publication fails with restore failure=%s", (restoreFails) => {
    const t = fixture();
    const preload = join(t.game, "scripts", "publish-error.mjs");
    // Fail only the final filesystem rename, after every source asset has been copied.
    writeFileSync(preload, `
      import fs from "node:fs";
      import { syncBuiltinESMExports } from "node:module";
      const rename = fs.renameSync, destination = ${JSON.stringify(t.assets)};
      let blocked = false;
      fs.renameSync = (from, to) => {
        if (to === destination && (${restoreFails} || !blocked)) {
          blocked = true;
          throw Object.assign(new Error("publication blocked: " + from + " -> " + to), { code: "EACCES" });
        }
        return rename(from, to);
      };
      syncBuiltinESMExports();
    `);
    const run = t.run(["--import", preload]);
    expect(run.status).not.toBe(0);
    expect(run.stderr).toContain("publication blocked");
    const workspaces = readdirSync(t.game).filter((name) => name.startsWith(".assets-sync-"));
    expect(workspaces).toHaveLength(restoreFails ? 1 : 0);
    const previous = restoreFails ? join(t.game, workspaces[0], "previous") : t.assets;
    expect(readFileSync(join(previous, "manifest.json"), "utf8")).toBe(originalManifest);
    expect(readFileSync(join(previous, "old.png"), "utf8")).toBe("previous image bytes");
    expect(readdirSync(previous).sort()).toEqual(["manifest.json", "old.png"]);
    if (restoreFails) expect(run.stderr).toContain(previous);
  });
});
