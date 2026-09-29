import { describe, expect, it } from "vitest";

import { Dir } from "../sim/types.ts";
import { keyLabel, KeyState, SOLO_KEYS, soloKeys, soloKeysHelp, VERSUS_KEYS } from "./input.ts";

describe("one player's keys (0x4699ac)", () => {
  it("keeps the arrows and takes the three action keys from the options by DIK", () => {
    expect(SOLO_KEYS).toMatchObject({ up: ["ArrowUp"], bomb: ["Space"], attack: ["ControlLeft"], evade: ["KeyZ"] });
    const keys = soloKeys([0x1e, 0x10, 0x39]);
    expect(keys).toMatchObject({ left: ["ArrowLeft"], bomb: ["KeyA"], attack: ["KeyQ"], evade: ["Space"] });
    expect(soloKeys([0x54, 0x1d, 0x2c]).bomb).toEqual(["Space"]);
  });

  it("names them for the page", () => {
    expect(soloKeysHelp(SOLO_KEYS)).toBe("이동: 방향키 · 폭탄: Space · 공격용: 왼쪽 Ctrl · 회피용: Z");
    expect(soloKeysHelp(SOLO_KEYS, true)).toBe(
      "이동: 조이스틱 스틱 · 폭탄: 0번 단추 · 공격용: 2번 단추 · 회피용: 1번 단추 (패드 단추를 한 번 누르기 전에는 키보드: 이동: 방향키 · 폭탄: Space · 공격용: 왼쪽 Ctrl · 회피용: Z)",
    );
    expect(keyLabel("ShiftRight")).toBe("오른쪽 Shift");
    expect(keyLabel("Digit5")).toBe("5");
    expect(keyLabel("Numpad0")).toBe("숫자패드 0");
    expect(keyLabel("F9")).toBe("F9");
  });
});

describe("KeyState", () => {
  it("picks up, then down, then left, then right among held directions, whatever the press order", () => {
    const keys = new KeyState();
    keys.press("ArrowRight");
    keys.press("ArrowLeft");
    expect(keys.sample(SOLO_KEYS).dir).toBe(Dir.Left);
    keys.press("ArrowDown");
    expect(keys.sample(SOLO_KEYS).dir).toBe(Dir.Down);
    keys.press("ArrowUp");
    expect(keys.sample(SOLO_KEYS).dir).toBe(Dir.Up);

    keys.release("ArrowUp");
    keys.release("ArrowDown");
    keys.release("ArrowLeft");
    expect(keys.sample(SOLO_KEYS).dir).toBe(Dir.Right);
    keys.release("ArrowRight");
    expect(keys.sample(SOLO_KEYS).dir).toBeNull();
  });

  it("keeps a bomb tap between two ticks for exactly one tick", () => {
    const keys = new KeyState();
    keys.press("Space");
    keys.release("Space");

    expect(keys.sample(SOLO_KEYS).bomb).toBe(true);
    keys.endTick();
    expect(keys.sample(SOLO_KEYS).bomb).toBe(false);
  });

  it("separates the two players of a shared keyboard", () => {
    const keys = new KeyState();
    keys.press("KeyD");
    keys.press("ArrowDown");
    keys.press("Enter");

    expect(keys.sample(VERSUS_KEYS[0])).toEqual({ dir: Dir.Right, bomb: false, attack: false, evade: false });
    expect(keys.sample(VERSUS_KEYS[1])).toEqual({ dir: Dir.Down, bomb: true, attack: false, evade: false });
  });

  it("reads Left Ctrl as the attack item key and Z as the evasion item key, taps included", () => {
    const keys = new KeyState();
    keys.press("ControlLeft");
    keys.press("KeyZ");
    keys.release("KeyZ");

    expect(keys.sample(SOLO_KEYS)).toEqual({ dir: null, bomb: false, attack: true, evade: true });
    keys.endTick();
    expect(keys.sample(SOLO_KEYS)).toEqual({ dir: null, bomb: false, attack: true, evade: false });
  });
});
