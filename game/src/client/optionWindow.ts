// The option window's state and rules (scene 13, shake.exe 0311): opened by the lobby remote's
// 옵션 (0x420dd0), closed by O, X, Enter or Esc (0x420e90). No drawing and no DOM: the lobby
// screen draws it (optionScreen.ts) and gives it the mouse, the keys and the editor's text.
import type { Badge } from "../server/protocol.ts";
import { DEFAULT_KEYS, firstHeld, GESTURE_DIK, GESTURE_REFUSED } from "./dik.ts";
import type { CheckId } from "./optionLayout.ts";
import { FRIEND_ID_LIMIT, optionTargetAt, popupTargetAt } from "./optionLayout.ts";
import type { Control, Settings } from "./settings.ts";
import { cloneSettings, MACRO_SLOTS } from "./settings.ts";
import { cp949Bytes } from "../server/cp949.ts";

/** A friend list row (record 0x48b988 + 0x40 i): the ID and where the server says the friend is. */
export interface FriendRecord {
  name: string;
  location: string;
  /** The friend's guild and level; null for an ID no account has. */
  badge: Badge | null;
}

/** The device switch's failures (res#2, res#3). */
export const DEVICE_ERRORS = {
  joystick: "조이스틱 초기화 에러",
  keyboard: "키보드 초기화 에러",
};

export interface OptionHost {
  /** The option object as it is now (0x48acd0): X and Esc go back to it. */
  current(): Readonly<Settings>;
  /** Apply and save (0x4227e0 → 0x44d040): O, Enter and 초기화. */
  save(settings: Settings): void;
  /** 0x402520: the game's input device changes now; false when it cannot start. */
  useControl(control: Control): boolean;
  /** Back to the lobby with its chat line (0x420e90). */
  close(): void;
  /** The message box (MSGBOX 0x443700). */
  message(text: string): void;
  /** The shared line editor (0x4714f8) opens on a macro box or the friend popup's ID, or closes. */
  edit(target: { kind: "macro" | "friend"; text: string } | null): void;
  /** The friend popup's O: C->S 0x64 (add) or 0x65 (delete); the answer comes to friendAnswered. */
  addFriend(name: string): void;
  deleteFriend(name: string): void;
}

export class OptionWindow {
  /** The check marks' copies ([0x4944d8], [0x494778], [0x494758]); they reach the options on O. */
  music: boolean;
  effects: boolean;
  balloons: boolean;
  /** The 1P and 조이스틱 marks ([0x494790], [0x494791]). */
  device: Control;
  /** Key1..Key3 ([0x4699ac]): changed live, put back by X. */
  keys: [number, number, number];
  /** The edit buffers 0x494550 + 0x33 i, CM1..CM10. */
  macros: string[];
  /** The macro box being edited, 0..8 for F2..F10 ([0x46decc] - 1 with [0x49485c]), or -1. */
  editing = -1;
  /** The key being changed, 0..2 for BOMB, ITEM1, ITEM2 ([0x48c304] with 305..307), or -1. */
  changing = -1;
  /** The friend popup ([0x494865]): delete ([0x494864]) or add, and its ID editor's text ([0x4947b0]). */
  popup: { mode: "add" | "delete"; name: string } | null = null;
  /** Waiting for the server ([0x496ca0]): clicks and Esc are dropped, the busy cursor shows. */
  busy = true;
  friends: FriendRecord[] = [];
  private readonly host: OptionHost;

  /** 0x420dd0: the window copies the options; it asks for the friend list and waits (0x459ac8). */
  constructor(host: OptionHost) {
    this.host = host;
    const settings = host.current();
    this.music = settings.music;
    this.effects = settings.effects;
    this.balloons = settings.balloons;
    this.device = settings.control === 0 ? 0 : 1;
    this.keys = [...settings.keys];
    this.macros = [...settings.macros];
  }

  /** S->C 0x63: the list replaces the records and the wait ends (0x44bda0). */
  friendsAnswered(friends: readonly FriendRecord[]): void {
    this.friends = friends.slice(0, 12).map((f) => ({ ...f }));
    this.busy = false;
  }

  /** The answer to the popup's O (S->C 0x64 0x44c050, 0x65 0x44c220): the popup closes and the wait ends. */
  friendAnswered(): void {
    this.closePopup();
    this.busy = false;
  }

  /** A left release (0x45a172). The lobby has already dropped it under the help, the wait and the message box. */
  release(x: number, y: number): void {
    if (this.popup) {
      const target = popupTargetAt(x, y);
      if (target === "ok") this.submitPopup();
      else if (target === "cancel") this.closePopup();
      return;
    }
    const target = optionTargetAt(x, y);
    switch (target.kind) {
      case "ok":
        this.applyAndClose();
        break;
      case "reset":
        this.reset();
        break;
      case "cancel":
        this.restoreAndClose();
        break;
      case "check":
        if (!this.check(target.id)) this.endModes();
        break;
      case "key":
        // 0x422470 etc.: the bar lights, then the macro edit ends.
        this.changing = target.slot;
        this.endMacroEdit();
        break;
      case "macro":
        this.startMacroEdit(target.box);
        this.changing = -1;
        break;
      case "friend":
        this.openPopup(target.row);
        break;
      case "elsewhere":
        this.endModes();
        break;
    }
  }

  /** Enter (0x45fd3b): ends a macro edit; else the popup's O; else O. The message box is not looked at. */
  enter(): void {
    if (this.editing >= 0) this.endMacroEdit();
    else if (this.popup) this.submitPopup();
    else this.applyAndClose();
  }

  /** Esc once the lobby has passed the wait, the help and the message box (0x46189c): the popup, else X. */
  escape(): void {
    if (this.popup) this.closePopup();
    else this.restoreAndClose();
  }

  /** After each key message, unless a key change is on (0x460588 → 0x4228d0, 0x422d10): the editor's text goes live. */
  editorText(text: string): void {
    if (this.changing >= 0) return;
    if (this.editing >= 0) this.macros[this.editing + 1] = text;
    else if (this.popup?.mode === "add") this.popup.name = text;
  }

  /**
   * The key-change poll (0x402090), each frame, only while the keyboard is the device (not the 1P
   * mark, which 초기화 sets alone): the lowest held DIK. D is refused.
   * A key another slot holds goes to that slot's place first: that slot takes this slot's key,
   * and this slot takes the key on the next poll if it is still held (0x40218e-0x402268).
   */
  poll(held: Iterable<string>): void {
    if (this.changing < 0 || this.host.current().control !== 0) return;
    const dik = firstHeld(held);
    if (dik === null) return;
    if (dik === GESTURE_DIK) {
      this.host.message(GESTURE_REFUSED);
      return;
    }
    const slot = this.changing;
    const other = [0, 1, 2].find((i) => i !== slot && this.keys[i] === dik);
    if (other !== undefined) this.keys[other] = this.keys[slot];
    else this.keys[slot] = dik;
  }

  /** The values O saves (0x4227e0): the checks, CM1..CM10 and the keys over the option object. */
  private edited(): Settings {
    return { ...cloneSettings(this.host.current()), music: this.music, effects: this.effects, balloons: this.balloons, macros: [...this.macros], keys: [...this.keys] };
  }

  private apply(): void {
    this.endMacroEdit();
    this.host.save(this.edited());
  }

  private applyAndClose(): void {
    this.apply();
    this.close();
  }

  /** 초기화 (0x4222e0): the checks on, the default keys, the 1P mark, no macros; saved; the window stays. */
  private reset(): void {
    this.music = true;
    this.effects = true;
    this.balloons = true;
    this.keys = [...DEFAULT_KEYS];
    // The mark only: the device and control stay as they are.
    this.device = 0;
    this.macros = Array.from({ length: MACRO_SLOTS }, () => "");
    this.apply();
  }

  /**
   * The copies again from the option object, device marks from control, as X takes them. Also when
   * this remake's option section saves under the open window, so that save shows here (R).
   */
  reload(): void {
    const settings = this.host.current();
    this.music = settings.music;
    this.effects = settings.effects;
    this.balloons = settings.balloons;
    this.keys = [...settings.keys];
    this.device = settings.control === 0 ? 0 : 1;
    this.macros = [...settings.macros];
  }

  /** X and Esc (0x4221b0, 0x422910): back to the option object. */
  private restoreAndClose(): void {
    this.reload();
    this.close();
  }

  /** 0x420e90: the edit and the key change end; the popup is left as it was. */
  private close(): void {
    this.endMacroEdit();
    this.changing = -1;
    this.host.close();
  }

  /** A check (0x4220f0, 0x422090, 0x422150) toggles and ends nothing; a device switch acts at once. */
  private check(id: CheckId): boolean {
    switch (id) {
      case "music":
        this.music = !this.music;
        return true;
      case "effects":
        this.effects = !this.effects;
        return true;
      case "balloons":
        this.balloons = !this.balloons;
        return true;
      case "keyboard":
        return this.switchDevice(0);
      case "joystick":
        return this.switchDevice(1);
    }
  }

  /**
   * 1P (0x421f90) and 조이스틱 (0x421e90): with control already there only the marks change;
   * otherwise the device is set up now and control follows, or the message says it failed.
   */
  private switchDevice(control: Control): boolean {
    const current = this.host.current().control;
    const already = control === 1 ? current !== 0 : current === 0;
    if (!already && !this.host.useControl(control)) {
      this.host.message(control === 1 ? DEVICE_ERRORS.joystick : DEVICE_ERRORS.keyboard);
      return false;
    }
    this.device = control;
    return true;
  }

  /** 0x4225e0: box k edits CM(k+2); the editor holds its text, the caret at its end. */
  private startMacroEdit(box: number): void {
    this.editing = box;
    this.host.edit({ kind: "macro", text: this.macros[box + 1] });
  }

  /** 0x4227c0: only the edit's flags; the text stays where the last key put it. */
  private endMacroEdit(): void {
    if (this.editing < 0) return;
    this.editing = -1;
    this.host.edit(null);
  }

  private endModes(): void {
    this.endMacroEdit();
    this.changing = -1;
  }

  /** A friend row (0x422b00 → 0x422c40): a row with an ID asks to delete it, an empty one to add. */
  private openPopup(row: number): void {
    const name = this.friends[row]?.name ?? "";
    this.endMacroEdit();
    this.changing = -1;
    this.popup = name ? { mode: "delete", name } : { mode: "add", name: "" };
    if (!name) this.host.edit({ kind: "friend", text: "" });
  }

  /** 0x422bd0: the ID is dropped and the editor goes back to the macro limit. */
  closePopup(): void {
    if (this.popup?.mode === "add") this.host.edit(null);
    this.popup = null;
  }

  /** The popup's O (0x45a192): delete asks at once; an add over 10 bytes closes without asking. */
  private submitPopup(): void {
    const popup = this.popup;
    if (!popup) return;
    if (popup.mode === "delete") {
      this.busy = true;
      this.host.deleteFriend(popup.name);
      return;
    }
    if (cp949Bytes(popup.name) > FRIEND_ID_LIMIT - 1) {
      this.closePopup();
      return;
    }
    this.busy = true;
    this.host.addFriend(popup.name);
  }
}
