import { SoundBank } from "./audio.ts";
import { SCREEN_H, SCREEN_W } from "./renderer.ts";
import { SettingsStore } from "./settings.ts";
import { h, readPreference, writePreference } from "./ui.ts";

/** The option object (0x48acd0), kept in this browser: the option window and the toolbar change it. */
export const settings = new SettingsStore({ get: readPreference, set: writePreference });

export const sounds = new SoundBank();
sounds.setEffects(settings.current.effects);
sounds.setMusic(settings.current.music);
// O and 초기화 (0x4227e0): music off stops the tune, on starts nothing.
settings.listen((next) => {
  sounds.setEffects(next.effects);
  sounds.setMusic(next.music);
});

const app = document.getElementById("app") as HTMLElement;
let cleanup: (() => void) | null = null;
let screenId = 0;

/** Replace the visible screen; the first heading receives focus for keyboard and screen-reader users. */
export function mount(screen: HTMLElement): void {
  app.replaceChildren(screen);
  screen.querySelector<HTMLElement>("h1")?.focus({ preventScroll: true });
}

/** Stop whatever the current screen runs and invalidate its pending async work. Returns the new screen id. */
export function leave(): number {
  screenId += 1;
  const stop = cleanup;
  cleanup = null;
  stop?.();
  return screenId;
}

export function isCurrent(id: number): boolean {
  return id === screenId;
}

export function setCleanup(id: number, stop: () => void): void {
  if (isCurrent(id)) cleanup = stop;
  else stop();
}

export type GameStarter = (
  canvas: HTMLCanvasElement,
  announce: (text: string) => void,
  onExit: () => void,
) => Promise<() => void>;

export interface GameScreen {
  root: HTMLElement;
  stage: HTMLElement;
  canvas: HTMLCanvasElement;
  announce(text: string): void;
  loaded(): void;
  failed(message: string): void;
}

/** Build (but do not mount) the game screen: toolbar, canvas, key help and a live region. */
export function gameScreen(title: string, keys: string, onExit: () => void): GameScreen {
  const canvas = h("canvas", {
    width: SCREEN_W,
    height: SCREEN_H,
    class: "game-canvas",
    role: "img",
    "aria-label": `${title} 게임 화면`,
  });
  const live = h("p", { class: "sr-only", "aria-live": "polite" });
  const loading = h("p", { class: "loading", role: "status" }, "에셋을 불러오는 중…");
  // The original's sound options (0x44cd50), which its option window sets: the same values here.
  const effectsButton = toggleButton("효과음", settings.current.effects, (on) => settings.update({ effects: on }));
  const musicButton = toggleButton("음악", settings.current.music, (on) => settings.update({ music: on }));
  const stage = h("div", { class: "stage" }, canvas, loading);
  const root = h(
    "main",
    { class: "screen game shake" },
    h(
      "header",
      { class: "toolbar" },
      h("button", { class: "btn small", type: "button", onclick: onExit }, "← 나가기"),
      h("h1", { tabindex: "-1" }, title),
      effectsButton,
      musicButton,
    ),
    stage,
    h("p", { class: "keys" }, keys),
    live,
  );
  return {
    root,
    stage,
    canvas,
    announce: (text) => (live.textContent = text),
    loaded: () => loading.remove(),
    failed: (message) => (loading.textContent = message),
  };
}

function toggleButton(label: string, on: boolean, onChange: (on: boolean) => void): HTMLButtonElement {
  const button = h("button", { class: "btn small", type: "button", "aria-pressed": String(on) }, label);
  button.addEventListener("click", () => {
    const next = button.getAttribute("aria-pressed") !== "true";
    button.setAttribute("aria-pressed", String(next));
    onChange(next);
  });
  return button;
}

/** Replace the screen with the game canvas and start `starter`; Esc or the back button calls `onExit`. */
export function showGame(title: string, keys: string, starter: GameStarter, onExit: () => void): void {
  const id = leave();
  let exited = false;
  const exit = () => {
    if (exited || !isCurrent(id)) return;
    exited = true;
    leave();
    onExit();
  };
  const screen = gameScreen(title, keys, exit);
  mount(screen.root);
  starter(screen.canvas, screen.announce, exit)
    .then((stop) => {
      setCleanup(id, stop);
      screen.loaded();
    })
    .catch((error: unknown) => {
      if (isCurrent(id)) screen.failed(`시작하지 못했습니다: ${(error as Error).message}`);
    });
}
