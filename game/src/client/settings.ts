// The option object (0x48acd0): what the option window (scene 13) sets and the rest of the game
// reads. The original keeps it in the registry, HKLM\Software\AOZORA Entertainment\Shake2 (load
// 0x44ce64, save 0x44d040); this remake keeps it in the browser.
import { cutBytes, typeable } from "../server/cp949.ts";
import { DEFAULT_KEYS, isBindable } from "./dik.ts";

/** CM1..CM10 (+0x0, 0x33 bytes each). Slot n is F(n+1); slot 0 is never shown or used. */
export const MACRO_SLOTS = 10;
/** The macro editor's limit (0x42272f: 0x25): 36 bytes. */
export const MACRO_LIMIT = 37;

export type Control = 0 | 1;

export interface Settings {
  /** SoundOpt bit 1 (+0x1fe). */
  music: boolean;
  /** SoundOpt bit 0 (+0x1ff). */
  effects: boolean;
  /** PHELP (+0x20b): the help balloons. */
  balloons: boolean;
  /** CM1..CM10. */
  macros: string[];
  /** Key1..Key3 (+0x20c, +0x210, +0x214): bombs, attack items (ITEM1), evasion items (ITEM2), by DIK. */
  keys: Keys;
  /** control (+0x218): 0 the keyboard, 1 the joystick. */
  control: Control;
}

/** The constructor's values (0x44cc60): everything on, no macros, the default keys, the keyboard. */
export function defaultSettings(): Settings {
  return {
    music: true,
    effects: true,
    balloons: true,
    macros: Array.from({ length: MACRO_SLOTS }, () => ""),
    keys: [...DEFAULT_KEYS],
    control: 0,
  };
}

export function cloneSettings(settings: Settings): Settings {
  return { ...settings, macros: [...settings.macros], keys: [...settings.keys] };
}

/** 초기화 (0x4222e0): the checks on, no macros, the default keys; the device stays as it is. */
export function resetSettings(current: Readonly<Settings>): Settings {
  return { ...defaultSettings(), control: current.control };
}

export type Keys = [number, number, number];

/**
 * Where the key change ends up (0x40218e-0x402268) in one step: the slot takes the key, and a slot
 * that held it takes the slot's old key.
 */
export function assignKey(keys: Readonly<Keys>, slot: number, dik: number): Keys {
  const next: Keys = [...keys];
  const other = next.findIndex((key, i) => i !== slot && key === dik);
  if (other >= 0) next[other] = keys[slot];
  next[slot] = dik;
  return next;
}

/** Text a macro box could hold: cp949, at most 36 bytes. */
export function macroText(raw: string): string {
  return cutBytes(typeable(raw), MACRO_LIMIT - 1);
}

export interface PreferenceStore {
  get(key: string): string | null;
  set(key: string, value: string): void;
}

/** Stored keys; effects and music keep the toolbar's earlier ones. */
const KEY = {
  effects: "effects",
  music: "music",
  balloons: "option.balloons",
  macros: "option.macros",
  keys: "option.keys",
  control: "option.control",
};

function parseJson(text: string | null): unknown {
  if (text === null) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** What the store holds, each value checked; a missing or bad one is the default, like a key value of 0 (0x461920). */
export function readSettings(store: PreferenceStore): Settings {
  const settings = defaultSettings();
  settings.effects = store.get(KEY.effects) !== "off";
  settings.music = store.get(KEY.music) !== "off";
  settings.balloons = store.get(KEY.balloons) !== "0";
  const macros = parseJson(store.get(KEY.macros));
  if (Array.isArray(macros)) {
    macros.slice(0, MACRO_SLOTS).forEach((text, i) => {
      if (typeof text === "string") settings.macros[i] = macroText(text);
    });
  }
  const keys = parseJson(store.get(KEY.keys));
  if (Array.isArray(keys)) {
    keys.slice(0, 3).forEach((dik, i) => {
      if (typeof dik === "number" && Number.isInteger(dik) && isBindable(dik)) settings.keys[i] = dik;
    });
  }
  settings.control = store.get(KEY.control) === "1" ? 1 : 0;
  return settings;
}

export function writeSettings(store: PreferenceStore, settings: Settings): void {
  store.set(KEY.effects, settings.effects ? "on" : "off");
  store.set(KEY.music, settings.music ? "on" : "off");
  store.set(KEY.balloons, settings.balloons ? "1" : "0");
  store.set(KEY.macros, JSON.stringify(settings.macros));
  store.set(KEY.keys, JSON.stringify(settings.keys));
  store.set(KEY.control, String(settings.control));
}

/** The one option object, told to whoever listens when it changes. */
export class SettingsStore {
  private readonly store: PreferenceStore;
  private value: Settings;
  /** control as last saved: the window's device checks change only the object (0x421e90, 0x421f90). */
  private savedControl: Control;
  private readonly listeners: ((settings: Settings) => void)[] = [];

  constructor(store: PreferenceStore) {
    this.store = store;
    this.value = readSettings(store);
    this.savedControl = this.value.control;
  }

  get current(): Readonly<Settings> {
    return this.value;
  }

  /** O and 초기화 (0x44d040): everything, the device too, is saved. */
  save(next: Settings): void {
    this.savedControl = next.control;
    this.write(next);
  }

  /** This remake's toolbar sound buttons: the change is saved, a device not yet saved stays unsaved. */
  update(change: Partial<Settings>): void {
    if (change.control !== undefined) this.savedControl = change.control;
    this.write({ ...cloneSettings(this.value), ...change });
  }

  /** 1P and 조이스틱: the device changes at once and is saved by the next O or 초기화. */
  setControl(control: Control): void {
    this.value = { ...cloneSettings(this.value), control };
    this.tell();
  }

  private write(next: Settings): void {
    this.value = cloneSettings(next);
    writeSettings(this.store, { ...this.value, control: this.savedControl });
    this.tell();
  }

  private tell(): void {
    for (const listener of this.listeners) listener(this.value);
  }

  listen(listener: (settings: Settings) => void): () => void {
    this.listeners.push(listener);
    return () => {
      const i = this.listeners.indexOf(listener);
      if (i >= 0) this.listeners.splice(i, 1);
    };
  }
}
