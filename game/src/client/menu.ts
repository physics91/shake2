import type { Manifest } from "../assets/types.ts";
import { isRoomMap } from "../sim/level.ts";
import { loadSheet } from "./assets.ts";
import { portraitSheetName } from "./scene.ts";
import { drawFrameFitted } from "./sprite.ts";
import type { Choice } from "./ui.ts";
import { h } from "./ui.ts";

const BASE = `${import.meta.env.BASE_URL}assets/`;

/** The maps a room can choose: every map but the practice one. */
export function playableMaps(manifest: Manifest): Manifest["maps"] {
  return manifest.maps.filter((m) => isRoomMap(m.id));
}

/** Map titles start with a two-digit sort key ("092002년새해코벱"); the name follows it. */
export function mapTitle(title: string): string {
  return title.replace(/^\d{2}/, "").trim() || title;
}

export function characterChoices(manifest: Manifest): Choice[] {
  return manifest.characters.map((name) => ({ value: name, label: name, image: portraitCanvas(name, 56) }));
}

export function mapChoices(manifest: Manifest): Choice[] {
  return playableMaps(manifest).map((m) => ({
    value: m.id,
    label: mapTitle(m.title),
    image: h("img", {
      src: `${BASE}maps/${m.id}.preview.png`,
      alt: "",
      width: 160,
      height: 120,
      loading: "lazy",
      decoding: "async",
    }),
  }));
}

export function portraitCanvas(character: string, size: number): HTMLCanvasElement {
  const canvas = h("canvas", { width: size, height: size, class: "portrait", "aria-hidden": "true" });
  void loadSheet("character", portraitSheetName(character)).then((portrait) => {
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    drawFrameFitted(ctx, portrait, portrait.meta.animations[0], 0, { x: 0, y: 0, width: size, height: size });
  });
  return canvas;
}
