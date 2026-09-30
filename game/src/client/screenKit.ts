// What the lobby (scene 4) and the waiting room (scene 7) draw and track the same way: the mouse
// (actions on release, 0x45a412 and 0x459796), the cursor, the bottom notice, the help balloon,
// the chat caret and the chat log's colours.
import type { Rect } from "../assets/types.ts";
import { animDue } from "../sim/constants.ts";
import type { Sheet } from "./assets.ts";
import { INSTALLED_VERSION, SCREEN_H, SCREEN_W, VERSION_TEXT } from "./hudLayout.ts";
import type { ChatLineClass } from "./roomChat.ts";
import { chatLineClass, shownChat } from "./roomChat.ts";
import type { Point } from "./roomLayout.ts";
import { HELP_BOX, helpBox, NOTICE } from "./roomLayout.ts";
import { blit, drawFrame } from "./sprite.ts";
import { FADE_FRAMES, fadeInDarkness, fadeOutDarkness, FRAME_MS } from "./startLayout.ts";
import { FONT_12, FONT_13, outlinedText, plainText, YELLOW } from "./text.ts";

/** The mouse in screen pixels: over the canvas or not, and where the left button went down. */
export class Pointer {
  mouse: Point = { x: 0, y: 0 };
  inside = false;
  held: Point | null = null;

  /**
   * Tracks the mouse on `canvas`. `released` gets the release point: the original acts there. A
   * press never takes the focus, so the chat line keeps typing (the original never closes it).
   * `rightReleased`, when given, gets the right button's release and the page's menu is kept away.
   */
  attach(
    canvas: HTMLCanvasElement,
    handlers: {
      moved(): void;
      released(x: number, y: number): void;
      /** The left button's press, where it was pressed. */
      pressed?(x: number, y: number): void;
      rightReleased?(x: number, y: number): void;
    },
  ): () => void {
    const toScreen = (event: PointerEvent): Point => {
      const rect = canvas.getBoundingClientRect();
      return {
        x: Math.floor(((event.clientX - rect.left) * SCREEN_W) / rect.width),
        y: Math.floor(((event.clientY - rect.top) * SCREEN_H) / rect.height),
      };
    };
    const onMove = (event: PointerEvent) => {
      this.mouse = toScreen(event);
      this.inside = true;
      if (this.held && (event.buttons & 1) === 0) this.held = null;
      if (this.held) this.held = { ...this.mouse };
      handlers.moved();
    };
    const onLeave = () => {
      this.inside = false;
    };
    const onDown = (event: PointerEvent) => {
      if (event.button !== 0) return;
      this.mouse = toScreen(event);
      this.held = { ...this.mouse };
      canvas.setPointerCapture?.(event.pointerId);
      handlers.pressed?.(this.mouse.x, this.mouse.y);
    };
    const onUp = (event: PointerEvent) => {
      if (event.button === 2 && handlers.rightReleased) {
        const at = toScreen(event);
        handlers.rightReleased(at.x, at.y);
        return;
      }
      if (event.button !== 0 || !this.held) return;
      this.held = null;
      this.mouse = toScreen(event);
      handlers.released(this.mouse.x, this.mouse.y);
    };
    const keepFocus = (event: MouseEvent) => event.preventDefault();
    const noMenu = (event: MouseEvent) => {
      if (handlers.rightReleased) event.preventDefault();
    };
    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerleave", onLeave);
    canvas.addEventListener("pointerdown", onDown);
    canvas.addEventListener("pointerup", onUp);
    canvas.addEventListener("mousedown", keepFocus);
    canvas.addEventListener("contextmenu", noMenu);
    return () => {
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerleave", onLeave);
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointerup", onUp);
      canvas.removeEventListener("mousedown", keepFocus);
      canvas.removeEventListener("contextmenu", noMenu);
    };
  }
}

/**
 * cursor.spr at the mouse, advanced by wall-clock time (0x43f070): anim 0, or anim 1 (the clock,
 * anchored at 17,20) while busy waiting for a reply. Setting either (0x43f0b0 → 0x461ff0) restarts
 * the frames, even when the anim does not change, but keeps the time of the last frame (+0x154).
 */
export class CursorAnim {
  private frame = 0;
  private lastMs = Number.NEGATIVE_INFINITY;
  private anim = 0;

  get busy(): boolean {
    return this.anim === 1;
  }

  set(busy: boolean): void {
    this.setAnim(busy ? 1 : 0);
  }

  private setAnim(anim: number): void {
    this.anim = anim;
    this.frame = 0;
  }

  advance(now: number, meta: Sheet["meta"]): { anim: number; frame: number } {
    const anim = meta.animations[this.anim];
    if (animDue(now, this.lastMs, anim.unknown_u16)) {
      this.frame = (this.frame + 1) % anim.frames.length;
      this.lastMs = now;
    }
    return { anim: this.anim, frame: this.frame };
  }

  /**
   * `busy`, when given, is a screen's own waiting state: a change sets the cursor. `hand` is the
   * link cursor, anim 2 (0x43f0d0), for scene 5's banner.
   */
  draw(ctx: CanvasRenderingContext2D, sheet: Sheet, now: number, at: Point, busy?: boolean, hand = false): void {
    if (busy !== undefined) {
      const anim = busy ? 1 : hand ? 2 : 0;
      if (anim !== this.anim) this.setAnim(anim);
    }
    const { anim, frame } = this.advance(now, sheet.meta);
    drawFrame(ctx, sheet, sheet.meta.animations[anim], frame, at.x, at.y);
  }
}

/** The bottom notice (0x4142d0): white and yellow in turn every 500 ms, for 60 s. */
export class Notice {
  private current: { text: string; since: number } | null = null;

  show(text: string, now: number): void {
    this.current = { text, since: now };
  }

  draw(ctx: CanvasRenderingContext2D, now: number, at: Point): void {
    const notice = this.current;
    if (!notice) return;
    const age = now - notice.since;
    if (age >= NOTICE.showMs) {
      this.current = null;
      return;
    }
    const colour = Math.floor(age / NOTICE.swapMs) % 2 === 0 ? "#ffffff" : YELLOW;
    outlinedText(ctx, notice.text, at.x, at.y, colour, FONT_13);
  }
}

/** The balloon (0x44d5d0): a 565 #6b71d6 box, the text in black then white 1 px down and right. */
export function drawBalloon(ctx: CanvasRenderingContext2D, text: string, x: number, y: number): void {
  const box = helpBox(text, x, y);
  const [left, top, right, bottom] = box.rect;
  ctx.fillStyle = HELP_BOX.fill;
  ctx.fillRect(left, top, right - left, bottom - top);
  plainText(ctx, text, box.dark.x, box.dark.y, "#000000", FONT_12);
  plainText(ctx, text, box.light.x, box.light.y, "#ffffff", FONT_12);
}

/** The editor's caret: 3 px (black, black, white), 14 rows (11 on the login screen, 0x41a5e0). */
export function drawCaret(ctx: CanvasRenderingContext2D, x: number, y: number, rows = 14): void {
  ["#000000", "#000000", "#ffffff"].forEach((colour, i) => {
    ctx.fillStyle = colour;
    ctx.fillRect(x + i, y, 1, rows);
  });
}

/** A copy of what the canvas shows now: the scene a fade-out keeps on screen (0x405e08). */
export function freezeCanvas(source: HTMLCanvasElement): HTMLCanvasElement {
  const copy = document.createElement("canvas");
  copy.width = SCREEN_W;
  copy.height = SCREEN_H;
  copy.getContext("2d")?.drawImage(source, 0, 0);
  return copy;
}

/**
 * A fade between scenes (0x413d10, stepped by 0x4130f0): "out" darkens a frozen picture, "in"
 * lightens the scene drawn under it. The original sets the gamma ramp, orig·(1 − f) toward black
 * (0x413c20); black over the frame with alpha f gives the same colours. `frameMs` is the frame
 * rate the scene runs at: 30 fps, or 10 fps while loading waits on its thread.
 */
export class Fade {
  readonly kind: "out" | "in";
  private readonly start: number;
  private readonly frameMs: number;

  constructor(kind: "out" | "in", start: number, frameMs: number) {
    this.kind = kind;
    this.start = start;
    this.frameMs = frameMs;
  }

  frame(now: number): number {
    return Math.max(0, Math.floor((now - this.start) / this.frameMs));
  }

  done(now: number): boolean {
    return this.frame(now) >= FADE_FRAMES;
  }

  darkness(now: number): number {
    const frame = this.frame(now);
    return this.kind === "out" ? fadeOutDarkness(frame) : fadeInDarkness(frame);
  }
}

export function drawDarkness(ctx: CanvasRenderingContext2D, darkness: number): void {
  if (darkness <= 0) return;
  ctx.save();
  ctx.globalAlpha = Math.min(1, darkness);
  ctx.fillStyle = "#000000";
  ctx.fillRect(0, 0, SCREEN_W, SCREEN_H);
  ctx.restore();
}

/**
 * fade(1) from one screen to the next when each has its own canvas: over the new screen's stage, a
 * veil shows the old screen's frozen picture darkening, then lets the new screen through as the dark
 * lifts. While the stage still shows its loading line the old picture is held, as the original
 * loads a match's world before the fade runs (0x44a424); the line stays readable above it. Without
 * `from` only the fade in plays. The veil takes no clicks: the original handles input while it
 * fades. Returns a stop for a screen that goes away first.
 */
export function fadeOver(stage: HTMLElement, from: HTMLCanvasElement | null): () => void {
  const veil = document.createElement("canvas");
  veil.width = SCREEN_W;
  veil.height = SCREEN_H;
  veil.className = "fade-veil";
  veil.setAttribute("aria-hidden", "true");
  stage.insertBefore(veil, stage.querySelector(".loading"));
  const ctx = veil.getContext("2d");
  let fade: Fade | null = null;
  let frame = 0;
  const step = (now: number) => {
    if (!ctx) return stop();
    ctx.clearRect(0, 0, SCREEN_W, SCREEN_H);
    if (!fade && !stage.querySelector(".loading")) fade = new Fade(from ? "out" : "in", now, FRAME_MS);
    if (!fade || fade.kind === "out") {
      if (from) ctx.drawImage(from, 0, 0);
      else drawDarkness(ctx, 1);
    }
    if (fade) {
      drawDarkness(ctx, fade.darkness(now));
      if (fade.done(now)) {
        if (fade.kind === "in") return stop();
        fade = new Fade("in", now, FRAME_MS);
      }
    }
    frame = requestAnimationFrame(step);
  };
  const stop = () => {
    cancelAnimationFrame(frame);
    veil.remove();
  };
  // The first frame now, before the new screen can show through.
  step(performance.now());
  return stop;
}

/** [fill, outline] of each kind of chat line (0x427810, 0x42d350). */
export const CHAT_COLOURS: Record<ChatLineClass, readonly [string, string]> = {
  system: ["#00ff12", "#002700"],
  own: ["#ffff00", "#311400"],
  police: ["#ffc000", "#311400"],
  normal: ["#ffffff", "#212070"],
};

/** `count` log lines from `first`, `step` px apart, each in its kind's colours. */
export function drawChatLines(
  ctx: CanvasRenderingContext2D,
  log: readonly string[],
  view: { first: number; count: number; x: number; y: number; step: number },
  ownName: string,
): void {
  for (let i = 0; i < view.count; i++) {
    const line = log[view.first + i];
    if (line === undefined) break;
    const [fill, outline] = CHAT_COLOURS[chatLineClass(line, ownName)];
    outlinedText(ctx, shownChat(line), view.x, view.y + view.step * i, fill, FONT_13, "left", outline);
  }
}

/** The chat scroll thumb, blend 1: the brighter of each channel (lighten), at its y - 8. */
export function drawThumb(ctx: CanvasRenderingContext2D, image: CanvasImageSource, src: Rect, x: number, y: number): void {
  ctx.save();
  ctx.globalCompositeOperation = "lighten";
  blit(ctx, image, src, x, y - 8);
  ctx.restore();
}

/**
 * The F1 help screen (0x432f90): shake_help at (0,0), which covers the whole screen, and "ver. %d"
 * at (720,580) in yellow 13 with its outline (0x440490). The number is the registry's version, 23
 * as the 0311 installer writes it (data1.hdr, REG_DWORD). While it shows, the scene is not drawn.
 */
export function drawHelpScreen(ctx: CanvasRenderingContext2D, image: CanvasImageSource): void {
  ctx.drawImage(image, 0, 0);
  outlinedText(ctx, `ver. ${INSTALLED_VERSION}`, VERSION_TEXT.x, VERSION_TEXT.y, YELLOW, FONT_13);
}
