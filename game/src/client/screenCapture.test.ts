import { afterEach, describe, expect, it, vi } from "vitest";

import { attachCapture, CAPTURE_INTERVAL_MS, captureBmp, captureDue, captureFileName, resetCapture } from "./screenCapture.ts";

afterEach(() => {
  resetCapture();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function queuedCaptures() {
  const events = new EventTarget();
  const frames = new Map<number, FrameRequestCallback>();
  let nextFrame = 0;
  let focused = true;
  const click = vi.fn();
  vi.stubGlobal("window", events);
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    const id = ++nextFrame;
    frames.set(id, callback);
    return id;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
  vi.stubGlobal("setTimeout", () => 0);
  vi.stubGlobal("document", { createElement: () => ({ click }), hasFocus: () => focused });
  vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:capture");
  vi.spyOn(performance, "now").mockReturnValue(10_000);
  const canvas = {
    width: 1,
    height: 1,
    getContext: () => ({ getImageData: () => ({ data: new Uint8ClampedArray([255, 255, 255, 255]) }) }),
  } as unknown as HTMLCanvasElement;
  const source = vi.fn(() => canvas);
  return {
    canvas,
    source,
    click,
    press() {
      events.dispatchEvent(Object.assign(new Event("keydown", { cancelable: true }), { code: "F12", keyCode: 123 }));
    },
    focus(value: boolean) {
      focused = value;
      events.dispatchEvent(new Event(value ? "focus" : "blur"));
    },
    draw() {
      for (const [id, callback] of [...frames]) {
        frames.delete(id);
        callback(10_016);
      }
    },
  };
}

describe("F12 screen capture (0x4602b3 → [0x48c2b8] → 0x413300)", () => {
  it("names the file month, day, hour, minute and second, two digits each (0x46b028)", () => {
    expect(captureFileName(new Date(2026, 8, 28, 7, 5, 9))).toBe("0928070509.bmp");
    expect(captureFileName(new Date(2002, 11, 3, 23, 59, 0))).toBe("1203235900.bmp");
  });

  it("takes F12 at most once in 3 s ([0x497f28], 0x4602c5)", () => {
    expect(CAPTURE_INTERVAL_MS).toBe(3000);
    expect(captureDue(1000, Number.NEGATIVE_INFINITY)).toBe(true);
    expect(captureDue(3999, 1000)).toBe(false);
    expect(captureDue(4000, 1000)).toBe(true);
  });

  it("lets a new program take its first F12 at once", () => {
    const keys: ((event: unknown) => void)[] = [];
    const frames: unknown[] = [];
    vi.stubGlobal("window", { addEventListener: (_: string, f: (event: unknown) => void) => keys.push(f), removeEventListener() {} });
    vi.stubGlobal("requestAnimationFrame", (f: unknown) => frames.push(f));
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    vi.spyOn(performance, "now").mockReturnValue(10_000);
    const detach = attachCapture({} as HTMLCanvasElement);
    const f12 = () => keys[0]({ code: "F12", preventDefault() {} });
    f12();
    f12();
    expect(frames).toHaveLength(1);
    resetCapture();
    f12();
    expect(frames).toHaveLength(2);
    detach();
  });

  it("does not download a queued capture after the program exits and starts over", () => {
    const capture = queuedCaptures();
    const detach = attachCapture(capture.canvas, undefined, capture.source);
    capture.press();
    resetCapture();
    detach();
    capture.draw();
    expect(capture.source).not.toHaveBeenCalled();
    expect(capture.click).not.toHaveBeenCalled();
  });

  it("saves only the new program when its first F12 comes before the old queued frame", () => {
    const capture = queuedCaptures();
    const detach = attachCapture(capture.canvas, undefined, capture.source);
    capture.press();
    resetCapture();
    detach();
    const nextSource = vi.fn(() => capture.canvas);
    const detachNext = attachCapture(capture.canvas, undefined, nextSource);
    capture.press();
    capture.draw();
    expect(capture.source).not.toHaveBeenCalled();
    expect(nextSource).toHaveBeenCalledOnce();
    expect(capture.click).toHaveBeenCalledOnce();
    detachNext();
  });

  it("saves the replacement scene after its first drawing, when F12 preceded the transition", () => {
    const capture = queuedCaptures();
    const detachOld = attachCapture(capture.canvas, undefined, capture.source);
    capture.press();
    detachOld();
    const currentSource = vi.fn(() => capture.canvas);
    const detachCurrent = attachCapture(capture.canvas, undefined, currentSource);
    try {
      capture.draw();
      expect(capture.source).not.toHaveBeenCalled();
      expect(currentSource).not.toHaveBeenCalled();
      capture.draw();
      expect(currentSource).toHaveBeenCalledOnce();
      expect(capture.click).toHaveBeenCalledOnce();
    } finally { detachCurrent(); }
  });

  it("keeps a capture pending while the next scene has no drawing source yet", () => {
    const capture = queuedCaptures();
    const detachOld = attachCapture(capture.canvas, undefined, capture.source);
    capture.press();
    detachOld();
    capture.draw();
    const currentSource = vi.fn(() => capture.canvas);
    const detachCurrent = attachCapture(capture.canvas, undefined, currentSource);
    try {
      capture.draw();
      capture.draw();
      expect(capture.source).not.toHaveBeenCalled();
      expect(currentSource).toHaveBeenCalledOnce();
      expect(capture.click).toHaveBeenCalledOnce();
    } finally { detachCurrent(); }
  });

  it("keeps the current capture source when an older scene detaches later", () => {
    const capture = queuedCaptures();
    const detachOld = attachCapture(capture.canvas, undefined, capture.source);
    const currentSource = vi.fn(() => capture.canvas);
    const detachCurrent = attachCapture(capture.canvas, undefined, currentSource);
    capture.press();
    detachOld();
    try {
      capture.draw();
      expect(capture.source).not.toHaveBeenCalled();
      expect(currentSource).toHaveBeenCalledOnce();
      expect(capture.click).toHaveBeenCalledOnce();
    } finally { detachCurrent(); }
  });

  it("coalesces F12 requests into one capture before the next drawing", () => {
    const capture = queuedCaptures();
    const detach = attachCapture(capture.canvas, undefined, capture.source);
    try {
      capture.press();
      vi.spyOn(performance, "now").mockReturnValue(13_000);
      capture.press();
      capture.draw();
      expect(capture.source).toHaveBeenCalledOnce();
      expect(capture.click).toHaveBeenCalledOnce();
    } finally { detach(); }
  });

  it("reads the current scene's composition on its next frame", () => {
    const capture = queuedCaptures();
    const composition = { ...capture.canvas } as HTMLCanvasElement;
    const source = vi.fn(() => composition);
    const detach = attachCapture(capture.canvas, undefined, source);
    try {
      capture.press();
      expect(source).not.toHaveBeenCalled();
      capture.draw();
      expect(source).toHaveBeenCalledOnce();
      expect(capture.click).toHaveBeenCalledOnce();
    } finally { detach(); }
  });

  it("writes the original's 24-bit headers, the file size field 2 bytes over (0x413329-0x4133a1)", () => {
    const bmp = captureBmp(new Uint8ClampedArray(800 * 600 * 4), 800, 600);
    const view = new DataView(bmp.buffer);
    expect(bmp.length).toBe(14 + 40 + 1_440_000);
    expect(String.fromCharCode(bmp[0], bmp[1])).toBe("BM");
    expect(view.getUint32(2, true)).toBe(0x15f938);
    expect(view.getUint32(10, true)).toBe(0x36);
    expect(view.getUint32(14, true)).toBe(40);
    expect(view.getInt32(18, true)).toBe(800);
    expect(view.getInt32(22, true)).toBe(600);
    expect(view.getUint16(26, true)).toBe(1);
    expect(view.getUint16(28, true)).toBe(24);
    expect(view.getUint32(34, true)).toBe(0x15f900);
  });

  it("stores the rows from the bottom up and each 5-6-5 pixel as B, G, R the original's way (0x413466)", () => {
    const rgba = new Uint8ClampedArray(800 * 600 * 4);
    const put = (x: number, y: number, r: number, g: number, b: number) => rgba.set([r, g, b, 255], (y * 800 + x) * 4);
    // 5-6-5 fields widened by bit copying, as the canvas holds them.
    put(0, 599, 0xff, 0xff, 0xff);
    put(1, 599, 0x84, 0x28, 0x10); // r5 16, g6 10, b5 2
    put(0, 0, 0x08, 0x04, 0x08); // r5 1, g6 1, b5 1
    const bmp = captureBmp(rgba, 800, 600);
    const at = (x: number, row: number) => Array.from(bmp.subarray(54 + (row * 800 + x) * 3, 54 + (row * 800 + x) * 3 + 3));
    // B = b5 << 3; G = the top 5 green bits << 3; R = the pixel's high byte, so green's top 3 bits leak into red.
    expect(at(0, 0)).toEqual([0xf8, 0xf8, 0xff]);
    expect(at(1, 0)).toEqual([0x10, 0x28, 0x81]);
    expect(at(0, 599)).toEqual([0x08, 0x00, 0x08]);
  });
});

describe("F12 while the window is inactive", () => {
  it("waits for focus before reading a requested frame", () => {
    const capture = queuedCaptures();
    const detach = attachCapture(capture.canvas, undefined, capture.source);
    try {
      capture.press();
      capture.focus(false);
      capture.draw();
      capture.draw();
      expect(capture.source).not.toHaveBeenCalled();
      capture.focus(true);
      capture.draw();
      expect(capture.source).toHaveBeenCalledOnce();
      expect(capture.click).toHaveBeenCalledOnce();
    } finally { detach(); }
  });

  it("keeps the request when focus is lost again before the resumed frame", () => {
    const capture = queuedCaptures();
    const detach = attachCapture(capture.canvas, undefined, capture.source);
    try {
      capture.press();
      capture.focus(false);
      capture.draw();
      capture.focus(true);
      capture.focus(false);
      capture.draw();
      expect(capture.click).not.toHaveBeenCalled();
      capture.focus(true);
      capture.draw();
      expect(capture.click).toHaveBeenCalledOnce();
    } finally { detach(); }
  });

  it("reads the current scene when it replaces the inactive one", () => {
    const capture = queuedCaptures();
    const detachOld = attachCapture(capture.canvas, undefined, capture.source);
    capture.press();
    capture.focus(false);
    capture.draw();
    const currentSource = vi.fn(() => capture.canvas);
    const detachCurrent = attachCapture(capture.canvas, undefined, currentSource);
    detachOld();
    try {
      capture.draw();
      expect(capture.click).not.toHaveBeenCalled();
      capture.focus(true);
      capture.draw();
      capture.draw();
      expect(capture.source).not.toHaveBeenCalled();
      expect(currentSource).toHaveBeenCalledOnce();
      expect(capture.click).toHaveBeenCalledOnce();
    } finally { detachCurrent(); }
  });

  it("drops a pending inactive request when the program starts over", () => {
    const capture = queuedCaptures();
    const detach = attachCapture(capture.canvas, undefined, capture.source);
    try {
      capture.press();
      capture.focus(false);
      capture.draw();
      resetCapture();
      capture.focus(true);
      capture.draw();
      expect(capture.click).not.toHaveBeenCalled();
    } finally { detach(); }
  });
});

describe("F12 while the scene has no composition yet", () => {
  it("waits for a composed surface while keeping one pending request", () => {
    const capture = queuedCaptures();
    let ready = false;
    const source = vi.fn(() => ready ? capture.canvas : null);
    const detach = attachCapture(capture.canvas, undefined, source);
    try {
      capture.press();
      capture.draw();
      capture.draw();
      expect(capture.click).not.toHaveBeenCalled();
      ready = true;
      capture.draw();
      expect(capture.click).toHaveBeenCalledOnce();
    } finally { detach(); }
  });

  it("cancels a request whose surface is still unavailable on program reset", () => {
    const capture = queuedCaptures();
    let ready = false;
    const detach = attachCapture(capture.canvas, undefined, () => ready ? capture.canvas : null);
    try {
      capture.press();
      capture.draw();
      resetCapture();
      ready = true;
      capture.draw();
      expect(capture.click).not.toHaveBeenCalled();
    } finally { detach(); }
  });
});
