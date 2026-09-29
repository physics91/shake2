import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  BOMB_FRAMES,
  bombFps,
  BRICK_BREAK,
  BURROW_FPS,
  BURROW_FRAMES,
  DEATH_FRAMES,
  EFFECT_SHEETS,
  JUMP_FPS,
  JUMP_FRAMES,
  KICK_FRAMES,
  kickFps,
  OBJECT_ANIMS,
  STAND_FPS,
  STAND_FRAMES,
  THROW_FPS,
  THROW_FRAMES,
  WALK_FRAMES,
} from "./sheets.ts";

interface SheetAnim {
  unknown_u16: number;
  frames: unknown[];
}

const SPR = fileURLToPath(new URL("../../public/assets/spr/", import.meta.url));

function animations(dir: string, name: string): SheetAnim[] {
  return JSON.parse(readFileSync(`${SPR}${dir}/${name}.json`, "utf8")).animations;
}

// The exported sheets are local copies of the copyrighted originals, so CI without them skips.
describe.skipIf(!existsSync(SPR))("sheet tables match the exported .spr files", () => {
  it("has each character's walk, stand and death animations", () => {
    for (const name of Object.keys(DEATH_FRAMES)) {
      const anims = animations("character", name);
      for (let dir = 0; dir < 4; dir++) {
        expect([name, dir, anims[dir].frames.length]).toEqual([name, dir, WALK_FRAMES]);
        expect([name, dir, anims[4 + dir].frames.length, anims[4 + dir].unknown_u16]).toEqual([
          name,
          dir,
          STAND_FRAMES,
          STAND_FPS[name],
        ]);
      }
      expect([name, anims[20].frames.length, anims[20].unknown_u16]).toEqual([name, DEATH_FRAMES[name], 5]);
      for (let dir = 0; dir < 4; dir++) {
        expect([name, anims[12 + dir].frames.length, anims[12 + dir].unknown_u16]).toEqual([name, KICK_FRAMES, kickFps(name, dir)]);
        expect([name, anims[16 + dir].frames.length, anims[16 + dir].unknown_u16]).toEqual([name, THROW_FRAMES, THROW_FPS]);
      }
    }
  });

  it("has each character's jump, burrow and emerge animations", () => {
    for (const name of Object.keys(DEATH_FRAMES)) {
      const anims = animations("character", name);
      for (let dir = 0; dir < 4; dir++) {
        expect([name, anims[8 + dir].frames.length, anims[8 + dir].unknown_u16]).toEqual([name, JUMP_FRAMES, JUMP_FPS]);
      }
      for (const anim of [21, 22]) {
        expect([name, anim, anims[anim].frames.length, anims[anim].unknown_u16]).toEqual([name, anim, BURROW_FRAMES, BURROW_FPS]);
      }
    }
  });

  it("has the dust and egg effect animations", () => {
    for (const [kind, file] of [["ground", "u_ground"], ["egg", "egg"]] as const) {
      const [anim] = animations("object", file);
      expect([kind, anim.frames.length, anim.unknown_u16]).toEqual([kind, EFFECT_SHEETS[kind].frames, EFFECT_SHEETS[kind].fps]);
    }
  });

  it("has the map object animations", () => {
    ["object_a", "object_b", "object_c"].forEach((file, sheet) => {
      const table = Object.fromEntries(
        animations("object", file).flatMap((anim, i) =>
          anim.frames.length > 0 ? [[i, { frames: anim.frames.length, fps: anim.unknown_u16 }]] : [],
        ),
      );
      expect([file, table]).toEqual([file, OBJECT_ANIMS[sheet]]);
    });
  });

  it("has every bomb colour's twenty bomb animations", () => {
    for (const colour of ["beige", "blue", "green", "pink", "red", "yellow"]) {
      const anims = animations("bomb", `bomb_${colour}`);
      expect(anims).toHaveLength(20);
      anims.forEach((anim, i) => expect([colour, i, anim.frames.length, anim.unknown_u16]).toEqual([colour, i, BOMB_FRAMES, bombFps(i)]));
    }
  });

  it("has each brick sheet's crumble animation", () => {
    for (const [name, anim] of Object.entries(BRICK_BREAK)) {
      const crumble = animations("brick", name)[1];
      expect([name, crumble.frames.length, crumble.unknown_u16]).toEqual([name, anim.frames, anim.fps]);
    }
  });
});
