// Shapes of the JSON files written by tools/shakefmt/export.py and scripts/sync-assets.mjs.

export type Rect = [left: number, top: number, right: number, bottom: number];

export interface FrameMeta {
  index: number;
  /** Offset from the frame top-left to the reference point (cell bottom-centre for most sprites). */
  anchor: [number, number];
  rect: Rect;
}

export interface AnimationMeta {
  name: string;
  /** RECONSTRUCTION: interpreted as frames per second. */
  unknown_u16: number;
  frames: FrameMeta[];
}

export interface SheetMeta {
  source: string;
  sheet: string;
  name: string;
  width: number;
  height: number;
  animations: AnimationMeta[];
}

export interface LevelMeta {
  source: string;
  title: string;
  background_image: string;
  preview: string;
  max_players: number;
  sprites: string[];
  object_sheets: string[];
  screen: [number, number];
  area: Rect;
  grid: { width: number; height: number; cell_width: number; cell_height: number };
  fixed: { sprite: number; cell: number }[];
  bricks: { sprite: number; cell: number; unknown_u16: number }[];
  /** `unknown_a` picks the sheet (0 Object_A, 1 Object_B, 2 Object_C); `rect` is where it is drawn. */
  objects: { cell: number; anim: number; rect: Rect; kind_flag: number; unknown_a: number }[];
  cells: { kind: number[][]; raw: number[][] };
}

export interface MusicMeta {
  name: string;
  /** "game" tracks play in rounds; tbwait11 (menus) and tbwait22 (room) are "lobby"/"room". */
  role: string;
  file: string;
  /** Seconds at which the MIDI segment ends and a repeat starts. */
  loopEnd: number;
}

/** A bitmap strike of the local gulim.ttc (tools/shakefmt/font.py), as GDI draws that size. */
export interface FontMeta {
  /** gulimche-12, gulimche-13, gulimche-14 or gulim-15. */
  id: string;
  file: string;
  ppem: number;
  ascent: number;
  descent: number;
}

export interface Manifest {
  characters: string[];
  maps: { id: string; title: string; objects: number }[];
  sounds: string[];
  music: MusicMeta[];
  /** Empty (or absent in an older manifest) when the font was not extracted. */
  fonts?: FontMeta[];
  spriteDirs: string[];
  sheets: Record<string, string[]>;
}
