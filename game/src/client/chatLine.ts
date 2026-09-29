// The hidden <input> behind practice's chat line. The browser does the IME; this keeps the line to
// what shake.exe's editor (0x4714f8) takes and reports what the line shows.
import type { Composition } from "./chat.ts";
import { CHAT_LIMIT, CHAT_LINE, chatView, fitsChat, typeable } from "./chat.ts";
import { SCREEN_H, SCREEN_W } from "./hudLayout.ts";

/**
 * The editor answers ← and → (moving over a whole character), Delete (0x403900) and Backspace
 * (0x403b70). It has no Home, End, selection, clipboard or undo, and Tab types nothing.
 */
function refused(event: KeyboardEvent): boolean {
  if (event.ctrlKey || event.metaKey) return true;
  if (["Home", "End", "ArrowUp", "ArrowDown", "PageUp", "PageDown", "Tab"].includes(event.key)) return true;
  return event.shiftKey && (event.key === "ArrowLeft" || event.key === "ArrowRight");
}

export interface ChatLineOptions {
  /** The editor's byte limit: 37 in a game (0x418cd0), 45 in the lobby and the room (0x418d37). */
  limit: number;
  /** Where the line is drawn, for the IME's candidate window. */
  at: { x: number; y: number };
  /**
   * In a game the line keeps the focus while it is open: the original never closes it on a click.
   * The room leaves the page's controls reachable with Tab instead.
   */
  trapFocus: boolean;
}

export class ChatLine {
  private readonly input: HTMLInputElement;
  private readonly limit: number;
  private accepted = { value: "", caret: 0 };
  private composition: Composition | null = null;
  private opened = false;
  private readonly detach: () => void;

  constructor(stage: HTMLElement, options: ChatLineOptions = { limit: CHAT_LIMIT, at: CHAT_LINE, trapFocus: true }) {
    this.limit = options.limit;
    const input = document.createElement("input");
    input.type = "text";
    input.className = "chat-line";
    input.autocomplete = "off";
    input.spellcheck = false;
    input.tabIndex = -1;
    input.setAttribute("aria-label", "채팅");
    // attachKeyboard keeps reading the game keys typed here, as DirectInput did.
    input.setAttribute("data-direct-input", "");
    input.style.left = `${(options.at.x / SCREEN_W) * 100}%`;
    input.style.top = `${(options.at.y / SCREEN_H) * 100}%`;
    stage.append(input);
    this.input = input;

    const onKey = (event: KeyboardEvent) => {
      // The room lets Tab leave the line for the page's controls.
      if (event.key === "Tab" && !options.trapFocus) return;
      if (refused(event)) event.preventDefault();
    };
    const refuse = (event: Event) => event.preventDefault();
    const onStart = () => {
      this.composition = { start: input.selectionStart ?? input.value.length, text: "" };
    };
    const onUpdate = (event: CompositionEvent) => {
      if (this.composition) this.composition.text = event.data;
    };
    const onEnd = () => {
      this.composition = null;
      this.settle();
    };
    const onInput = (event: Event) => {
      if (!(event as InputEvent).isComposing && !this.composition) this.settle();
    };
    // A click on the game must not take the line's focus: the original never closes it that way.
    const onBlur = () => {
      if (this.opened && options.trapFocus) requestAnimationFrame(() => this.focus());
    };
    const onWindowFocus = () => {
      if (options.trapFocus) this.focus();
    };
    input.addEventListener("keydown", onKey);
    input.addEventListener("paste", refuse);
    input.addEventListener("drop", refuse);
    input.addEventListener("compositionstart", onStart);
    input.addEventListener("compositionupdate", onUpdate);
    input.addEventListener("compositionend", onEnd);
    input.addEventListener("input", onInput);
    input.addEventListener("blur", onBlur);
    window.addEventListener("focus", onWindowFocus);
    this.detach = () => {
      window.removeEventListener("focus", onWindowFocus);
      input.remove();
    };
  }

  get isOpen(): boolean {
    return this.opened;
  }

  /** 0x418cd0(1): the editor starts empty. */
  open(): void {
    this.opened = true;
    this.reset();
    this.focus();
  }

  /** Enter or Esc: the line closes; returns what it held. */
  close(): string {
    const text = this.accepted.value;
    this.opened = false;
    this.reset();
    this.input.blur();
    return text;
  }

  /** While the box is up the editor takes no characters (0x403b70). */
  set locked(locked: boolean) {
    this.input.readOnly = locked;
  }

  /** The line as drawn. ← and → fire no input event, so the caret is picked up here, each frame. */
  view(): { text: string; caret: number } {
    const { input } = this;
    if (this.composition) return chatView(input.value, this.composition, input.value.length, this.limit);
    if (input.value === this.accepted.value) this.accepted.caret = input.selectionStart ?? input.value.length;
    return chatView(this.accepted.value, null, this.accepted.caret, this.limit);
  }

  dispose(): void {
    this.opened = false;
    this.detach();
  }

  /** Put the line's text back, as the room's Up key recalls the last line sent. */
  set text(value: string) {
    this.input.value = value;
    this.accepted = { value, caret: value.length };
    this.input.setSelectionRange(value.length, value.length);
  }

  /** Move the hidden input under the text it edits, for the IME's candidate window. */
  place(at: { x: number; y: number }): void {
    this.input.style.left = `${(at.x / SCREEN_W) * 100}%`;
    this.input.style.top = `${(at.y / SCREEN_H) * 100}%`;
  }

  /** The hidden input, for key handling and focus checks. */
  get element(): HTMLInputElement {
    return this.input;
  }

  focus(): void {
    if (this.opened && document.hasFocus() && document.activeElement !== this.input) this.input.focus({ preventScroll: true });
  }

  private reset(): void {
    this.composition = null;
    this.input.value = "";
    this.accepted = { value: "", caret: 0 };
  }

  /** Keep what the editor would have taken: cp949 characters under the byte limit; refuse the rest whole. */
  private settle(): void {
    const { input } = this;
    const caret = input.selectionStart ?? input.value.length;
    const value = typeable(input.value);
    if (!fitsChat(value, this.limit)) {
      input.value = this.accepted.value;
      input.setSelectionRange(this.accepted.caret, this.accepted.caret);
      return;
    }
    const kept = typeable(input.value.slice(0, caret)).length;
    if (value !== input.value) {
      input.value = value;
      input.setSelectionRange(kept, kept);
    }
    this.accepted = { value, caret: kept };
  }
}
