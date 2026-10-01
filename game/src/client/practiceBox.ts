// The practice message box (object 0x484698): the end box after practice and the Esc box.

/** "end": all dummies gone or the local player dead ([0x48c314] = 0); "esc": opened with Esc ([0x48c314] = 1). */
export type BoxKind = "end" | "esc";
export type BoxResult = "restart" | "exit";

export interface PracticeBox {
  kind: BoxKind;
  /** Keyboard selection (+8): 1 YES, 2 NO. Show (0x443ce0) sets it to 1. */
  selection: 1 | 2;
  /** Where left or right put the cursor (SetCursorPos 0x443d00) until the mouse moves; null: the mouse. */
  keyCursor: { x: number; y: number } | null;
}

interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/**
 * Hit rects per variant. The end box uses Shake1's "다시 시작할까요?" panel rects (the 0311 draw
 * is broken, see FIDELITY §11); the Esc box is the network box, "종료하시겠습니까?" (+0x4c, +0x54).
 */
export const BOX_BUTTONS: Record<BoxKind, { yes: Rect; no: Rect }> = {
  end: { yes: { left: 354, top: 311, right: 400, bottom: 331 }, no: { left: 431, top: 311, right: 466, bottom: 331 } },
  esc: { yes: { left: 322, top: 338, right: 390, bottom: 360 }, no: { left: 414, top: 338, right: 482, bottom: 360 } },
};

export function openBox(kind: BoxKind): PracticeBox {
  return { kind, selection: 1, keyCursor: null };
}

/** YES and NO by box (0x458a19-0x458b88, 0x461bc0): the end box restarts on YES, the Esc box on NO. */
function result(box: PracticeBox, choice: 1 | 2): BoxResult {
  return (choice === 1) === (box.kind === "end") ? "restart" : "exit";
}

/** The button under the mouse (0x443fc0), or 0. */
function boxButtonAt(box: PracticeBox, x: number, y: number): 0 | 1 | 2 {
  const { yes, no } = BOX_BUTTONS[box.kind];
  if (inside(yes, x, y)) return 1;
  if (inside(no, x, y)) return 2;
  return 0;
}

/** Both edges count (jl/jg). */
function inside(rect: Rect, x: number, y: number): boolean {
  return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
}

/**
 * The button under the cursor, or 0, as the box's draw reads it every frame (0x443c50 → 0x443d60).
 * Over a button of the Esc box it also becomes the selection (0x443e78, 0x443ea9), so a box shown
 * under a mouse that has not moved takes the button there; the end box's selection only follows
 * the keys. The cursor is where left or right put it, else `mouse`.
 */
export function boxHover(box: PracticeBox, mouse: { x: number; y: number }): 0 | 1 | 2 {
  const { x, y } = box.keyCursor ?? mouse;
  const button = boxButtonAt(box, x, y);
  if (button !== 0 && box.kind === "esc") box.selection = button;
  return button;
}

/** The mouse moved: the cursor is the mouse again. */
export function boxPointer(box: PracticeBox, x: number, y: number): 0 | 1 | 2 {
  box.keyCursor = null;
  return boxHover(box, { x, y });
}

/** A mouse click (0x45891f): a button's result, or null off the buttons. */
export function boxClick(box: PracticeBox, x: number, y: number): BoxResult | null {
  const button = boxButtonAt(box, x, y);
  return button === 0 ? null : result(box, button);
}

/**
 * Left and right also SetCursorPos onto the selected button (0x443d00). 0311 aims every box at
 * the network box's buttons, (322,338) and (414,338), which miss its broken practice box; the
 * restored Shake1 box has its own, (370,331) and (447,331), inside its buttons (0x423690). The
 * browser cannot move the cursor: this gives the button the cursor would be on.
 */
const KEY_CURSOR: Record<BoxKind, Record<1 | 2, { x: number; y: number }>> = {
  end: { 1: { x: 370, y: 331 }, 2: { x: 447, y: 331 } },
  esc: { 1: { x: 322, y: 338 }, 2: { x: 414, y: 338 } },
};

export function boxKeyCursor(box: PracticeBox): 0 | 1 | 2 {
  box.keyCursor = KEY_CURSOR[box.kind][box.selection];
  return boxHover(box, box.keyCursor);
}

/**
 * Keys while the box is up: left and right set the selection (0x403900), lower-case y and n
 * choose at once (0x403b70), Enter takes the selection (0x45fb2b → 0x461bc0). Esc only clears
 * the help flag (0x460097), so it cannot close the box.
 */
export function boxKey(box: PracticeBox, key: string): BoxResult | null {
  switch (key) {
    case "ArrowLeft":
      box.selection = 1;
      return null;
    case "ArrowRight":
      box.selection = 2;
      return null;
    case "y":
      box.selection = 1;
      return result(box, 1);
    case "n":
      box.selection = 2;
      return result(box, 2);
    case "Enter":
      return result(box, box.selection);
    default:
      return null;
  }
}

export interface BoxImages {
  /** images.shk: Shake1's "다시 시작할까요? YES / NO" panel and its lit buttons. */
  panel: HTMLImageElement;
  /** new_messagebox.shk: "종료하시겠습니까?". */
  messageBox: HTMLImageElement;
  /** new_button2.shk: the lit and pressed buttons of the network box. */
  buttons: HTMLImageElement;
}

type Blit = { src: Rect; x: number; y: number };

/** Shake1's practice box: the panel (+0x14) at (295,245); the lit YES and NO over their hit rects. */
const END_PANEL: Blit = { src: { left: 222, top: 204, right: 419, bottom: 310 }, x: 295, y: 245 };
const END_LIT: Record<1 | 2, Blit> = {
  1: { src: { left: 471, top: 187, right: 517, bottom: 203 }, x: 354, y: 311 },
  2: { src: { left: 517, top: 187, right: 552, bottom: 203 }, x: 431, y: 311 },
};
/** The network box (0x443c50): new_messagebox (1,1)-(239,180) (+0xc) at (284,250). */
const ESC_PANEL: Blit = { src: { left: 1, top: 1, right: 239, bottom: 180 }, x: 284, y: 250 };
/** new_button2's lit (+0x3c, +0x44) and pressed (+0x5c, +0x64) buttons, at (322,338) and (414,338). */
const ESC_LIT: Record<1 | 2, { lit: Rect; pressed: Rect; x: number; y: number }> = {
  1: { lit: { left: 183, top: 117, right: 251, bottom: 145 }, pressed: { left: 252, top: 117, right: 320, bottom: 145 }, x: 322, y: 338 },
  2: { lit: { left: 205, top: 146, right: 273, bottom: 174 }, pressed: { left: 206, top: 175, right: 274, bottom: 203 }, x: 414, y: 338 },
};

/**
 * Draw the box (0x443c50) over the field. `hover` is the button under the mouse (0x443d60): the
 * end box lights it; the Esc box lights the selected button while the mouse is on it, pressed
 * while the mouse button is down (+0x148), so a selection made with the keys shows nothing.
 */
export function drawPracticeBox(
  ctx: CanvasRenderingContext2D,
  images: BoxImages,
  box: PracticeBox,
  hover: 0 | 1 | 2,
  pressed: boolean,
): void {
  if (box.kind === "end") {
    blit(ctx, images.panel, END_PANEL);
    if (hover !== 0) blit(ctx, images.panel, END_LIT[hover]);
    return;
  }
  blit(ctx, images.messageBox, ESC_PANEL);
  if (hover === 0 || hover !== box.selection) return;
  const button = ESC_LIT[hover];
  blit(ctx, images.buttons, { src: pressed ? button.pressed : button.lit, x: button.x, y: button.y });
}

function blit(ctx: CanvasRenderingContext2D, image: HTMLImageElement, { src, x, y }: Blit): void {
  const w = src.right - src.left;
  const h = src.bottom - src.top;
  ctx.drawImage(image, src.left, src.top, w, h, x, y, w, h);
}
