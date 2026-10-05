import { afterEach, describe, expect, it, vi } from "vitest";

import { loadImage, loadJson } from "./assets.ts";

afterEach(() => vi.unstubAllGlobals());

describe("asset loading after a transient failure", () => {
  it("requests an image again after a failed preload, while sharing successful requests", async () => {
    const images: { src: string; onload: (() => void) | null; onerror: (() => void) | null }[] = [];
    vi.stubGlobal("Image", class {
      src = "";
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      constructor() {
        images.push(this);
      }
    });
    const first = loadImage("image/retry.png");
    expect(loadImage("image/retry.png")).toBe(first);
    images[0].onerror?.();
    await expect(first).rejects.toThrow("failed to load");

    const next = loadImage("image/retry.png");
    expect(images).toHaveLength(2);
    images[1].onload?.();
    await expect(next).resolves.toBe(images[1]);
    expect(loadImage("image/retry.png")).toBe(next);
  });

  it.each([
    ["network failure", () => Promise.reject(new TypeError("offline"))],
    ["HTTP failure", () => Promise.resolve(new Response("missing", { status: 404 }))],
    ["invalid JSON", () => Promise.resolve(new Response("{broken"))],
  ])("requests JSON again after %s", async (name, fail) => {
    const fetch = vi.fn().mockImplementationOnce(fail).mockResolvedValueOnce(new Response('{"id":"restored"}'));
    vi.stubGlobal("fetch", fetch);
    const path = `maps/${name}.json`;
    const first = loadJson(path);
    expect(loadJson(path)).toBe(first);
    await expect(first).rejects.toThrow();

    const next = loadJson(path);
    await expect(next).resolves.toEqual({ id: "restored" });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(loadJson(path)).toBe(next);
  });
});
