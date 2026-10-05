import { gameChatLine } from "../server/protocol.ts";
import { layoutFromLevel } from "../sim/level.ts";
import { AiController } from "../sim/ai.ts";
import type { InputMap } from "../sim/match.ts";
import { createMatch, matchResultDone, step } from "../sim/match.ts";
import type { MatchState, PlayerSetup, Rules } from "../sim/types.ts";
import type { MusicTrack, SoundBank } from "./audio.ts";
import { CaretBlink, gameRecall, keepRecall } from "./chat.ts";
import { ChatLine } from "./chatLine.ts";
import type { GameViewOptions } from "./gameView.ts";
import { GameView, runFixedLoop } from "./gameView.ts";
import { connectedPad, padFrame } from "./gamepad.ts";
import type { KeyBinding } from "./input.ts";
import { attachKeyboard, boundCodes, isButtonActivation, KeyState, readKeysWhileLoading } from "./input.ts";
import { macroSlot } from "./macro.ts";
import { Balloons, closesExitBox, enterOpensChat, helpAllowed, matchEscape, sendsChat } from "./matchChat.ts";
import type { ChatDraw } from "./renderer.ts";
import { loadSceneAssets, type PlayerTint } from "./scene.ts";
import { attachCapture } from "./screenCapture.ts";
import type { CursorAnim } from "./screenKit.ts";
import type { Settings } from "./settings.ts";

export type LocalPlayer = { setup: PlayerSetup } & ({ binding: KeyBinding } | { ai: true });

export interface LocalGameOptions {
  canvas: HTMLCanvasElement;
  cursor?: CursorAnim;
  levelId: string;
  players: LocalPlayer[];
  /** Solo AI play follows the option window's device, keys and F2..F10 macros. */
  settings?: Readonly<Settings>;
  /** The room's hues turn the body, panel face and result head as in scene 8. */
  tints?: readonly PlayerTint[];
  people?: GameViewOptions["people"];
  candyBase?: number;
  rules: Rules;
  sounds: SoundBank;
  music: MusicTrack | null;
  announce: (text: string) => void;
  onExit: () => void;
  /** The assistive action follows the canvas's original host exit gate. */
  setExitAction?: (action: () => void) => void;
  /** The match was left while its pictures loaded: nothing starts, the tune playing is left alone. */
  cancelled?: () => boolean;
  /** Remove initial loading input immediately when the screen is left. */
  signal?: AbortSignal;
}

/**
 * Run a match entirely in the browser; resolves to a stop function once assets are loaded.
 * Like the original returning to its room, the game exits 5 s into the final result.
 */
export async function startLocalGame(options: LocalGameOptions): Promise<() => void> {
  const cancelled = () => options.signal?.aborted || options.cancelled?.();
  if (cancelled()) return () => undefined;
  const { canvas, players, rules, sounds } = options;
  const humans = players.filter((p) => "binding" in p);
  const controllers = new Map(players.filter((p) => "ai" in p).map((p) => [p.setup.id, new AiController(p.setup.id)]));
  const soloAi = humans.length === 1 && controllers.size > 0;
  const keys = new KeyState();
  const bound = boundCodes(humans.map((p) => p.binding));
  const assets = await readKeysWhileLoading(keys, bound, () => loadSceneAssets(
    options.levelId,
    players.map((p) => p.setup.character),
    options.tints,
  ), options.signal);
  if (cancelled()) return () => undefined;
  // Shadows and the invisible blend read the screen back each frame (0x413620 works on the surface).
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("canvas 2d context unavailable");
  const layout = layoutFromLevel(options.levelId, assets.level.meta);

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
    cursor: options.cursor,
    localPlayerIds: humans.map((p) => p.setup.id),
    hostId: players[0].setup.id,
    music: options.music,
    announce: options.announce,
    people: options.people,
    candyBase: options.candyBase,
  });
  view.ingest(state, state.events);

  // Scene 8's original one-player editor and help. The two-keyboard remake retains Enter as 2P's bomb.
  const chat = soloAi ? new ChatLine(canvas.parentElement ?? document.body) : null;
  const balloons = new Balloons();
  const blink = new CaretBlink();
  let help = false;
  let stopped = false;
  const frozen = () => help || chat?.isOpen;
  function exit(): void {
    if (stopped) return;
    stop();
    options.onExit();
  }
  function say(raw: string): void {
    keepRecall(raw);
    const text = gameChatLine(raw);
    if (!text || !sendsChat(state.phase)) return;
    const own = state.players.find((p) => p.id === humans[0].setup.id);
    if (own) balloons.say(own.slot, text, performance.now());
    options.announce(`채팅: ${text}`);
  }
  const onKey = (event: KeyboardEvent) => {
    if (isButtonActivation(event)) return;
    if (!chat) {
      if (event.code === "Escape") exit();
      return;
    }
    if (event.code === "F1") event.preventDefault();
    // Completed action taps under help/chat are lost; keys still held survive the next poll.
    if (frozen()) keys.endTick();
    if (event.keyCode === 229) return;
    const slot = macroSlot(event.code);
    if (slot !== null) {
      event.preventDefault();
      chat.open();
      chat.text = options.settings?.macros[slot] ?? "";
      options.announce("채팅 입력: 단축 메시지가 들어갔습니다. Enter로 보내기, Esc로 취소");
      return;
    }
    if (event.code === "F1") {
      help = !help && helpAllowed(state.phase);
    } else if (event.code === "Escape") {
      // 1P is the room host: Esc leaves only the first wait, after help and chat have closed.
      const action = matchEscape({ help, chatOpen: chat.isOpen, host: true, round: state.round, phase: state.phase });
      if (action === "help") help = false;
      else if (action === "chat") chat.close();
      else if (action === "leave") exit();
    } else if (event.key === "Enter") {
      event.preventDefault();
      if (chat.isOpen) say(chat.close());
      else if (enterOpensChat(state.phase)) {
        chat.open();
        options.announce("채팅 입력: Enter로 보내기, Esc로 취소");
      }
    } else if (event.key === "ArrowUp" && chat.isOpen) {
      chat.text = gameRecall();
    }
  };
  // A bound Enter/F-key must open the editor/help before the keyboard records its action.
  window.addEventListener("keydown", onKey);
  const detachKeyboard = attachKeyboard(keys, bound);
  const detachCapture = attachCapture(options.canvas, undefined, () => view.composition);
  options.setExitAction?.(() => {
    if (chat) {
      if (help || closesExitBox(state.phase, state.round)) return;
      const action = matchEscape({ help: false, chatOpen: false, host: true, round: state.round, phase: state.phase });
      if (action !== "leave") return;
    }
    exit();
  });

  function chatDraw(): ChatDraw {
    if (!sendsChat(state.phase)) return { balloons: [], line: null };
    const now = performance.now();
    const shown = balloons.shown(now);
    if (!chat?.isOpen) return { balloons: shown, line: null };
    const line = chat.view();
    return { balloons: shown, line: { text: line.text, caret: blink.shown(now) ? line.caret : null } };
  }

  const stopLoop = runFixedLoop(
    () => {
      if (stopped) return;
      const pad = soloAi && options.settings?.control === 1 ? connectedPad() : null;
      const inputs: InputMap = Object.fromEntries(players.map((p) => [p.setup.id, "binding" in p
        ? (frozen() ? null : pad && p === humans[0] ? padFrame(pad) : keys.sample(p.binding))
        : controllers.get(p.setup.id)!.sample(state)]));
      keys.endTick();
      step(state, inputs);
      view.ingest(state, state.events);
      if (state.events.some((event) => event.type === "round-start")) balloons.clear();
      if (matchResultDone(state)) {
        exit();
      }
    },
    () => {
      if (help && !helpAllowed(state.phase)) help = false;
      view.render(state, chat ? { help, chat: chatDraw() } : undefined);
    },
  );

  function stop(): void {
    if (stopped) return;
    stopped = true;
    stopLoop();
    chat?.dispose();
    view.dispose();
    detachKeyboard();
    detachCapture();
    window.removeEventListener("keydown", onKey);
  }
  return stop;
}
