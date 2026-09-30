// The tint (tint.ts) on the page's pictures: a character sheet turned as the original reads it
// (path a, 0x462140), and the 70 × 70 work surfaces Wg_char's faces and heads are turned into
// (path b, 0x414760; seven of them at [0x492b58], 0..5 the room's slots, 6 the my-info popup and scene 5).
import type { Rect } from "../assets/types.ts";
import type { Sheet } from "./assets.ts";
import { loadImage, loadSheet } from "./assets.ts";
import { clampHue, tintSprPixels, tintWgPixels } from "./tint.ts";

/** Turned sheets kept, the least recently asked for dropped first: a held slider asks for one a frame. */
const KEPT_SHEETS = 48;
const turned = new Map<string, Promise<Sheet>>();

/**
 * A `.spr` sheet under assets/spr/`dir` turned by `hue` (0x414d50 clamps it to ±180). Hue 0 is the
 * plain sheet, as the original skips the turn. The turn needs the file's 8-bit colours
 * (`<name>.rgb.png`, written by the exporter); without them the plain sheet is used.
 */
export function loadTintedSheet(dir: "character" | "w_character", name: string, hue: number): Promise<Sheet> {
  const turn = clampHue(hue);
  if (turn === 0) return loadSheet(dir, name);
  const key = `${dir}/${name}@${turn}`;
  let pending = turned.get(key);
  if (pending) {
    turned.delete(key);
  } else {
    pending = turnSheet(dir, name, turn);
    if (turned.size >= KEPT_SHEETS) turned.delete(turned.keys().next().value as string);
  }
  turned.set(key, pending);
  return pending;
}

async function turnSheet(dir: string, name: string, hue: number): Promise<Sheet> {
  const plain = await loadSheet(dir, name);
  let raw: HTMLImageElement;
  try {
    raw = await loadImage(`spr/${dir}/${plain.meta.sheet.replace(/\.png$/i, ".rgb.png")}`);
  } catch {
    return plain;
  }
  const { width, height } = raw;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return plain;
  ctx.drawImage(raw, 0, 0);
  const pixels = tintSprPixels(ctx.getImageData(0, 0, width, height).data, width, hue);
  ctx.putImageData(new ImageData(pixels, width, height), 0, 0);
  return { image: canvas, meta: plain.meta };
}

/** Each work surface is 70 × 70 (0x41216f–0x4121bd). */
const WORK_SIZE = 70;

/**
 * One work surface: 0x4148b0 turns a rect of Wg_char into its top-left, and the draw (0x414160)
 * copies that part keyed. It keeps what it last held until turned again.
 */
export class WorkSurface {
  private readonly canvas = document.createElement("canvas");
  private width = 0;
  private height = 0;

  constructor() {
    this.canvas.width = WORK_SIZE;
    this.canvas.height = WORK_SIZE;
  }

  /** 0x4148b0: `rect` of `image` turned by `hue` (hue 0 too: the round trip is not the identity). */
  recolour(image: CanvasImageSource, [left, top, right, bottom]: Rect, hue: number): void {
    const width = Math.min(right - left, WORK_SIZE);
    const height = Math.min(bottom - top, WORK_SIZE);
    const ctx = this.canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx || width <= 0 || height <= 0) return;
    ctx.clearRect(0, 0, WORK_SIZE, WORK_SIZE);
    ctx.drawImage(image, left, top, width, height, 0, 0, width, height);
    const data = ctx.getImageData(0, 0, width, height);
    tintWgPixels(data.data, hue);
    ctx.putImageData(data, 0, 0);
    this.width = width;
    this.height = height;
  }

  /** 0x414160: what the surface holds, from its top-left, at (x, y). */
  draw(ctx: CanvasRenderingContext2D, x: number, y: number): void {
    if (this.width === 0) return;
    ctx.drawImage(this.canvas, 0, 0, this.width, this.height, x, y, this.width, this.height);
  }

  get picture(): HTMLCanvasElement {
    return this.canvas;
  }
}

const surfaces: WorkSurface[] = [];

/** Work surface `index` of the seven ([0x492b58 + 4·index]): 0..5 the room's slots, 6 the popup and scene 5. */
export function workSurface(index: number): WorkSurface {
  surfaces[index] ??= new WorkSurface();
  return surfaces[index];
}
