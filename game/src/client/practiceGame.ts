import type { Badge } from "../server/protocol.ts";
import { layoutFromLevel, PRACTICE_MAP } from "../sim/level.ts";
import { step } from "../sim/match.ts";
import { createPractice } from "../sim/practice.ts";
import type { MatchState, PlayerSetup } from "../sim/types.ts";
import { loadImage } from "./assets.ts";
import type { SoundBank } from "./audio.ts";
import { BUBBLE_MS, CaretBlink, trimChat } from "./chat.ts";
import { ChatLine } from "./chatLine.ts";
import { GameView, runFixedLoop } from "./gameView.ts";
import { connectedPad, padFrame } from "./gamepad.ts";
import { attachKeyboard, boundCodes, KeyState, soloKeys } from "./input.ts";
import { macroOpens, macroSlot } from "./macro.ts";
import type { BoxImages, BoxResult, PracticeBox } from "./practiceBox.ts";
import { boxClick, boxKey, boxKeyCursor, boxPointer, drawPracticeBox, openBox } from "./practiceBox.ts";
import { MENU_SOUNDS } from "./presentation.ts";
import { freezeCanvas } from "./screenKit.ts";
import { attachCapture } from "./screenCapture.ts";
import type { ChatDraw } from "./renderer.ts";
import { SCREEN_H, SCREEN_W } from "./renderer.ts";
import { loadSceneAssets } from "./scene.ts";
import type { Settings } from "./settings.ts";

export interface PracticeGameOptions {
  canvas: HTMLCanvasElement;
  local: PlayerSetup;
  /** [0x492770]: scene 5's hue, which the local sprite is read with (0x45490f); the panel face and dummies keep hue 0. */
  hue: number;
  sounds: SoundBank;
  /** The option object: Key1..Key3, the device and the F2..F10 macros. */
  settings: Readonly<Settings>;
  announce: (text: string) => void;
  /** NO on the end box, YES on the Esc box: back to the server list (scene 2), here the main menu. */
  onExit: () => void;
  /** Time-over: straight to the my-info screen (scene 5), here the practice setup. */
  onTimeUp: () => void;
  /** A start over whose pictures fail to load: the practice has stopped, told as a failed first start is. */
  onFailed: (error: unknown) => void;
  /** The account's guild and level on the player's panel row and result rows; none without an account. */
  badge?: Badge;
}

/**
 * Practice (scene 9) in the browser. Each (re)start reloads like 0x4542d0: a fresh srand(time),
 * new dummies. Under a box, the F1 help or the chat line the game runs on but the input poll
 * returns before the player (0x458750), so a walking player walks on.
 */
export async function startPracticeGame(options: PracticeGameOptions): Promise<() => void> {
  const { canvas, local, sounds, announce } = options;
  // Shadows and the invisible blend read the screen back each frame (0x413620 works on the surface).
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("canvas 2d context unavailable");
  const images: BoxImages = {
    panel: await loadImage("image/images.png"),
    messageBox: await loadImage("image/new_messagebox.png"),
    buttons: await loadImage("image/new_button2.png"),
  };
  const keys = new KeyState();
  let state: MatchState | null = null;
  let view: GameView | null = null;
  let box: PracticeBox | null = null;
  let hover: 0 | 1 | 2 = 0;
  let pressed = false;
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
    // srand(time(0)) on every load (0x4542e4): the seed is the clock's second.
    const next = createPractice(layoutFromLevel(PRACTICE_MAP, first.level.meta), local, Math.floor(Date.now() / 1000));
    const tint = { id: local.id, character: local.character, hue: options.hue, face: false, head: false };
    const assets = await loadSceneAssets(PRACTICE_MAP, next.players.map((p) => p.character), [tint]);
    if (stopped) return;
    view?.dispose();
    state = next;
    // Practice makes no music calls, so whatever tune was playing goes on (findings 4.6).
    const nextView = new GameView(ctx as CanvasRenderingContext2D, assets, sounds, {
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
    hover = 0;
    nextView.ingest(next, next.events);
  }
  try {
    await begin();
  } catch (error) {
    // Nothing else is running yet; the chat line's input and focus listener go with the failed start.
    chat.dispose();
    throw error;
  }

  function show(kind: PracticeBox["kind"]): void {
    if (box) return;
    box = openBox(kind);
    announce(kind === "end" ? "다시 시작할까요? 예(Y), 아니오(N)" : "종료하시겠습니까? 예(Y), 아니오(N)");
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
    state = null;
    view?.dispose();
    view = null;
    begin(picture).catch((error: unknown) => {
      if (stopped) return;
      stop();
      options.onFailed(error);
    });
  }

  const binding = soloKeys(options.settings.keys);
  // With the joystick the keyboard's game keys are not read (0x402520 mode 1). A browser shows no
  // pad until one of its buttons is pressed, so the keys play until then.
  const joystick = options.settings.control === 1;
  const detachKeyboard = attachKeyboard(keys, boundCodes([binding]));
  function sample(): ReturnType<KeyState["sample"]> {
    const pad = joystick ? connectedPad() : null;
    return pad ? padFrame(pad) : keys.sample(binding);
  }
  /** 0x446200: the trimmed line becomes the bubble; nothing is sent. */
  function say(text: string): void {
    const line = trimChat(text);
    if (!line) return;
    bubble = { text: line, since: performance.now() };
    announce(`채팅: ${line}`);
  }

  const onKey = (event: KeyboardEvent) => {
    if (event.code === "F1") event.preventDefault();
    // Keys the IME takes for its composition.
    if (event.isComposing || event.keyCode === 229) return;
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
      help = false;
      const result = boxKey(box, event.key);
      if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        hover = boxKeyCursor(box);
        announce(box.selection === 1 ? "예" : "아니오");
      }
      if (result) answer(result);
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
    }
  };
  const toScreen = (event: PointerEvent) => {
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) * SCREEN_W) / rect.width,
      y: ((event.clientY - rect.top) * SCREEN_H) / rect.height,
    };
  };
  const onMove = (event: PointerEvent) => {
    if (!box) return;
    const { x, y } = toScreen(event);
    hover = boxPointer(box, x, y);
    pressed = (event.buttons & 1) !== 0;
  };
  const onDown = () => {
    pressed = true;
  };
  const onClick = (event: PointerEvent) => {
    pressed = false;
    if (!box || help) return;
    const { x, y } = toScreen(event);
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
  canvas.addEventListener("pointermove", onMove);
  canvas.addEventListener("pointerdown", onDown);
  canvas.addEventListener("pointerup", onClick);

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
        if (event.type === "practice-over") show("end");
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
      const overlay = shown ? (target: CanvasRenderingContext2D) => drawPracticeBox(target, images, shown, hover, pressed) : undefined;
      view.render(state, { overlay, help, chat: chatDraw(shown !== null) });
    },
  );

  /**
   * The bubble and the line are skipped, expiry included, while the box is up (0x408b85); the
   * caret blinks only while the line is drawn.
   */
  function chatDraw(boxShown: boolean): ChatDraw {
    chat.locked = boxShown;
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
    canvas.removeEventListener("pointermove", onMove);
    canvas.removeEventListener("pointerdown", onDown);
    canvas.removeEventListener("pointerup", onClick);
  }
  return stop;
}
