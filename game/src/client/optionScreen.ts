// The option window (scene 13) on the lobby's canvas: its drawing (0x420ed0), its editors and the
// keys held for a key change. The rules are optionWindow.ts's; the lobby screen gives this the
// mouse, Enter and Esc, and draws its own partial screen under it and the message box over it.
import type { ClientMessage } from "../server/protocol.ts";
import { CaretBlink } from "./chat.ts";
import { ChatLine } from "./chatLine.ts";
import { keyName } from "./dik.ts";
import type { FriendReply } from "./friends.ts";
import { connectedPad } from "./gamepad.ts";
import { drawBadge } from "./badge.ts";
import {
  CHECKS,
  FRIEND_ID_LIMIT,
  FRIEND_PARTS,
  FRIEND_POPUP,
  FRIEND_ROWS,
  friendCaret,
  friendRowY,
  GESTURE,
  KEY_BAR,
  KEY_BOXES,
  KEY_COLOUR,
  MACRO_CARET_ROWS,
  MACRO_HIGHLIGHT,
  MACRO_TEXT_COLOUR,
  macroBox,
  macroCaret,
  macroLines,
  LOCATION_BYTES,
  OFFLINE,
  OPTION_AT,
  OPTION_BUTTONS,
  optionHelpAt,
} from "./optionLayout.ts";
import type { FriendRecord } from "./optionWindow.ts";
import { OptionWindow } from "./optionWindow.ts";
import type { Point } from "./roomLayout.ts";
import { inside } from "./roomLayout.ts";
import { drawBalloon, drawCaret } from "./screenKit.ts";
import type { SettingsStore } from "./settings.ts";
import { MACRO_LIMIT } from "./settings.ts";
import { blit } from "./sprite.ts";
import { cp949Bytes, cutBytes } from "../server/cp949.ts";
import { FONT_12, FONT_13, outlinedText, plainText } from "./text.ts";

export interface OptionAssets {
  option: HTMLImageElement;
  basicWindow: HTMLImageElement;
  button: HTMLImageElement;
  button2: HTMLImageElement;
  guild: HTMLImageElement;
  mark: HTMLImageElement;
}

export interface OptionScreenHost {
  stage: HTMLElement;
  assets: OptionAssets;
  settings: SettingsStore;
  send(message: ClientMessage): void;
  /** The message box (MSGBOX). */
  message(text: string): void;
  /** Back to the lobby (0x420e90). */
  close(): void;
  /** A line for a screen reader. */
  announce(text: string): void;
}

/** What the lobby knows of the frame: the mouse and whether the message box is up. */
export interface OptionFrame {
  mouse: Point;
  inside: boolean;
  held: Point | null;
  message: boolean;
}

export class OptionScreen {
  readonly window: OptionWindow;
  private readonly host: OptionScreenHost;
  /** The shared editor (0x4714f8) as the macro boxes' (37) and the friend popup's (11). */
  private readonly macroLine: ChatLine;
  private readonly idLine: ChatLine;
  private readonly caret = new CaretBlink();
  /** The popup's O was sent and its answer has not come. */
  private asked = false;
  /** Keys held now, by code, for the key-change poll (DirectInput's GetDeviceState). */
  private readonly held = new Set<string>();
  private readonly detach: () => void;

  constructor(host: OptionScreenHost) {
    this.host = host;
    this.macroLine = new ChatLine(host.stage, { limit: MACRO_LIMIT, at: macroBox(0).text, trapFocus: false });
    this.macroLine.element.setAttribute("aria-label", "단축 메시지");
    this.idLine = new ChatLine(host.stage, { limit: FRIEND_ID_LIMIT, at: FRIEND_POPUP.text, trapFocus: false });
    this.idLine.element.setAttribute("aria-label", "친구 아이디");
    this.window = new OptionWindow({
      current: () => host.settings.current,
      save: (next) => host.settings.save(next),
      useControl: (control) => {
        // The browser shows a pad only after one of its buttons was pressed on the page.
        if (control === 1 && !connectedPad()) return false;
        host.settings.setControl(control);
        return true;
      },
      close: () => host.close(),
      message: (text) => host.message(text),
      edit: (target) => this.edit(target),
      addFriend: (name) => this.addFriend(name),
      deleteFriend: (name) => this.deleteFriend(name),
    });
    this.requestFriends();
    const down = (event: KeyboardEvent) => {
      // Keys typed into the page's controls (the option section below) are not the window's.
      const active = document.activeElement;
      if (active !== null && active !== document.body && !host.stage.contains(active)) return;
      this.held.add(event.code);
      // A key change takes Tab like any other key; Esc and Enter still close the window.
      if (event.code === "Tab" && this.window.changing >= 0) event.preventDefault();
    };
    const up = (event: KeyboardEvent) => this.held.delete(event.code);
    const blur = () => this.held.clear();
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", blur);
    this.detach = () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", blur);
    };
  }

  /** The editors' inputs, whose keys the lobby takes as the window's. */
  owns(element: Element | null): boolean {
    return element === this.macroLine.element || element === this.idLine.element;
  }

  /** S->C 0x63 for this window. */
  friendsAnswered(friends: readonly FriendRecord[]): void {
    this.window.friendsAnswered(friends);
    const on = friends.filter((f) => f.location).length;
    this.host.announce(`친구 ${friends.length}명, 접속 중 ${on}명.`);
  }

  dispose(): void {
    this.macroLine.dispose();
    this.idLine.dispose();
    this.detach();
  }

  /** S->C 0x64 or 0x65 to this window's popup: it closes, the wait ends, and a change asks for the list again. */
  friendReplied(reply: FriendReply): void {
    if (!this.asked) return;
    this.asked = false;
    this.window.friendAnswered();
    if (reply.message) this.host.message(reply.message);
    if (reply.askAgain) this.requestFriends();
  }

  /** C->S 0x63: the list, and the wait for it. */
  private requestFriends(): void {
    this.window.busy = true;
    this.host.send({ type: "friends" });
  }

  private edit(target: { kind: "macro" | "friend"; text: string } | null): void {
    if (target?.kind === "macro") {
      this.idLine.close();
      this.macroLine.place(macroBox(this.window.editing).text);
      this.macroLine.open();
      this.macroLine.text = target.text;
      this.host.announce(`F${this.window.editing + 2} 단축 메시지 편집: 입력한 글이 바로 들어가고, Enter로 마칩니다.`);
    } else if (target?.kind === "friend") {
      this.macroLine.close();
      this.idLine.open();
      this.idLine.text = target.text;
      this.host.announce("친구 추가: 아이디를 입력하고 Enter, 닫으려면 Esc.");
    } else {
      this.macroLine.close();
      this.idLine.close();
    }
  }

  /** C->S 0x64 (0x44bff0); the window waits for the answer (friendReplied). */
  private addFriend(name: string): void {
    this.asked = true;
    this.host.send({ type: "add-friend", name });
  }

  /** C->S 0x65 (0x44c1c0). */
  private deleteFriend(name: string): void {
    this.asked = true;
    this.host.send({ type: "delete-friend", name });
  }

  /** Each frame: the editor's text goes live (not under the message box, 0x460588) and the keys are polled. */
  update(frame: OptionFrame): void {
    if (!frame.message) this.syncText();
    this.window.poll(this.held);
  }

  /** Enter (0x45fd3b): the text typed just before it counts, as the original takes it on each key message. */
  enter(message: boolean): void {
    if (!message) this.syncText();
    this.window.enter();
  }

  /** A release, which only comes with no message box: as Enter, the text typed so far counts. */
  release(x: number, y: number): void {
    this.syncText();
    this.window.release(x, y);
    // The window has the keyboard, as the original's does: a click on it leaves no page control focused.
    const active = document.activeElement;
    if (active instanceof HTMLElement && active !== document.body && !this.host.stage.contains(active)) active.blur();
  }

  /** 0x460588 → 0x4228d0, 0x422d10: the open editor's text into the edited box or the popup's ID. */
  private syncText(): void {
    if (this.window.editing >= 0) this.window.editorText(this.macroLine.view().text);
    else if (this.window.popup?.mode === "add") this.window.editorText(this.idLine.view().text);
  }

  /** 0x420ed0 after the lobby's partial draw: the window and everything on it, the balloons last. */
  draw(ctx: CanvasRenderingContext2D, now: number, frame: OptionFrame): void {
    const { assets } = this.host;
    const win = this.window;
    ctx.drawImage(assets.option, OPTION_AT.x, OPTION_AT.y);
    if (win.editing >= 0) {
      const at = macroBox(win.editing).text;
      blit(ctx, assets.button2, MACRO_HIGHLIGHT, at.x - 2, at.y - 3);
    }
    this.drawMacros(ctx, now);
    for (const id of ["music", "effects", "balloons"] as const) {
      if (win[id]) blit(ctx, assets.button, CHECKS[id].src, CHECKS[id].at.x, CHECKS[id].at.y);
    }
    const device = CHECKS[win.device === 1 ? "joystick" : "keyboard"];
    blit(ctx, assets.button, device.src, device.at.x, device.at.y);
    if (win.changing >= 0) {
      const box = KEY_BOXES[win.changing];
      blit(ctx, assets.button2, KEY_BAR, box.at.x, box.at.y);
    }
    KEY_BOXES.forEach((box, i) => plainText(ctx, keyName(win.keys[i]), box.name.x, box.name.y, KEY_COLOUR, FONT_13));
    plainText(ctx, GESTURE.text, GESTURE.at.x, GESTURE.at.y, KEY_COLOUR, FONT_13);
    this.drawFriends(ctx);
    if (!frame.message && !win.popup) this.drawButtonArt(ctx, frame);
    if (win.popup) this.drawPopup(ctx, now, frame);
    if (this.host.settings.current.balloons && frame.inside) {
      const balloon = optionHelpAt(frame.mouse.x, frame.mouse.y, { popup: win.popup !== null, message: frame.message });
      if (balloon) drawBalloon(ctx, balloon.text, balloon.x, balloon.y);
    }
  }

  /** Boxes 1..9 (F2..F10) in 굴림체 12 white, no outline, from (x, y+1); the caret in the edited one. */
  private drawMacros(ctx: CanvasRenderingContext2D, now: number): void {
    const win = this.window;
    for (let k = 0; k < 9; k++) {
      const at = macroBox(k).text;
      macroLines(win.macros[k + 1]).forEach((line, j) => plainText(ctx, line, at.x, at.y + 1 + 15 * j, MACRO_TEXT_COLOUR, FONT_12));
    }
    if (win.editing < 0 || !this.caret.shown(now)) return;
    const at = macroBox(win.editing).text;
    const caret = macroCaret(cp949Bytes(win.macros[win.editing + 1]), this.macroLine.view().caret, at);
    drawCaret(ctx, caret.x, caret.y, MACRO_CARET_ROWS);
  }

  /** 0x422a10: twelve rows; a row with an ID shows its guild, rank, ID and where the friend is. */
  private drawFriends(ctx: CanvasRenderingContext2D): void {
    const { assets } = this.host;
    for (let i = 0; i < FRIEND_ROWS; i++) {
      const friend = this.window.friends[i];
      if (!friend) continue;
      const y = friendRowY(i);
      if (friend.name) {
        drawBadge(ctx, assets, friend.badge, { x: FRIEND_PARTS.guild, y }, { x: FRIEND_PARTS.rank, y });
        plainText(ctx, friend.name, FRIEND_PARTS.name, y, FRIEND_PARTS.colour, FONT_13);
        if (!friend.location) plainText(ctx, OFFLINE, FRIEND_PARTS.location, y, FRIEND_PARTS.colour, FONT_13);
      }
      if (friend.location) plainText(ctx, cutBytes(friend.location, LOCATION_BYTES), FRIEND_PARTS.location, y, FRIEND_PARTS.colour, FONT_13);
    }
  }

  /** 초기화's hover; while held, the first of O, X and 초기화 under the mouse shows pressed. */
  private drawButtonArt(ctx: CanvasRenderingContext2D, frame: OptionFrame): void {
    if (!frame.inside) return;
    const { button2 } = this.host.assets;
    const { x, y } = frame.mouse;
    const reset = OPTION_BUTTONS.reset;
    if (reset.hover && inside(reset.hit, x, y)) blit(ctx, button2, reset.hover, reset.at.x, reset.at.y);
    if (!frame.held) return;
    for (const button of [OPTION_BUTTONS.ok, OPTION_BUTTONS.cancel, reset]) {
      if (!inside(button.hit, x, y)) continue;
      blit(ctx, button2, button.pressed, button.at.x, button.at.y);
      return;
    }
  }

  /** 0x421558: new_basicwindow, the question or the ID label, the ID, its caret when adding, O and X held. */
  private drawPopup(ctx: CanvasRenderingContext2D, now: number, frame: OptionFrame): void {
    const popup = this.window.popup;
    if (!popup) return;
    const { assets } = this.host;
    const p = FRIEND_POPUP;
    blit(ctx, assets.basicWindow, p.src, p.at.x, p.at.y);
    if (popup.mode === "delete") outlinedText(ctx, p.question.text, p.question.at.x, p.question.at.y, p.question.colour, FONT_13);
    else blit(ctx, assets.button2, p.label.src, p.label.at.x, p.label.at.y);
    outlinedText(ctx, popup.name, p.text.x, p.text.y, p.text.colour, FONT_13);
    if (popup.mode === "add" && this.caret.shown(now)) {
      const at = friendCaret(this.idLine.view().caret);
      drawCaret(ctx, at.x, at.y);
    }
    if (!frame.held || !frame.inside) return;
    for (const button of [p.ok, p.cancel]) {
      if (inside(button.hit, frame.mouse.x, frame.mouse.y)) blit(ctx, assets.button2, button.pressed, button.at.x, button.at.y);
    }
  }
}
