import { layoutFromLevel } from "../sim/level.ts";
import type { InputMap } from "../sim/match.ts";
import { createMatch, matchResultDone, step } from "../sim/match.ts";
import type { MatchState, PlayerSetup, Rules } from "../sim/types.ts";
import type { MusicTrack, SoundBank } from "./audio.ts";
import { GameView, runFixedLoop } from "./gameView.ts";
import type { KeyBinding } from "./input.ts";
import { attachKeyboard, boundCodes, KeyState } from "./input.ts";
import { loadSceneAssets } from "./scene.ts";
import { attachCapture } from "./screenCapture.ts";

export interface LocalPlayer {
  setup: PlayerSetup;
  binding: KeyBinding;
}

export interface LocalGameOptions {
  canvas: HTMLCanvasElement;
  levelId: string;
  players: LocalPlayer[];
  rules: Rules;
  sounds: SoundBank;
  music: MusicTrack | null;
  announce: (text: string) => void;
  onExit: () => void;
  /** The match was left while its pictures loaded: nothing starts, the tune playing is left alone. */
  cancelled?: () => boolean;
}

/**
 * Run a match entirely in the browser; resolves to a stop function once assets are loaded.
 * Like the original returning to its room, the game exits 5 s into the final result.
 */
export async function startLocalGame(options: LocalGameOptions): Promise<() => void> {
  const { canvas, players, rules, sounds } = options;
  const assets = await loadSceneAssets(
    options.levelId,
    players.map((p) => p.setup.character),
  );
  if (options.cancelled?.()) return () => undefined;
  // Shadows and the invisible blend read the screen back each frame (0x413620 works on the surface).
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("canvas 2d context unavailable");
  const layout = layoutFromLevel(options.levelId, assets.level.meta);
  const keys = new KeyState();

  const state: MatchState = createMatch(
    layout,
    players.map((p) => p.setup),
    rules,
    Math.floor(Date.now() / 1000),
    Date.now(),
  );
  // Browser checks steer by the live state in development; production builds drop this.
  if (import.meta.env.DEV) Object.assign(window, { shakeMatch: state });
  const view = new GameView(ctx, assets, sounds, {
    localPlayerIds: players.map((p) => p.setup.id),
    hostId: players[0].setup.id,
    music: options.music,
    announce: options.announce,
  });
  view.ingest(state, state.events);

  const detachKeyboard = attachKeyboard(keys, boundCodes(players.map((p) => p.binding)));
  const onKey = (event: KeyboardEvent) => {
    if (event.code === "Escape") {
      stop();
      options.onExit();
    }
  };
  window.addEventListener("keydown", onKey);
  const detachCapture = attachCapture(options.canvas, undefined, () => view.composition);

  const stopLoop = runFixedLoop(
    () => {
      if (stopped) return;
      const inputs: InputMap = Object.fromEntries(players.map((p) => [p.setup.id, keys.sample(p.binding)]));
      keys.endTick();
      step(state, inputs);
      view.ingest(state, state.events);
      if (matchResultDone(state)) {
        stop();
        options.onExit();
      }
    },
    () => view.render(state),
  );

  let stopped = false;
  function stop(): void {
    if (stopped) return;
    stopped = true;
    stopLoop();
    view.dispose();
    detachKeyboard();
    detachCapture();
    window.removeEventListener("keydown", onKey);
  }
  return stop;
}
