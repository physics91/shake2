import type { InputFrame } from "../sim/types.ts";
import { Dir } from "../sim/types.ts";
import { DEFAULT_KEYS, dikToCode } from "./dik.ts";

/** Key lists use `KeyboardEvent.code`, so layouts (QWERTY, 두벌식) do not matter. */
export interface KeyBinding {
  up: readonly string[];
  down: readonly string[];
  left: readonly string[];
  right: readonly string[];
  bomb: readonly string[];
  attack: readonly string[];
  evade: readonly string[];
}

/**
 * One player's keys (DirectInput poll 0x402090, getDir 0x4024d0, getAction 0x4024e0): the fixed
 * arrows, and Key1..Key3 (0x4699ac) from the option window for bombs, attack items and evasion
 * items. D (gesture) is not used.
 */
export function soloKeys(keys: readonly [number, number, number]): KeyBinding {
  const code = (dik: number, fallback: number) => [dikToCode(dik) ?? dikToCode(fallback) ?? ""];
  return {
    up: ["ArrowUp"],
    down: ["ArrowDown"],
    left: ["ArrowLeft"],
    right: ["ArrowRight"],
    bomb: code(keys[0], DEFAULT_KEYS[0]),
    attack: code(keys[1], DEFAULT_KEYS[1]),
    evade: code(keys[2], DEFAULT_KEYS[2]),
  };
}

/** The default keys: Space, Left Ctrl and Z. */
export const SOLO_KEYS: KeyBinding = soloKeys(DEFAULT_KEYS);

/** The page's words for a key code. */
export function keyLabel(code: string): string {
  const sides: Record<string, string> = { Left: "왼쪽", Right: "오른쪽" };
  const sided = /^(Control|Shift|Alt)(Left|Right)$/.exec(code);
  if (sided) return `${sides[sided[2]]} ${sided[1] === "Control" ? "Ctrl" : sided[1]}`;
  const simple = /^(?:Key|Digit)(.)$/.exec(code);
  if (simple) return simple[1];
  if (code.startsWith("Numpad")) return `숫자패드 ${code.slice(6)}`;
  return code;
}

/** "이동: 방향키 · 폭탄: Space · 공격용: 왼쪽 Ctrl · 회피용: Z", or the joystick's buttons. */
export function soloKeysHelp(binding: KeyBinding, joystick = false): string {
  const keyboard = `이동: 방향키 · 폭탄: ${keyLabel(binding.bomb[0])} · 공격용: ${keyLabel(binding.attack[0])} · 회피용: ${keyLabel(binding.evade[0])}`;
  if (!joystick) return keyboard;
  // The browser shows a pad only after one of its buttons is pressed on the page; until then the keys play.
  return `이동: 조이스틱 스틱 · 폭탄: 0번 단추 · 공격용: 2번 단추 · 회피용: 1번 단추 (패드 단추를 한 번 누르기 전에는 키보드: ${keyboard})`;
}

/**
 * Two players on one keyboard is this remake's addition; the original has one player per PC.
 * 1P avoids Ctrl, which the browser would read as Ctrl+W with the up key held.
 */
export const VERSUS_KEYS: readonly [KeyBinding, KeyBinding] = [
  {
    up: ["KeyW"],
    down: ["KeyS"],
    left: ["KeyA"],
    right: ["KeyD"],
    bomb: ["Space", "ShiftLeft"],
    attack: ["KeyQ"],
    evade: ["KeyE"],
  },
  {
    up: ["ArrowUp"],
    down: ["ArrowDown"],
    left: ["ArrowLeft"],
    right: ["ArrowRight"],
    bomb: ["Enter", "NumpadEnter", "ShiftRight", "Numpad0", "Slash"],
    attack: ["ControlRight", "Period", "Numpad1"],
    evade: ["Comma", "Numpad2"],
  },
];

export function boundCodes(bindings: readonly KeyBinding[]): Set<string> {
  return new Set(
    bindings.flatMap((b) => [...b.up, ...b.down, ...b.left, ...b.right, ...b.bomb, ...b.attack, ...b.evade]),
  );
}

/**
 * Held keys. Directions have the original's fixed priority, up > down > left > right
 * (0x4024d0); an action key tapped between two ticks still counts for one tick.
 */
export class KeyState {
  private held: string[] = [];
  private tapped = new Set<string>();

  press(code: string): void {
    if (this.held.includes(code)) return;
    this.held.push(code);
    this.tapped.add(code);
  }

  release(code: string): void {
    this.held = this.held.filter((c) => c !== code);
  }

  clear(): void {
    this.held = [];
    this.tapped.clear();
  }

  sample(binding: KeyBinding): Required<InputFrame> {
    const held = (codes: readonly string[]) => codes.some((code) => this.held.includes(code));
    let dir: Dir | null = null;
    if (held(binding.up)) dir = Dir.Up;
    else if (held(binding.down)) dir = Dir.Down;
    else if (held(binding.left)) dir = Dir.Left;
    else if (held(binding.right)) dir = Dir.Right;
    const pressed = (codes: readonly string[]) =>
      codes.some((code) => this.held.includes(code) || this.tapped.has(code));
    return { dir, bomb: pressed(binding.bomb), attack: pressed(binding.attack), evade: pressed(binding.evade) };
  }

  /** Call once per simulation tick after every binding was sampled. */
  endTick(): void {
    this.tapped.clear();
  }
}

/** Enter and Space activate an assistive button instead of the game's keys. */
export function isButtonActivation(event: KeyboardEvent): boolean {
  return event.target instanceof HTMLElement && event.target.tagName === "BUTTON" && (event.code === "Space" || event.key === "Enter");
}

/**
 * Feed window keyboard events into `keys`; `onChange` runs after each bound key change. Returns a
 * detach function. Keys typed into a text field are left to it, except in one marked
 * `data-direct-input`: the original reads the keyboard with DirectInput (GetDeviceState, 0x4020d2)
 * whatever has the focus, so a key held on its chat line counts once the line closes.
 */
export function attachKeyboard(keys: KeyState, bound: ReadonlySet<string>, onChange?: () => void): () => void {
  const down = (event: KeyboardEvent) => {
    if (!bound.has(event.code) || isButtonActivation(event)) return;
    if (isTextField(event.target)) {
      if (!(event.target as HTMLElement).hasAttribute("data-direct-input")) return;
    } else {
      event.preventDefault();
    }
    // Loading or a blur can hide the initial press; a repeat still says the key is down.
    // KeyState ignores presses it already holds, so repeats cannot create extra action taps.
    keys.press(event.code);
    onChange?.();
  };
  const up = (event: KeyboardEvent) => {
    if (!bound.has(event.code)) return;
    keys.release(event.code);
    onChange?.();
  };
  const blur = () => {
    keys.clear();
    onChange?.();
  };
  window.addEventListener("keydown", down);
  window.addEventListener("keyup", up);
  window.addEventListener("blur", blur);
  return () => {
    window.removeEventListener("keydown", down);
    window.removeEventListener("keyup", up);
    window.removeEventListener("blur", blur);
  };
}

/** Keep keys held through an asset load; completed taps expire before the game's first poll. */
export async function readKeysWhileLoading<T>(keys: KeyState, bound: ReadonlySet<string>, load: () => Promise<T>, signal?: AbortSignal): Promise<T> {
  const detach = signal?.aborted ? () => undefined : attachKeyboard(keys, bound);
  signal?.addEventListener("abort", detach, { once: true });
  try {
    return await load();
  } finally {
    signal?.removeEventListener("abort", detach);
    detach();
    keys.endTick();
  }
}

function isTextField(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));
}
