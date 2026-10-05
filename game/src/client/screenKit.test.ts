import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SheetMeta } from "../assets/types.ts";
import { CursorAnim, Fade, Pointer } from "./screenKit.ts";
import { FRAME_MS } from "./startLayout.ts";

/** A moment inside frame `frame` of a fade that started at `start`. */
const inFrame = (start: number, frame: number) => start + frame * FRAME_MS + 1;

describe("Pointer", () => {
  let canvas: EventTarget;
  let pointer: Pointer;
  const pressed = vi.fn<(x: number, y: number) => void>();
  const released = vi.fn<(x: number, y: number) => void>();
  const rightReleased = vi.fn<(x: number, y: number) => void>();
  let detach: () => void;

  beforeEach(() => {
    vi.stubGlobal("window", new EventTarget());
    canvas = Object.assign(new EventTarget(), {
      getBoundingClientRect: () => ({ left: 10, top: 20, width: 400, height: 300 }),
      setPointerCapture: vi.fn(),
    });
    pointer = new Pointer();
    pressed.mockClear();
    released.mockClear();
    rightReleased.mockClear();
    detach = pointer.attach(canvas as HTMLCanvasElement, { moved() {}, pressed, released, rightReleased });
  });

  afterEach(() => {
    detach();
    vi.unstubAllGlobals();
  });

  function send(type: string, fields: Partial<PointerEvent> = {}) {
    canvas.dispatchEvent(Object.assign(new Event(type), {
      pointerId: 1, isPrimary: true, button: type === "pointermove" ? -1 : 0, buttons: type === "pointerdown" ? 1 : 0,
      clientX: 60, clientY: 120, ...fields,
    }));
  }

  it("shows the cursor on a first touch press without waiting for movement", () => {
    send("pointerdown");
    expect(pointer.mouse).toEqual({ x: 100, y: 200 });
    expect(pointer.inside).toBe(true);
  });

  it("keeps the primary cursor visible when a second finger leaves", () => {
    send("pointermove");
    send("pointerdown");
    send("pointerleave", { pointerId: 2, isPrimary: false });
    expect(pointer.inside).toBe(true);
    expect(pointer.held).toEqual({ x: 100, y: 200 });
  });

  it("keeps a held touch cursor visible when another device's primary pointer leaves", () => {
    send("pointerdown", { pointerType: "touch" });
    send("pointerleave", { pointerId: 2, isPrimary: true, pointerType: "mouse" });
    expect(pointer.inside).toBe(true);
    expect(pointer.held).toEqual({ x: 100, y: 200 });
  });

  it("ignores a remaining secondary finger's movement after the primary finger leaves", () => {
    send("pointerdown");
    send("pointerup");
    send("pointerleave");
    send("pointermove", { pointerId: 2, isPrimary: false, buttons: 1, clientX: 210, clientY: 220 });
    expect(pointer.mouse).toEqual({ x: 100, y: 200 });
    expect(pointer.inside).toBe(false);
  });

  it.each(["pointercancel", "lostpointercapture"])("stops holding on %s without releasing a button", (type) => {
    send("pointerdown");
    expect(pointer.held).toEqual({ x: 100, y: 200 });
    send(type);
    expect(pointer.held).toBeNull();
    send("pointerup");
    expect(released).not.toHaveBeenCalled();
    send("pointerdown");
    send("pointerup");
    expect(released).toHaveBeenCalledExactlyOnceWith(100, 200);
  });

  it("clears a press when the window loses focus without activating its release", () => {
    send("pointermove");
    send("pointerdown");
    window.dispatchEvent(new Event("blur"));
    expect(pointer.held).toBeNull();
    expect(pointer.inside).toBe(false);
    send("pointerup");
    expect(released).not.toHaveBeenCalled();
  });

  it("keeps a captured drag across pointerleave and releases at the final position", () => {
    send("pointerdown");
    send("pointerleave");
    expect(pointer.held).not.toBeNull();
    send("pointerup", { clientX: 420, clientY: 330 });
    expect(released).toHaveBeenCalledExactlyOnceWith(820, 620);
    expect(pointer.held).toBeNull();
  });

  it("keeps another pointer from moving, canceling or releasing the held press", () => {
    send("pointerdown");
    const other = { pointerId: 2, isPrimary: false, clientX: 210, clientY: 220 };
    send("pointermove", { ...other, buttons: 1 });
    send("pointercancel", other);
    send("lostpointercapture", other);
    send("pointerup", other);
    expect(pointer.held).toEqual({ x: 100, y: 200 });
    expect(released).not.toHaveBeenCalled();
    send("pointerup");
    expect(released).toHaveBeenCalledExactlyOnceWith(100, 200);
  });

  it.each([true, false])("keeps a second press from taking over the first pointer's hold with isPrimary=%s", (isPrimary) => {
    send("pointerdown");
    send("pointerdown", { pointerId: 2, isPrimary, clientX: 210, clientY: 220 });
    expect(pointer.held).toEqual({ x: 100, y: 200 });
    send("pointerup");
    expect(released).toHaveBeenCalledExactlyOnceWith(100, 200);
  });

  it("releases the left button while the right button remains down", () => {
    send("pointerdown", { pointerType: "mouse" });
    send("pointermove", { pointerType: "mouse", button: 2, buttons: 3 });
    // Chromium reports intermediate button changes as pointermove, not pointerup.
    send("pointermove", { pointerType: "mouse", button: 0, buttons: 2, clientX: 110, clientY: 170 });
    expect(released).toHaveBeenCalledExactlyOnceWith(200, 300);
    expect(pointer.held).toBeNull();
    expect(pressed).toHaveBeenCalledOnce();
    expect(rightReleased).not.toHaveBeenCalled();
    send("pointerup", { pointerType: "mouse", button: 2 });
    expect(rightReleased).toHaveBeenCalledOnce();
    expect(released).toHaveBeenCalledOnce();
  });

  it("presses, drags and releases the left button while the right button stays down", () => {
    send("pointerdown", { pointerType: "mouse", button: 2, buttons: 2 });
    send("pointermove", { pointerType: "mouse", button: 0, buttons: 3 });
    expect(pressed).toHaveBeenCalledExactlyOnceWith(100, 200);
    expect(pointer.held).toEqual({ x: 100, y: 200 });
    send("pointermove", { pointerType: "mouse", button: -1, buttons: 3, clientX: 110, clientY: 170 });
    expect(pointer.held).toEqual({ x: 200, y: 300 });
    expect(pressed).toHaveBeenCalledOnce();
    send("pointermove", { pointerType: "mouse", button: 0, buttons: 2, clientX: 160, clientY: 220 });
    expect(released).toHaveBeenCalledExactlyOnceWith(300, 400);
    expect(pointer.held).toBeNull();
    send("pointerup", { pointerType: "mouse", button: 2 });
    expect(released).toHaveBeenCalledOnce();
  });

  it("releases the right button once while keeping the left button held", () => {
    send("pointerdown", { pointerType: "mouse" });
    send("pointermove", { pointerType: "mouse", button: 2, buttons: 3 });
    send("pointermove", { pointerType: "mouse", button: 2, buttons: 1 });
    expect(rightReleased).toHaveBeenCalledExactlyOnceWith(100, 200);
    expect(pointer.held).toEqual({ x: 100, y: 200 });
    expect(released).not.toHaveBeenCalled();
    send("pointerup", { pointerType: "mouse" });
    expect(released).toHaveBeenCalledExactlyOnceWith(100, 200);
    expect(rightReleased).toHaveBeenCalledOnce();
  });

  it("does not treat an ordinary held-button move as a new press", () => {
    send("pointermove", { pointerType: "mouse", button: -1, buttons: 3 });
    expect(pointer.held).toBeNull();
    expect(pressed).not.toHaveBeenCalled();
    expect(released).not.toHaveBeenCalled();
    expect(rightReleased).not.toHaveBeenCalled();
  });

  it("keeps another device's mouse button changes from taking a held touch", () => {
    send("pointerdown", { pointerType: "touch" });
    const mouse = { pointerId: 2, isPrimary: true, pointerType: "mouse", clientX: 210, clientY: 220 };
    send("pointermove", { ...mouse, button: 0, buttons: 3 });
    send("pointermove", { ...mouse, button: 2, buttons: 1 });
    send("pointermove", { ...mouse, button: 0, buttons: 2 });
    expect(pointer.held).toEqual({ x: 100, y: 200 });
    expect(pointer.mouse).toEqual({ x: 100, y: 200 });
    expect(pressed).toHaveBeenCalledOnce();
    expect(released).not.toHaveBeenCalled();
    expect(rightReleased).not.toHaveBeenCalled();
  });

  it.each([true, false])("ignores another pointer's right release during a held touch with isPrimary=%s", (isPrimary) => {
    send("pointerdown", { pointerType: "touch" });
    send("pointerup", { pointerId: 2, pointerType: "mouse", isPrimary, button: 2, clientX: 210, clientY: 220 });
    expect(rightReleased).not.toHaveBeenCalled();
    expect(pointer.held).toEqual({ x: 100, y: 200 });
    expect(pointer.mouse).toEqual({ x: 100, y: 200 });
    expect(released).not.toHaveBeenCalled();
  });

  it("ignores a secondary pointer's right release without an active hold", () => {
    send("pointerup", { pointerId: 2, isPrimary: false, button: 2 });
    expect(rightReleased).not.toHaveBeenCalled();
    expect(pointer.held).toBeNull();
  });

  it.each(["pointerup", "pointercancel", "lostpointercapture", "blur"])("allows a fresh mouse right release after a held touch ends with %s", (type) => {
    send("pointerdown", { pointerType: "touch" });
    if (type === "blur") window.dispatchEvent(new Event("blur"));
    else send(type, { pointerType: "touch" });
    send("pointerup", { pointerId: 2, pointerType: "mouse", button: 2, clientX: 210, clientY: 220 });
    expect(rightReleased).toHaveBeenCalledExactlyOnceWith(400, 400);
    expect(pointer.held).toBeNull();
  });

  it.each(["pointercancel", "lostpointercapture", "blur"])("ignores an intermediate left release after %s", (type) => {
    send("pointerdown", { pointerType: "mouse" });
    send("pointermove", { pointerType: "mouse", button: 2, buttons: 3 });
    if (type === "blur") window.dispatchEvent(new Event("blur"));
    else send(type);
    send("pointermove", { pointerType: "mouse", button: 0, buttons: 2 });
    expect(pointer.held).toBeNull();
    expect(released).not.toHaveBeenCalled();
  });
});

describe("Fade", () => {
  it("darkens the frozen frame 10 % a 30 fps frame from its first frame, the 11th black (0x4130f0)", () => {
    const fade = new Fade("out", 500, FRAME_MS);
    expect(fade.darkness(500)).toBe(0.1);
    expect(Array.from({ length: 11 }, (_, i) => fade.darkness(inFrame(500, i)))).toEqual([
      0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1, 1,
    ]);
  });

  it("lightens the new scene from 90 % dark to none", () => {
    const fade = new Fade("in", 0, FRAME_MS);
    expect(Array.from({ length: 11 }, (_, i) => fade.darkness(inFrame(0, i)))).toEqual([
      0.9, 0.8, 0.7, 0.6, 0.5, 0.4, 0.3, 0.2, 0.1, 0, 0,
    ]);
  });

  it("finishes the 11th drawn frame each way (indices 0 through 10)", () => {
    const out = new Fade("out", 0, FRAME_MS);
    expect(out.done(inFrame(0, 9))).toBe(false);
    expect(out.done(10 * FRAME_MS)).toBe(true);
    const into = new Fade("in", 11 * FRAME_MS, FRAME_MS);
    expect(into.darkness(11 * FRAME_MS)).toBe(0.9);
    expect(into.done(inFrame(11 * FRAME_MS, 9))).toBe(false);
    expect(into.done(21 * FRAME_MS)).toBe(true);
  });

  it("starts fade-in when its first frame is drawn, even if that frame arrived late", () => {
    const fade = new Fade("in", 500, FRAME_MS);
    expect(fade.darkness(1500)).toBe(0.9);
    expect(fade.done(1500)).toBe(false);
    expect(fade.darkness(1500 + FRAME_MS)).toBe(0.8);
    expect(fade.done(1500 + 10 * FRAME_MS)).toBe(true);
  });

  it.each([0, 1000 / 30, 1_000_000_000])("keeps exact frame boundaries at clock origin %i", (start) => {
    const fade = new Fade("out", start, FRAME_MS);
    for (let n = 0; n <= 10; n++) {
      expect(fade.frame(start + n * FRAME_MS)).toBe(n);
      expect(fade.done(start + n * FRAME_MS)).toBe(n === 10);
    }
  });

  it.each([32, 38])("keeps boundaries when a chained fade starts at global tick %i", (startTick) => {
    const start = 1000 + startTick * 1000 / 30;
    const fade = new Fade("out", start, FRAME_MS);
    for (let n = 0; n <= 10; n++) {
      expect(fade.frame(1000 + (startTick + n) * 1000 / 30)).toBe(n);
      if (n > 0) expect(fade.frame(1000 + (startTick + n) * 1000 / 30 - 0.01)).toBe(n - 1);
    }
  });

  it("counts a clock read before the start as the first frame", () => {
    expect(new Fade("out", 1000, FRAME_MS).darkness(990)).toBe(0.1);
  });
});

/** cursor.spr's shape: anims 0 and 1 of 4 frames at 5 fps (a frame is due after 200 ms). */
const CURSOR_META = {
  animations: [0, 1].map(() => ({ name: "", unknown_u16: 5, frames: Array.from({ length: 4 }, () => ({ rect: [0, 0, 1, 1] })) })),
} as unknown as SheetMeta;

describe("CursorAnim", () => {
  it("restarts the frames on busy but keeps the frame clock (0x43f0b0 → 0x461ff0; +0x154 kept)", () => {
    const cursor = new CursorAnim();
    expect(cursor.advance(0, CURSOR_META)).toEqual({ anim: 0, frame: 1 });
    expect(cursor.advance(150, CURSOR_META)).toEqual({ anim: 0, frame: 1 });
    cursor.set(true);
    expect(cursor.advance(150, CURSOR_META)).toEqual({ anim: 1, frame: 0 });
    // Due 200 ms after the pointer's last frame, not after the switch.
    expect(cursor.advance(201, CURSOR_META)).toEqual({ anim: 1, frame: 1 });
  });

  it("restarts the pointer's frames when told it is not busy while it already is not", () => {
    const cursor = new CursorAnim();
    cursor.advance(0, CURSOR_META);
    expect(cursor.advance(201, CURSOR_META)).toEqual({ anim: 0, frame: 2 });
    cursor.set(false);
    expect(cursor.advance(202, CURSOR_META)).toEqual({ anim: 0, frame: 0 });
  });
});
