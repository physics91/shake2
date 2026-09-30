// The lobby's ranking window (scene 12) on the lobby's canvas: its list, ◀ ▶ FIND and X, and the
// FIND popup with its editor. The list and its fetches are ranking.ts's, shared with scene 5; the
// lobby screen gives this the mouse, Enter and Esc, and draws its own partial screen under it and
// the message box over it. Layout: rankingWindowLayout.ts.
import { drawBadge } from "./badge.ts";
import { CaretBlink } from "./chat.ts";
import { ChatLine } from "./chatLine.ts";
import type { RankingAccess } from "./ranking.ts";
import type { Point } from "./roomLayout.ts";
import { inside } from "./roomLayout.ts";
import {
  genderIcon,
  RANKING_BUTTONS,
  RANKING_POPUP,
  RANKING_ROWS,
  RANKING_WINDOW_AT,
  rankingButtonAt,
  rankingCaret,
  rankingHelpAt,
  rankingHoverAt,
  rankingPopupAt,
  rankingPressedAt,
  rankingRowY,
} from "./rankingWindowLayout.ts";
import { drawBalloon, drawCaret } from "./screenKit.ts";
import { blit } from "./sprite.ts";
import { padNumber, rankingMatch, STATUS_TEXT } from "./statusLayout.ts";
import { FONT_12, FONT_13, outlinedText } from "./text.ts";

export interface RankingWindowAssets {
  /** new_ranking. */
  ranking: HTMLImageElement;
  basicWindow: HTMLImageElement;
  button: HTMLImageElement;
  button2: HTMLImageElement;
  guild: HTMLImageElement;
  mark: HTMLImageElement;
}

export interface RankingWindowHost {
  stage: HTMLElement;
  assets: RankingWindowAssets;
  /** The list scene 5 shows too, and the fetches on the lobby's connection. */
  ranking: RankingAccess;
  /** menu2 (0x25). */
  sound(): void;
  /** The message box (MSGBOX). */
  message(text: string): void;
  /** Back to the lobby (0x4231c0). */
  close(): void;
  /** A line for a screen reader. */
  announce(text: string): void;
  /** PHELP: the balloons are drawn only with it on. */
  balloons(): boolean;
}

/** What the lobby knows of the frame: the mouse and whether the message box is up. */
export interface RankingFrame {
  mouse: Point;
  inside: boolean;
  held: Point | null;
  message: boolean;
}

export class RankingWindow {
  /** A fetch waits for its answer: the busy cursor, and the mouse and keys are dropped. */
  busy = false;
  /** [0x494950]. */
  private popup = false;
  /** [0x4948ec]: the ID the last FIND found, whose row shows yellow. */
  private found = "";
  /** The shared editor (0x4714f8) as the popup's, 0xb. */
  private readonly idLine: ChatLine;
  private readonly caret = new CaretBlink();
  private readonly host: RankingWindowHost;
  private disposed = false;

  /** 0x423170: page 1, the highlight gone, and the wait for page 1; the list stays until rows come. */
  constructor(host: RankingWindowHost) {
    this.host = host;
    this.idLine = new ChatLine(host.stage, { limit: RANKING_POPUP.limit, at: RANKING_POPUP.text, trapFocus: false });
    this.idLine.element.setAttribute("aria-label", "찾을 아이디 (Enter 찾기, Esc 취소)");
    host.ranking.windowPage = 1;
    void this.fetch(1, false);
  }

  get popupOpen(): boolean {
    return this.popup;
  }

  /** The popup's editor, whose keys the lobby takes as the window's. */
  owns(element: Element | null): boolean {
    return element === this.idLine.element;
  }

  /** The page may have taken the focus from the popup's editor: it goes back there. */
  focusEditor(): void {
    if (this.popup) this.idLine.focus();
  }

  dispose(): void {
    this.disposed = true;
    this.idLine.dispose();
  }

  /** A release, only with no message box (0x459ffa): the popup's O and X, else X, ◀, ▶ and FIND. */
  release(x: number, y: number): void {
    if (this.popup) {
      const hit = rankingPopupAt(x, y);
      if (hit === "ok") void this.find();
      else if (hit === "cancel") this.cancelPopup();
      else this.idLine.focus();
      return;
    }
    const { ranking } = this.host;
    switch (rankingButtonAt(x, y)) {
      case "close":
        this.host.close();
        break;
      case "prev":
        // Page 1 sends nothing; 0x423d20 then returns the list's pointer, so the sound plays while
        // a list is held (its low byte is 0 about once in 32: silent then; here never).
        if (ranking.windowPage > 1) void this.fetch(ranking.windowPage - 1, true);
        else if (ranking.rows.length > 0) this.host.sound();
        break;
      case "next":
        // No last page: past the end the list and the page stay, and the sound still plays.
        void this.fetch(ranking.windowPage + 1, true);
        break;
      case "find":
        this.host.sound();
        this.openPopup();
        break;
      default:
        break;
    }
  }

  /** Enter (0x45fcbe): the popup's O; with no popup, nothing. */
  enter(): void {
    if (this.popup && !this.busy) void this.find();
  }

  /** Esc (0x46187e), after the lobby's wait, help screen and message box: the popup, then the window. */
  escape(): void {
    if (this.popup) this.cancelPopup();
    else this.host.close();
  }

  /**
   * ◀ or ▶ (0x423d20, 0x423db0) and the opening: the highlight goes, the page follows only when rows
   * came, and ◀ ▶ play menu2 after the answer, as after the original's blocking fetch.
   */
  private async fetch(page: number, sound: boolean): Promise<void> {
    this.found = "";
    const ok = await this.wait(this.host.ranking.page(page));
    if (this.disposed) return;
    if (ok) this.host.ranking.windowPage = page;
    if (sound) this.host.sound();
    this.host.announce(ok ? this.rowsText() : "랭킹 목록이 바뀌지 않았습니다.");
  }

  /** The popup's O or Enter (0x45a01a): its page, or "찾을 수 없습니다."; the popup closes either way, silent. */
  private async find(): Promise<void> {
    const id = this.idLine.view().text;
    const found = await this.wait(this.host.ranking.search(id));
    if (this.disposed) return;
    if (found) {
      this.found = id;
      this.host.announce(this.rowsText());
    } else {
      this.host.message(STATUS_TEXT.notFound);
    }
    this.closePopup();
  }

  private async wait(fetch: Promise<boolean>): Promise<boolean> {
    this.busy = true;
    try {
      return await fetch;
    } finally {
      this.busy = false;
    }
  }

  /** 0x423f80: the IME's composition dropped, the ID empty, the highlight gone, the editor on it. */
  private openPopup(): void {
    this.found = "";
    this.popup = true;
    this.idLine.open();
    this.host.announce("아이디 찾기 창: 아이디를 입력하고 Enter, 닫으려면 Esc.");
  }

  /** 0x423f30. */
  private closePopup(): void {
    this.popup = false;
    this.idLine.close();
  }

  /** The popup's X or Esc: it closes, and nothing is asked. */
  private cancelPopup(): void {
    this.closePopup();
    this.host.announce("아이디 찾기 창을 닫았습니다.");
  }

  /** The rows, read out, with the page they are on. */
  private rowsText(): string {
    const { rows, windowPage } = this.host.ranking;
    const found = rankingMatch(rows, this.found);
    const lines = rows.map((row, i) => `${i === found ? "찾은 아이디 " : ""}${row.rank}위 ${row.id} 셀포인트 ${row.cell} 승 ${row.wins}`);
    return `랭킹 ${windowPage}쪽. ${lines.join(", ")}`;
  }

  /** 0x4231e0 after the lobby's partial draw: the art, the rows, the buttons' art, the popup, the balloons. */
  draw(ctx: CanvasRenderingContext2D, now: number, frame: RankingFrame): void {
    ctx.drawImage(this.host.assets.ranking, RANKING_WINDOW_AT.x, RANKING_WINDOW_AT.y);
    this.drawRows(ctx);
    if (!frame.message && !this.popup) this.drawButtonArt(ctx, frame);
    // The popup is drawn under the message box too; its O and X take no message box gate.
    if (this.popup) this.drawPopup(ctx, now, frame);
    if (this.host.balloons() && frame.inside) {
      const balloon = rankingHelpAt(frame.mouse.x, frame.mouse.y, { popup: this.popup, message: frame.message });
      if (balloon) drawBalloon(ctx, balloon.text, balloon.x, balloon.y);
    }
  }

  /** Each row: rank, gender, guild, level badge, ID, cell point and wins, yellow for the ID found. */
  private drawRows(ctx: CanvasRenderingContext2D): void {
    const { assets, ranking } = this.host;
    const layout = RANKING_ROWS;
    const found = rankingMatch(ranking.rows, this.found);
    ranking.rows.forEach((row, i) => {
      const y = rankingRowY(i);
      const colour = i === found ? layout.found : layout.colour;
      const text = (value: string, x: number, font: string) => outlinedText(ctx, value, x, y, colour, font, "left", layout.outline);
      text(padNumber(row.rank, layout.rank.width), layout.rank.x, FONT_13);
      const gender = genderIcon(row.gender);
      if (gender) blit(ctx, assets.button, gender, layout.gender.x, y);
      drawBadge(ctx, assets, row, { x: layout.guild.x, y }, { x: layout.badge.x, y: y + layout.badge.dy });
      text(row.id, layout.id.x, FONT_12);
      text(padNumber(row.cell, layout.cell.width), layout.cell.x, FONT_13);
      text(padNumber(row.wins, layout.wins.width), layout.wins.x, FONT_13);
    });
  }

  /** Hover art under the mouse (◀ FIND ▶), then pressed art while held (0x423780, 0x4238c0). */
  private drawButtonArt(ctx: CanvasRenderingContext2D, frame: RankingFrame): void {
    if (!frame.inside) return;
    const { button2 } = this.host.assets;
    const { x, y } = frame.mouse;
    const hover = rankingHoverAt(x, y);
    const lit = hover && RANKING_BUTTONS[hover].hover;
    if (hover && lit) blit(ctx, button2, lit, RANKING_BUTTONS[hover].at.x, RANKING_BUTTONS[hover].at.y);
    if (!frame.held) return;
    const pressed = rankingPressedAt(x, y);
    if (pressed) blit(ctx, button2, RANKING_BUTTONS[pressed].pressed, RANKING_BUTTONS[pressed].at.x, RANKING_BUTTONS[pressed].at.y);
  }

  /** 0x423a60: new_basicwindow, the ID label, O or X held, the ID and its caret. */
  private drawPopup(ctx: CanvasRenderingContext2D, now: number, frame: RankingFrame): void {
    const { assets } = this.host;
    const p = RANKING_POPUP;
    blit(ctx, assets.basicWindow, p.src, p.at.x, p.at.y);
    blit(ctx, assets.button2, p.label.src, p.label.at.x, p.label.at.y);
    if (frame.held && frame.inside) {
      const button = [p.ok, p.cancel].find((b) => inside(b.hit, frame.mouse.x, frame.mouse.y));
      if (button) blit(ctx, assets.button2, button.pressed, button.at.x, button.at.y);
    }
    const line = this.idLine.view();
    if (line.text) outlinedText(ctx, line.text, p.text.x, p.text.y, p.colour, FONT_13, "left", p.outline);
    if (this.caret.shown(now)) {
      const at = rankingCaret(line.caret);
      drawCaret(ctx, at.x, at.y, p.caretRows);
    }
  }
}
