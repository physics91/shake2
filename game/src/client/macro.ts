// The chat macros (0x461a50): F2..F10 put the option window's text for that key into the chat
// line, freshly opened and empty (0x418cd0(1)), without sending it; Enter sends it as any line.

/** F2..F10 → CM2..CM10 (slot = VK - 0x70); other keys are not macros. */
export function macroSlot(code: string): number | null {
  const match = /^F(\d+)$/.exec(code);
  if (!match) return null;
  const n = Number(match[1]);
  return n >= 2 && n <= 10 ? n - 1 : null;
}

/** The browser's own F2..F10 actions (rename, find, reload, the address bar, caret browsing, the menu). */
export function isMacroKey(code: string): boolean {
  return macroSlot(code) !== null;
}

/**
 * Whether the macro opens the chat line. F2..F9 come as WM_KEYDOWN, which the yes/no box takes
 * first; F10 comes as WM_SYSKEYDOWN, which does not look at it (0x45facc). `blocked` is the
 * scene's own check: a lobby popup, the room's open list; nothing in a match.
 */
export function macroOpens(slot: number, at: { box: boolean; blocked: boolean }): boolean {
  if (at.box && slot < 9) return false;
  return !at.blocked;
}
