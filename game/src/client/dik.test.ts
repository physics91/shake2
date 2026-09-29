import { describe, expect, it } from "vitest";

import { bindableKeys, codeToDik, DEFAULT_KEYS, dikToCode, firstHeld, isBindable, KEY_NAMES, keyName } from "./dik.ts";

describe("DirectInput key codes (0x402090, 0x46ded4)", () => {
  it("maps the default keys to Space, Left Ctrl and Z", () => {
    expect(DEFAULT_KEYS.map(dikToCode)).toEqual(["Space", "ControlLeft", "KeyZ"]);
    expect(codeToDik("Space")).toBe(0x39);
    expect(codeToDik("KeyD")).toBe(0x20);
    expect(codeToDik("F12")).toBe(0x58);
  });

  it("leaves out keys the poll never scans: Escape, the arrows, Right Ctrl and Right Alt", () => {
    for (const code of ["Escape", "ArrowUp", "ArrowLeft", "ControlRight", "AltRight", "NumpadEnter", "Home"]) {
      expect(codeToDik(code)).toBeNull();
    }
  });

  it("names keys by the table: by DIK up to 0x53, then packed, so F11 shows F14", () => {
    expect(KEY_NAMES).toHaveLength(137);
    expect(keyName(0x39)).toBe("  SPACE ");
    expect(keyName(0x1d)).toBe("LCONTROL");
    expect(keyName(0x2c)).toBe("    Z   ");
    expect(keyName(0x57)).toBe("   F14  ");
    expect(keyName(0x58)).toBe("   F15  ");
    expect(keyName(0x43)).toBe("\t  F9   ");
    expect(keyName(0x89)).toBe("");
  });

  it("binds every scanned key but D", () => {
    expect(isBindable(0x20)).toBe(false);
    expect(isBindable(0x1e)).toBe(true);
    expect(isBindable(0x54)).toBe(false);
    expect(isBindable(0x01)).toBe(false);
  });

  it("lists the bindable keys in the poll's order, for the page's key choices", () => {
    const keys = bindableKeys();
    expect(keys).not.toContain(0x20);
    expect(keys).toEqual(expect.arrayContaining([...DEFAULT_KEYS, 0x02, 0x57, 0x7e]));
    expect(keys.every((dik, i) => i === 0 || dik > keys[i - 1])).toBe(true);
    expect(keys.every(isBindable)).toBe(true);
  });

  it("takes the lowest held DIK, not the first pressed", () => {
    expect(firstHeld(["KeyZ", "KeyQ", "ArrowUp"])).toBe(0x10);
    expect(firstHeld(["ArrowUp", "Escape"])).toBeNull();
    expect(firstHeld([])).toBeNull();
  });
});
