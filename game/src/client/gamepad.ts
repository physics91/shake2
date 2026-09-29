// The joystick (option control = 1): DirectInput's first joystick (0x402520 mode 1), its axes set
// to -10..10 with a 10 % dead zone, read as the keys: lY < -5 up, > 5 down, lX < -5 left, > 5
// right; button 0 bombs, button 2 attack items, button 1 evasion items (3 is the unused gesture).
// The browser's Gamepad API stands in for it.
import type { InputFrame } from "../sim/types.ts";
import { Dir } from "../sim/types.ts";

export interface PadLike {
  axes: readonly number[];
  buttons: readonly { pressed: boolean }[];
}

const DEAD_ZONE = 0.1;
const RANGE = 10;
const THRESHOLD = 5;

/** An axis as DirectInput reports it: 0 in the dead zone, the rest a straight line to -10..10 (DirectInput's "Interpreting Joystick Axis Data"). */
export function axisValue(raw: number): number {
  const size = Math.abs(raw);
  if (size <= DEAD_ZONE) return 0;
  return Math.sign(raw) * Math.min(1, (size - DEAD_ZONE) / (1 - DEAD_ZONE)) * RANGE;
}

/** The pad as the game reads it; directions keep the keyboard's priority, up > down > left > right. */
export function padFrame(pad: PadLike): Required<InputFrame> {
  const x = axisValue(pad.axes[0] ?? 0);
  const y = axisValue(pad.axes[1] ?? 0);
  let dir: Dir | null = null;
  if (y < -THRESHOLD) dir = Dir.Up;
  else if (y > THRESHOLD) dir = Dir.Down;
  else if (x < -THRESHOLD) dir = Dir.Left;
  else if (x > THRESHOLD) dir = Dir.Right;
  const pressed = (i: number) => pad.buttons[i]?.pressed ?? false;
  return { dir, bomb: pressed(0), attack: pressed(2), evade: pressed(1) };
}

/** The first connected pad, like the startup's first enumerated joystick. */
export function firstPad(pads: readonly (PadLike | null)[]): PadLike | null {
  return pads.find((pad): pad is PadLike => pad !== null) ?? null;
}

/** The browser's pads; none before one of their buttons is pressed on this page. */
export function connectedPad(): PadLike | null {
  try {
    return firstPad(navigator.getGamepads?.() ?? []);
  } catch {
    return null;
  }
}
