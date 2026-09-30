import { describe, expect, it } from "vitest";

import { FRIEND_POPUP } from "./optionLayout.ts";
import {
  genderIcon,
  RANKING_POPUP,
  RANKING_WINDOW_AT,
  rankingButtonAt,
  rankingCaret,
  rankingHelpAt,
  rankingHoverAt,
  rankingPopupAt,
  rankingPressedAt,
  rankingRowY,
} from "./rankingWindowLayout.ts";

describe("the lobby's ranking window (scene 12)", () => {
  it("finds X, ◀, ▶ and FIND by their rects, edges included", () => {
    expect(rankingButtonAt(495, 522)).toBe("close");
    expect(rankingButtonAt(524, 551)).toBe("close");
    expect(rankingButtonAt(136, 468)).toBe("prev");
    expect(rankingButtonAt(193, 496)).toBe("prev");
    expect(rankingButtonAt(468, 496)).toBe("next");
    expect(rankingButtonAt(300, 480)).toBe("find");
    expect(rankingButtonAt(200, 480)).toBeNull();
    expect(rankingButtonAt(83, 191)).toBeNull();
  });

  it("has hover art for ◀, FIND and ▶ only, and pressed art for all four", () => {
    expect(rankingHoverAt(150, 480)).toBe("prev");
    expect(rankingHoverAt(500, 530)).toBeNull();
    expect(rankingPressedAt(500, 530)).toBe("close");
    expect(rankingPressedAt(420, 470)).toBe("next");
  });

  it("puts the rows 18 px apart from y 191, fifteen within the art", () => {
    expect(rankingRowY(0)).toBe(191);
    expect(rankingRowY(14)).toBe(191 + 18 * 14);
    expect(rankingRowY(14) + 16).toBeLessThan(RANKING_WINDOW_AT.y + 460);
  });

  it("shows gender 1 and 2 only", () => {
    expect(genderIcon(1)).toEqual([111, 78, 126, 91]);
    expect(genderIcon(2)).toEqual([94, 78, 109, 91]);
    expect(genderIcon(0)).toBeNull();
  });

  it("lays the FIND popup out as the option window's friend popup, moved", () => {
    const dx = RANKING_POPUP.at.x - FRIEND_POPUP.at.x;
    const dy = RANKING_POPUP.at.y - FRIEND_POPUP.at.y;
    expect(RANKING_POPUP.src).toEqual(FRIEND_POPUP.src);
    expect(RANKING_POPUP.label.src).toEqual(FRIEND_POPUP.label.src);
    expect(RANKING_POPUP.label.at).toEqual({ x: FRIEND_POPUP.label.at.x + dx, y: FRIEND_POPUP.label.at.y + dy });
    expect(RANKING_POPUP.text).toEqual({ x: FRIEND_POPUP.text.x + dx, y: FRIEND_POPUP.text.y + dy });
    expect(RANKING_POPUP.ok.at).toEqual({ x: FRIEND_POPUP.ok.at.x + dx, y: FRIEND_POPUP.ok.at.y + dy });
    expect(RANKING_POPUP.cancel.at).toEqual({ x: FRIEND_POPUP.cancel.at.x + dx, y: FRIEND_POPUP.cancel.at.y + dy });
    expect(rankingPopupAt(208, 375)).toBe("ok");
    expect(rankingPopupAt(425, 405)).toBe("cancel");
    expect(rankingPopupAt(300, 325)).toBeNull();
    expect(rankingCaret(3)).toEqual({ x: 258 + 21, y: 325 });
  });

  it("gives the popup's balloons over the message box, and the window's only without it", () => {
    expect(rankingHelpAt(220, 390, { popup: true, message: true })?.text).toBe("확인(enter)");
    expect(rankingHelpAt(400, 390, { popup: true, message: false })?.text).toBe("취소 버튼(esc)");
    expect(rankingHelpAt(150, 480, { popup: true, message: false })).toBeNull();
    expect(rankingHelpAt(150, 480, { popup: false, message: false })).toEqual({ text: "이전리스트 보기", x: 150, y: 480 });
    expect(rankingHelpAt(300, 480, { popup: false, message: false })?.text).toBe("원하는 아이디 랭킹 확인");
    expect(rankingHelpAt(420, 480, { popup: false, message: false })?.text).toBe("다음 리스트 보기");
    expect(rankingHelpAt(500, 530, { popup: false, message: false })?.text).toBe("창닫기(esc)");
    expect(rankingHelpAt(500, 530, { popup: false, message: true })).toBeNull();
  });
});
