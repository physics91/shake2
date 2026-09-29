// Scene 5's option page, the older one 0311 carries but cannot show (findings_scene5.md §4.5,
// §5.3): open 0x41f2c0, clicks in 0x41dfc0, key poll 0x402090, 확인 0x420410, Tab 0x41f3f0.
// Rules only; statusScreen.ts draws it over Shake1's option.shk and gives it the mouse and keys.
import { firstHeld, GESTURE_DIK, GESTURE_REFUSED } from "./dik.ts";
import { DEVICE_ERRORS } from "./optionWindow.ts";
import { inside } from "./roomLayout.ts";
import type { Control, Keys, Settings } from "./settings.ts";
import { cloneSettings } from "./settings.ts";
import { OPTION_PAGE, OPTION_SAVED, optionMacroLine } from "./statusLayout.ts";

export interface StatusOptionHost {
  /** The option object (0x48acd0). */
  current(): Readonly<Settings>;
  /** 0x44d040. */
  save(settings: Settings): void;
  /** 0x402520: the input device changes now; false when it cannot start. */
  useControl(control: Control): boolean;
  /** MSGBOX (0x443700). */
  message(text: string): void;
  /** SND 0x25, menu2. */
  click(): void;
  /** The editor (0x4714f8) is now on this line, with its text. */
  edit(line: number, text: string): void;
}

export class StatusOption {
  private readonly host: StatusOptionHost;
  /** The page's buffers 0x494074 + 0x33 i: CM1..CM10, shown as F1..F10. */
  readonly macros: string[];
  /** [0x494444]: the line the editor is on. */
  line = 0;
  /** [0x46d860], [0x46d861]: the options' copies until 확인. */
  music: boolean;
  effects: boolean;
  /** [0x494441]: the joystick's mark ([0x46d862] is its opposite). */
  joystick: boolean;
  /** Key1..Key3 ([0x4699ac]), the page's live keys: changed at once, saved by 확인. */
  readonly keys: Keys;
  /** [0x48c304] with [0x48c305..7]: the key being changed, or −1. */
  changing = -1;

  /** 0x41f2c0: everything from the options as they are; the editor on CM1. */
  constructor(host: StatusOptionHost, keys: Keys) {
    this.host = host;
    const current = host.current();
    this.macros = [...current.macros];
    this.music = current.music;
    this.effects = current.effects;
    this.joystick = current.control === 1;
    this.keys = keys;
    host.edit(0, this.macros[0]);
  }

  /** The editor's text is the line's (0x41f430). */
  editorText(text: string): void {
    this.macros[this.line] = text;
  }

  /** Tab (0x41f3f0): the next line, 9 back to 0. */
  tab(): void {
    this.pick((this.line + 1) % OPTION_PAGE.macros.lines);
  }

  /** A click on the page, in 0x41e223's order: "saved" after 확인 wrote the options, "close" for 취소. */
  click(x: number, y: number): "saved" | "close" | null {
    const page = OPTION_PAGE;
    if (inside(page.joystick, x, y)) this.joystick = true;
    else if (inside(page.keyboard, x, y)) this.joystick = false;
    else if (inside(page.music.on.hit, x, y)) this.music = true;
    else if (inside(page.music.off.hit, x, y)) this.music = false;
    else if (inside(page.sound.on.hit, x, y)) this.effects = true;
    else if (inside(page.sound.off.hit, x, y)) this.effects = false;
    else {
      const key = page.keys.findIndex((box) => inside(box.hit, x, y));
      if (key >= 0) {
        this.host.click();
        this.changing = key;
        return null;
      }
      // Any other click ends a key change.
      this.changing = -1;
      if (inside(page.macros.hit, x, y)) {
        const line = optionMacroLine(y);
        if (line !== null) this.pick(line);
      } else if (inside(page.ok.hit, x, y)) {
        this.host.click();
        return this.save() ? "saved" : null;
      } else if (inside(page.cancel.hit, x, y)) {
        // The keys stay as changed until Go, Practice or Ranking puts them back.
        this.host.click();
        return "close";
      }
    }
    return null;
  }

  /**
   * The key-change poll (0x402090), each frame, only while the keyboard is the device: the lowest
   * held DIK. D is refused. A key another slot holds goes to that slot's place first: that slot
   * takes this slot's key, and this slot takes the key on the next poll if it is still held.
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

  private pick(line: number): void {
    this.line = line;
    this.host.edit(line, this.macros[line]);
  }

  /** 확인 (0x420410): the device first; then the macros, music, sound and keys; the page stays open. */
  private save(): boolean {
    const control: Control = this.joystick ? 1 : 0;
    if (control !== this.host.current().control && !this.host.useControl(control)) {
      this.host.message(control === 1 ? DEVICE_ERRORS.joystick : DEVICE_ERRORS.keyboard);
      return false;
    }
    const current = this.host.current();
    this.host.save({ ...cloneSettings(current), music: this.music, effects: this.effects, macros: [...this.macros], keys: [...this.keys], control });
    this.host.message(OPTION_SAVED);
    return true;
  }
}
