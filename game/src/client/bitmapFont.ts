// The original's letters: GDI drawing gulim.ttc's embedded 1-bit bitmaps at ppem = the CreateFont
// height (0x418370). tools/shakefmt/font.py extracts the strikes from the local Windows font with
// GDI's advances baked in; this reads them and lays text out as TextOut does.

const MAGIC = [0x53, 0x48, 0x46, 0x31]; // "SHF1"
const RECORD = 7;

/** The text blit (0x413f70) runs its outline over rows 0..14 of the work surface and copies those. */
export const OUTLINE_ROWS = 15;

interface Glyph {
  advance: number;
  left: number;
  top: number;
  width: number;
  height: number;
  /** Where the glyph's width*height ink bits start (MSB first, rows run together). */
  at: number;
}

/** A work surface after TextOut at (1,1): 1 where the text inked. */
export interface TextInk {
  width: number;
  height: number;
  /** GetTextExtentPoint's width: the sum of the advances. */
  extent: number;
  ink: Uint8Array;
}

/** A work surface after the outline pass: 0 colour key, 1 text, 2 outline. */
export const KEY = 0;
export const INK = 1;
export const EDGE = 2;

export class BitmapFont {
  readonly ascent: number;
  readonly descent: number;
  private readonly data: Uint8Array;
  private readonly glyphs: Map<number, Glyph>;

  private constructor(ascent: number, descent: number, data: Uint8Array, glyphs: Map<number, Glyph>) {
    this.ascent = ascent;
    this.descent = descent;
    this.data = data;
    this.glyphs = glyphs;
  }

  /** A strike file of tools/shakefmt/font.py. */
  static parse(buffer: ArrayBuffer, ascent: number, descent: number): BitmapFont {
    const data = new Uint8Array(buffer);
    const view = new DataView(buffer);
    if (data.length < 8 || MAGIC.some((byte, i) => data[i] !== byte)) throw new Error("not a font strike");
    const count = view.getUint32(4, true);
    const glyphs = new Map<number, Glyph>();
    let at = 8;
    for (let i = 0; i < count; i++) {
      if (at + RECORD > data.length) throw new Error("font strike is cut short");
      const glyph: Glyph = {
        advance: view.getUint8(at + 2),
        left: view.getInt8(at + 3),
        top: view.getInt8(at + 4),
        width: view.getUint8(at + 5),
        height: view.getUint8(at + 6),
        at: at + RECORD,
      };
      glyphs.set(view.getUint16(at, true), glyph);
      at = glyph.at + Math.ceil((glyph.width * glyph.height) / 8);
    }
    if (at > data.length) throw new Error("font strike is cut short");
    return new BitmapFont(ascent, descent, data, glyphs);
  }

  /** GetTextExtentPoint's width, or null when the strike lacks a character of `text`. */
  measure(text: string): number | null {
    let extent = 0;
    for (const char of text) {
      const glyph = this.glyphs.get(char.codePointAt(0)!);
      if (!glyph) return null;
      extent += glyph.advance;
    }
    return extent;
  }

  /**
   * TextOut at (1,1) with TA_TOP: the pen starts at x 1, each glyph at its left bearing and its top
   * below the cell top. The surface is the cell height plus a row each side and reaches a pixel past
   * the ink or the extent, whichever is further right. Null when a character is missing.
   */
  draw(text: string): TextInk | null {
    const chars = [...text].map((char) => this.glyphs.get(char.codePointAt(0)!));
    if (chars.some((glyph) => !glyph)) return null;
    const glyphs = chars as Glyph[];
    let pen = 1;
    let right = 0;
    for (const glyph of glyphs) {
      right = Math.max(right, pen + glyph.left + glyph.width);
      pen += glyph.advance;
    }
    const extent = pen - 1;
    const width = Math.max(extent + 2, right + 1);
    const height = this.ascent + this.descent + 2;
    const ink = new Uint8Array(width * height);
    pen = 1;
    for (const glyph of glyphs) {
      for (let r = 0; r < glyph.height; r++) {
        const y = 1 + glyph.top + r;
        if (y < 0 || y >= height) continue;
        for (let c = 0; c < glyph.width; c++) {
          const bit = r * glyph.width + c;
          const x = pen + glyph.left + c;
          if (x >= 0 && x < width && (this.data[glyph.at + (bit >> 3)] >> (7 - (bit & 7))) & 1) ink[y * width + x] = INK;
        }
      }
      pen += glyph.advance;
    }
    return { width, height, extent, ink };
  }
}

/**
 * The text blit's outline (0x414070): in rows 0..14, each text pixel among the first 7·(bytes+3)
 * turns its 8 neighbours that are still colour key into the outline colour. Text further right
 * (a wide 굴림 15 line) or lower (굴림 15's last descent row) gets no outline of its own.
 */
export function outlineInk(text: TextInk, bytes: number): Uint8Array {
  const { width, height, ink } = text;
  const out = Uint8Array.from(ink);
  const span = Math.min(width, 7 * (bytes + 3));
  const rows = Math.min(height, OUTLINE_ROWS);
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < span; x++) {
      if (ink[y * width + x] !== INK) continue;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx >= 0 && ny >= 0 && nx < width && ny < height && out[ny * width + nx] === KEY) out[ny * width + nx] = EDGE;
        }
      }
    }
  }
  return out;
}
