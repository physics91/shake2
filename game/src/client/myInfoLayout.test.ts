import { describe, expect, it } from "vitest";

import { RANKING_POPUP } from "./rankingWindowLayout.ts";
import {
  CHARACTER_IDS,
  CHARACTER_NAMES,
  characterIndex,
  dropdownHeight,
  dropdownLineAt,
  dropdownLines,
  greetingCaret,
  greetingLines,
  myInfoButtonAt,
  myInfoHelpAt,
  newColourSlider,
  NICK_POPUP,
  nickCaret,
  slideColour,
  stepCharacter,
} from "./myInfoLayout.ts";

const ALL = Array.from({ length: 20 }, (_, i) => i);
/** A new 0311 account: pairs 0-4 and 8 (0x448c50). */
const DEFAULT_OWNED = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 16, 17];

describe("my-info characters (0x469adc, 0x469bc0)", () => {
  it("lists the 20 characters in the original's order with their padded names", () => {
    expect(CHARACTER_IDS).toHaveLength(20);
    expect(CHARACTER_IDS.slice(0, 4)).toEqual(["rookie", "tofi", "imp", "bogle"]);
    expect(CHARACTER_IDS.slice(18)).toEqual(["doonae", "rookiee"]);
    expect(CHARACTER_NAMES[0]).toBe("루    키");
    expect(CHARACTER_NAMES[5]).toBe("   둔   ");
    expect(characterIndex("doona")).toBe(4);
    expect(characterIndex("w-doomy")).toBe(-1);
  });

  it("steps the arrows through owned characters only, wrapping at both ends (0x43e320)", () => {
    expect(stepCharacter(9, 1, DEFAULT_OWNED)).toBe(16);
    expect(stepCharacter(17, 1, DEFAULT_OWNED)).toBe(0);
    expect(stepCharacter(0, -1, DEFAULT_OWNED)).toBe(17);
    expect(stepCharacter(19, 1, ALL)).toBe(0);
    expect(stepCharacter(0, -1, ALL)).toBe(19);
  });

  it("lists the dropdown by owned pairs: two lines a pair, 30 px a pair plus 3 (0x43c510)", () => {
    expect(dropdownLines(DEFAULT_OWNED)).toEqual(DEFAULT_OWNED);
    expect(dropdownLines(ALL)).toEqual(ALL);
    expect(dropdownHeight(DEFAULT_OWNED)).toBe(183);
    expect(dropdownHeight(ALL)).toBe(303);
  });

  it("picks the first line whose band holds the point, 542..613 by 287+15j..305+15j (0x43eda0)", () => {
    expect(dropdownLineAt(542, 287, 20)).toBe(0);
    expect(dropdownLineAt(613, 301, 20)).toBe(0);
    // Line 0's band reaches 305, so line 1 starts at 306 in effect.
    expect(dropdownLineAt(600, 305, 20)).toBe(0);
    expect(dropdownLineAt(600, 306, 20)).toBe(1);
    expect(dropdownLineAt(600, 286, 20)).toBe(-1);
    expect(dropdownLineAt(614, 290, 20)).toBe(-1);
    expect(dropdownLineAt(560, 590, 20)).toBe(19);
    expect(dropdownLineAt(560, 590, 12)).toBe(-1);
  });
});

describe("my-info greeting (0x418760, 0x43e040)", () => {
  it("wraps at 18 bytes without splitting a double-byte character, two lines at most", () => {
    expect(greetingLines("안녕하세요 반갑습니다 잘 부탁해요")).toEqual(["안녕하세요 반갑습", "니다 잘 부탁해요"]);
    expect(greetingLines(`${"a".repeat(17)}가나`)).toEqual(["a".repeat(17), "가나"]);
    expect(greetingLines("x".repeat(40))).toEqual(["x".repeat(18), "x".repeat(18)]);
  });

  it("puts the caret on line 1 while the text is under 18 bytes, else on line 2 at 7 px a byte past 18", () => {
    expect(greetingCaret(5, 5)).toEqual({ x: 323 + 35, y: 282 });
    expect(greetingCaret(18, 18)).toEqual({ x: 323, y: 297 });
    expect(greetingCaret(30, 30)).toEqual({ x: 323 + 84, y: 297 });
    expect(greetingCaret(30, 4)).toEqual({ x: 323, y: 297 });
  });
});

describe("my-info buttons and balloons (0x43c790, 0x43d9a0)", () => {
  it("finds the main window's buttons, edges included", () => {
    expect(myInfoButtonAt(651, 504)).toBe("close");
    expect(myInfoButtonAt(128, 534)).toBe("save");
    expect(myInfoButtonAt(532, 270)).toBe("prev");
    expect(myInfoButtonAt(624, 284)).toBe("next");
    expect(myInfoButtonAt(303, 223)).toBe("useId");
    expect(myInfoButtonAt(324, 267)).toBe("greeting");
    expect(myInfoButtonAt(542, 268)).toBe("names");
    expect(myInfoButtonAt(300, 300)).toBeNull();
  });

  it("gives each part its balloon, the portrait's kept left of 594", () => {
    expect(myInfoHelpAt(310, 230, { useId: false })).toEqual({ text: "게임중에서 아이디 사용시 체크", x: 310, y: 230 });
    expect(myInfoHelpAt(310, 230, { useId: true })?.text).toBe("닉네임을 사용하려면 아이디체크 해지");
    expect(myInfoHelpAt(600, 200, { useId: false })).toEqual({ text: "화살표로 원하는 캐릭터 선택가능", x: 594, y: 200 });
    expect(myInfoHelpAt(615, 275, { useId: false })?.x).toBe(594);
    expect(myInfoHelpAt(100, 510, { useId: false })?.text).toBe("입력 및 수정 확인(enter)");
    expect(myInfoHelpAt(660, 510, { useId: false })?.text).toBe("취소 버튼(esc)");
    expect(myInfoHelpAt(560, 470, { useId: false })?.text).toBe("현재 지원안함");
    expect(myInfoHelpAt(300, 300, { useId: false })).toBeNull();
  });
});

describe("my-info colour popup (0x43cd8a, 0x43e580)", () => {
  it("opens at hue 0 with the knob at 526, whatever the hue was", () => {
    expect(newColourSlider()).toEqual({ hue: 0, knob: 526 });
  });

  it("steps ◀ one hue and 0.21 px a held frame, and snaps from −153 to −180 at the knob's stop", () => {
    const slider = newColourSlider();
    for (let i = 0; i < 152; i++) expect(slideColour(slider, 480, 274)).toBe(true);
    expect(slider.hue).toBe(-152);
    expect(slider.knob).toBeGreaterThan(494);
    slideColour(slider, 480, 274);
    expect(slider).toEqual({ hue: -180, knob: 488 });
    slideColour(slider, 480, 274);
    expect(slider).toEqual({ hue: -180, knob: 488 });
  });

  it("steps ▶ up to 180 and the knob to 564", () => {
    const slider = newColourSlider();
    for (let i = 0; i < 180; i++) slideColour(slider, 585, 274);
    expect(slider.hue).toBe(180);
    expect(slider.knob).toBeLessThan(564);
    slideColour(slider, 585, 274);
    expect(slider).toEqual({ hue: 180, knob: 564 });
  });

  it("sets the hue from the track: (x − 530) / 37 · 180 cut toward 0, the knob 6 px left of the mouse", () => {
    const slider = newColourSlider();
    slideColour(slider, 531, 270);
    expect(slider).toEqual({ hue: 4, knob: 525 });
    slideColour(slider, 520, 270);
    expect(slider).toEqual({ hue: -48, knob: 514 });
    slideColour(slider, 494, 270);
    expect(slider).toEqual({ hue: -180, knob: 488 });
    slideColour(slider, 564, 281);
    expect(slider).toEqual({ hue: 180, knob: 564 });
    expect(slideColour(slider, 530, 290)).toBe(false);
    expect(slideColour(slider, 487, 270)).toBe(false);
    expect(slider).toEqual({ hue: 180, knob: 564 });
  });

  it("has its own balloons over O, X and the slider", () => {
    expect(myInfoHelpAt(410, 330, { useId: false, popup: "colour" })?.text).toBe("입력 및 수정 확인(enter)");
    expect(myInfoHelpAt(650, 330, { useId: false, popup: "colour" })?.text).toBe("취소 버튼(esc)");
    expect(myInfoHelpAt(500, 274, { useId: false, popup: "colour" })?.text).toBe("화살표로 색 조절");
    expect(myInfoHelpAt(100, 510, { useId: false, popup: "colour" })).toBeNull();
    expect(myInfoHelpAt(290, 350, { useId: false, popup: "greeting" })?.text).toBe("입력 및 수정 확인(enter)");
  });
});

describe("my-info nickname popup (0x43d248, 0x43eac0)", () => {
  it("draws new_basicwindow as the other ID popups do, with its own O and X a pixel wider", () => {
    expect(NICK_POPUP.src).toEqual(RANKING_POPUP.src);
    expect(NICK_POPUP.ok.pressed).toEqual(RANKING_POPUP.ok.pressed);
    expect(NICK_POPUP.cancel.pressed).toEqual(RANKING_POPUP.cancel.pressed);
    expect(NICK_POPUP.ok.hit).toEqual([281, 341, 312, 372]);
    expect(NICK_POPUP.cancel.hit).toEqual([468, 341, 499, 372]);
  });

  it("puts the caret 7 px a byte from x 331 on y 291", () => {
    expect(nickCaret(0)).toEqual({ x: 331, y: 291 });
    expect(nickCaret(10)).toEqual({ x: 401, y: 291 });
  });

  it("has its own balloons over O and X", () => {
    expect(myInfoHelpAt(312, 372, { useId: false, popup: "nickname" })?.text).toBe("입력 및 수정 확인(enter)");
    expect(myInfoHelpAt(499, 341, { useId: false, popup: "nickname" })?.text).toBe("취소 버튼(esc)");
    expect(myInfoHelpAt(331, 291, { useId: false, popup: "nickname" })).toBeNull();
  });
});
