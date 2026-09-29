import { describe, expect, it } from "vitest";

import type { PreferenceStore } from "./settings.ts";
import { assignKey, defaultSettings, macroText, readSettings, resetSettings, SettingsStore } from "./settings.ts";

function memory(entries: Record<string, string> = {}): PreferenceStore & { data: Map<string, string> } {
  const data = new Map(Object.entries(entries));
  return { data, get: (key) => data.get(key) ?? null, set: (key, value) => void data.set(key, value) };
}

describe("the option object (0x48acd0, registry 0x44ce64/0x44d040)", () => {
  it("starts with everything on, no macros, Space/Left Ctrl/Z and the keyboard (0x44cc60)", () => {
    const settings = readSettings(memory());
    expect(settings).toEqual(defaultSettings());
    expect(settings.keys).toEqual([0x39, 0x1d, 0x2c]);
    expect(settings.macros).toHaveLength(10);
    expect(settings.control).toBe(0);
  });

  it("reads back what it saved", () => {
    const store = memory();
    const book = new SettingsStore(store);
    book.save({ music: false, effects: true, balloons: false, macros: ["", "안녕", "", "", "", "", "", "", "", "gg"], keys: [0x1e, 0x10, 0x2d], control: 1 });
    expect(readSettings(store)).toEqual(book.current);
    expect(store.data.get("music")).toBe("off");
    expect(store.data.get("effects")).toBe("on");
  });

  it("takes the toolbar's earlier effects and music values", () => {
    const settings = readSettings(memory({ effects: "off", music: "on" }));
    expect(settings.effects).toBe(false);
    expect(settings.music).toBe(true);
  });

  it("falls back per value on bad data: unknown keys, D, long or odd macros", () => {
    const settings = readSettings(
      memory({
        "option.keys": JSON.stringify([0x20, 0x99, "x"]),
        "option.macros": JSON.stringify(["a", 5, "가".repeat(30), "\u0007bell"]),
        "option.control": "7",
        "option.balloons": "yes",
      }),
    );
    expect(settings.keys).toEqual([0x39, 0x1d, 0x2c]);
    expect(settings.macros.slice(0, 4)).toEqual(["a", "", "가".repeat(18), "bell"]);
    expect(settings.control).toBe(0);
    expect(settings.balloons).toBe(true);
    expect(readSettings(memory({ "option.macros": "{not json" })).macros.every((m) => m === "")).toBe(true);
  });

  it("keeps a macro to 36 cp949 bytes", () => {
    expect(macroText("a".repeat(40))).toHaveLength(36);
    expect(macroText("가".repeat(20))).toBe("가".repeat(18));
  });

  it("tells listeners of each save and lets them go", () => {
    const book = new SettingsStore(memory());
    const seen: boolean[] = [];
    const stop = book.listen((s) => seen.push(s.music));
    book.update({ music: false });
    stop();
    book.update({ music: true });
    expect(seen).toEqual([false]);
    expect(book.current.music).toBe(true);
  });

  it("changes the device at once but saves it only with O or 초기화 (0x421e90, 0x44d040)", () => {
    const store = memory();
    const book = new SettingsStore(store);
    const seen: number[] = [];
    book.listen((s) => seen.push(s.control));
    book.setControl(1);
    expect(book.current.control).toBe(1);
    expect(seen).toEqual([1]);
    expect(store.data.get("option.control")).toBeUndefined();
    // The toolbar's sound buttons save, but not a device the window has not saved.
    book.update({ effects: false });
    expect(store.data.get("option.control")).toBe("0");
    expect(book.current.control).toBe(1);
    book.save({ ...book.current, macros: [...book.current.macros], keys: [...book.current.keys] });
    expect(store.data.get("option.control")).toBe("1");
    book.setControl(0);
    book.update({ music: false });
    expect(store.data.get("option.control")).toBe("1");
  });

  it("gives a key to a slot, the slot holding it taking the old one, as the key change ends up (0x40218e)", () => {
    expect(assignKey([0x39, 0x1d, 0x2c], 1, 0x10)).toEqual([0x39, 0x10, 0x2c]);
    expect(assignKey([0x39, 0x1d, 0x2c], 0, 0x2c)).toEqual([0x2c, 0x1d, 0x39]);
    expect(assignKey([0x39, 0x1d, 0x2c], 2, 0x2c)).toEqual([0x39, 0x1d, 0x2c]);
  });

  it("resets to the defaults but keeps the device, as 초기화 does (0x4222e0)", () => {
    const current = { ...defaultSettings(), music: false, macros: defaultSettings().macros.map(() => "x"), keys: [0x1e, 0x10, 0x2d] as [number, number, number], control: 1 as const };
    expect(resetSettings(current)).toEqual({ ...defaultSettings(), control: 1 });
  });
});
