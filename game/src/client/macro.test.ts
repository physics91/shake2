import { describe, expect, it } from "vitest";

import { isMacroKey, macroOpens, macroSlot } from "./macro.ts";

describe("chat macros (0x461a50)", () => {
  it("maps F2..F10 to CM2..CM10 and nothing else", () => {
    expect(macroSlot("F2")).toBe(1);
    expect(macroSlot("F10")).toBe(9);
    expect(macroSlot("F1")).toBeNull();
    expect(macroSlot("F11")).toBeNull();
    expect(macroSlot("KeyF")).toBeNull();
    expect(isMacroKey("F5")).toBe(true);
    expect(isMacroKey("F12")).toBe(false);
  });

  it("lets the yes/no box take F2..F9 but not F10, and the scene's own check take all", () => {
    expect(macroOpens(1, { box: false, blocked: false })).toBe(true);
    expect(macroOpens(8, { box: true, blocked: false })).toBe(false);
    expect(macroOpens(9, { box: true, blocked: false })).toBe(true);
    expect(macroOpens(9, { box: false, blocked: true })).toBe(false);
  });
});
