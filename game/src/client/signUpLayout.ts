// The NEW ID (가입) window of scene 3 (draw 0x419a5e–0x419e44, clicks 0x41ad60): new_id.shk over the
// server screen, its fields, buttons, checks and messages. Geometry and rules from findings_auth.md §1.
// The original sent the sign-up to the web site (Regist_UP_shake2.asp) and asked it for free IDs and
// nicks (idcheck.asp); here both go to the account server (R). The window's name, resident number,
// region and e-mail are not taken (R, 개인정보 보호법 제24조의2): their boxes stay drawn and empty.
import type { Rect } from "../assets/types.ts";
import { cp949Bytes } from "../server/cp949.ts";
import type { Button, Point } from "./roomLayout.ts";
import { inside } from "./roomLayout.ts";

/** new_id.shk (502×460) at (153,74), keyed like the others (0x419818). */
export const SIGN_UP_PANEL = { x: 153, y: 74 };

/** The fields' text: TEXT_draw font 12, yellow with the black outline (0x41a190). */
export const SIGN_UP_TEXT_COLOUR = "#ffff00";
/** The editor's limit 0xb for all four: 10 bytes (0x41bd70). */
export const SIGN_UP_LIMIT = 11;
/** Font 12's pitch (0x403e70): the caret moves 6 px a byte. */
const CARET_PITCH = 6;

export type SignUpField = "id" | "nick" | "password" | "confirm";

/**
 * The editor's foci (0x41bf50) the remake keeps: 0 ID, 1 the ID check, 2 nick, 3 the nick check,
 * 4 password, 5 its repeat. 6 name, 7–8 resident number and 10 e-mail are not taken (R).
 */
export type SignUpFocus = 0 | 1 | 2 | 3 | 4 | 5;

export const SIGN_UP_FIELDS: Record<SignUpField, { focus: SignUpFocus; text: Point; click: Rect; caret: Point; label: string }> = {
  id: { focus: 0, text: { x: 273, y: 154 }, click: [272, 152, 346, 168], caret: { x: 274, y: 154 }, label: "아이디" },
  nick: { focus: 2, text: { x: 273, y: 177 }, click: [272, 175, 338, 191], caret: { x: 274, y: 177 }, label: "닉네임" },
  password: { focus: 4, text: { x: 273, y: 199 }, click: [272, 197, 338, 213], caret: { x: 274, y: 199 }, label: "비밀번호" },
  confirm: { focus: 5, text: { x: 556, y: 199 }, click: [555, 197, 621, 213], caret: { x: 557, y: 199 }, label: "비밀번호확인" },
};

export function fieldOfFocus(focus: SignUpFocus): SignUpField | null {
  for (const [name, field] of Object.entries(SIGN_UP_FIELDS)) if (field.focus === focus) return name as SignUpField;
  return null;
}

export function signUpCaret(field: SignUpField, caretBytes: number): Point {
  const { caret } = SIGN_UP_FIELDS[field];
  return { x: caret.x + CARET_PITCH * caretBytes, y: caret.y };
}

/** Tab (0x41bf50, table 0x41c0ac): 0→1→…→5, then the fields the remake does not take are skipped back to 0. */
export function nextFocus(focus: SignUpFocus): SignUpFocus {
  return focus === 5 ? 0 : ((focus + 1) as SignUpFocus);
}

/** Hover and pressed art from new_button2 (the X's pressed art too), drawn at the hit rect's top-left. */
export const SIGN_UP_BUTTONS = {
  idCheck: { hit: [344, 151, 415, 169] as Rect, hover: [394, 27, 465, 45] as Rect, pressed: [394, 46, 465, 64] as Rect, at: { x: 344, y: 151 } },
  nickCheck: { hit: [344, 174, 415, 192] as Rect, hover: [394, 65, 465, 83] as Rect, pressed: [394, 84, 465, 102] as Rect, at: { x: 344, y: 174 } },
  submit: { hit: [349, 494, 439, 522] as Rect, hover: [366, 133, 456, 161] as Rect, pressed: [366, 103, 456, 131] as Rect, at: { x: 349, y: 494 } },
  close: { hit: [596, 495, 627, 525] as Rect, hover: null, pressed: [252, 30, 282, 59] as Rect, at: { x: 596, y: 495 } },
  /** The terms' arrows: pressed art 1 px inside the hit rect. */
  termsUp: { hit: [598, 345, 614, 360] as Rect, hover: null, pressed: [412, 12, 428, 26] as Rect, at: { x: 598, y: 346 } },
  termsDown: { hit: [598, 422, 614, 436] as Rect, hover: null, pressed: [429, 12, 446, 26] as Rect, at: { x: 598, y: 421 } },
} satisfies Record<string, Button>;

export type SignUpButton = keyof typeof SIGN_UP_BUTTONS;

/** The two tick boxes pairs, 15×15, and new_button's tick drawn at a ticked box's top-left (0x41a47f). */
export const SIGN_UP_BOXES = {
  mailYes: [506, 291, 521, 306] as Rect,
  mailNo: [583, 291, 598, 306] as Rect,
  agree: [314, 455, 329, 470] as Rect,
  disagree: [491, 455, 506, 470] as Rect,
};
export const SIGN_UP_TICK: Rect = [141, 94, 156, 109];

/** Every place a release does something, in 0x41ad60's order; the mail pair is not taken (R). */
export type SignUpTarget = SignUpButton | "agree" | "disagree" | SignUpField;

export function signUpTargetAt(x: number, y: number): SignUpTarget | null {
  for (const [name, button] of Object.entries(SIGN_UP_BUTTONS)) if (inside(button.hit, x, y)) return name as SignUpButton;
  if (inside(SIGN_UP_BOXES.agree, x, y)) return "agree";
  if (inside(SIGN_UP_BOXES.disagree, x, y)) return "disagree";
  for (const [name, field] of Object.entries(SIGN_UP_FIELDS)) if (inside(field.click, x, y)) return name as SignUpField;
  return null;
}

/** The region box's label, always drawn (0x419c3b); its drop-down is not taken (R). */
export const REGION_LABEL = { text: "거주지역을 선택하세요", at: { x: 277, y: 269 } };

/** The terms: 5 lines of TEXT_draw font 13, yellow with the black outline, 20 px apart from (200,346). */
export const TERMS = { x: 200, y: 346, step: 20, rows: 5 };
/** The box from x 200 to the arrows at 598, at 굴림체 13's 7 px a byte. */
export const TERMS_MAX_BYTES = 56;

/**
 * The original's 188 lines are hanpanthe.net's terms for a service that is gone; the remake says in
 * their place what its account server keeps (R).
 */
export const TERMS_LINES: readonly string[] = [
  "[복원판 안내] 원본의 이용약관 대신 이 글을 둡니다.",
  "이 서버는 쉐이크2 복원판의 서버이며, 원본의",
  "개발사·운영사와는 관계가 없습니다.",
  "",
  "서버가 저장하는 것: 아이디, 닉네임, 비밀번호의",
  "해시(비밀번호 자체는 저장하지 않음), 인사말,",
  "캐릭터와 색조, 길드, 전적, 셀포인트, 사탕, 아이템.",
  "이름, 주민등록번호, 거주지역, 이메일은 받지",
  "않으므로 그 칸은 비워 둡니다.",
  "",
  "기록은 서버를 운영하는 사람의 컴퓨터에 파일로",
  "남습니다. 다른 사용자에게는 아이디, 닉네임,",
  "인사말, 캐릭터, 길드, 전적, 레벨이 보입니다.",
  "계정을 지우려면 서버 운영자에게 요청하세요.",
  "",
  "비밀번호는 4~10바이트로 짧고, 암호화(TLS) 없이",
  "운영하는 서버에서는 그대로 전송됩니다. 다른",
  "곳에서 쓰는 비밀번호는 쓰지 마세요.",
  "",
  "동의함에 체크하고 가입하기를 누르세요.",
];

/** ▼ stops when the last line is the box's last (max top 183 of 188 in the original). */
export const TERMS_MAX_TOP = TERMS_LINES.length - TERMS.rows;

export function scrollTerms(top: number, by: -1 | 1): number {
  return Math.max(0, Math.min(TERMS_MAX_TOP, top + by));
}

// 가입하기 (0x41b3ee–0x41baac)

export interface SignUpInput {
  id: string;
  nick: string;
  password: string;
  confirm: string;
  agreed: boolean;
}

/** A message box's text and the field the focus moves to, if any. */
export interface SignUpNotice {
  text: string;
  focus: SignUpFocus | null;
}

/** 0x41c210: ASCII blanks dropped, double-byte characters kept whole. */
export function stripBlanks(text: string): string {
  return text.replaceAll(" ", "");
}

/**
 * The window's checks in their order, on the fields as typed: the first failing one's message, or
 * null. Checks 7–10 and 12 (name, resident number, region, e-mail) are not made (R).
 */
export function signUpProblem(input: SignUpInput): SignUpNotice | null {
  if (input.id === "") return { text: "ID을 입력하세요.", focus: 0 };
  if (cp949Bytes(input.id) <= 3) return { text: "ID는 4글자 이상입니다.", focus: 0 };
  if (input.nick === "") return { text: "닉네임을 입력하세요.", focus: 2 };
  if (input.password === "" || input.confirm === "") return { text: "비밀번호를  입력하세요.", focus: 4 };
  if (input.password !== input.confirm) return { text: "입력하신 두개의 비밀번호가\n일치하지 않습니다.", focus: 4 };
  if (cp949Bytes(input.password) <= 3) return { text: "비밀번호는 4글자 이상입니다.", focus: 4 };
  if (!input.agreed) return { text: "회원가입을 하시려면 약관동의를\n체크하셔야 합니다.", focus: null };
  return null;
}

/** 0x45f280 on the ID: 7 for its length, 8 for a character outside [0-9A-Za-z], 9 for a digit first. */
export function idCode(id: string): number | null {
  const bytes = cp949Bytes(id);
  if (bytes < 4 || bytes > 10) return 7;
  if (!/^[0-9A-Za-z]+$/.test(id)) return 8;
  if (/^[0-9]/.test(id)) return 9;
  return null;
}

/** An unanswered request or a failed one (0x44c380's −1). */
export const SIGN_UP_ERROR = -1;

/**
 * What 0x44c380 sends after the window's checks: the ID, nick and password with their blanks
 * dropped, or the rcode it gives without asking (−1 for a field left empty, then 0x45f280's).
 */
export function signUpRequest(input: SignUpInput): { id: string; nick: string; password: string } | { rcode: number } {
  const id = stripBlanks(input.id);
  const nick = stripBlanks(input.nick);
  const password = stripBlanks(input.password);
  if (id === "" || nick === "" || password === "") return { rcode: SIGN_UP_ERROR };
  const code = idCode(id);
  if (code !== null) return { rcode: code };
  return { id, nick, password };
}

/** The rcode's message (jump tables 0x41bae8 / 0x41bb10); 7, above 9 and −1 are the same failure. */
export function signUpMessage(rcode: number): string {
  switch (rcode) {
    case 0:
      return "가입 처리가 완료 되었습니다";
    case 1:
      return "사용할수 없는 아이디 입니다";
    case 2:
    case 3:
      return "이미 등록된 주민등록번호 입니다\n확인 후 재입력 해주시기 바랍니다";
    case 4:
      return "이미 사용중인 아이디 입니다";
    case 5:
      return "이미 사용중인 닉네임 입니다";
    case 6:
      return "잘못된 주민등록번호 입니다\n확인 후 재입력 해주시기 바랍니다";
    case 8:
      return "아이디에 한글이나 특수문자는\n사용할 수 없습니다";
    case 9:
      return "아이디 첫자리에는 숫자를 사용할 수\n없습니다";
    default:
      return "가입처리중 오류가 발생했습니다\n재 가입 해주시기 바랍니다";
  }
}

// 아이디검색 / 닉네임검색 (0x41c280)

export type CheckKind = "id" | "nick";

/** An empty field is refused before asking; the focus stays on it. */
export function checkProblem(kind: CheckKind, text: string): SignUpNotice | null {
  if (text !== "") return null;
  return kind === "id" ? { text: "ID을 입력하세요.", focus: 0 } : { text: "닉네임을 입력하세요.", focus: 2 };
}

/** idcheck.asp's rcode 0 is free and moves on; anything else, a failed request too, reads as taken. */
export function checkAnswer(kind: CheckKind, rcode: number): SignUpNotice {
  if (kind === "id") return rcode === 0 ? { text: "사용가능한  아이디 입니다", focus: 2 } : { text: "이미 사용중인 아이디 입니다", focus: 0 };
  return rcode === 0 ? { text: "사용가능한  닉네임 입니다", focus: 4 } : { text: "이미 사용중인 닉네임 입니다", focus: 2 };
}
