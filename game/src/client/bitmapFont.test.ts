import { describe, expect, it } from "vitest";

import { BitmapFont, EDGE, INK, KEY, outlineInk } from "./bitmapFont.ts";
import { fitText, FONT_12, FONT_13, installFonts, same16 } from "./text.ts";

interface TestGlyph {
  char: string;
  advance: number;
  left: number;
  top: number;
  rows: string[];
}

/** A strike file as tools/shakefmt/font.py writes it. */
function strike(glyphs: TestGlyph[]): ArrayBuffer {
  const bytes: number[] = [0x53, 0x48, 0x46, 0x31, glyphs.length, 0, 0, 0];
  for (const g of glyphs) {
    const width = g.rows[0]?.length ?? 0;
    const code = g.char.codePointAt(0)!;
    bytes.push(code & 0xff, code >> 8, g.advance, g.left & 0xff, g.top & 0xff, width, g.rows.length);
    const bits = g.rows.join("");
    for (let i = 0; i < bits.length; i += 8) {
      let byte = 0;
      for (let k = 0; k < 8; k++) if (bits[i + k] === "#") byte |= 0x80 >> k;
      bytes.push(byte);
    }
  }
  return new Uint8Array(bytes).buffer;
}

function picture(ink: Uint8Array, width: number): string[] {
  const rows: string[] = [];
  for (let at = 0; at < ink.length; at += width) {
    rows.push([...ink.subarray(at, at + width)].map((v) => (v === INK ? "#" : v === EDGE ? "o" : ".")).join(""));
  }
  return rows;
}

// Cell 3 tall (ascent 2, descent 1): "A" 2 wide stepping 3, "가" 3 wide stepping 4 one row down.
const FONT = BitmapFont.parse(
  strike([
    { char: "A", advance: 3, left: 0, top: 0, rows: ["#.", "##"] },
    { char: "가", advance: 4, left: 1, top: 1, rows: ["###", "#.#"] },
    { char: "j", advance: 1, left: -1, top: 0, rows: ["#", "#", "#"] },
  ]),
  2,
  1,
);

describe("bitmap strike (tools/shakefmt/font.py)", () => {
  it("measures the advances as GetTextExtentPoint does", () => {
    expect(FONT.measure("A가A")).toBe(10);
    expect(FONT.measure("")).toBe(0);
  });

  it("gives up on a character the strike lacks", () => {
    expect(FONT.measure("AB")).toBeNull();
    expect(FONT.draw("AB")).toBeNull();
  });

  it("draws as TextOut at (1,1): pen from x 1, glyph tops below the cell top", () => {
    const text = FONT.draw("A가")!;
    expect(text.extent).toBe(7);
    expect([text.width, text.height]).toEqual([9, 5]);
    expect(picture(text.ink, text.width)).toEqual([
      ".........",
      ".#.......",
      ".##..###.",
      ".....#.#.",
      ".........",
    ]);
  });

  it("widens the surface for ink left or right of the advances", () => {
    const text = FONT.draw("j")!;
    expect(text.extent).toBe(1);
    expect(picture(text.ink, text.width)).toEqual(["...", "#..", "#..", "#..", "..."]);
  });

  it("refuses a file that is not a strike or is cut short", () => {
    expect(() => BitmapFont.parse(new Uint8Array([1, 2, 3, 4, 0, 0, 0, 0]).buffer, 2, 1)).toThrow("not a font strike");
    const whole = new Uint8Array(strike([{ char: "A", advance: 3, left: 0, top: 0, rows: ["#.", "##"] }]));
    expect(() => BitmapFont.parse(whole.slice(0, whole.length - 1).buffer, 2, 1)).toThrow("cut short");
  });
});

describe("text blit outline (0x414070)", () => {
  it("rings every text pixel's colour-key neighbours", () => {
    const text = FONT.draw("A")!;
    expect(picture(outlineInk(text, 1), text.width)).toEqual(["ooo..", "o#oo.", "o##o.", "oooo.", "....."]);
  });

  it("outlines only rows 0..14 and the first 7·(bytes+3) pixels", () => {
    const width = 40;
    const height = 18;
    const ink = new Uint8Array(width * height);
    ink[15 * width + 5] = INK; // row 15: copied by nothing, outlined by nothing
    ink[14 * width + 10] = INK; // row 14: outlined, its ring reaching row 15
    ink[3 * width + 27] = INK; // column 27 < 7·(1+3) = 28
    ink[3 * width + 28] = INK; // column 28: past the span
    const out = outlineInk({ width, height, extent: 30, ink }, 1);
    const at = (x: number, y: number) => out[y * width + x];
    expect([at(4, 14), at(5, 14), at(6, 16)]).toEqual([KEY, KEY, KEY]);
    expect([at(9, 13), at(11, 15), at(10, 15)]).toEqual([EDGE, EDGE, EDGE]);
    expect([at(26, 3), at(27, 2)]).toEqual([EDGE, EDGE]);
    // Column 28 has no ring of its own: only column 27's reaches x 28.
    expect([at(28, 2), at(29, 3), at(29, 2)]).toEqual([EDGE, KEY, KEY]);
  });
});

describe("text with an installed strike (text.ts)", () => {
  const noCanvas = {} as CanvasRenderingContext2D;

  it("fits a name by the strike's advances", () => {
    installFonts(new Map([["gulimche-12", FONT]]));
    try {
      expect(fitText(noCanvas, "A가A", FONT_12, 7)).toBe("A가");
      expect(fitText(noCanvas, "A가A", FONT_12, 6)).toBe("A");
      expect(fitText(noCanvas, "A가A", FONT_12, 10)).toBe("A가A");
    } finally {
      installFonts(new Map());
    }
  });

  it("measures with the browser when the strike is not the font's or lacks a character", () => {
    installFonts(new Map([["gulimche-12", FONT]]));
    const measured: string[] = [];
    const ctx = {
      save() {},
      restore() {},
      measureText: (text: string) => (measured.push(text), { width: text.length * 5 }),
    } as unknown as CanvasRenderingContext2D;
    try {
      expect(fitText(ctx, "AB", FONT_12, 5)).toBe("A");
      expect(fitText(ctx, "A가", FONT_13, 100)).toBe("A가");
      expect(measured).toEqual(["AB", "A", "A가"]);
    } finally {
      installFonts(new Map());
    }
  });

  it("compares colours as the 5-6-5 surface holds them", () => {
    expect(same16("#000000", "#070300")).toBe(true);
    expect(same16("#000000", "#080000")).toBe(false);
    expect(same16("#3e60a0", "#3860a0")).toBe(true);
  });
});
