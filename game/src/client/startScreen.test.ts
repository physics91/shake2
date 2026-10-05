import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { resetCapture } from "./screenCapture.ts";
import { newSlide } from "./startLayout.ts";
import { StartScreen, type StartScreenOptions } from "./startScreen.ts";
import { freezeCanvas } from "./screenKit.ts";
import { FRAME_MS } from "./startLayout.ts";

vi.mock("./chatLine.ts", () => ({ ChatLine: class {
  element = new TestElement();
  dispose() {}
} }));
vi.mock("./statusScreen.ts", () => ({ StatusPage: class { dispose() {} } }));
vi.mock("./signUpWindow.ts", () => ({ SignUpWindow: class { dispose() {} } }));

class TestElement extends EventTarget {
  className = "";
  textContent = "";
  setAttribute() {}
  append() {}
  remove() {}
  click() {}
}

type Colour = [number, number, number];
class TestContext {
  readonly canvas: TestCanvas;
  pixel: Colour = [0, 0, 0];
  fillStyle = "#000000";
  globalAlpha = 1;
  imageSmoothingEnabled = false;
  private readonly saved: { alpha: number; fill: string }[] = [];

  constructor(canvas: TestCanvas) { this.canvas = canvas; }
  drawImage(source: TestCanvas | { colour: Colour }) {
    this.pixel = [...("colour" in source ? source.colour : source.context.pixel)];
  }
  save() { this.saved.push({ alpha: this.globalAlpha, fill: this.fillStyle }); }
  restore() {
    const saved = this.saved.pop()!;
    this.globalAlpha = saved.alpha;
    this.fillStyle = saved.fill;
  }
  fillRect() {
    const colour = [1, 3, 5].map((at) => Number.parseInt(this.fillStyle.slice(at, at + 2), 16));
    this.pixel = this.pixel.map((value, i) => Math.round(value * (1 - this.globalAlpha) + colour[i] * this.globalAlpha)) as Colour;
  }
  getImageData(_x: number, _y: number, width: number, height: number) {
    const data = new Uint8ClampedArray(width * height * 4);
    for (let i = 0; i < data.length; i += 4) data.set([...this.pixel, 255], i);
    return { data };
  }
}

class TestCanvas extends TestElement {
  width = 800;
  height = 600;
  readonly context = new TestContext(this);
  getContext() { return this.context; }
}

let now: number;
let nextFrame: number;
let frames: Map<number, FrameRequestCallback>;
let saved: Blob[];
let canvas: TestCanvas;
let screen: StartScreen;
let screenOptions: StartScreenOptions;

beforeEach(() => {
  now = 0;
  nextFrame = 0;
  frames = new Map();
  saved = [];
  canvas = new TestCanvas();
  vi.stubGlobal("window", new EventTarget());
  vi.stubGlobal("document", { activeElement: null, hasFocus: () => true, createElement: (tag: string) => tag === "canvas" ? new TestCanvas() : new TestElement() });
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { frames.set(++nextFrame, callback); return nextFrame; });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
  vi.stubGlobal("setTimeout", () => 0);
  vi.spyOn(performance, "now").mockImplementation(() => now);
  vi.spyOn(URL, "createObjectURL").mockImplementation((blob) => { saved.push(blob as Blob); return "blob:capture"; });
  resetCapture();
  screenOptions = {
    canvas, stage: new TestElement(), begin: "logo", savedId: "", list: { slide: newSlide() }, status: {}, sounds: { unlock() {} },
    assets: { logo: { colour: [120, 80, 40] }, loading: { colour: [40, 100, 160] } },
  } as unknown as StartScreenOptions;
  screen = new StartScreen(screenOptions);
});

afterEach(() => {
  screen.dispose();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function frame(at: number): void {
  now = at;
  const callbacks = [...frames.values()];
  frames.clear();
  for (const callback of callbacks) callback(at);
}

async function capture(at: number): Promise<number[]> {
  window.dispatchEvent(Object.assign(new Event("keydown"), { code: "F12" }));
  frame(at);
  expect(saved).toHaveLength(1);
  return Array.from(new Uint8Array(await saved[0].arrayBuffer()).slice(54, 57));
}

function press(key: string, keyCode: number, isComposing: boolean): Event {
  const event = Object.assign(new Event("keydown", { cancelable: true }), { key, code: key, keyCode, isComposing });
  window.dispatchEvent(event);
  return event;
}

describe("start screen keys during IME composition", () => {
  it("opens help with an ordinary F1 during composition", () => {
    expect(screen.dropsClicks).toBe(false);
    const event = press("F1", 112, true);
    expect(screen.dropsClicks).toBe(true);
    expect(event.defaultPrevented).toBe(true);
  });

  it("closes help with an ordinary Esc during composition", () => {
    press("F1", 112, false);
    const event = press("Escape", 27, true);
    expect(screen.dropsClicks).toBe(false);
    expect(event.defaultPrevented).toBe(true);
  });

  it.each([true, false])("leaves IME process keys to the editor with isComposing=%s", (composing) => {
    const f1 = press("F1", 229, composing);
    expect(screen.dropsClicks).toBe(false);
    expect(f1.defaultPrevented).toBe(false);
    press("F1", 112, false);
    const esc = press("Escape", 229, composing);
    expect(screen.dropsClicks).toBe(true);
    expect(esc.defaultPrevented).toBe(false);
  });
});

describe("start screen captures before the display fade", () => {
  it("resumes the loading in step after another screen's out finishes", () => {
    frame(0);
    for (let n = 0; n <= 10; n++) frame(2000 + n * FRAME_MS);
    for (let n = 0; n < 4; n++) frame(2400 + n * 100);
    now = 2700 + FRAME_MS;
    screen.dispose();
    const from = freezeCanvas(canvas as unknown as HTMLCanvasElement);
    screen = new StartScreen({ ...screenOptions, fadeFrom: from });
    const start = now;
    frame(start);
    expect(canvas.context.pixel).toEqual([36, 90, 144]);
    frame(start + 10 * FRAME_MS);
    frame(start + 11 * FRAME_MS);
    expect(canvas.context.pixel).toEqual([60, 40, 20]);
  });

  it("carries the frozen logo and ongoing out step across disposal and screen replacement", () => {
    frame(0);
    frame(2000);
    for (let n = 1; n < 5; n++) frame(2000 + n * FRAME_MS);
    now = 2000 + 5 * FRAME_MS;
    screen.dispose();
    const from = freezeCanvas(canvas as unknown as HTMLCanvasElement);
    screen = new StartScreen({ ...screenOptions, fadeFrom: from });
    frame(now);
    expect(canvas.context.pixel).toEqual([48, 32, 16]);
    frame(2000 + 10 * FRAME_MS);
    expect(canvas.context.pixel).toEqual([0, 0, 0]);
  });

  it("keeps the frozen logo's original pixels while its display fades out", async () => {
    frame(0);
    frame(2001);
    const pixel = await capture(2101);
    expect(canvas.context.pixel).toEqual([72, 48, 24]);
    expect(pixel).toEqual([40, 80, 122]);
  });

  it("saves black on the final fade-out frame", async () => {
    frame(0);
    frame(2001);
    const pixel = await capture(2368);
    expect(canvas.context.pixel).toEqual([0, 0, 0]);
    expect(pixel).toEqual([0, 0, 0]);
  });

  it("keeps the new loading scene's original pixels while its display fades in", async () => {
    frame(0);
    frame(2001);
    frame(2368);
    const pixel = await capture(2468);
    // This is the first drawn loading frame: native fade-in begins at 90 % dark.
    expect(canvas.context.pixel).toEqual([4, 10, 16]);
    expect(pixel).toEqual([160, 96, 43]);
  });

  it("lightens loading on its next 10 fps frame while retaining the original capture pixels", async () => {
    frame(0);
    frame(2001);
    frame(2368);
    frame(2468);
    const pixel = await capture(2568);
    expect(canvas.context.pixel).toEqual([8, 20, 32]);
    expect(pixel).toEqual([160, 96, 43]);
  });
});
