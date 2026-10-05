import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Sheet } from "./assets.ts";

const { loadSheet, loadImage } = vi.hoisted(() => ({ loadSheet: vi.fn(), loadImage: vi.fn() }));
vi.mock("./assets.ts", () => ({ loadSheet, loadImage }));

const plain = { image: {}, meta: { sheet: "retry.png" } } as Sheet;
const raw = { width: 2, height: 1 };
const canvas = {
  width: 0,
  height: 0,
  getContext: () => ({
    drawImage() {},
    getImageData: () => ({ data: new Uint8ClampedArray([0, 0, 0, 255, 255, 0, 0, 255]) }),
    putImageData() {},
  }),
};

beforeEach(() => {
  vi.resetModules();
  loadSheet.mockReset().mockResolvedValue(plain);
  loadImage.mockReset().mockResolvedValue(raw);
  vi.stubGlobal("document", { createElement: () => canvas });
  vi.stubGlobal("ImageData", class {
    data: Uint8ClampedArray;
    width: number;
    height: number;
    constructor(data: Uint8ClampedArray, width: number, height: number) {
      this.data = data;
      this.width = width;
      this.height = height;
    }
  });
});

afterEach(() => vi.unstubAllGlobals());

describe("tinted sheets after a transient failure", () => {
  it("retries the same hue after its base sheet failed", async () => {
    const { loadTintedSheet } = await import("./tintArt.ts");
    loadSheet.mockRejectedValueOnce(new Error("offline"));
    const first = loadTintedSheet("character", "retry", 75);
    expect(loadTintedSheet("character", "retry", 75)).toBe(first);
    await expect(first).rejects.toThrow("offline");

    const next = loadTintedSheet("character", "retry", 75);
    await expect(next).resolves.toEqual({ image: canvas, meta: plain.meta });
    expect(loadSheet).toHaveBeenCalledTimes(2);
    expect(loadTintedSheet("character", "retry", 75)).toBe(next);
  });

  it("uses the plain sheet while RGB is missing, then restores the requested hue on the next load", async () => {
    const { loadTintedSheet } = await import("./tintArt.ts");
    loadImage.mockRejectedValueOnce(new Error("offline"));
    await expect(loadTintedSheet("character", "retry", 125)).resolves.toBe(plain);

    const next = loadTintedSheet("character", "retry", 125);
    await expect(next).resolves.toEqual({ image: canvas, meta: plain.meta });
    expect(loadImage).toHaveBeenCalledTimes(2);
    expect(loadTintedSheet("character", "retry", 125)).toBe(next);
  });

  it("does not remove a newer request when an older, evicted request fails", async () => {
    const { loadTintedSheet } = await import("./tintArt.ts");
    let fail!: (error: Error) => void;
    loadSheet.mockImplementationOnce(() => new Promise((_resolve, reject) => { fail = reject; }));
    const old = loadTintedSheet("character", "retry", 1);
    for (let hue = 2; hue <= 49; hue++) await loadTintedSheet("character", "retry", hue);
    const fresh = loadTintedSheet("character", "retry", 1);
    await fresh;
    fail(new Error("old failure"));
    await expect(old).rejects.toThrow("old failure");

    expect(loadTintedSheet("character", "retry", 1)).toBe(fresh);
  });
});
