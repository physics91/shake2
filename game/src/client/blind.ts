// An apple flame's blindness (+0x264). The frame goes to the composition as usual, but its map
// background only inside a window around the local player (0x406111, 0x408f59), then apple_filter2
// is blended over that window (0x408d97), and the present copies only the window, with its colour
// key, onto apple.shk, which was drawn straight to the back buffer (0x412e20).
import { SCREEN_H, SCREEN_W } from "./hudLayout.ts";

/** apple_filter2.shk: an ellipse, black inside, grey at its edge, colour key around it. */
const FILTER_W = 200;
const FILTER_H = 160;
const KEY = [255, 0, 255] as const;

/**
 * ±100 x ±80 px around the player's point, clipped to the screen (0x406111-0x406142). Clipped on
 * the left or at the top, the filter is read from its right or bottom part (0x414bf0).
 */
export interface BlindWindow {
  left: number;
  top: number;
  width: number;
  height: number;
  sx: number;
  sy: number;
}

export function blindWindow(x: number, y: number): BlindWindow {
  const left = Math.max(0, x - FILTER_W / 2);
  const top = Math.max(0, y - FILTER_H / 2);
  const width = Math.min(SCREEN_W, x + FILTER_W / 2) - left;
  const height = Math.min(SCREEN_H, y + FILTER_H / 2) - top;
  return { left, top, width, height, sx: left === 0 ? FILTER_W - width : 0, sy: top === 0 ? FILTER_H - height : 0 };
}

/**
 * Blend level 1 (0x413620, table 0x404020) is the per-channel maximum: the black middle leaves
 * the frame as it is and the grey edge fogs it. A colour-key pixel of the filter is written as it
 * is (0x413768), so the present lets apple.shk through there.
 */
export function blendBlindFilter(frame: Uint8ClampedArray, filter: Uint8ClampedArray, win: BlindWindow): void {
  for (let y = 0; y < win.height; y++) {
    for (let x = 0; x < win.width; x++) {
      const at = (y * win.width + x) * 4;
      const from = ((win.sy + y) * FILTER_W + win.sx + x) * 4;
      for (let c = 0; c < 3; c++) {
        frame[at + c] = filter[from + 3] === 0 ? KEY[c] : Math.max(frame[at + c], filter[from + c]);
      }
    }
  }
}

/** The present's colour key (DDBLTFAST_SRCCOLORKEY, 0x412f59): key pixels become holes. */
export function punchKey(frame: Uint8ClampedArray): void {
  for (let at = 0; at < frame.length; at += 4) {
    if (frame[at] === KEY[0] && frame[at + 1] === KEY[1] && frame[at + 2] === KEY[2]) frame[at + 3] = 0;
  }
}

let scratch: CanvasRenderingContext2D | null = null;
const filterPixels = new WeakMap<HTMLImageElement, Uint8ClampedArray>();

function scratchContext(): CanvasRenderingContext2D {
  if (!scratch) {
    const canvas = document.createElement("canvas");
    canvas.width = FILTER_W;
    canvas.height = FILTER_H;
    scratch = canvas.getContext("2d", { willReadFrequently: true });
    if (!scratch) throw new Error("2d canvas unavailable");
  }
  return scratch;
}

function pixelsOf(image: HTMLImageElement): Uint8ClampedArray {
  let pixels = filterPixels.get(image);
  if (!pixels) {
    const ctx = scratchContext();
    ctx.clearRect(0, 0, FILTER_W, FILTER_H);
    ctx.drawImage(image, 0, 0);
    pixels = ctx.getImageData(0, 0, FILTER_W, FILTER_H).data;
    filterPixels.set(image, pixels);
  }
  return pixels;
}

/** Run `edit` on the window's pixels and put them back; the scratch canvas keeps the result. */
function editWindow(ctx: CanvasRenderingContext2D, win: BlindWindow, edit: (pixels: Uint8ClampedArray) => void): CanvasRenderingContext2D {
  const work = scratchContext();
  work.clearRect(0, 0, FILTER_W, FILTER_H);
  work.drawImage(ctx.canvas, win.left, win.top, win.width, win.height, 0, 0, win.width, win.height);
  const image = work.getImageData(0, 0, win.width, win.height);
  edit(image.data);
  work.putImageData(image, 0, 0);
  return work;
}

/** The filter pass, in the frame's order after the cursor (0x408dba). */
export function drawBlindFilter(ctx: CanvasRenderingContext2D, filter: HTMLImageElement, win: BlindWindow): void {
  const pixels = pixelsOf(filter);
  const work = editWindow(ctx, win, (frame) => blendBlindFilter(frame, pixels, win));
  ctx.drawImage(work.canvas, 0, 0, win.width, win.height, win.left, win.top, win.width, win.height);
}

/** The present: apple.shk over the whole screen, then the composition's window without its key pixels. */
export function presentBlind(screen: CanvasRenderingContext2D, composition: CanvasRenderingContext2D, apple: HTMLImageElement, win: BlindWindow): void {
  const work = editWindow(composition, win, punchKey);
  screen.drawImage(apple, 0, 0);
  screen.drawImage(work.canvas, 0, 0, win.width, win.height, win.left, win.top, win.width, win.height);
}
