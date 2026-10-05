import { NETWORK_SPAWNS } from "./constants.ts";
import { brickBreak } from "./sheets.ts";
import type { BreakAnim, LevelLayout, MapObject } from "./types.ts";
import { CellKind } from "./types.ts";

/** Practice always loads practice.MAP (0x4708d8); room map lists leave it out (0x438200). */
export const PRACTICE_MAP = "practice";

export function isRoomMap(id: string): boolean {
  return id.toLowerCase() !== PRACTICE_MAP;
}

/** The subset of an exported map JSON (tools/shakefmt/export.py) the simulation needs. */
export interface LevelSource {
  grid: { width: number; height: number; cell_width: number; cell_height: number };
  /** `raw`: each cell's i16[10] as the file stores it (and the game keeps it, 0x411331). */
  cells: { kind: number[][]; raw: number[][] };
  /** Brick sheet files; `bricks[].sprite` indexes this list. */
  sprites: string[];
  bricks: { sprite: number; cell: number }[];
  objects: { cell: number; anim: number; kind_flag: number; unknown_a: number }[];
}

export function layoutFromLevel(id: string, source: LevelSource): LevelLayout {
  const { width, height, cell_width, cell_height } = source.grid;
  const kinds = source.cells.kind.flat().map(toCellKind);
  const breakAnims: (BreakAnim | null)[] = kinds.map(() => null);
  // 0x462560 combines the images but reads animation metadata from the first sheet only.
  const breakAnim = brickBreak(source.sprites[0] ?? "");
  for (const brick of source.bricks) breakAnims[brick.cell] = breakAnim;
  return {
    id,
    width,
    height,
    cellW: cell_width,
    cellH: cell_height,
    kinds,
    breakAnims,
    spawns: [...NETWORK_SPAWNS],
    rollSpawns: true,
    tileA: source.cells.raw.map((raw) => tileWord(raw[4], raw[5])),
    tileB: source.cells.raw.map((raw) => tileWord(raw[6], raw[7])),
    objects: source.objects.map(toMapObject),
    objectAt: source.cells.raw.map((raw) => raw[2]),
  };
}

/** Two of a cell's i16 read as one u32 flag word. */
function tileWord(low: number, high: number): number {
  return ((low & 0xffff) | ((high & 0xffff) << 16)) >>> 0;
}

/** Only the low byte of kind_flag reaches the record's +0xa (0x4111b7). */
function toMapObject(object: LevelSource["objects"][number]): MapObject {
  return { cell: object.cell, sheet: object.unknown_a, anim: object.anim, loop: (object.kind_flag & 0xff) !== 0 };
}

function toCellKind(value: number): CellKind {
  if (value === CellKind.Fixed || value === CellKind.Brick) return value;
  return CellKind.Empty;
}
