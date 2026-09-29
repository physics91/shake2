import { describe, expect, it } from "vitest";

import { GESTURE_REFUSED } from "./dik.ts";
import { DEVICE_ERRORS } from "./optionWindow.ts";
import type { Control, Keys, Settings } from "./settings.ts";
import { defaultSettings } from "./settings.ts";
import { OPTION_PAGE, OPTION_SAVED, optionMacroLine, statusKeyName } from "./statusLayout.ts";
import { StatusOption } from "./statusOption.ts";

function centre([x0, y0, x1, y1]: readonly number[]): [number, number] {
  return [Math.trunc((x0 + x1) / 2), Math.trunc((y0 + y1) / 2)];
}

function setup(change: Partial<Settings> = {}, device = true) {
  let current: Settings = { ...defaultSettings(), ...change };
  const log: string[] = [];
  const saved: Settings[] = [];
  const keys: Keys = [...current.keys];
  const option = new StatusOption(
    {
      current: () => current,
      save: (next) => {
        saved.push(next);
        current = next;
      },
      useControl: (control: Control) => {
        log.push(`device ${control}`);
        if (device) current = { ...current, control };
        return device;
      },
      message: (text) => log.push(`message ${text}`),
      click: () => log.push("click"),
      edit: (_line, text) => log.push(`edit ${text}`),
    },
    keys,
  );
  return { option, log, saved, keys, current: () => current };
}

describe("scene 5 option page", () => {
  it("opens on CM1 with the options' copies and the device's mark", () => {
    const macros = ["첫째", "둘째", "", "", "", "", "", "", "", "열째"];
    const { option, log } = setup({ macros, music: false, control: 1 });
    expect(option.line).toBe(0);
    expect(option.macros).toEqual(macros);
    expect(option.music).toBe(false);
    expect(option.effects).toBe(true);
    expect(option.joystick).toBe(true);
    expect(log).toEqual(["edit 첫째"]);
  });

  it("walks the lines with Tab, 9 back to 0, and a click picks (y − 88) / 24", () => {
    const { option, log } = setup({ macros: ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"] });
    for (let i = 0; i < 9; i++) option.tab();
    expect(option.line).toBe(9);
    option.tab();
    expect(option.line).toBe(0);
    option.click(100, 88 + 24 * 3);
    expect(option.line).toBe(3);
    expect(log.at(-1)).toBe("edit d");
    // The last two rows of the area would be line 10: nothing.
    option.click(100, 328);
    expect(option.line).toBe(3);
    expect(optionMacroLine(327)).toBe(9);
    expect(optionMacroLine(328)).toBeNull();
  });

  it("puts the editor's text on the line it is on", () => {
    const { option } = setup();
    option.click(100, 88 + 24 * 2);
    option.editorText("안녕");
    expect(option.macros[2]).toBe("안녕");
  });

  it("sets the device, music and sound marks without a sound", () => {
    const { option, log } = setup();
    option.click(...centre(OPTION_PAGE.joystick));
    option.click(...centre(OPTION_PAGE.music.off.hit));
    option.click(...centre(OPTION_PAGE.sound.off.hit));
    expect([option.joystick, option.music, option.effects]).toEqual([true, false, false]);
    option.click(...centre(OPTION_PAGE.keyboard));
    option.click(...centre(OPTION_PAGE.music.on.hit));
    option.click(...centre(OPTION_PAGE.sound.on.hit));
    expect([option.joystick, option.music, option.effects]).toEqual([false, true, true]);
    expect(log.filter((line) => line === "click")).toHaveLength(0);
  });

  it("changes a key live: the lowest held key, D refused, a taken key swapped in", () => {
    const { option, log, keys } = setup();
    option.poll(["KeyQ"]);
    expect(keys).toEqual([0x39, 0x1d, 0x2c]);
    option.click(...centre(OPTION_PAGE.keys[1].hit));
    expect(option.changing).toBe(1);
    expect(log.at(-1)).toBe("click");
    option.poll(["KeyW", "KeyQ"]);
    expect(keys).toEqual([0x39, 0x10, 0x2c]);
    option.poll(["KeyD"]);
    expect(log.at(-1)).toBe(`message ${GESTURE_REFUSED}`);
    // Space is Key1's: Key1 takes this slot's Q first, and the slot takes Space on the next poll.
    option.poll(["Space"]);
    expect(keys).toEqual([0x10, 0x10, 0x2c]);
    option.poll(["Space"]);
    expect(keys).toEqual([0x10, 0x39, 0x2c]);
    // A click anywhere else ends the change.
    option.click(300, 200);
    expect(option.changing).toBe(-1);
    option.poll(["KeyE"]);
    expect(keys).toEqual([0x10, 0x39, 0x2c]);
  });

  it("does not change keys while the joystick is the device", () => {
    const { option, keys } = setup({ control: 1 });
    option.click(...centre(OPTION_PAGE.keys[0].hit));
    option.poll(["KeyQ"]);
    expect(keys[0]).toBe(0x39);
  });

  it("toggles do not end a key change", () => {
    const { option } = setup();
    option.click(...centre(OPTION_PAGE.keys[2].hit));
    option.click(...centre(OPTION_PAGE.music.off.hit));
    expect(option.changing).toBe(2);
  });

  it("확인 switches the device, saves everything and stays open", () => {
    const { option, log, saved, keys, current } = setup({ balloons: false });
    option.click(100, 88 + 24 * 4);
    option.editorText("매크로");
    option.click(...centre(OPTION_PAGE.music.off.hit));
    option.click(...centre(OPTION_PAGE.joystick));
    keys[0] = 0x10;
    expect(option.click(...centre(OPTION_PAGE.ok.hit))).toBe("saved");
    expect(log.slice(-3)).toEqual(["click", "device 1", `message ${OPTION_SAVED}`]);
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({ music: false, effects: true, balloons: false, control: 1, keys: [0x10, 0x1d, 0x2c] });
    expect(saved[0].macros[4]).toBe("매크로");
    expect(current().control).toBe(1);
  });

  it("확인 stops at a device that will not start", () => {
    const { option, log, saved } = setup({}, false);
    option.click(...centre(OPTION_PAGE.joystick));
    expect(option.click(...centre(OPTION_PAGE.ok.hit))).toBeNull();
    expect(log.at(-1)).toBe(`message ${DEVICE_ERRORS.joystick}`);
    expect(saved).toHaveLength(0);
  });

  it("취소 closes with a sound and leaves the live keys as they are", () => {
    const { option, log, saved, keys } = setup();
    option.click(...centre(OPTION_PAGE.keys[0].hit));
    option.poll(["KeyX"]);
    expect(option.click(...centre(OPTION_PAGE.cancel.hit))).toBe("close");
    expect(log.at(-1)).toBe("click");
    expect(keys[0]).toBe(0x2d);
    expect(saved).toHaveLength(0);
  });

  it("names keys from 0x46d864, unpadded", () => {
    expect(statusKeyName(0x39)).toBe("SPACE");
    expect(statusKeyName(0x1d)).toBe("LCONTROL");
    expect(statusKeyName(0x57)).toBe("F14");
    expect(statusKeyName(0xc8)).toBe("");
  });
});
