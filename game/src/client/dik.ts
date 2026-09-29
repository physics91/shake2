// The keyboard as shake.exe reads it: DirectInput key codes (DIK), polled by 0x402090. The option
// window binds the three action keys by DIK (Key1..Key3, 0x4699ac) and names them from the table
// at 0x46ded4. The browser reports keys by `KeyboardEvent.code`; this maps between the two.

/** Key1..Key3's defaults (0x44d3e3): Space for bombs, Left Ctrl for attack items, Z for evasion items. */
export const DEFAULT_KEYS: readonly [number, number, number] = [0x39, 0x1d, 0x2c];

/** The key-change poll scans DIK 2..0x8c and takes the first held key (0x402154). */
export const SCAN_FIRST = 0x02;
export const SCAN_LAST = 0x8c;

/** D is the gesture key: the poll refuses it with this message (0x402168, 0x46992c). */
export const GESTURE_DIK = 0x20;
export const GESTURE_REFUSED = "D key는 이미 사용중입니다.";

/**
 * The keys a browser can report inside the scanned range, by DIK. The DIK is the key's set 1 scan
 * code (0xE0-prefixed keys add 0x80, so the arrows, Right Ctrl and Right Alt fall outside the scan).
 */
const DIK_CODES: Readonly<Record<number, string>> = (() => {
  const codes: Record<number, string> = {};
  const run = (first: number, names: readonly string[]) => names.forEach((name, i) => (codes[first + i] = name));
  run(0x02, ["Digit1", "Digit2", "Digit3", "Digit4", "Digit5", "Digit6", "Digit7", "Digit8", "Digit9", "Digit0"]);
  run(0x0c, ["Minus", "Equal", "Backspace", "Tab"]);
  run(0x10, ["KeyQ", "KeyW", "KeyE", "KeyR", "KeyT", "KeyY", "KeyU", "KeyI", "KeyO", "KeyP", "BracketLeft", "BracketRight", "Enter", "ControlLeft"]);
  run(0x1e, ["KeyA", "KeyS", "KeyD", "KeyF", "KeyG", "KeyH", "KeyJ", "KeyK", "KeyL", "Semicolon", "Quote", "Backquote", "ShiftLeft", "Backslash"]);
  run(0x2c, ["KeyZ", "KeyX", "KeyC", "KeyV", "KeyB", "KeyN", "KeyM", "Comma", "Period", "Slash", "ShiftRight", "NumpadMultiply", "AltLeft", "Space", "CapsLock"]);
  run(0x3b, ["F1", "F2", "F3", "F4", "F5", "F6", "F7", "F8", "F9", "F10", "NumLock", "ScrollLock"]);
  run(0x47, ["Numpad7", "Numpad8", "Numpad9", "NumpadSubtract", "Numpad4", "Numpad5", "Numpad6", "NumpadAdd", "Numpad1", "Numpad2", "Numpad3", "Numpad0", "NumpadDecimal"]);
  run(0x56, ["IntlBackslash", "F11", "F12"]);
  run(0x64, ["F13", "F14", "F15"]);
  Object.assign(codes, { 0x70: "KanaMode", 0x73: "IntlRo", 0x79: "Convert", 0x7b: "NonConvert", 0x7d: "IntlYen", 0x7e: "NumpadComma" });
  return codes;
})();

const CODE_DIKS: ReadonlyMap<string, number> = new Map(Object.entries(DIK_CODES).map(([dik, code]) => [code, Number(dik)]));

/** The key's DIK when the poll can see it, else null (Escape, the arrows, Right Ctrl, ...). */
export function codeToDik(code: string): number | null {
  return CODE_DIKS.get(code) ?? null;
}

export function dikToCode(dik: number): string | null {
  return DIK_CODES[dik] ?? null;
}

/** A key the option window can bind: one the browser reports, other than D. */
export function isBindable(dik: number): boolean {
  return dik !== GESTURE_DIK && dikToCode(dik) !== null;
}

/** Every key the option window could bind, in the poll's order (DIK 2..0x8c). */
export function bindableKeys(): number[] {
  const keys: number[] = [];
  for (let dik = SCAN_FIRST; dik <= SCAN_LAST; dik++) if (isBindable(dik)) keys.push(dik);
  return keys;
}

/**
 * 0x46ded4: 137 names, index = DIK up to 0x53. From 0x54 the names follow dinput's declaration
 * order without its gaps, so F11 (DIK 0x57) shows "F14" and F12 "F15". F9 and F10 start with a TAB.
 */
export const KEY_NAMES: readonly string[] = [
  " ESCAPE ", " ESCAPE ", "    1   ", "    2   ", "    3   ", "    4   ", "    5   ", "    6   ",
  "    7   ", "    8   ", "    9   ", "    0   ", "  MINUS ", " EQUALS ", "  BACK  ", "   TAB  ",
  "    Q   ", "    W   ", "    E   ", "    R   ", "    T   ", "    Y   ", "    U   ", "    I   ",
  "    O   ", "    P   ", "LBRACKET", "RBRACKET", " RETURN ", "LCONTROL", "    A   ", "    S   ",
  "    D   ", "    F   ", "    G   ", "    H   ", "    J   ", "    K   ", "    L   ", "SMICOLON",
  " APROPHE", "  GRAVE ", " LSHIFT ", " BSLASH ", "    Z   ", "    X   ", "    C   ", "    V   ",
  "    B   ", "    N   ", "    M   ", "  COMMA ", " PERIOD ", "  SLASH ", " RSHIFT ", "MULTIPLY",
  "  LMENU ", "  SPACE ", " CAPITAL", "   F1   ", "   F2   ", "   F3   ", "   F4   ", "   F5   ",
  "   F6   ", "   F7   ", "   F8   ", "\t  F9   ", "\t F10  ", "NUMLOCK ", " SCROLL ", "NUMPAD7 ",
  "NUMPAD8 ", "NUMPAD9 ", "SUBTRACT", "NUMPAD4 ", "NUMPAD5 ", "NUMPAD6 ", "   ADD  ", "NUMPAD1 ",
  "NUMPAD2 ", "NUMPAD3 ", "NUMPAD0 ", "DECIMAL ", "   F11  ", "   F12  ", "   F13  ", "   F14  ",
  "   F15  ", "  KANA  ", "CONVERT ", "NCONVERT", "   YEN  ", "NPEQUALS", " CMFLEX ", "   AT   ",
  "  COLON ", "  ULINE ", " KANJI  ", "  STOP  ", "   AX   ", "ULABELED", " NPENTER", "RCONTROL",
  " NPCOMMA", " DIVIDE ", "  SYSRQ ", "  RMENU ", "  HOME  ", "   UP   ", " PRIOR  ", "  LEFT  ",
  " RIGHT  ", "  END   ", "  DOWN  ", "  NEXT  ", " INSERT ", " DELETE ", "  LWIN  ", "  RWIN  ",
  "  APPS  ", " PAUSE  ", " BSPACE ", "NPADSTAR", "  LALT  ", "CAPSLOCK", " NPMINUS", "NPADPLUS",
  "NPPERIOD", " NPSLASH", "  RALT  ", " UPARROW", "  PGUP  ", " LARROW ", " RARROW ", " DARROW ",
  "  PGDN  ",
];

/** The name the window draws for a bound key (0x4212ae); none past the table. */
export function keyName(dik: number): string {
  return KEY_NAMES[dik] ?? "";
}

/**
 * The key-change poll (0x402154): the first held key from DIK 2 to 0x8c, or null. `held` holds
 * `KeyboardEvent.code`s.
 */
export function firstHeld(held: Iterable<string>): number | null {
  let first: number | null = null;
  for (const code of held) {
    const dik = codeToDik(code);
    if (dik !== null && dik >= SCAN_FIRST && dik <= SCAN_LAST && (first === null || dik < first)) first = dik;
  }
  return first;
}
