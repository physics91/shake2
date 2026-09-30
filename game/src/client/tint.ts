// The character tint (색조, −180..180): a hue turn in HSV (0x413b10 → += hue → 0x4138e0), two ways.
// (a) A `.spr` is turned as it is read (0x414d50 → 0x414ed0), from its 8-bit colours before the
//     16-bit cut; pixels equal to their row's first one are left alone, and hue 0 skips the turn.
// (b) A face or head of Wg_char.shk is turned from the 5-6-5 surface into a 70 × 70 work surface
//     (0x414760 → 0x4148b0 → 0x414a40); the key 0x0185 is kept, and hue 0 still makes the round trip.
// The x87 runs at 53-bit precision (_controlfp at 0x465174), so the sums are doubles; what the code
// stores as float goes through Math.fround, and _ftol truncates toward zero.
import { widen5, widen6 } from "./color16.ts";

/** The slider's and the scene-5 buttons' ends; 0x414d50 clamps a `.spr`'s hue to them. */
export const HUE_LIMIT = 180;
/** Wg_char's key (its top-left pixel) and the work surfaces' ([0x492b80]). */
export const WG_KEY = 0x0185;

const ONE_255 = Math.fround(1 / 255); // 0x467084
const ONE_6 = 0.16666666666666666; // 0x467068, a multiply
const ONE_60 = 0.016666666666666666; // 0x467048, a multiply

export function clampHue(hue: number): number {
  return Math.max(-HUE_LIMIT, Math.min(HUE_LIMIT, Math.trunc(hue)));
}

/** 0x413b10: H in degrees, S and V in 0..1, each stored as float. */
export function rgbToHsv(r: number, g: number, b: number): [number, number, number] {
  const mx = Math.max(r, g, b);
  const mn = Math.min(r, g, b);
  const v = mx * ONE_255;
  const s = mx !== 0 ? (mx - mn) / mx : 0;
  let h = 0;
  if (s !== 0) {
    const d = mx - mn;
    const rc = Math.fround((mx - r) / d);
    const gc = Math.fround((mx - g) / d);
    const bc = (mx - b) / d;
    if (r === mx) h = bc - gc;
    else if (g === mx) h = rc + 2 - bc;
    else h = gc + 4 - rc;
    h *= ONE_6;
    if (h < 0) h += 1;
  }
  return [Math.fround(h * 360), Math.fround(s), Math.fround(v)];
}

/** 0x4138e0: each channel _ftol(x · 255), the low byte kept as the callers keep it. */
export function hsvToRgb(h: number, s: number, v: number): [number, number, number] {
  let rgb: [number, number, number];
  if (s === 0) {
    rgb = [v, v, v];
  } else {
    if (h === 360) h = 0;
    else {
      if (h < 0) h += 360;
      if (h > 360) h -= 360;
    }
    const hh = h * ONE_60;
    const i = Math.trunc(hh);
    const f = hh - i;
    const p = (1 - s) * v;
    const q = (1 - f * s) * v;
    const t = (1 - (1 - f) * s) * v;
    const sectors: [number, number, number][] = [
      [v, t, p],
      [q, v, p],
      [p, v, t],
      [p, q, v],
      [t, p, v],
      [v, p, q],
    ];
    rgb = sectors[i] ?? [0, 0, 0];
  }
  return rgb.map((c) => Math.trunc(c * 255) & 0xff) as [number, number, number];
}

/** One 8-bit colour turned by `hue` (the pixel step of 0x414ed0). */
export function tintRgb(r: number, g: number, b: number, hue: number): [number, number, number] {
  const [h, s, v] = rgbToHsv(r, g, b);
  return hsvToRgb(hue + h, s, v);
}

/** One 5-6-5 pixel turned by `hue` (0x414a40): unpacked without widening, packed by masking. */
export function tint565(p: number, hue: number): number {
  const [r, g, b] = tintRgb((p >> 8) & 0xf8, (p >> 3) & 0xfc, (p << 3) & 0xff, hue);
  return (((r & 0xf8) << 8) + ((g & 0xfc) << 3) + (b >> 3)) & 0xffff;
}

/** The 5-6-5 value of a pixel as the extracted pictures widen it. */
function pack565(r: number, g: number, b: number): number {
  return ((r >> 3) << 11) | ((g >> 2) << 5) | (b >> 3);
}

function putWidened(out: Uint8ClampedArray, i: number, p: number): void {
  out[i] = widen5(p >> 11);
  out[i + 1] = widen6((p >> 5) & 0x3f);
  out[i + 2] = widen5(p & 0x1f);
}

/**
 * Path (b), 0x4148b0: RGBA from Wg_char (keyed pixels have alpha 0, the key 0x0185 there) turned
 * in place, each opaque pixel through its 5-6-5 value. Run at hue 0 too: it is not the identity.
 */
export function tintWgPixels(data: Uint8ClampedArray, hue: number): void {
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] === 0) continue;
    const p = tint565(pack565(data[i], data[i + 1], data[i + 2]), hue);
    if (p === WG_KEY) {
      data[i + 3] = 0;
      continue;
    }
    putWidened(data, i, p);
  }
}

/**
 * Path (a), 0x414d50 → 0x414ed0 → 0x412830: a `.spr`'s 8-bit pixels (RGBA, alpha ignored, rows
 * top-down) turned by the clamped hue, cut to 5-6-5 and widened; the surface is keyed on its
 * top-left pixel after the cut, so a turned pixel that lands on the key goes transparent too.
 */
export function tintSprPixels(raw: Uint8ClampedArray, width: number, hue: number): Uint8ClampedArray<ArrayBuffer> {
  const turn = clampHue(hue);
  const out = new Uint8ClampedArray(raw.length);
  const rowBytes = width * 4;
  let key = -1;
  for (let row = 0; row < raw.length; row += rowBytes) {
    const kr = raw[row];
    const kg = raw[row + 1];
    const kb = raw[row + 2];
    for (let i = row; i < row + rowBytes; i += 4) {
      let r = raw[i];
      let g = raw[i + 1];
      let b = raw[i + 2];
      if (turn !== 0 && (r !== kr || g !== kg || b !== kb)) [r, g, b] = tintRgb(r, g, b, turn);
      const p = (((r & 0xf8) << 8) | ((g & 0xfc) << 3) | (b >> 3)) & 0xffff;
      if (key < 0) key = p;
      putWidened(out, i, p);
      out[i + 3] = p === key ? 0 : 255;
    }
  }
  return out;
}
