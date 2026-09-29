import type { AnimationMeta, FrameMeta } from "../assets/types.ts";
import { TICK_RATE } from "../sim/constants.ts";
import type { Sheet } from "./assets.ts";
import { blend565, orHalf } from "./color16.ts";

export { orHalf };

/**
 * Frame of a looping animation `ticks` logic frames after it started, advancing like the
 * original sprite object (0x462080): one frame whenever more than 1000/fps ms have passed.
 */
export function timedFrame(ticks: number, fps: number, frames: number): number {
  if (frames <= 0) return 0;
  const limit = Math.trunc(1000 / Math.max(1, fps));
  let period = 1;
  while (Math.floor((period * 1000) / TICK_RATE) <= limit) period += 1;
  return Math.floor(Math.max(0, ticks) / period) % frames;
}

/** Frame to show `ticks` after an animation started, using the sheet's per-animation rate as fps. */
export function loopingFrame(anim: AnimationMeta, ticks: number): number {
  if (anim.frames.length === 0) return 0;
  const fps = Math.max(1, anim.unknown_u16);
  return Math.floor((ticks * fps) / TICK_RATE) % anim.frames.length;
}

/**
 * Where the original's sprite draw (0x462b90 keyed, 0x4630b0 blended) puts a frame: anchor at
 * (x, y), but a top-left above or left of the screen is moved to 0 without trimming the source,
 * so the whole frame is pushed onto the screen (0x462d92, 0x4630fe). The right and bottom edges
 * are trimmed at the screen, as the canvas does.
 */
export function frameTopLeft(frame: FrameMeta, x: number, y: number): { x: number; y: number } {
  return { x: Math.max(0, x - frame.anchor[0]), y: Math.max(0, y - frame.anchor[1]) };
}

/**
 * The keyed sprite draw (0x462b90) first limits the point: x past 795 becomes 780 and y past 600
 * becomes 600 (0x462b9d-0x462bb6). Only the mouse cursor gets there.
 */
export function keyedPoint(x: number, y: number): { x: number; y: number } {
  return { x: x > 795 ? 780 : x, y: Math.min(y, 600) };
}

/** Draw frame `frameIndex` of `anim` with its anchor placed at (x, y). */
export function drawFrame(
  ctx: CanvasRenderingContext2D,
  sheet: Sheet,
  anim: AnimationMeta,
  frameIndex: number,
  x: number,
  y: number,
): void {
  const frame = anim.frames[frameIndex];
  if (!frame) return;
  const [left, top, right, bottom] = frame.rect;
  const width = right - left;
  const height = bottom - top;
  const point = keyedPoint(x, y);
  const at = frameTopLeft(frame, point.x, point.y);
  ctx.drawImage(sheet.image, left, top, width, height, at.x, at.y, width, height);
}

let scratch: HTMLCanvasElement | null = null;

/**
 * Draw `src` of `image` with its top-left at (x, y) through a pixel mix: read back the screen
 * under it and mix the source in, as the original's blended draws do on the 16-bit surface.
 */
function drawMixed(
  ctx: CanvasRenderingContext2D,
  image: CanvasImageSource,
  [left, top, right, bottom]: readonly [number, number, number, number],
  x: number,
  y: number,
  mix: (dst: Uint8ClampedArray, src: Uint8ClampedArray) => void,
): void {
  // Only the screen part is read and written; the source is cut where the screen is.
  const skipX = Math.max(0, -x);
  const skipY = Math.max(0, -y);
  const width = Math.min(right - left - skipX, ctx.canvas.width - x - skipX);
  const height = Math.min(bottom - top - skipY, ctx.canvas.height - y - skipY);
  if (width <= 0 || height <= 0) return;
  scratch ??= document.createElement("canvas");
  scratch.width = width;
  scratch.height = height;
  const scratchCtx = scratch.getContext("2d", { willReadFrequently: true });
  if (!scratchCtx) return;
  scratchCtx.drawImage(image, left + skipX, top + skipY, width, height, 0, 0, width, height);
  const src = scratchCtx.getImageData(0, 0, width, height);
  const dst = ctx.getImageData(x + skipX, y + skipY, width, height);
  mix(dst.data, src.data);
  ctx.putImageData(dst, x + skipX, y + skipY);
}

/** `drawFrame` through the invisible player's blend (0x462d38). */
export function drawFrameOrHalf(
  ctx: CanvasRenderingContext2D,
  sheet: Sheet,
  anim: AnimationMeta,
  frameIndex: number,
  x: number,
  y: number,
): void {
  const frame = anim.frames[frameIndex];
  if (!frame) return;
  const point = keyedPoint(x, y);
  const at = frameTopLeft(frame, point.x, point.y);
  drawMixed(ctx, sheet.image, frame.rect, at.x, at.y, orHalf);
}

/**
 * The whole of `image` at (x, y) through the weighted blend (0x413620): what lies under keeps
 * w/256 of itself, as shadows (w 100, 0x40914f) and the candy box (w 70, 0x40bc82) are drawn.
 */
export function blitBlended(ctx: CanvasRenderingContext2D, image: HTMLImageElement, x: number, y: number, w: number): void {
  drawMixed(ctx, image, [0, 0, image.width, image.height], x, y, (dst, src) => blend565(dst, src, w));
}

/** Copy `src` of `image` 1:1 with its top-left at (x, y). */
export function blit(
  ctx: CanvasRenderingContext2D,
  image: CanvasImageSource,
  [left, top, right, bottom]: readonly [number, number, number, number],
  x: number,
  y: number,
): void {
  ctx.drawImage(image, left, top, right - left, bottom - top, x, y, right - left, bottom - top);
}

/** Draw a frame scaled to fit a box, ignoring its anchor (portraits, UI). */
export function drawFrameFitted(
  ctx: CanvasRenderingContext2D,
  sheet: Sheet,
  anim: AnimationMeta,
  frameIndex: number,
  box: { x: number; y: number; width: number; height: number },
): void {
  const frame = anim.frames[frameIndex];
  if (!frame) return;
  const [left, top, right, bottom] = frame.rect;
  const width = right - left;
  const height = bottom - top;
  const scale = Math.min(box.width / width, box.height / height);
  const drawW = width * scale;
  const drawH = height * scale;
  ctx.drawImage(
    sheet.image,
    left,
    top,
    width,
    height,
    box.x + (box.width - drawW) / 2,
    box.y + (box.height - drawH) / 2,
    drawW,
    drawH,
  );
}
