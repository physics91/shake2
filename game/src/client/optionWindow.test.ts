import { describe, expect, it } from "vitest";

import type { OptionHost } from "./optionWindow.ts";
import { OptionWindow } from "./optionWindow.ts";
import type { Control, Settings } from "./settings.ts";
import { cloneSettings, defaultSettings } from "./settings.ts";

/** Points inside the window's controls (optionLayout's rects). */
const AT = {
  ok: [100, 530],
  reset: [380, 535],
  cancel: [650, 530],
  music: [195, 480],
  effects: [295, 480],
  balloons: [625, 488],
  keyboard: [200, 365],
  joystick: [325, 365],
  bomb: [150, 410],
  item1: [230, 410],
  item2: [300, 410],
  macro: (k: number) => [110 + 81 * (k % 3), 180 + 53 * Math.floor(k / 3)],
  friend: (i: number) => [450, 205 + 21 * i],
  popupOk: [470, 450],
  popupCancel: [660, 450],
  elsewhere: [60, 60],
} as const;

function setup(settings: Settings = defaultSettings(), devices: { joystick: boolean } = { joystick: true }) {
  const log: string[] = [];
  let current = cloneSettings(settings);
  const host: OptionHost = {
    current: () => current,
    save: (next) => {
      current = cloneSettings(next);
      log.push("save");
    },
    useControl: (control: Control) => {
      if (control === 1 && !devices.joystick) return false;
      current = { ...current, control };
      log.push(`control ${control}`);
      return true;
    },
    close: () => log.push("close"),
    message: (text) => log.push(`message ${text}`),
    edit: (target) => log.push(target ? `edit ${target.kind} ${target.text}` : "edit off"),
    addFriend: (name) => log.push(`add ${name}`),
    deleteFriend: (name) => log.push(`delete ${name}`),
  };
  const window = new OptionWindow(host);
  window.friendsAnswered([]);
  const click = (point: readonly number[]) => window.release(point[0], point[1]);
  return { window, host, log, click, saved: () => current };
}

describe("option window (scene 13)", () => {
  it("opens with the options' values and waits for the friend list", () => {
    const settings = { ...defaultSettings(), music: false, control: 1 as Control, macros: ["", "a", "", "", "", "", "", "", "", ""] };
    const { window } = setup(settings);
    expect(window.music).toBe(false);
    expect(window.device).toBe(1);
    expect(window.macros[1]).toBe("a");
    const fresh = new OptionWindow(setup(settings).host);
    expect(fresh.busy).toBe(true);
    fresh.friendsAnswered([{ name: "철수", location: "" }]);
    expect(fresh.busy).toBe(false);
  });

  it("toggles the checks without saving; O saves them and closes", () => {
    const { window, click, log, saved } = setup();
    click(AT.music);
    click(AT.effects);
    click(AT.balloons);
    expect([window.music, window.effects, window.balloons]).toEqual([false, false, false]);
    expect(log).toEqual([]);
    click(AT.ok);
    expect(log).toEqual(["save", "close"]);
    expect(saved()).toMatchObject({ music: false, effects: false, balloons: false });
  });

  it("X and Esc go back to the options and close without saving", () => {
    const { window, click, log } = setup();
    click(AT.music);
    click(AT.bomb);
    window.poll(["KeyA"]);
    click(AT.cancel);
    expect(window.music).toBe(true);
    expect(window.keys).toEqual([0x39, 0x1d, 0x2c]);
    expect(log).toEqual(["close"]);
    const again = setup();
    again.click(AT.effects);
    again.window.escape();
    expect(again.window.effects).toBe(true);
    expect(again.log).toEqual(["close"]);
  });

  it("초기화 turns everything back on, clears the macros, saves and stays open; the device is not reset", () => {
    const settings = { ...defaultSettings(), music: false, balloons: false, keys: [0x1e, 0x1f, 0x21] as [number, number, number], control: 1 as Control, macros: Array(10).fill("x") };
    const { window, click, log, saved } = setup(settings);
    click(AT.reset);
    expect(log).toEqual(["save"]);
    expect(saved()).toMatchObject({ music: true, balloons: true, keys: [0x39, 0x1d, 0x2c], control: 1 });
    expect(saved().macros.every((m) => m === "")).toBe(true);
    // The 1P mark shows though the joystick is still the device; X puts the mark back.
    expect(window.device).toBe(0);
    click(AT.cancel);
    expect(window.device).toBe(1);
  });

  it("Enter ends a macro edit first, then answers the popup, then saves and closes", () => {
    const { window, click, log } = setup();
    click(AT.macro(0));
    window.editorText("hi");
    window.enter();
    expect(window.editing).toBe(-1);
    expect(log).toEqual(["edit macro ", "edit off"]);
    window.enter();
    expect(log.slice(-2)).toEqual(["save", "close"]);
  });

  it("edits box k as CM(k+2), live, and keeps the text when the edit ends", () => {
    const { window, click, saved } = setup();
    click(AT.macro(4));
    expect(window.editing).toBe(4);
    window.editorText("안녕하세요");
    click(AT.elsewhere);
    expect(window.editing).toBe(-1);
    expect(window.macros[5]).toBe("안녕하세요");
    click(AT.ok);
    expect(saved().macros[5]).toBe("안녕하세요");
    expect(saved().macros[0]).toBe("");
  });

  it("does not end a macro edit on a check, but does on a key box, a friend row or elsewhere", () => {
    const { window, click } = setup();
    click(AT.macro(0));
    click(AT.music);
    expect(window.editing).toBe(0);
    click(AT.item1);
    expect(window.editing).toBe(-1);
    expect(window.changing).toBe(1);
    click(AT.macro(2));
    expect(window.changing).toBe(-1);
    click(AT.friend(0));
    expect(window.editing).toBe(-1);
  });

  describe("key change (poll 0x402090)", () => {
    it("binds the lowest held key and stays on until something ends it", () => {
      const { window, click } = setup();
      click(AT.bomb);
      window.poll([]);
      expect(window.keys[0]).toBe(0x39);
      window.poll(["KeyW", "KeyQ"]);
      expect(window.keys[0]).toBe(0x10);
      window.poll(["KeyE"]);
      expect(window.keys[0]).toBe(0x12);
      expect(window.changing).toBe(0);
      click(AT.elsewhere);
      window.poll(["KeyR"]);
      expect(window.keys[0]).toBe(0x12);
    });

    it("refuses D with the message on every poll it is held", () => {
      const { window, click, log } = setup();
      click(AT.item2);
      window.poll(["KeyD"]);
      window.poll(["KeyD"]);
      expect(log).toEqual(["message D key는 이미 사용중입니다.", "message D key는 이미 사용중입니다."]);
      expect(window.keys[2]).toBe(0x2c);
    });

    it("swaps with the slot holding the key over two polls; one poll leaves the other slot changed only", () => {
      const { window, click } = setup();
      click(AT.bomb);
      window.poll(["KeyZ"]);
      expect(window.keys).toEqual([0x39, 0x1d, 0x39]);
      window.poll(["KeyZ"]);
      expect(window.keys).toEqual([0x2c, 0x1d, 0x39]);
    });

    it("does nothing with the joystick as the device, or with keys the poll does not scan", () => {
      const { window, click } = setup({ ...defaultSettings(), control: 1 });
      click(AT.bomb);
      window.poll(["KeyA"]);
      expect(window.keys[0]).toBe(0x39);
      const keyboard = setup();
      keyboard.click(AT.bomb);
      keyboard.window.poll(["ArrowUp", "Escape"]);
      expect(keyboard.window.keys[0]).toBe(0x39);
    });

    it("stops the live macro sync while it is on", () => {
      const { window, click } = setup();
      click(AT.macro(1));
      window.changing = 0;
      window.editorText("x");
      expect(window.macros[2]).toBe("");
    });
  });

  describe("device (0x421e90, 0x421f90)", () => {
    it("switches at once, or says it failed and ends the edit and the key change", () => {
      const ok = setup();
      ok.click(AT.joystick);
      expect(ok.window.device).toBe(1);
      expect(ok.log).toEqual(["control 1"]);
      ok.click(AT.keyboard);
      expect(ok.log).toEqual(["control 1", "control 0"]);
      const none = setup(defaultSettings(), { joystick: false });
      none.click(AT.macro(0));
      none.click(AT.joystick);
      expect(none.window.device).toBe(0);
      expect(none.window.editing).toBe(-1);
      expect(none.log).toContain("message 조이스틱 초기화 에러");
    });

    it("only moves the marks when control is already that device", () => {
      const { window, click, log } = setup({ ...defaultSettings(), control: 1 });
      click(AT.joystick);
      expect(log).toEqual([]);
      expect(window.device).toBe(1);
    });
  });

  describe("friend popup (0x422c40)", () => {
    it("asks to delete a row with an ID and to add on an empty row", () => {
      const { window, click, log } = setup();
      window.friendsAnswered([{ name: "영희", location: "복원판 채널" }]);
      click(AT.friend(0));
      expect(window.popup).toEqual({ mode: "delete", name: "영희" });
      click(AT.popupOk);
      expect(log).toEqual(["delete 영희"]);
      expect(window.busy).toBe(true);
      window.friendAnswered();
      expect(window.popup).toBeNull();
      expect(window.busy).toBe(false);
      window.friendsAnswered([]);
      click(AT.friend(3));
      expect(window.popup).toEqual({ mode: "add", name: "" });
      expect(log.at(-1)).toBe("edit friend ");
    });

    it("takes only its O and X while open; an ID over 10 bytes closes it without asking", () => {
      const { window, click, log } = setup();
      click(AT.friend(0));
      click(AT.ok);
      expect(log).toEqual(["edit friend "]);
      window.editorText("가나다라마바");
      click(AT.popupOk);
      expect(window.popup).toBeNull();
      expect(log).toEqual(["edit friend ", "edit off"]);
      click(AT.friend(0));
      window.editorText("친구");
      window.enter();
      expect(log.at(-1)).toBe("add 친구");
    });

    it("Esc and X close the popup before the window", () => {
      const { window, click, log } = setup();
      click(AT.friend(0));
      window.escape();
      expect(window.popup).toBeNull();
      expect(log).not.toContain("close");
      click(AT.friend(0));
      click(AT.popupCancel);
      expect(window.popup).toBeNull();
    });
  });
});
