import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { NETWORK_SPAWNS } from "./constants.ts";
import { layoutFromLevel } from "./level.ts";
import { CellKind } from "./types.ts";

const MAPS_DIR = join(import.meta.dirname, "..", "..", "public", "assets", "maps");

describe.skipIf(!existsSync(MAPS_DIR))("object maps", () => {
  const load = (name: string) => layoutFromLevel(name, JSON.parse(readFileSync(join(MAPS_DIR, `${name}.json`), "utf-8")));

  it("reads the tile flag words and each cell's object", () => {
    const desert02 = load("desert02");
    expect(desert02.tileB[64]).toBe(0x400);
    expect(desert02.tileB[70]).toBe(0x1000);
    expect(desert02.objects).toEqual([
      { cell: 64, sheet: 1, anim: 0, loop: true },
      { cell: 70, sheet: 1, anim: 2, loop: true },
      { cell: 154, sheet: 1, anim: 2, loop: true },
      { cell: 160, sheet: 1, anim: 0, loop: true },
    ]);
    expect(desert02.objectAt[154]).toBe(2);
    expect(desert02.objectAt[0]).toBe(-1);
  });

  it("puts the blast zone on Object_A and the pads' arrows at rest", () => {
    const snow = load("snowearth02");
    expect(snow.objects).toHaveLength(24);
    for (const object of snow.objects) {
      expect(object).toMatchObject({ sheet: 0, anim: 14, loop: true });
      expect(snow.tileA[object.cell]).toBe(0x10000);
    }
    const desert01 = load("desert01");
    expect(desert01.objects.every((o) => o.sheet === 1 && !o.loop && o.anim >= 7 && o.anim <= 10)).toBe(true);
  });
});

describe.skipIf(!existsSync(MAPS_DIR))("exported original maps", () => {
  const maps = existsSync(MAPS_DIR) ? readdirSync(MAPS_DIR).filter((n) => n.endsWith(".json")) : [];

  it.each(maps.filter((name) => name !== "practice.json"))("%s has the eight spawn points of 0x469b8c, all open", (name) => {
    const layout = layoutFromLevel(name, JSON.parse(readFileSync(join(MAPS_DIR, name), "utf-8")));

    expect(layout.spawns).toEqual([...NETWORK_SPAWNS]);
    expect(layout.rollSpawns).toBe(true);
    for (const cell of layout.spawns) expect(layout.kinds[cell]).toBe(CellKind.Empty);
  });
});
