import { describe, expect, it } from "vitest";
import { cp949Bytes } from "../server/cp949.ts";
import {
  checkAnswer,
  checkProblem,
  fieldOfFocus,
  idCode,
  nextFocus,
  scrollTerms,
  SIGN_UP_BUTTONS,
  SIGN_UP_ERROR,
  signUpCaret,
  signUpMessage,
  signUpProblem,
  signUpRequest,
  signUpTargetAt,
  stripBlanks,
  TERMS_LINES,
  TERMS_MAX_BYTES,
  TERMS_MAX_TOP,
} from "./signUpLayout.ts";

const good = { id: "tester9", nick: "시험", password: "pass1234", confirm: "pass1234", agreed: true };

describe("the sign-up window's places", () => {
  it("finds the buttons, the agree boxes and the four fields; the mail pair and the other fields take nothing", () => {
    expect(signUpTargetAt(344, 151)).toBe("idCheck");
    expect(signUpTargetAt(415, 192)).toBe("nickCheck");
    expect(signUpTargetAt(400, 510)).toBe("submit");
    expect(signUpTargetAt(627, 525)).toBe("close");
    expect(signUpTargetAt(600, 350)).toBe("termsUp");
    expect(signUpTargetAt(600, 430)).toBe("termsDown");
    expect(signUpTargetAt(320, 460)).toBe("agree");
    expect(signUpTargetAt(500, 460)).toBe("disagree");
    expect(signUpTargetAt(300, 160)).toBe("id");
    expect(signUpTargetAt(300, 180)).toBe("nick");
    expect(signUpTargetAt(300, 205)).toBe("password");
    expect(signUpTargetAt(600, 205)).toBe("confirm");
    // 기입, 기입안함, 이름, 주민번호, 이메일, the region box.
    for (const [x, y] of [[510, 295], [590, 295], [300, 228], [300, 250], [350, 250], [300, 297], [300, 275]]) {
      expect(signUpTargetAt(x, y)).toBeNull();
    }
  });

  it("draws the arrows' pressed art one pixel inside their hit rects", () => {
    expect(SIGN_UP_BUTTONS.termsUp.at.y).toBe(SIGN_UP_BUTTONS.termsUp.hit[1] + 1);
    expect(SIGN_UP_BUTTONS.termsDown.at.y).toBe(SIGN_UP_BUTTONS.termsDown.hit[1] - 1);
  });

  it("tabs through the fields and the two checks, and back from the password's repeat", () => {
    const seen = [0];
    let focus = nextFocus(0);
    while (focus !== 0) {
      seen.push(focus);
      focus = nextFocus(focus);
    }
    expect(seen).toEqual([0, 1, 2, 3, 4, 5]);
    expect([0, 1, 2, 3, 4, 5].map((f) => fieldOfFocus(f as 0))).toEqual(["id", null, "nick", null, "password", "confirm"]);
  });

  it("moves the caret 6 px a byte from each field's start", () => {
    expect(signUpCaret("id", 0)).toEqual({ x: 274, y: 154 });
    expect(signUpCaret("confirm", 4)).toEqual({ x: 557 + 24, y: 199 });
  });
});

describe("the terms box's notice", () => {
  it("keeps each line inside the box and scrolls to its last five", () => {
    for (const line of TERMS_LINES) expect(cp949Bytes(line), line).toBeLessThanOrEqual(TERMS_MAX_BYTES);
    expect(TERMS_MAX_TOP).toBe(TERMS_LINES.length - 5);
    expect(scrollTerms(0, -1)).toBe(0);
    expect(scrollTerms(TERMS_MAX_TOP, 1)).toBe(TERMS_MAX_TOP);
    expect(scrollTerms(3, 1)).toBe(4);
  });
});

describe("가입하기's checks", () => {
  it("stops at the first failing check, in the window's order, with its focus", () => {
    expect(signUpProblem({ ...good, id: "" })).toEqual({ text: "ID을 입력하세요.", focus: 0 });
    expect(signUpProblem({ ...good, id: "abc", nick: "" })).toEqual({ text: "ID는 4글자 이상입니다.", focus: 0 });
    expect(signUpProblem({ ...good, nick: "" })?.focus).toBe(2);
    expect(signUpProblem({ ...good, confirm: "" })).toEqual({ text: "비밀번호를  입력하세요.", focus: 4 });
    expect(signUpProblem({ ...good, confirm: "pass12345" })).toEqual({ text: "입력하신 두개의 비밀번호가\n일치하지 않습니다.", focus: 4 });
    expect(signUpProblem({ ...good, password: "abc", confirm: "abc" })?.text).toBe("비밀번호는 4글자 이상입니다.");
    expect(signUpProblem({ ...good, agreed: false })).toEqual({ text: "회원가입을 하시려면 약관동의를\n체크하셔야 합니다.", focus: null });
    expect(signUpProblem(good)).toBeNull();
  });

  it("counts bytes: two Hangul are four", () => {
    expect(signUpProblem({ ...good, password: "가나", confirm: "가나" })).toBeNull();
    expect(signUpProblem({ ...good, id: "가" })?.text).toBe("ID는 4글자 이상입니다.");
  });

  it("drops the blanks before sending, and 0x45f280 answers for a bad ID without asking", () => {
    expect(stripBlanks(" a b 가 ")).toBe("ab가");
    expect(signUpRequest({ ...good, id: "tes ter", nick: "시 험", password: "pa ss1234", confirm: "pa ss1234" })).toEqual({
      id: "tester",
      nick: "시험",
      password: "pass1234",
    });
    expect(signUpRequest({ ...good, nick: "    " })).toEqual({ rcode: SIGN_UP_ERROR });
    expect(signUpRequest({ ...good, id: "abc  " })).toEqual({ rcode: 7 });
    expect(signUpRequest({ ...good, id: "한글아이디" })).toEqual({ rcode: 8 });
    expect(signUpRequest({ ...good, id: "1tester" })).toEqual({ rcode: 9 });
  });

  it("orders 0x45f280's codes: length, then characters, then the first digit", () => {
    expect(idCode("ab")).toBe(7);
    expect(idCode("abcdefghijk")).toBe(7);
    expect(idCode("한")).toBe(7);
    expect(idCode("ab_cd")).toBe(8);
    expect(idCode("9abc")).toBe(9);
    expect(idCode("abc9")).toBeNull();
  });

  it("words each rcode as the original, the unknown ones as its failure", () => {
    expect(signUpMessage(0)).toBe("가입 처리가 완료 되었습니다");
    expect(signUpMessage(4)).toBe("이미 사용중인 아이디 입니다");
    expect(signUpMessage(5)).toBe("이미 사용중인 닉네임 입니다");
    expect(signUpMessage(2)).toBe(signUpMessage(3));
    for (const rcode of [7, 10, SIGN_UP_ERROR]) expect(signUpMessage(rcode)).toBe("가입처리중 오류가 발생했습니다\n재 가입 해주시기 바랍니다");
  });
});

describe("the ID and nick checks", () => {
  it("refuses an empty field and reads anything but 0 as taken", () => {
    expect(checkProblem("id", "")).toEqual({ text: "ID을 입력하세요.", focus: 0 });
    expect(checkProblem("nick", "")).toEqual({ text: "닉네임을 입력하세요.", focus: 2 });
    expect(checkProblem("id", "a")).toBeNull();
    expect(checkAnswer("id", 0)).toEqual({ text: "사용가능한  아이디 입니다", focus: 2 });
    expect(checkAnswer("nick", 0)).toEqual({ text: "사용가능한  닉네임 입니다", focus: 4 });
    expect(checkAnswer("id", SIGN_UP_ERROR)).toEqual({ text: "이미 사용중인 아이디 입니다", focus: 0 });
    expect(checkAnswer("nick", 1)).toEqual({ text: "이미 사용중인 닉네임 입니다", focus: 2 });
  });
});
