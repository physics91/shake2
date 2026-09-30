// The NEW ID window over scene 3 (0x41bd70 open, 0x41bcf0 close, 0x41ad60 clicks, 0x419a5e draw): four
// editors, the ID and nick checks, the agree pair, the scrolled terms and 가입하기. It plays no sound
// and shows no balloons (findings_auth §1.1). Places, checks and messages: signUpLayout.ts.
import { cp949Bytes } from "../server/cp949.ts";
import { ChatLine } from "./chatLine.ts";
import type { Point } from "./roomLayout.ts";
import { inside } from "./roomLayout.ts";
import { drawCaret } from "./screenKit.ts";
import type { CheckKind, SignUpFocus, SignUpNotice, SignUpTarget } from "./signUpLayout.ts";
import {
  checkAnswer,
  checkProblem,
  fieldOfFocus,
  nextFocus,
  REGION_LABEL,
  scrollTerms,
  SIGN_UP_BOXES,
  SIGN_UP_BUTTONS,
  SIGN_UP_ERROR,
  SIGN_UP_FIELDS,
  SIGN_UP_LIMIT,
  SIGN_UP_PANEL,
  SIGN_UP_TEXT_COLOUR,
  SIGN_UP_TICK,
  signUpCaret,
  signUpMessage,
  signUpProblem,
  signUpRequest,
  signUpTargetAt,
  TERMS,
  TERMS_LINES,
} from "./signUpLayout.ts";
import type { SignUpField } from "./signUpLayout.ts";
import { blit } from "./sprite.ts";
import { FONT_12, FONT_13, outlinedText } from "./text.ts";

/** Caret rows as on the login (0x41a5e0). */
const CARET_ROWS = 11;

export interface SignUpAssets {
  /** new_id.shk. */
  window: HTMLImageElement;
  /** new_button: the tick. */
  button: HTMLImageElement;
  /** new_button2: the buttons' hover and pressed art. */
  button2: HTMLImageElement;
}

export interface SignUpOptions {
  stage: HTMLElement;
  assets: SignUpAssets;
  announce(text: string): void;
  /** The scene's message box (MSGBOX 0x443700). */
  message(text: string): void;
  /** Regist_UP_shake2.asp's request; false when there is no account server to send it to. */
  register(request: { id: string; nick: string; password: string }): boolean;
  /** idcheck.asp's; false likewise. */
  check(kind: CheckKind, text: string): boolean;
}

/** The request the account server has not answered yet: the original's blocking HTTP call. */
type Waiting = "register" | CheckKind;

export class SignUpWindow {
  private readonly options: SignUpOptions;
  private readonly lines: Record<SignUpField, ChatLine>;
  /** [0x493f30]. */
  private opened = false;
  /** [0x493f3c]. */
  private focus: SignUpFocus = 0;
  /** [0x493f32] 동의함 and [0x493f33] 동의안함. */
  private agreed = false;
  private disagreed = false;
  /** [0x493f38]: the terms' top line. */
  private termsTop = 0;
  private waiting: Waiting | null = null;
  /** The scene's message box is up. */
  private boxUp = false;

  constructor(options: SignUpOptions) {
    this.options = options;
    const line = (field: SignUpField) => {
      const { text, label } = SIGN_UP_FIELDS[field];
      const made = new ChatLine(options.stage, { limit: SIGN_UP_LIMIT, at: text, trapFocus: false });
      made.element.setAttribute("aria-label", `회원가입 ${label}`);
      if (field === "password" || field === "confirm") {
        made.element.type = "password";
        made.element.autocomplete = "new-password";
      }
      return made;
    };
    this.lines = { id: line("id"), nick: line("nick"), password: line("password"), confirm: line("confirm") };
  }

  get isOpen(): boolean {
    return this.opened;
  }

  /** A request is out: the window takes nothing until it is answered. */
  get pending(): boolean {
    return this.waiting !== null;
  }

  /** Whether one of the window's editors holds the focus (StartScreen's key filter). */
  owns(element: Element | null): boolean {
    return Object.values(this.lines).some((line) => line.element === element);
  }

  /** The scene's message box went up or away: while it is up the editors take no characters. */
  set box(up: boolean) {
    this.boxUp = up;
    this.applyLock();
  }

  /** 0x41bd70: nothing ticked but 기입, the terms at the top, the editor on the ID. */
  open(): void {
    this.opened = true;
    for (const line of Object.values(this.lines)) line.open();
    this.agreed = false;
    this.disagreed = false;
    this.termsTop = 0;
    this.setWaiting(null);
    this.setFocus(0);
    this.options.announce(
      "회원가입 창. 아이디, 닉네임, 비밀번호, 비밀번호 확인을 넣고 동의함에 체크한 뒤 가입하기. Tab은 칸과 검색 단추를 차례로, Enter는 검색 단추에서 검색, Esc는 닫기. 이름·주민등록번호·거주지역·이메일은 받지 않습니다. 안내 글은 약관 칸의 ▲▼로 넘깁니다.",
    );
  }

  /** 0x41bcf0 (Esc, X, a sign-up that went through): the fields are cleared and the window goes. */
  close(): void {
    this.opened = false;
    this.setWaiting(null);
    for (const line of Object.values(this.lines)) line.close();
  }

  dispose(): void {
    for (const line of Object.values(this.lines)) line.dispose();
  }

  /** Tab (0x41bf50). */
  tab(): void {
    if (this.waiting) return;
    this.setFocus(nextFocus(this.focus));
  }

  /** Enter (0x45fbb3): the check under the focus; it never signs up. */
  enter(): void {
    if (this.waiting) return;
    if (this.focus === 1) this.check("id");
    else if (this.focus === 3) this.check("nick");
  }

  /** The editor back on the focused field, as every click on the window reloads it (0x41adc1). */
  refocus(): void {
    this.setFocus(this.focus, false);
  }

  /** A release on the window (0x41ad60). */
  release(x: number, y: number): void {
    if (this.waiting) return;
    const target = signUpTargetAt(x, y);
    switch (target) {
      case "idCheck":
        this.check("id");
        return;
      case "nickCheck":
        this.check("nick");
        return;
      case "submit":
        this.submit();
        return;
      case "close":
        this.close();
        this.options.announce("회원가입 창을 닫았습니다.");
        return;
      case "termsUp":
      case "termsDown":
        this.termsTop = scrollTerms(this.termsTop, target === "termsUp" ? -1 : 1);
        this.options.announce(TERMS_LINES.slice(this.termsTop, this.termsTop + TERMS.rows).filter(Boolean).join(" "));
        this.refocus();
        return;
      case "agree":
      case "disagree":
        this.agreed = target === "agree";
        this.disagreed = !this.agreed;
        this.options.announce(this.agreed ? "동의함에 체크했습니다." : "동의안함에 체크했습니다.");
        this.refocus();
        return;
      case null:
        this.refocus();
        return;
      default:
        this.setFocus(SIGN_UP_FIELDS[target].focus);
    }
  }

  /** The place a hidden control stands for: the middle of its hit rect. */
  static centre(target: Exclude<SignUpTarget, SignUpField>): Point {
    const rect = target === "agree" || target === "disagree" ? SIGN_UP_BOXES[target] : SIGN_UP_BUTTONS[target].hit;
    return { x: Math.trunc((rect[0] + rect[2]) / 2), y: Math.trunc((rect[1] + rect[3]) / 2) };
  }

  /** The account server's answer to the request out; any other is not this window's. */
  answer(kind: Waiting, rcode: number): void {
    if (!this.opened || this.waiting !== kind) return;
    this.setWaiting(null);
    if (kind !== "register") {
      this.notice(checkAnswer(kind, rcode));
      return;
    }
    // None of the answers moves the focus; the one that signed up closes the window (0x41b879).
    this.options.message(signUpMessage(rcode));
    if (rcode === 0) this.close();
    else this.refocus();
  }

  /** The account server went with a request out: it failed, as the original's did (−1). */
  lost(): void {
    if (this.waiting) this.answer(this.waiting, SIGN_UP_ERROR);
  }

  draw(ctx: CanvasRenderingContext2D, mouse: Point | null, held: Point | null, caretShown: boolean): void {
    const { assets } = this.options;
    ctx.drawImage(assets.window, SIGN_UP_PANEL.x, SIGN_UP_PANEL.y);
    for (const [name, field] of Object.entries(SIGN_UP_FIELDS) as [SignUpField, (typeof SIGN_UP_FIELDS)[SignUpField]][]) {
      const { text } = this.lines[name].view();
      const shown = name === "password" || name === "confirm" ? "*".repeat(cp949Bytes(text)) : text;
      if (shown) outlinedText(ctx, shown, field.text.x, field.text.y, SIGN_UP_TEXT_COLOUR, FONT_12);
    }
    // No e-mail is taken, so 기입안함 is the one ticked (R: the original opens with 기입).
    blit(ctx, assets.button, SIGN_UP_TICK, SIGN_UP_BOXES.mailNo[0], SIGN_UP_BOXES.mailNo[1]);
    const tick = this.agreed ? SIGN_UP_BOXES.agree : this.disagreed ? SIGN_UP_BOXES.disagree : null;
    if (tick) blit(ctx, assets.button, SIGN_UP_TICK, tick[0], tick[1]);
    const field = fieldOfFocus(this.focus);
    if (caretShown && field) {
      const at = signUpCaret(field, this.lines[field].view().caret);
      drawCaret(ctx, at.x, at.y, CARET_ROWS);
    }
    for (let i = 0; i < TERMS.rows; i++) {
      const line = TERMS_LINES[this.termsTop + i];
      if (line) outlinedText(ctx, line, TERMS.x, TERMS.y + TERMS.step * i, SIGN_UP_TEXT_COLOUR, FONT_13);
    }
    for (const button of Object.values(SIGN_UP_BUTTONS)) {
      if (button.hover && mouse && inside(button.hit, mouse.x, mouse.y)) blit(ctx, assets.button2, button.hover, button.at.x, button.at.y);
      if (held && inside(button.hit, held.x, held.y)) blit(ctx, assets.button2, button.pressed, button.at.x, button.at.y);
    }
    outlinedText(ctx, REGION_LABEL.text, REGION_LABEL.at.x, REGION_LABEL.at.y, SIGN_UP_TEXT_COLOUR, FONT_12);
    // The focused check button shows its hover art (0x419c9e).
    const focused = this.focus === 1 ? SIGN_UP_BUTTONS.idCheck : this.focus === 3 ? SIGN_UP_BUTTONS.nickCheck : null;
    if (focused) blit(ctx, assets.button2, focused.hover, focused.at.x, focused.at.y);
  }

  /** A request out stands for the original's blocking call: nothing is typed until it is answered. */
  private setWaiting(waiting: Waiting | null): void {
    this.waiting = waiting;
    this.applyLock();
  }

  private applyLock(): void {
    const locked = this.boxUp || this.waiting !== null;
    for (const line of Object.values(this.lines)) line.locked = locked;
  }

  private setFocus(focus: SignUpFocus, speak = true): void {
    this.focus = focus;
    const field = fieldOfFocus(focus);
    if (field) {
      this.lines[field].focus();
      return;
    }
    // A check button has no editor: what is typed there goes nowhere (0x41bf10).
    const active = document.activeElement;
    if (active instanceof HTMLElement && this.owns(active)) active.blur();
    if (speak) this.options.announce(focus === 1 ? "아이디검색 단추. Enter로 검색합니다." : "닉네임검색 단추. Enter로 검색합니다.");
  }

  private notice(notice: SignUpNotice): void {
    this.options.message(notice.text);
    if (notice.focus !== null) this.setFocus(notice.focus);
    else this.refocus();
  }

  private input() {
    return {
      id: this.lines.id.view().text,
      nick: this.lines.nick.view().text,
      password: this.lines.password.view().text,
      confirm: this.lines.confirm.view().text,
      agreed: this.agreed,
    };
  }

  /** 0x41c280: an empty field is refused; otherwise the field as typed is asked about. */
  private check(kind: CheckKind): void {
    const text = this.lines[kind].view().text;
    const problem = checkProblem(kind, text);
    if (problem) {
      this.notice(problem);
      return;
    }
    if (!this.options.check(kind, text)) {
      this.notice(checkAnswer(kind, SIGN_UP_ERROR));
      return;
    }
    this.setWaiting(kind);
    this.options.announce(kind === "id" ? "아이디를 확인하는 중…" : "닉네임을 확인하는 중…");
  }

  /** 가입하기 (0x41b3ee): the window's checks, 0x44c380's own, then the request. */
  private submit(): void {
    const input = this.input();
    const problem = signUpProblem(input);
    if (problem) {
      this.notice(problem);
      return;
    }
    const request = signUpRequest(input);
    if ("rcode" in request) {
      this.options.message(signUpMessage(request.rcode));
      this.refocus();
      return;
    }
    if (!this.options.register(request)) {
      this.options.message(signUpMessage(SIGN_UP_ERROR));
      this.refocus();
      return;
    }
    this.setWaiting("register");
    this.options.announce("가입을 요청하는 중…");
  }
}
