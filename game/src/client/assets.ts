import type { AnimationMeta, LevelMeta, Manifest, SheetMeta } from "../assets/types.ts";
import { BitmapFont } from "./bitmapFont.ts";

const BASE = `${import.meta.env.BASE_URL}assets/`;

export interface Sheet {
  image: HTMLImageElement;
  meta: SheetMeta;
}

const imageCache = new Map<string, Promise<HTMLImageElement>>();
const jsonCache = new Map<string, Promise<unknown>>();

export function loadImage(path: string): Promise<HTMLImageElement> {
  let pending = imageCache.get(path);
  if (!pending) {
    pending = new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error(`failed to load ${path}`));
      image.src = BASE + path;
    });
    imageCache.set(path, pending);
  }
  return pending;
}

export function loadJson<T>(path: string): Promise<T> {
  let pending = jsonCache.get(path);
  if (!pending) {
    pending = fetch(BASE + path).then((response) => {
      if (!response.ok) throw new Error(`failed to load ${path}: ${response.status}`);
      return response.json();
    });
    jsonCache.set(path, pending);
  }
  return pending as Promise<T>;
}

/** A text file in the original's code page, cp949 (which the Encoding Standard names euc-kr). */
export async function loadCp949(path: string): Promise<string> {
  const response = await fetch(BASE + path);
  if (!response.ok) throw new Error(`failed to load ${path}: ${response.status}`);
  return new TextDecoder("euc-kr").decode(await response.arrayBuffer());
}

export function loadManifest(): Promise<Manifest> {
  return loadJson<Manifest>("manifest.json");
}

/** The synced bitmap strikes by id; empty when the font was not extracted. */
export async function loadFonts(manifest: Manifest): Promise<Map<string, BitmapFont>> {
  const strikes = await Promise.all(
    (manifest.fonts ?? []).map(async (meta) => {
      const response = await fetch(`${BASE}font/${meta.file}`);
      if (!response.ok) throw new Error(`failed to load font/${meta.file}: ${response.status}`);
      return [meta.id, BitmapFont.parse(await response.arrayBuffer(), meta.ascent, meta.descent)] as const;
    }),
  );
  return new Map(strikes);
}

/** `dir` is a folder under assets/spr (character, bomb, brick, item, object, w_character, misc). */
export async function loadSheet(dir: string, name: string): Promise<Sheet> {
  const meta = await loadJson<SheetMeta>(`spr/${dir}/${name}.json`);
  const image = await loadImage(`spr/${dir}/${meta.sheet}`);
  return { image, meta };
}

/** A sheet exported from image/ rather than spr_data/, such as cursor.spr. */
export async function loadImageSheet(name: string): Promise<Sheet> {
  const meta = await loadJson<SheetMeta>(`image/${name}.json`);
  const image = await loadImage(`image/${meta.sheet}`);
  return { image, meta };
}

export interface LevelAssets {
  id: string;
  meta: LevelMeta;
  background: HTMLImageElement;
  bricks: Sheet[];
}

export async function loadLevel(id: string): Promise<LevelAssets> {
  const meta = await loadJson<LevelMeta>(`maps/${id}.json`);
  const [background, bricks] = await Promise.all([
    loadImage(`maps/${meta.background_image}`),
    Promise.all(meta.sprites.map((file) => loadSheet("brick", file.replace(/\.spr$/i, "")))),
  ]);
  return { id, meta, background, bricks };
}

export function findAnimation(sheet: Sheet, name: string, fallbackIndex: number): AnimationMeta {
  return sheet.meta.animations.find((a) => a.name === name) ?? sheet.meta.animations[fallbackIndex];
}
