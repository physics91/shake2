import type { EffectKind } from "../sim/types.ts";
import type { LevelAssets, Sheet } from "./assets.ts";
import { loadImage, loadImageSheet, loadLevel, loadSheet } from "./assets.ts";
import { bombColor, portraitRect } from "./hudLayout.ts";
import { loadTintedSheet, WorkSurface } from "./tintArt.ts";

export interface CharacterAssets {
  body: Sheet;
  /** W_character sheet: the panel face (anim 0 is the grey face shown while dying). */
  face: Sheet;
  /** Bomb sheet, chosen by character in the original. */
  bomb: Sheet;
}

/** Images of the HUD and the result screens (image/*.shk). */
export interface HudImages {
  mark: HTMLImageElement;
  item: HTMLImageElement;
  sd: HTMLImageElement;
  portraits: HTMLImageElement;
  guild: HTMLImageElement;
  teambar: HTMLImageElement;
  candy: HTMLImageElement;
  textbox: HTMLImageElement;
  /** shake_help.shk: practice's F1 help screen (0x432f90). */
  help: HTMLImageElement;
  /** apple.shk and apple_filter2.shk: what an apple flame's blindness shows (0x404307). */
  apple: HTMLImageElement;
  blindFilter: HTMLImageElement;
  /** images.shk: practice's typing balloon (and its box panel). */
  images: HTMLImageElement;
  load: HTMLImageElement;
  roundResult: HTMLImageElement;
  gameResult: HTMLImageElement;
}

/** A player's tint as its sheets are read for the match. */
export interface PlayerTint {
  id: number;
  character: string;
  hue: number;
  /** The W_Character panel face turns too (network, 0x44de67); practice's does not. */
  face: boolean;
  /** The 46 × 40 head is precomputed in its slot's work surface (0x4406ca), hue 0 too: network rooms. */
  head: boolean;
}

export interface SceneAssets {
  level: LevelAssets;
  characters: Map<string, CharacterAssets>;
  /** Each player's sheets read for the match (0x4633c0), by id, including hue 0. */
  tinted: Map<number, CharacterAssets>;
  /** The result, wait and final screens' heads, turned into the slots' work surfaces, by player id. */
  heads: Map<number, WorkSurface>;
  fire: Sheet;
  items: Sheet;
  /** Map object sheets Object_A, Object_B and Object_C.spr, all loaded for every map (0x411530). */
  objectSheets: readonly [Sheet, Sheet, Sheet];
  digits: Sheet;
  clock: Sheet;
  hurry: Sheet;
  /** diff1.spr: the green "me" arrow; diff2.spr: the yellow arrow over teammates. */
  marker: Sheet;
  teamMarker: Sheet;
  /** bad_state.spr: the dizzy stars of a curse, the bomb switch or a reset. */
  badState: Sheet;
  /** Effect list sheets: u_ground.spr, egg.spr and revival.spr. */
  effects: Record<EffectKind, Sheet>;
  shadow: HTMLImageElement;
  /** cursor.spr: the game draws its own mouse cursor (0x43ef30). */
  cursor: Sheet;
  hud: HudImages;
}

/** `w-doomy` ships without portrait and face sheets; it borrows doomy's. */
export function portraitSheetName(character: string): string {
  return `${character.replace(/^w-/, "")}_p`;
}

export function faceSheetName(character: string): string {
  return `${character.replace(/^w-/, "")}_w`;
}

export async function loadCharacter(name: string): Promise<CharacterAssets> {
  const [body, face, bomb] = await Promise.all([
    loadSheet("character", name),
    loadSheet("w_character", faceSheetName(name)),
    loadSheet("bomb", `bomb_${bombColor(name)}`),
  ]);
  return { body, face, bomb };
}

async function loadHud(): Promise<HudImages> {
  const names = {
    mark: "mark",
    item: "item",
    sd: "sd",
    portraits: "Wg_char",
    guild: "guild",
    teambar: "new_teambar",
    candy: "candy",
    textbox: "textbox",
    help: "shake_help",
    apple: "apple",
    blindFilter: "apple_filter2",
    images: "images",
    load: "new_load",
    roundResult: "new_round_e",
    gameResult: "new_game_e",
  } as const;
  const entries = await Promise.all(
    Object.entries(names).map(async ([key, file]) => [key, await loadImage(`image/${file}.png`)] as const),
  );
  return Object.fromEntries(entries) as unknown as HudImages;
}

/** A player's sheets: its own when read with a hue, else its character's. */
export function characterOf(assets: SceneAssets, player: { id: number; character: string }): CharacterAssets | undefined {
  return assets.tinted.get(player.id) ?? assets.characters.get(player.character);
}

async function loadTinted(tint: PlayerTint): Promise<CharacterAssets> {
  const [body, face, bomb] = await Promise.all([
    loadTintedSheet("character", tint.character, tint.hue),
    loadTintedSheet("w_character", faceSheetName(tint.character), tint.face ? tint.hue : 0),
    loadSheet("bomb", `bomb_${bombColor(tint.character)}`),
  ]);
  return { body, face, bomb };
}

function heads(portraits: HTMLImageElement, tints: readonly PlayerTint[]): Map<number, WorkSurface> {
  const surfaces = new Map<number, WorkSurface>();
  for (const tint of tints) {
    if (!tint.head) continue;
    const surface = new WorkSurface();
    surface.recolour(portraits, portraitRect(tint.character), tint.hue);
    surfaces.set(tint.id, surface);
  }
  return surfaces;
}

export async function loadSceneAssets(levelId: string, characterNames: readonly string[], tints: readonly PlayerTint[] = []): Promise<SceneAssets> {
  const unique = [...new Set(characterNames)];
  const [level, characters, tinted, fire, items, objectA, objectB, objectC, digits, clock, hurry, marker, teamMarker, badState, ground, egg, revival, shadow, cursor, hud] = await Promise.all([
    loadLevel(levelId),
    Promise.all(unique.map(async (name) => [name, await loadCharacter(name)] as const)),
    // In the same wait as the rest, so a failed tinted sheet is the one error the caller gets.
    Promise.all(tints.map(async (tint) => [tint.id, await loadTinted(tint)] as const)),
    loadSheet("bomb", "fire"),
    loadSheet("item", "item"),
    loadSheet("object", "object_a"),
    loadSheet("object", "object_b"),
    loadSheet("object", "object_c"),
    loadSheet("object", "count"),
    loadSheet("object", "clock"),
    loadSheet("object", "hurry"),
    loadSheet("object", "diff1"),
    loadSheet("object", "diff2"),
    loadSheet("object", "bad_state"),
    loadSheet("object", "u_ground"),
    loadSheet("object", "egg"),
    loadSheet("object", "revival"),
    loadImage("image/shadow.png"),
    loadImageSheet("cursor"),
    loadHud(),
  ]);
  return {
    level,
    characters: new Map(characters),
    tinted: new Map(tinted),
    heads: heads(hud.portraits, tints),
    fire,
    items,
    objectSheets: [objectA, objectB, objectC],
    digits,
    clock,
    hurry,
    marker,
    teamMarker,
    badState,
    effects: { ground, egg, revival },
    shadow,
    cursor,
    hud,
  };
}
