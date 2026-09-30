import { crc32 } from "node:zlib";

import { describe, expect, it } from "vitest";

import { clampHue, hsvToRgb, rgbToHsv, tint565, tintRgb, tintSprPixels, tintWgPixels, WG_KEY } from "./tint.ts";

/** Path (b) over every 5-6-5 value, u16 little-endian, the key kept as 0x4148b0 keeps it. */
function table565(hue: number): string {
  const out = Buffer.alloc(65536 * 2);
  for (let p = 0; p < 65536; p++) out.writeUInt16LE(p === WG_KEY ? p : tint565(p, hue), p * 2);
  return crc32(out).toString(16).padStart(8, "0");
}

/** Path (a) over r, g, b in 0, 5, …, 255, three bytes each. */
function grid24(hue: number): string {
  const out: number[] = [];
  for (let r = 0; r < 256; r += 5) for (let g = 0; g < 256; g += 5) for (let b = 0; b < 256; b += 5) out.push(...tintRgb(r, g, b, hue));
  return crc32(Buffer.from(out)).toString(16).padStart(8, "0");
}

describe("the hue turn (0x413b10, 0x4138e0)", () => {
  it("matches the disassembly's model over every 5-6-5 value (path b)", () => {
    const expected: Record<number, string> = {
      [-180]: "157aed4b",
      [-90]: "ad88b89b",
      [-1]: "e70b3fd1",
      0: "7187ab62",
      1: "1d6d653b",
      45: "6b24d5b7",
      90: "c9ccde39",
      180: "157aed4b",
    };
    for (const [hue, crc] of Object.entries(expected)) expect(table565(Number(hue)), `hue ${hue}`).toBe(crc);
  });

  it("matches the model on 8-bit colours (path a)", () => {
    expect(grid24(180)).toBe("60a977ee");
    expect(grid24(-180)).toBe("60a977ee");
    expect(grid24(-1)).toBe("f3ff289d");
    expect(grid24(1)).toBe("e2a8ee70");
    expect(grid24(90)).toBe("23101604");
  });

  it("gives the worked vectors", () => {
    expect(tint565(0x0029, 0)).toBe(0x0009);
    expect(tint565(0xf800, 90)).toBe(0x7fc0);
    expect(tint565(0x07e0, -45)).toBe(0xbfe0);
    expect(tint565(0x001f, 30)).toBe(0x781f);
    expect(tint565(0xfc10, 180)).toBe(0x87df);
    expect(tint565(0x3a6b, -120)).toBe(0x4ac7);
    for (const grey of [0x8410, 0xd69a]) expect(tint565(grey, 77)).toBe(grey);
    expect(tintRgb(255, 0, 255, 90)).toEqual([255, 127, 0]);
    expect(tintRgb(200, 100, 50, -30)).toEqual([200, 50, 75]);
    expect(tintRgb(10, 20, 30, 180)).toEqual([30, 20, 10]);
  });

  it("stores H, S and V as floats and truncates the channels", () => {
    const [h, s, v] = rgbToHsv(200, 100, 50);
    expect(h).toBe(Math.fround(h));
    expect(s).toBe(Math.fround(s));
    expect(v).toBe(Math.fround(200 * Math.fround(1 / 255)));
    expect(hsvToRgb(0, 0, 1)).toEqual([255, 255, 255]);
    expect(hsvToRgb(360, 1, 1)).toEqual([255, 0, 0]);
  });

  it("clamps a hue to ±180", () => {
    expect(clampHue(999)).toBe(180);
    expect(clampHue(-181)).toBe(-180);
    expect(clampHue(12.7)).toBe(12);
  });
});

const pixels = (...rows: [number, number, number, number][][]) => new Uint8ClampedArray(rows.flat(2));

describe("path (b): Wg_char into a work surface (0x4148b0)", () => {
  it("keeps keyed pixels and turns the rest through their 5-6-5 value, even at hue 0", () => {
    const data = pixels([
      [0, 0, 0, 0],
      [0, 4, 0x4a, 255], // 0x0029 widened; hue 0 makes it 0x0009
    ]);
    tintWgPixels(data, 0);
    expect([...data]).toEqual([0, 0, 0, 0, 0, 0, 0x4a, 255]);
    const red = pixels([[255, 0, 0, 255]]);
    tintWgPixels(red, 90);
    // 0xf800 → 0x7fc0: r 15, g 62, b 0, widened.
    expect([...red]).toEqual([123, 251, 0, 255]);
  });
});

describe("path (a): a .spr as it is read (0x414d50, 0x414ed0)", () => {
  it("leaves each row's first colour and hue 0 alone, cuts to 16 bits and keys the top-left", () => {
    // Row 0: key colour, then red. Row 1: red first (its own key), then the sheet key.
    const raw = pixels(
      [
        [1, 2, 3, 255],
        [255, 0, 0, 255],
      ],
      [
        [255, 0, 0, 255],
        [1, 2, 3, 255],
      ],
    );
    const plain = tintSprPixels(raw, 2, 0);
    expect(plain[3]).toBe(0); // top-left keyed
    expect([...plain.slice(4, 8)]).toEqual([255, 0, 0, 255]);
    const turned = tintSprPixels(raw, 2, 90);
    // Red turned by 90° is (127, 255, 0) → 5-6-5 cut and widened.
    expect([...turned.slice(4, 8)]).toEqual([123, 255, 0, 255]);
    // Row 1's red is that row's first pixel: not turned.
    expect([...turned.slice(8, 12)]).toEqual([255, 0, 0, 255]);
    // The sheet key in row 1 is not its row's first colour: it is turned, and a grey stays itself.
    expect(turned[15]).toBe(0);
  });

  it("clamps the hue to ±180", () => {
    const raw = pixels([
      [0, 0, 0, 255],
      [200, 100, 50, 255],
    ]);
    expect([...tintSprPixels(raw, 2, 500)]).toEqual([...tintSprPixels(raw, 2, 180)]);
  });
});
