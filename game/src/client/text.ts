import { cp949Bytes } from "../server/cp949.ts";
import type { BitmapFont } from "./bitmapFont.ts";
import { EDGE, INK, OUTLINE_ROWS, outlineInk } from "./bitmapFont.ts";
import { same16, shownRgb } from "./color16.ts";

export { same16 };

/** 굴림체 is the original's font; other systems fall back to the nearest Korean font. */
export const FONT_12 = '12px GulimChe, "굴림체", Gulim, "굴림", monospace';
export const FONT_13 = '13px GulimChe, "굴림체", Gulim, "굴림", monospace';
export const FONT_14 = '14px GulimChe, "굴림체", Gulim, "굴림", monospace';
/**
 * The original's size 15 (0x418dd0(15)) asks for "Courier New" with HANGEUL_CHARSET, which the
 * Korean font mapper answers with 굴림: the fallback asks for that too.
 */
export const FONT_COURIER_15 = '15px Gulim, "굴림", GulimChe, "굴림체", monospace';
export const YELLOW = "#ffff00";

/** The strike GDI draws each font with (tools/shakefmt/font.py). */
const STRIKE_OF: Record<string, string> = {
  [FONT_12]: "gulimche-12",
  [FONT_13]: "gulimche-13",
  [FONT_14]: "gulimche-14",
  [FONT_COURIER_15]: "gulim-15",
};

const MAX_CACHED = 256;
/** Coverage kept as ink without an outline: 128 loses thin strokes of 13 px Hangul, 64 thickens them. */
const PLAIN_CUT = 96;

interface Drawn {
  image: HTMLCanvasElement;
  /** GetTextExtentPoint's width, which centring and right alignment use. */
  extent: number;
}

const cache = new Map<string, Drawn>();
let strikes: ReadonlyMap<string, BitmapFont> = new Map();

/** Draw with the original's glyphs from now on; text drawn before is drawn again. */
export function installFonts(fonts: ReadonlyMap<string, BitmapFont>): void {
  strikes = fonts;
  cache.clear();
}

function strikeFor(font: string): BitmapFont | undefined {
  const id = STRIKE_OF[font];
  return id === undefined ? undefined : strikes.get(id);
}

/**
 * Text with the 1 px outline of shake.exe's text blit (0x413f70), black unless the caller gives
 * another. The original draws with TextOutA at (1,1) of a colour-keyed work surface (0x413ed9)
 * and copies its rows 0..14 to (x,y) (0x41405c), so the character cell starts at (x+1,y+1).
 */
export function outlinedText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  color: string,
  font: string,
  align: CanvasTextAlign = "left",
  outline = "#000000",
): void {
  const { image, extent } = crispText(text, color, font, outline);
  const left = align === "center" ? x - Math.floor(extent / 2) : align === "right" ? x - extent : x;
  const rows = Math.min(image.height, OUTLINE_ROWS);
  ctx.drawImage(image, 0, 0, image.width, rows, left, y, image.width, rows);
}

/**
 * Text drawn straight with TextOutA and no outline (0x412870). Centred, it starts half its drawn
 * width (GetTextExtentPoint, 0x413250) left of x.
 */
export function plainText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  color: string,
  font: string,
  align: "left" | "center" = "left",
): void {
  const { image, extent } = crispText(text, color, font, null);
  const left = align === "center" ? x - Math.floor(extent / 2) : x;
  ctx.drawImage(image, left - 1, y - 1);
}

/** The longest start of `text` no wider than `width` in `font`, for a name that must stay clear of what follows. */
export function fitText(ctx: CanvasRenderingContext2D, text: string, font: string, width: number): string {
  const chars = [...text];
  const strike = strikeFor(font);
  if (strike && strike.measure(text) !== null) {
    while (chars.length > 0 && strike.measure(chars.join(""))! > width) chars.pop();
    return chars.join("");
  }
  ctx.save();
  ctx.font = font;
  while (chars.length > 0 && ctx.measureText(chars.join("")).width > width) chars.pop();
  ctx.restore();
  return chars.join("");
}

function crispText(text: string, color: string, font: string, outline: string | null): Drawn {
  const key = `${font}\u0000${color}\u0000${outline}\u0000${text}`;
  const cached = cache.get(key);
  if (cached) return cached;
  const strike = strikeFor(font);
  const drawn = (strike && glyphText(strike, text, color, outline)) || browserText(text, color, font, outline);
  if (cache.size >= MAX_CACHED) cache.clear();
  cache.set(key, drawn);
  return drawn;
}

/** The original's glyphs, and its outline pass when there is one. Null when the strike lacks a character. */
function glyphText(strike: BitmapFont, text: string, color: string, outline: string | null): Drawn | null {
  const drawn = strike.draw(text);
  if (!drawn) return null;
  // The pass takes any pixel already in the outline colour for outline, so text in that colour gets none.
  const marks = outline && !same16(color, outline) ? outlineInk(drawn, cp949Bytes(text)) : drawn.ink;
  const canvas = document.createElement("canvas");
  canvas.width = drawn.width;
  canvas.height = drawn.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return { image: canvas, extent: drawn.extent };
  const image = ctx.createImageData(drawn.width, drawn.height);
  // GDI puts SetTextColor's colour on the 16-bit surface cut to 5-6-5, as it does fills and pixels.
  const ink = [...shownRgb(color), 255];
  const edge = outline ? [...shownRgb(outline), 255] : null;
  marks.forEach((mark, i) => {
    if (mark === INK) image.data.set(ink, i * 4);
    else if (mark === EDGE && edge) image.data.set(edge, i * 4);
  });
  ctx.putImageData(image, 0, 0);
  return { image: canvas, extent: drawn.extent };
}

/**
 * Without the extracted font (or for a character it lacks): the browser's font cut at half
 * coverage for the same hard pixels, and an outline on every side.
 */
function browserText(text: string, color: string, font: string, outline: string | null): Drawn {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return { image: canvas, extent: 0 };
  ctx.font = font;
  const size = Number.parseInt(font, 10) || 12;
  canvas.width = Math.max(1, Math.ceil(ctx.measureText(text).width)) + 2;
  canvas.height = size + 6;
  ctx.font = font;
  ctx.textBaseline = "top";
  ctx.fillStyle = "#ffffff";
  ctx.fillText(text, 1, 1);

  const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const { width, height, data } = image;
  const ink = new Uint8Array(width * height);
  const cut = outline ? 128 : PLAIN_CUT;
  for (let i = 0; i < ink.length; i++) ink[i] = data[i * 4 + 3] >= cut ? 1 : 0;
  const [r, g, b] = shownRgb(color);
  const edge = outline ? shownRgb(outline) : null;
  for (let py = 0; py < height; py++) {
    for (let px = 0; px < width; px++) {
      const i = py * width + px;
      const o = i * 4;
      if (ink[i]) {
        data.set([r, g, b, 255], o);
      } else if (edge && touchesInk(ink, width, height, px, py)) {
        data.set([...edge, 255], o);
      } else {
        data[o + 3] = 0;
      }
    }
  }
  ctx.putImageData(image, 0, 0);
  return { image: canvas, extent: width - 2 };
}

function touchesInk(ink: Uint8Array, width: number, height: number, px: number, py: number): boolean {
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const nx = px + dx;
      const ny = py + dy;
      if (nx >= 0 && ny >= 0 && nx < width && ny < height && ink[ny * width + nx]) return true;
    }
  }
  return false;
}
