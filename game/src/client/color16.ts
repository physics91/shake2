// The original's screen is a 16-bit DirectDraw surface: 5-6-5 when the card's green mask is 0x7e0
// ([0x493794] = 1, 0x411f40), the common case taken here (I). Every colour on it is cut to 5, 6 and
// 5 bits (0x414ed0: r & 0xf8, g & 0xfc, b >> 3) and shown widened back to 8 by copying the top
// bits down (I: the display's widening), as the extracted .shk and .spr pictures already are.

export const widen5 = (v: number): number => (v << 3) | (v >> 2);
export const widen6 = (v: number): number => (v << 2) | (v >> 4);

/** An 8-bit red or blue channel as the screen holds and shows it. */
export const shown5 = (v: number): number => widen5(v >> 3);
/** An 8-bit green channel as the screen holds and shows it. */
export const shown6 = (v: number): number => widen6(v >> 2);

export function parseColor(color: string): [number, number, number] {
  const hex = color.replace("#", "");
  return [0, 2, 4].map((i) => Number.parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];
}

/** A "#rrggbb" colour as the 16-bit screen shows it. */
export function shownRgb(color: string): [number, number, number] {
  const [r, g, b] = parseColor(color);
  return [shown5(r), shown6(g), shown5(b)];
}

/** Whether two colours are one pixel value on the 16-bit screen. */
export function same16(a: string, b: string): boolean {
  const [ar, ag, ab] = parseColor(a);
  const [br, bg, bb] = parseColor(b);
  return ar >> 3 === br >> 3 && ag >> 2 === bg >> 2 && ab >> 3 === bb >> 3;
}

/** Whether an 8-bit pixel is a value the 16-bit screen can show. */
export function isShown16(r: number, g: number, b: number): boolean {
  return shown5(r) === r && shown6(g) === g && shown5(b) === b;
}

/**
 * The weighted blend (0x413620): each field (dst·w + src·(256 − w)) >> 8 on the cut channels.
 * Colour-keyed source pixels (alpha 0 here, 0xf81f there) are skipped. Both arrays are RGBA and
 * `dst` is written in place; what lies under is cut first, as the screen already held it so.
 */
export function blend565(dst: Uint8ClampedArray, src: Uint8ClampedArray, w: number): void {
  const v = 256 - w;
  for (let i = 0; i < src.length; i += 4) {
    if (src[i + 3] === 0) continue;
    dst[i] = widen5(((dst[i] >> 3) * w + (src[i] >> 3) * v) >> 8);
    dst[i + 1] = widen6(((dst[i + 1] >> 2) * w + (src[i + 1] >> 2) * v) >> 8);
    dst[i + 2] = widen5(((dst[i + 2] >> 3) * w + (src[i + 2] >> 3) * v) >> 8);
  }
}

/**
 * The invisible player's pixel (0x462d38): `((dst | src) >> 1) & (0xf7de >> 1)` on 16-bit 5-6-5
 * colour, i.e. each channel is (dst | src) >> 1. Colour-keyed source pixels are skipped.
 */
export function orHalf(dst: Uint8ClampedArray, src: Uint8ClampedArray): void {
  for (let i = 0; i < src.length; i += 4) {
    if (src[i + 3] === 0) continue;
    dst[i] = widen5(((dst[i] >> 3) | (src[i] >> 3)) >> 1);
    dst[i + 1] = widen6(((dst[i + 1] >> 2) | (src[i + 1] >> 2)) >> 1);
    dst[i + 2] = widen5(((dst[i + 2] >> 3) | (src[i + 2] >> 3)) >> 1);
  }
}
