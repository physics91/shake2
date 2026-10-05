import type { Badge } from "../server/protocol.ts";
import { layoutFromLevel, PRACTICE_MAP } from "../sim/level.ts";
import { step } from "../sim/match.ts";
import { createPractice } from "../sim/practice.ts";
import type { MatchState, PlayerSetup } from "../sim/types.ts";
import { loadImage } from "./assets.ts";
import type { SoundBank } from "./audio.ts";
import { BUBBLE_MS, CaretBlink, gameRecall, keepRecall, trimChat } from "./chat.ts";
import { ChatLine } from "./chatLine.ts";
import { GameView, runFixedLoop } from "./gameView.ts";
import { connectedPad, padFrame } from "./gamepad.ts";
import { attachKeyboard, boundCodes, isButtonActivation, KeyState, readKeysWhileLoading, soloKeys } from "./input.ts";
import { macroOpens, macroSlot } from "./macro.ts";
import type { BoxImages, BoxResult, PracticeBox } from "./practiceBox.ts";
import { boxClick, boxHover, boxKey, boxKeyCursor, boxPointer, drawPracticeBox, openBox } from "./practiceBox.ts";
import { MENU_SOUNDS } from "./presentation.ts";
import { CursorAnim, freezeCanvas, Pointer } from "./screenKit.ts";
import { attachCapture } from "./screenCapture.ts";
import type { ChatDraw } from "./renderer.ts";
import { loadSceneAssets } from "./scene.ts";
import type { Settings } from "./settings.ts";

export interface PracticeGameOptions {
  canvas: HTMLCanvasElement;
  cursor?: CursorAnim;
  local: PlayerSetup;
  /** [0x492770]: scene 5's hue, which the local sprite is read with (0x45490f); the panel face and dummies keep hue 0. */
  hue: number;
  sounds: SoundBank;
  /** The option object: Key1..Key3, the device and the F2..F10 macros. */
  settings: Readonly<Settings>;
  announce: (text: string) => void;
  /** NO on the end box, YES on the Esc box: back to the server list (scene 2), here the main menu. */
  onExit: () => void;
  /** The hidden exit action follows this scene's help gate. */
  setExitAction?: (action: () => void) => void;
  /** Time-over: straight to the my-info screen (scene 5), here the practice setup. */
  onTimeUp: () => void;
  /** A start over whose pictures fail to load: the practice has stopped, told as a failed first start is. */
  onFailed: (error: unknown) => void;
  /** The account's guild and level on the player's panel row and result rows; none without an account. */
  badge?: Badge;
  /** The screen was left during its initial load: no view, sounds or input listeners may start. */
  cancelled?: () => boolean;
  /** Remove initial loading input immediately when the screen is left. */
  signal?: AbortSignal;
}

/**
 * Practice (scene 9) in the browser. Each (re)start reloads like 0x4542d0: a fresh srand(time),
 * new dummies. Under a box, the F1 help or the chat line the game runs on but the input poll
 * returns before the player (0x458750), so a walking player walks on.
 */
export async function startPracticeGame(options: PracticeGameOptions): Promise<() => void> {
  const cursor = options.cursor ?? new CursorAnim();
  const cancelled = () => options.signal?.aborted || options.cancelled?.();
  if (cancelled()) return () => undefined;
  const { canvas, local, sounds, announce } = options;
  // Shadows and the invisible blend read the screen back each frame (0x413620 works on the surface).
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("canvas 2d context unavailable");
  const keys = new KeyState();
  const binding = soloKeys(options.settings.keys);
  const bound = boundCodes([binding]);
  const images: BoxImages = await readKeysWhileLoading(keys, bound, async () => ({
    panel: await loadImage("image/images.png"),
    messageBox: await loadImage("image/new_messagebox.png"),
    buttons: await loadImage("image/new_button2.png"),
  }), options.signal);
  if (cancelled()) return () => undefined;
  let state: MatchState | null = null;
  let view: GameView | null = null;
  let box: PracticeBox | null = null;
  let hover: 0 | 1 | 2 = 0;
  const pointer = new Pointer();
  /** The mouse in screen pixels, which the box reads even when it has not moved. */
  let mouse = { x: 0, y: 0 };
  /** F1 help ([0x492856]): shown over everything; while it is up the player's keys and box clicks do nothing (0x458750). */
  let help = false;
  /** Chat ([0x48c0e8]) and the own player's last line (+0x204, +0x208 GetTickCount). */
  const stage = canvas.parentElement ?? document.body;
  const chat = new ChatLine(stage);
  const blink = new CaretBlink();
  let bubble: { text: string; since: number } | null = null;
  let stopped = false;

  /** `fadeFrom`: starting over fades from the last frame (0x458a32, 0x458b5e, 0x461cfc, 0x461e4d). */
  async function begin(fadeFrom?: HTMLCanvasElement): Promise<void> {
    const first = await loadSceneAssets(PRACTICE_MAP, [local.character]);
    if (stopped || cancelled()) return;
    // srand(time(0)) on every load (0x4542e4): the seed is the clock's second.
    const next = createPractice(layoutFromLevel(PRACTICE_MAP, first.level.meta), local, Math.floor(Date.now() / 1000));
    const tint = { id: local.id, character: local.character, hue: options.hue, face: false, head: false };
    const assets = await loadSceneAssets(PRACTICE_MAP, next.players.map((p) => p.character), [tint]);
    if (stopped || cancelled()) return;
    view?.dispose();
    state = next;
    // Practice makes no music calls, so whatever tune was playing goes on (findings 4.6).
    const nextView = new GameView(ctx as CanvasRenderingContext2D, assets, sounds, {
      cursor,
      localPlayerIds: [local.id],
      hostId: null,
      music: null,
      keepMusic: true,
      announce,
      fadeFrom,
      people: options.badge ? new Map([[local.id, { name: local.name, badge: options.badge }]]) : undefined,
    });
    view = nextView;
    // Browser checks steer by the live state in development; production builds drop this.
    if (import.meta.env.DEV) Object.assign(window, { shakeMatch: state });
    box = null;
    chat.deferChanges(false);
    hover = 0;
    nextView.ingest(next, next.events);
  }
  try {
    await readKeysWhileLoading(keys, bound, begin, options.signal);
    if (cancelled()) {
      chat.dispose();
      return () => undefined;
    }
  } catch (error) {
    // Nothing else is running yet; the chat line's input and focus listener go with the failed start.
    chat.dispose();
    throw error;
  }

  function show(kind: PracticeBox["kind"]): void {
    if (box) return;
    box = openBox(kind);
    chat.deferChanges(true);
    hover = boxHover(box, mouse);
    announcePrompt(box);
  }

  /**
   * The practice is over. With no dummy left the box comes up unless one is (0x407b59); the own
   * death's end runs Show (0x443ce0) whatever is up, so a box already up keeps its kind and goes
   * back to YES (0x4083be), until its draw reads the cursor again.
   */
  function over(ownDeath: boolean): void {
    if (!box || !ownDeath) return show("end");
    box.selection = 1;
    hover = boxHover(box, mouse);
    announcePrompt(box);
  }

  function announcePrompt(shown: PracticeBox): void {
    announce(shown.kind === "end" ? "다시 시작할까요? 예(Y), 아니오(N)" : "종료하시겠습니까? 예(Y), 아니오(N)");
  }

  function answer(result: BoxResult): void {
    if (result === "exit") {
      stop();
      options.onExit();
      return;
    }
    // The composition stays as it was, box and all, while the next practice loads (0x405e08); the
    // fade shows all of it, not only a blind window (0x4130f0).
    const picture = freezeCanvas(view?.composition ?? canvas);
    // Every way to start over rebuilds the players (0x4542d0: 0x463250, 0x4632a0), whose
    // constructor clears the last line (+0x204, 0x44fc50), and then shuts the chat (0x418cd0(0)).
    bubble = null;
    if (chat.isOpen) chat.close();
    box = null;
    chat.deferChanges(false);
    state = null;
    view?.dispose();
    view = null;
    begin(picture).catch((error: unknown) => {
      if (stopped) return;
      stop();
      options.onFailed(error);
    });
  }

  // With the joystick the keyboard's game keys are not read (0x402520 mode 1). A browser shows no
  // pad until one of its buttons is pressed, so the keys play until then.
  const joystick = options.settings.control === 1;
  const detachKeyboard = attachKeyboard(keys, bound);
  function sample(): ReturnType<KeyState["sample"]> {
    const pad = joystick ? connectedPad() : null;
    return pad ? padFrame(pad) : keys.sample(binding);
  }
  /** 0x446200: the trimmed line becomes the bubble; nothing is sent. The recall line takes it as typed. */
  function say(text: string): void {
    keepRecall(text);
    const line = trimChat(text);
    if (!line) return;
    bubble = { text: line, since: performance.now() };
    announce(`채팅: ${line}`);
  }

  const onKey = (event: KeyboardEvent) => {
    if (isButtonActivation(event)) return;
    if (event.code === "F1") event.preventDefault();
    // Starting over holds the last picture until its assets arrive. Keys must not start another
    // load or open invisible chat/help/boxes while there is no practice to draw them on.
    if (!state) return;
    // A paused editor/help can close before the next tick. Discard its completed taps while
    // preserving keys still held, as the original's next DirectInput poll would read them.
    if (box || help || chat.isOpen) keys.endTick();
    // The IME's process key belongs to the editor; real keys retain the scene's handling.
    if (event.keyCode === 229) return;
    const slot = macroSlot(event.code);
    if (slot !== null) {
      // 0x461a50: the macro goes into a fresh chat line, unsent; the box takes F2..F9 first.
      event.preventDefault();
      if (macroOpens(slot, { box: box !== null, blocked: false })) {
        chat.open();
        chat.text = options.settings.macros[slot];
        announce("채팅 입력: 단축 메시지가 들어갔습니다. Enter로 보내기, Esc로 취소");
        return;
      }
    }
    if (box) {
      // Any key clears the help while the box is up (0x460097), so F1 cannot open it then.
      // WM_CHAR drops characters/Backspace, but Delete and IME still edit the buffer (0x403a97, 0x40368b).
      if (event.key !== "Delete") event.preventDefault();
      help = false;
      const result = boxKey(box, event.key);
      if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        hover = boxKeyCursor(box);
        announce(box.selection === 1 ? "예" : "아니오");
      }
      if (result) {
        answer(result);
      }
      return;
    }
    if (event.code === "F1") help = !help; // 0x460264
    else if (event.code === "Escape") {
      // Esc closes the help first (0x46159f), then drops the chat line (0x4618d9).
      if (help) help = false;
      else if (chat.isOpen) chat.close();
      else show("esc");
    } else if (event.key === "Enter") {
      // Enter sends and closes the line, or opens it (0x45fb47).
      event.preventDefault();
      if (chat.isOpen) say(chat.close());
      else {
        chat.open();
        announce("채팅 입력: Enter로 보내기, Esc로 취소");
      }
    } else if (event.key === "ArrowUp" && chat.isOpen) {
      chat.text = gameRecall(); // 0x4600d9
    }
  };
  const onMove = () => {
    mouse = pointer.mouse;
    if (!box) return;
    hover = boxPointer(box, mouse.x, mouse.y);
  };
  const onClick = (x: number, y: number) => {
    if (!box || help) return;
    const result = boxClick(box, x, y);
    if (!result) return;
    // A click on the box's buttons sounds menu2 (0x4589a9); its keys are silent (0x461bc0).
    sounds.play(MENU_SOUNDS.primary);
    answer(result);
  };
  window.addEventListener("keydown", onKey);
  const detachCapture = attachCapture(
    canvas,
    () => box !== null,
    () => view?.composition ?? canvas,
  );
  const detachPointer = pointer.attach(canvas, { moved: onMove, pressed: onMove, released: onClick });

  const stopLoop = runFixedLoop(
    () => {
      if (stopped || !state || !view) return;
      // Starting over, the clock and the keys wait for the fade out (0x405e08); taps meanwhile are lost.
      if (view.fadingOut) {
        keys.endTick();
        return;
      }
      const input = box || help || chat.isOpen ? null : sample();
      keys.endTick();
      step(state, { [local.id]: input });
      view.ingest(state, state.events);
      for (const event of state.events) {
        if (event.type === "practice-over") over(state.lastGoneId === local.id);
        if (event.type === "practice-time-up") {
          stop();
          options.onTimeUp();
          return;
        }
      }
    },
    () => {
      if (!state || !view) return;
      const shown = box;
      const overlay = shown ? (target: CanvasRenderingContext2D) => drawPracticeBox(target, images, shown, hover, pointer.held !== null) : undefined;
      view.render(state, { overlay, help, chat: chatDraw(shown !== null) });
    },
  );

  /**
   * The bubble and the line are skipped, expiry included, while the box is up (0x408b85); the
   * caret blinks only while the line is drawn.
   */
  function chatDraw(boxShown: boolean): ChatDraw {
    if (boxShown) return { balloons: [], line: null };
    const now = performance.now();
    if (bubble && now - bubble.since >= BUBBLE_MS) bubble = null;
    // 0x418940 with slot 3, the practice player's slot (0x454f44).
    const balloons = bubble ? [{ slot: 3, text: bubble.text }] : [];
    if (!chat.isOpen) return { balloons, line: null };
    const line = chat.view();
    return { balloons, line: { text: line.text, caret: blink.shown(now) ? line.caret : null } };
  }

  function stop(): void {
    if (stopped) return;
    stopped = true;
    stopLoop();
    chat.dispose();
    view?.dispose();
    detachKeyboard();
    detachCapture();
    window.removeEventListener("keydown", onKey);
    detachPointer();
  }
  options.setExitAction?.(() => {
    if (help) return;
    stop();
    options.onExit();
  });
  return stop;
}
