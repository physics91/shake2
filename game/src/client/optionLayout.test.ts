import { describe, expect, it } from "vitest";

import {
  friendCaret,
  friendRowAt,
  friendRowY,
  macroBox,
  macroBoxAt,
  macroCaret,
  macroLines,
  optionHelpAt,
  optionTargetAt,
  popupTargetAt,
} from "./optionLayout.ts";

describe("option window releases (0x45a172)", () => {
  it("finds the buttons, the checks and the key boxes by their rects, edges included", () => {
    expect(optionTargetAt(86, 521)).toEqual({ kind: "ok" });
    expect(optionTargetAt(116, 551)).toEqual({ kind: "ok" });
    expect(optionTargetAt(400, 540)).toEqual({ kind: "reset" });
    expect(optionTargetAt(669, 551)).toEqual({ kind: "cancel" });
    expect(optionTargetAt(189, 474)).toEqual({ kind: "check", id: "music" });
    expect(optionTargetAt(300, 480)).toEqual({ kind: "check", id: "effects" });
    expect(optionTargetAt(635, 496)).toEqual({ kind: "check", id: "balloons" });
    expect(optionTargetAt(200, 360)).toEqual({ kind: "check", id: "keyboard" });
    expect(optionTargetAt(325, 365)).toEqual({ kind: "check", id: "joystick" });
    expect(optionTargetAt(150, 410)).toEqual({ kind: "key", slot: 0 });
    expect(optionTargetAt(230, 410)).toEqual({ kind: "key", slot: 1 });
    expect(optionTargetAt(339, 418)).toEqual({ kind: "key", slot: 2 });
  });

  it("gives 2P, 기본정보공개 and the location column no action of their own", () => {
    expect(optionTargetAt(240, 360)).toEqual({ kind: "elsewhere" });
    expect(optionTargetAt(505, 485)).toEqual({ kind: "elsewhere" });
    expect(optionTargetAt(600, 300)).toEqual({ kind: "elsewhere" });
  });

  it("maps the nine macro boxes row-major to F2..F10, with the gaps between them outside", () => {
    expect(macroBoxAt(108, 174)).toBe(0);
    expect(macroBoxAt(266, 200)).toBe(1);
    expect(macroBoxAt(300, 328)).toBe(8);
    expect(macroBoxAt(187, 200)).toBe(-1);
    expect(macroBoxAt(150, 225)).toBe(-1);
    expect(optionTargetAt(200, 250)).toEqual({ kind: "macro", box: 4 });
    expect(macroBox(0).text).toEqual({ x: 110, y: 177 });
    expect(macroBox(4).text).toEqual({ x: 191, y: 230 });
    expect(macroBox(8).text).toEqual({ x: 272, y: 283 });
  });

  it("takes friend rows 21 px apart, each 17 rows tall", () => {
    expect(friendRowAt(409, 201)).toBe(0);
    expect(friendRowAt(534, 217)).toBe(0);
    expect(friendRowAt(450, 219)).toBe(-1);
    expect(friendRowAt(450, 222)).toBe(1);
    expect(friendRowAt(450, 449)).toBe(-1);
    expect(friendRowAt(450, 432)).toBe(11);
    expect(friendRowY(11)).toBe(434);
    expect(optionTargetAt(420, 205)).toEqual({ kind: "friend", row: 0 });
  });

  it("answers only the popup's O and X while it is open", () => {
    expect(popupTargetAt(460, 440)).toBe("ok");
    expect(popupTargetAt(676, 467)).toBe("cancel");
    expect(popupTargetAt(90, 530)).toBeNull();
  });
});

describe("macro text (0x418870) and caret (0x421d80)", () => {
  it("wraps at 12 bytes, moves a double-byte character at the 12th byte down and keeps three lines", () => {
    expect(macroLines("abcdefghijklmnop")).toEqual(["abcdefghijkl", "mnop"]);
    expect(macroLines("abcdefghijk가나")).toEqual(["abcdefghijk", "가나"]);
    expect(macroLines("가".repeat(18))).toEqual(["가".repeat(6), "가".repeat(6), "가".repeat(6)]);
    expect(macroLines("")).toEqual([]);
  });

  it("puts the caret by the text's length: 6 px a byte on the line the length reaches", () => {
    const at = { x: 110, y: 177 };
    expect(macroCaret(0, 0, at)).toEqual({ x: 110, y: 177 });
    expect(macroCaret(11, 11, at)).toEqual({ x: 176, y: 177 });
    expect(macroCaret(12, 12, at)).toEqual({ x: 110, y: 192 });
    expect(macroCaret(30, 30, at)).toEqual({ x: 146, y: 207 });
  });

  it("keeps the caret at the line's start when it stands before the line's 12th byte (0x403e90)", () => {
    const at = { x: 110, y: 177 };
    // 20 bytes typed, the caret moved back to byte 5: line 2, not 42 px left of the box.
    expect(macroCaret(20, 5, at)).toEqual({ x: 110, y: 192 });
    expect(macroCaret(30, 20, at)).toEqual({ x: 110, y: 207 });
    // A double-byte character wrapped at byte 11 starts line 2 there; the caret still counts from 12.
    expect(macroCaret(13, 13, at)).toEqual({ x: 116, y: 192 });
  });

  it("puts the friend popup's caret 7 px a byte from (508,386)", () => {
    expect(friendCaret(3)).toEqual({ x: 529, y: 386 });
  });
});

describe("option window balloons (0x421840)", () => {
  const clear = { popup: false, message: false };
  it("shows the window's texts at the raw mouse", () => {
    expect(optionHelpAt(120, 180, clear)).toEqual({ text: "단축메세지지정, 클릭하면 편집가능", x: 120, y: 180 });
    expect(optionHelpAt(240, 360, clear)?.text).toBe("현재 지원안함");
    expect(optionHelpAt(130, 410, clear)?.text).toBe("키보드 설정변경 클릭하면 키 바꿈모드");
    expect(optionHelpAt(505, 485, clear)?.text).toBe("체크되면 모든 정보 공개(준비중)");
    expect(optionHelpAt(600, 300, clear)?.text).toBe("친구의 위치표시");
    expect(optionHelpAt(100, 530, clear)?.text).toBe("입력 및 수정 확인(enter)");
    expect(optionHelpAt(650, 530, clear)?.text).toBe("취소 버튼(esc)");
  });

  it("keeps to the popup's O and X while it is open, and shows none under the message box without it", () => {
    expect(optionHelpAt(460, 440, { popup: true, message: false })?.text).toBe("입력 및 수정 확인(enter)");
    expect(optionHelpAt(460, 440, { popup: true, message: true })?.text).toBe("입력 및 수정 확인(enter)");
    expect(optionHelpAt(120, 180, { popup: true, message: false })).toBeNull();
    expect(optionHelpAt(650, 440, { popup: false, message: true })).toBeNull();
    expect(optionHelpAt(120, 180, { popup: false, message: true })).toBeNull();
  });
});
