// The start of the program on a canvas, from the original's art: the logo (scene 0xe, 0x418fb0),
// loading (1, 0x418fd0), login (3, 0x419a10), the old "My Status" menu (5, statusScreen.ts) and the
// server list (2, 0x433530), with the fades between them. Rules and geometry: startLayout.ts. The
// page's hidden controls (startView.ts) are the keyboard and screen reader path.
import type { Rect } from "../assets/types.ts";
import { cp949Bytes, cutBytes, typeable } from "../server/cp949.ts";
import type { Sheet } from "./assets.ts";
import { loadImage, loadImageSheet, loadSheet } from "./assets.ts";
import type { SoundBank } from "./audio.ts";
import { CaretBlink } from "./chat.ts";
import { ChatLine } from "./chatLine.ts";
import { INSTALLED_VERSION, SCREEN_H, SCREEN_W, VERSION_TEXT } from "./hudLayout.ts";
import { MESSAGE_BOX, MESSAGE_HELP, messageLines } from "./lobbyLayout.ts";
import type { BoxImages, BoxResult, PracticeBox } from "./practiceBox.ts";
import { boxClick, boxKey, boxKeyCursor, boxPointer, drawPracticeBox, openBox } from "./practiceBox.ts";
import { MENU_SOUNDS } from "./presentation.ts";
import { inside } from "./roomLayout.ts";
import { CursorAnim, drawBalloon, drawCaret, drawDarkness, drawHelpScreen, Fade, freezeCanvas, Pointer } from "./screenKit.ts";
import { attachCapture } from "./screenCapture.ts";
import { blit } from "./sprite.ts";
import type { ListSlide } from "./startLayout.ts";
import {
  FRAME_MS,
  FULL_BAR_MS,
  gaugeBar,
  gaugeLevel,
  LOADER_DELAY_MS,
  LOADING_BAR,
  LOADING_FRAME_MS,
  LOADING_STEPS,
  loadingBarWidth,
  loadingCount,
  LOGIN,
  LOGIN_BUTTONS,
  loginButtonAt,
  loginCaret,
  LOGO_MS,
  MEMO,
  percentText,
  REFRESH_FRAMES,
  ROW_NAME_WIDTH,
  rowBar,
  rowClickAt,
  rowHoverAt,
  rowOrigin,
  rowsShown,
  rowTexts,
  SERVER_BUTTONS,
  slideBlits,
  START_BANNER,
  stepSlide,
  toggleSlide,
} from "./startLayout.ts";
import type { SettingsStore } from "./settings.ts";
import { MAIN_BUTTONS, OPTION_PAGE, STATUS_BUTTONS } from "./statusLayout.ts";
import type { StatusAssets, StatusPageName, StatusState } from "./statusScreen.ts";
import { loadStatusAssets, StatusPage } from "./statusScreen.ts";
import { fitText, FONT_12, FONT_13, outlinedText, plainText, YELLOW } from "./text.ts";

export interface StartAssets {
  logo: HTMLImageElement;
  loading: HTMLImageElement;
  server: HTMLImageElement;
  banner: HTMLImageElement;
  login: HTMLImageElement;
  listWindow: HTMLImageElement;
  serverOb: HTMLImageElement;
  memo: HTMLImageElement;
  button: HTMLImageElement;
  button2: HTMLImageElement;
  /** images2: the message box (MSGBOX 0x443770). */
  messageBox: HTMLImageElement;
  /** new_messagebox, images and new_button2: the quit box (0x443c50). */
  box: BoxImages;
  help: HTMLImageElement;
  cursor: Sheet;
  status: StatusAssets;
}

export async function loadStartAssets(): Promise<StartAssets> {
  const image = (name: string) => loadImage(`image/${name}.png`);
  const [logo, loading, server, banner, login, listWindow, serverOb, memo, button, button2, messageBox, quitBox, images, help, cursor, status] = await Promise.all([
    image("Logo"),
    image("loading"),
    image("new_server"),
    image("new_banner"),
    image("new_login"),
    image("new_listwindow"),
    image("new_serverob"),
    image("new_memo"),
    image("new_button"),
    image("new_button2"),
    image("images2"),
    image("new_messagebox"),
    image("images"),
    image("shake_help"),
    loadImageSheet("cursor"),
    loadStatusAssets(),
  ]);
  return {
    logo,
    loading,
    server,
    banner,
    login,
    listWindow,
    serverOb,
    memo,
    button,
    button2,
    messageBox,
    box: { panel: images, messageBox: quitBox, buttons: button2 },
    help,
    cursor,
    status,
  };
}

/**
 * What the loader thread's 33 steps (0x404200) stand for here: the art of the lobby, the room and
 * the game, so that those screens open at once. The start screens' own art is loaded first.
 */
const PRELOAD_IMAGES = [
  "new_status", "new_roombutton", "new_gameinfo", "new_remote", "guild", "mark", "new_statuswindow", "new_charchange",
  "new_winobject", "new_readyroom", "new_pReadyobject1", "new_pReadyobject2", "mapimage", "shadow", "textbox", "candy",
  "apple", "apple_filter2", "new_load", "new_round_e", "new_game_e",
];
const PRELOAD_SHEETS: readonly [string, string][] = [
  ["bomb", "fire"], ["item", "item"], ["object", "object_a"], ["object", "object_b"], ["object", "object_c"],
  ["object", "count"], ["object", "clock"], ["object", "hurry"], ["object", "diff1"], ["object", "diff2"],
  ["object", "bad_state"], ["object", "u_ground"], ["object", "egg"], ["object", "revival"],
];

/** Loads them all, reporting each file done; a file that fails counts as done (its screen retries). */
export async function preloadOnline(progress: (done: number, total: number) => void): Promise<void> {
  const jobs: (() => Promise<unknown>)[] = [
    ...PRELOAD_IMAGES.map((name) => () => loadImage(`image/${name}.png`)),
    ...PRELOAD_SHEETS.map(([dir, name]) => () => loadSheet(dir, name)),
  ];
  let done = 0;
  progress(0, jobs.length);
  await Promise.all(
    jobs.map((job) =>
      job()
        .catch(() => undefined)
        .then(() => progress(++done, jobs.length)),
    ),
  );
}

/** A server list row (record 0x497190 + 0x1c i): its name, load % (+0x10) and ping ms (+0x14). */
export interface ServerRow {
  name: string;
  load: number;
  ping: number;
  /** The remake's row for two players on this PC (AGENTS.md), after the server's. */
  local?: boolean;
}

/** What the server list keeps between its screens: the slide's statics, the rows and the choice. */
export interface ServerList {
  slide: ListSlide;
  rows: ServerRow[];
  /** [0x46e994]: the chosen row, −1 for none. */
  selected: number;
}

export type StartScene = "logo" | "loading" | "login" | "status" | "servers";

/** Scene 5's buttons the page's hidden controls stand for, and the page each is on (null: all). */
const STATUS_COMMANDS = {
  go: { page: null, hit: STATUS_BUTTONS.go.hit },
  practice: { page: null, hit: STATUS_BUTTONS.practice.hit },
  ranking: { page: null, hit: STATUS_BUTTONS.ranking.hit },
  option: { page: null, hit: STATUS_BUTTONS.option.hit },
  exit: { page: null, hit: STATUS_BUTTONS.exit.hit },
  characterUp: { page: "main", hit: MAIN_BUTTONS.characterUp.hit },
  characterDown: { page: "main", hit: MAIN_BUTTONS.characterDown.hit },
  ok: { page: "main", hit: MAIN_BUTTONS.ok.hit },
  musicOn: { page: "option", hit: OPTION_PAGE.music.on.hit },
  musicOff: { page: "option", hit: OPTION_PAGE.music.off.hit },
  soundOn: { page: "option", hit: OPTION_PAGE.sound.on.hit },
  soundOff: { page: "option", hit: OPTION_PAGE.sound.off.hit },
  keyboard: { page: "option", hit: OPTION_PAGE.keyboard },
  joystick: { page: "option", hit: OPTION_PAGE.joystick },
  key1: { page: "option", hit: OPTION_PAGE.keys[0].hit },
  key2: { page: "option", hit: OPTION_PAGE.keys[1].hit },
  key3: { page: "option", hit: OPTION_PAGE.keys[2].hit },
  optionOk: { page: "option", hit: OPTION_PAGE.ok.hit },
  optionCancel: { page: "option", hit: OPTION_PAGE.cancel.hit },
} satisfies Record<string, { page: StatusPageName | null; hit: Rect }>;

export type StatusCommand = keyof typeof STATUS_COMMANDS;

export interface StartScreenOptions {
  canvas: HTMLCanvasElement;
  stage: HTMLElement;
  assets: StartAssets;
  sounds: SoundBank;
  /** The option object (0x48acd0), which scene 5's option page saves. */
  settings: SettingsStore;
  list: ServerList;
  begin: StartScene;
  /** The picture of the screen left behind, faded out before the first scene fades in (fade(1)). */
  fadeFrom?: HTMLCanvasElement;
  /** The last ID used (the options' saved ID, 0x44d5c0). */
  savedId: string;
  /** Scene 5's own memory, kept by the session. */
  status: StatusState;
  /** The greeting scene 5 shows (the account's, kept by this browser). */
  greeting: string;
  /** The loader thread's work (0x404200): every file the next screens use; reports each one done. */
  preload(progress: (done: number, total: number) => void): Promise<void>;
  /** 1→3: the waiting tune starts (0x43fbe0(0)). */
  startMusic(): void;
  /** OK with both fields: the remake has no account server, so the ID is the player's name. */
  loggedIn(id: string): void;
  /** Scene 5's Go game: the server list's rows are made and asked for. */
  listServers(): void;
  /** Scene 5's Practice (0x45aa37) with its character and hue ([0x492770]). */
  practice(character: string, hue: number): void;
  /** Scene 5's 확인: the nick and greeting kept. */
  saveProfile(profile: { nick: string; greeting: string }): void;
  /** Scene 5's ▲ and ▼. */
  characterChanged(character: string): void;
  /** The chosen row clicked again (0x4441c0): connect and say hello. */
  connect(): void;
  /** EXIT on the login, YES on the quit box: the original closes its window; here the program starts over. */
  exit(): void;
}

export class StartScreen {
  private readonly options: StartScreenOptions;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly pointer = new Pointer();
  private readonly cursor = new CursorAnim();
  private readonly caret = new CaretBlink();
  private readonly status = document.createElement("p");
  private readonly idLine: ChatLine;
  private readonly pwLine: ChatLine;
  private readonly statusPage: StatusPage;
  private scene: StartScene;
  private fade: Fade | null = null;
  /** The picture a fade-out keeps, and what follows it. */
  private frozen: { picture: HTMLCanvasElement; then: () => void } | null = null;
  /** The 30 fps frame clock the slide and the refresh animation step on. */
  private tickAt = 0;
  private logoAt: number | null = null;
  private loading = { switchedAt: 0, started: false, done: 0, total: 0, finished: false, count: 0, frameAt: 0, fullAt: null as number | null };
  /** [0x46b0b9]: the login field with the focus. */
  private focus: "id" | "pw" = "id";
  /** [0x495670]: the memo, opened on each login. */
  private memo = false;
  /** [0x46e999] armed by a release; [0x49566c] the refresh animation's frame. */
  private refreshArmed = true;
  private refreshFrame: number | null = null;
  /** The busy cursor (0x43f0b0) and [0x48c2e8]: a connection under way. */
  private busy = false;
  private message: { text: string; since: number } | null = null;
  private quitBox: PracticeBox | null = null;
  private boxHover: 0 | 1 | 2 = 0;
  private helpScreen = false;
  private frame = 0;
  private stopped = false;
  private readonly detach: () => void;

  constructor(options: StartScreenOptions) {
    this.options = options;
    const ctx = options.canvas.getContext("2d");
    if (!ctx) throw new Error("canvas 2d context unavailable");
    this.ctx = ctx;
    this.status.className = "sr-only";
    this.status.setAttribute("role", "status");
    options.stage.append(this.status);
    this.idLine = new ChatLine(options.stage, { limit: LOGIN.limit, at: LOGIN.id.text, trapFocus: false });
    this.idLine.element.setAttribute("aria-label", "아이디");
    this.pwLine = new ChatLine(options.stage, { limit: LOGIN.limit, at: LOGIN.pw.text, trapFocus: false });
    this.pwLine.element.type = "password";
    this.pwLine.element.setAttribute("aria-label", "비밀번호");
    this.statusPage = new StatusPage({
      stage: options.stage,
      assets: options.assets.status,
      sounds: options.sounds,
      settings: options.settings,
      state: options.status,
      announce: (text) => this.announce(text),
      message: (text) => this.showMessage(text),
      save: (profile) => options.saveProfile(profile),
      characterChanged: (character) => options.characterChanged(character),
    });
    this.scene = options.begin;
    const now = performance.now();
    this.tickAt = now;
    if (options.begin === "login") this.enterLogin();
    // Practice's time limit (0x406224): 0x41f030 again, then scene 5 with the fade.
    if (options.begin === "status") this.enterStatus(options.savedId);
    if (options.begin === "servers") this.announce("서버 선택 화면. 서버 줄을 두 번 누르면 접속합니다. Esc는 종료 상자입니다.");
    if (options.fadeFrom) this.fadeOut(options.fadeFrom, now, FRAME_MS, () => this.fadeIn(performance.now(), FRAME_MS));
    else if (options.begin !== "logo") this.fadeIn(now, FRAME_MS);
    this.detach = this.attach();
    const draw = () => {
      if (this.stopped) return;
      this.render(performance.now());
      this.frame = requestAnimationFrame(draw);
    };
    this.frame = requestAnimationFrame(draw);
  }

  get currentScene(): StartScene {
    return this.scene;
  }

  /** The load query's answer, already in the list (thread 0x448410): read out. */
  serverInfo(row: ServerRow): void {
    this.announce(`${row.name} 서버: 부하 ${percentText(row.load).trim()}, 응답 ${row.ping < 0 ? "없음" : `${row.ping} ms`}`);
  }

  /** The message box over the scene (MSGBOX 0x443700). */
  showMessage(text: string): void {
    this.message = { text, since: performance.now() };
    this.announce(text.replace("\n", " "));
  }

  /** A connection from the page's form: the busy cursor as for a row's (0x45928b). */
  connecting(): void {
    this.busy = true;
  }

  /** FD_CONNECT failed (0x460edc): busy off and the message; the row stays chosen. */
  connectFailed(): void {
    this.busy = false;
    this.showMessage("게임 서버에 연결할 수\n없습니다");
  }

  /** S->C 0x0a refused (0x444b58): busy off, the message, the row let go. */
  refused(text: string): void {
    this.busy = false;
    this.options.list.selected = -1;
    this.showMessage(text);
  }

  /** FD_CLOSE (0x460dbe): the message, the row let go and a fade back to the list, even from it. */
  disconnected(): void {
    this.busy = false;
    this.options.list.selected = -1;
    this.showMessage("서버로 부터 접속이\n끊어졌습니다");
    this.fadeOut(freezeCanvas(this.options.canvas), performance.now(), FRAME_MS, () => this.fadeIn(performance.now(), FRAME_MS));
  }

  /** A hidden control for scene 5: the release a click on that button makes, on scene 5 and its page only. */
  statusCommand(command: StatusCommand): void {
    if (this.scene !== "status") return;
    const { page, hit } = STATUS_COMMANDS[command];
    if (page !== null && page !== this.statusPage.pageName) {
      this.announce(page === "option" ? "옵션 쪽이 열려 있지 않습니다." : "내 정보 쪽이 열려 있지 않습니다.");
      return;
    }
    this.release(Math.trunc((hit[0] + hit[2]) / 2), Math.trunc((hit[1] + hit[3]) / 2));
  }

  /** 2→4 (0x449172): the list freezes and fades out; then the lobby is shown. */
  leave(then: () => void): void {
    this.fadeOut(freezeCanvas(this.options.canvas), performance.now(), FRAME_MS, then);
  }

  dispose(): void {
    this.stopped = true;
    cancelAnimationFrame(this.frame);
    this.idLine.dispose();
    this.pwLine.dispose();
    this.statusPage.dispose();
    this.status.remove();
    this.detach();
  }

  // Scenes

  private announce(text: string): void {
    this.status.textContent = text;
  }

  private fadeOut(picture: HTMLCanvasElement, now: number, frameMs: number, then: () => void): void {
    this.fade = new Fade("out", now, frameMs);
    this.frozen = { picture, then };
  }

  private fadeIn(now: number, frameMs: number): void {
    this.fade = new Fade("in", now, frameMs);
    this.frozen = null;
  }

  /** 0x41bc00: a saved ID puts the focus on the password; both are cleared otherwise. */
  private enterLogin(): void {
    this.scene = "login";
    this.idLine.open();
    this.pwLine.open();
    this.idLine.text = this.savedId;
    this.setFocus(this.savedId ? "pw" : "id");
    this.announce("로그인 화면. 아이디(이름)와 비밀번호를 넣고 Enter. 비밀번호는 쓰지 않습니다. Tab으로 칸을 바꿉니다.");
  }

  /** The saved ID as the 10-byte editor takes it. */
  private get savedId(): string {
    return cutBytes(typeable(this.options.savedId), LOGIN.limit - 1);
  }

  private setFocus(field: "id" | "pw"): void {
    this.focus = field;
    (field === "id" ? this.idLine : this.pwLine).focus();
  }

  /**
   * 0x44f920: both fields must hold something; the remake keeps the ID and drops the password.
   * The auth reply cuts at once (0x448be3), here to scene 5, as Shake1's login does (R).
   */
  private login(): void {
    const id = this.idLine.view().text;
    if (!id || !this.pwLine.view().text) return;
    this.idLine.close();
    this.pwLine.close();
    this.options.loggedIn(id.trim());
    this.enterStatus(id.trim());
  }

  /** Scene 5 (0x41f030): the nick is the login's ID; the greeting is the one kept. */
  private enterStatus(nick: string): void {
    this.scene = "status";
    this.statusPage.enter(cutBytes(typeable(nick), LOGIN.limit - 1), this.options.greeting);
  }

  /** Go game: scene 5 fades out and the server list in, its notice window open, its rows asked for. */
  private goServers(): void {
    this.statusPage.leave();
    this.fadeOut(freezeCanvas(this.options.canvas), performance.now(), FRAME_MS, () => {
      this.options.list.selected = -1;
      this.memo = true;
      this.scene = "servers";
      this.options.listServers();
      this.announce("서버 선택 화면. 공지 창은 X나 Esc로 닫고, 서버 줄을 두 번 누르면 접속합니다.");
      this.fadeIn(performance.now(), FRAME_MS);
    });
  }

  // Input

  private attach(): () => void {
    const detachPointer = this.pointer.attach(this.options.canvas, {
      moved: () => this.moved(),
      released: (x, y) => this.release(x, y),
      pressed: (x, y) => this.press(x, y),
    });
    const onKey = (event: KeyboardEvent) => this.key(event);
    const onGesture = () => this.options.sounds.unlock();
    const onWheel = (event: WheelEvent) => this.wheel(event);
    window.addEventListener("keydown", onKey);
    this.options.canvas.addEventListener("pointerdown", onGesture);
    this.options.canvas.addEventListener("wheel", onWheel, { passive: false });
    const detachCapture = attachCapture(this.options.canvas, () => this.quitBox !== null);
    return () => {
      detachPointer();
      detachCapture();
      window.removeEventListener("keydown", onKey);
      this.options.canvas.removeEventListener("pointerdown", onGesture);
      this.options.canvas.removeEventListener("wheel", onWheel);
    };
  }

  private get blocked(): boolean {
    return this.frozen !== null;
  }

  /** A press (0x45ae58): scene 5 marks whether it was on the hue knob. */
  private press(x: number, y: number): void {
    if (this.scene !== "status" || this.blocked || this.helpScreen || this.message || this.quitBox) return;
    this.statusPage.press(x, y);
  }

  private moved(): void {
    const box = this.quitBox;
    if (box) this.boxHover = boxPointer(box, this.pointer.mouse.x, this.pointer.mouse.y);
  }

  /** Releases (0x459041): nothing on the logo and loading; the message box takes every one. */
  private release(x: number, y: number): void {
    if (this.blocked || this.helpScreen) return;
    if (this.scene === "logo" || this.scene === "loading") return;
    if (this.message) {
      if (inside(MESSAGE_BOX.button.hit, x, y)) this.closeMessage();
      return;
    }
    if (this.scene === "login") this.loginRelease(x, y);
    else if (this.scene === "status") this.statusRelease(x, y);
    else this.serversRelease(x, y);
  }

  /** Scene 5 (0x45a8d3): the quit box takes the click while it is up. */
  private statusRelease(x: number, y: number): void {
    if (this.quitBox) {
      const result = boxClick(this.quitBox, x, y);
      if (result) this.answer(result);
      return;
    }
    switch (this.statusPage.release(x, y)) {
      case "go":
        this.goServers();
        break;
      case "practice":
        this.statusPage.leave();
        this.options.practice(this.statusPage.character, this.options.status.hue);
        break;
      case "exit":
        // The network box (0x443ce0); its YES resets scene 5 and leaves (0x4205e0).
        this.openQuitBox();
        break;
      case null:
        break;
    }
  }

  /** The wheel (0x461063): scene 5's guild list, while nothing covers it. */
  private wheel(event: WheelEvent): void {
    if (this.scene !== "status" || event.deltaY === 0) return;
    event.preventDefault();
    if (this.blocked || this.helpScreen || this.message || this.quitBox) return;
    this.statusPage.wheel(event.deltaY < 0);
  }

  /** 0x459069: OK, NEW ID and EXIT sound menu2; a field takes the focus. */
  private loginRelease(x: number, y: number): void {
    const { sounds } = this.options;
    switch (loginButtonAt(x, y)) {
      case "ok":
        sounds.play(MENU_SOUNDS.primary);
        this.login();
        break;
      case "newId":
        // The sign-up window needs the account server; only its sound is kept.
        sounds.play(MENU_SOUNDS.primary);
        break;
      case "exit":
        sounds.play(MENU_SOUNDS.primary);
        this.options.exit();
        break;
      case "id":
        this.setFocus("id");
        break;
      case "pw":
        this.setFocus("pw");
        break;
      default:
        this.setFocus(this.focus);
        break;
    }
  }

  /** 0x4591fb: refresh first, then the memo, the rows, AUTO and EXIT. */
  private serversRelease(x: number, y: number): void {
    const { list, sounds } = this.options;
    if (this.quitBox) {
      const result = boxClick(this.quitBox, x, y);
      if (result) this.answer(result);
      return;
    }
    this.refreshArmed = true;
    if (!this.memo && inside(SERVER_BUTTONS.refresh.hit, x, y)) {
      if (list.slide.open) list.selected = -1;
      toggleSlide(list.slide);
      return;
    }
    if (this.memo) {
      if (inside(MEMO.close.hit, x, y)) this.closeMemo();
      return;
    }
    const row = list.slide.open ? rowClickAt(x, y, list.rows.length) : -1;
    if (row >= 0 && list.rows[row].load !== -1) {
      if (row !== list.selected) {
        list.selected = row;
        this.announce(`${list.rows[row].name} 서버를 골랐습니다. 한 번 더 누르면 접속합니다.`);
      } else if (!this.busy) {
        this.busy = true;
        this.announce("접속하는 중…");
        this.options.connect();
      }
      return;
    }
    if (inside(SERVER_BUTTONS.auto.hit, x, y)) {
      this.showMessage("서비스 준비중입니다.");
      return;
    }
    if (inside(SERVER_BUTTONS.exit.hit, x, y)) {
      list.selected = -1;
      sounds.play(MENU_SOUNDS.primary);
      this.openQuitBox();
    }
  }

  private openQuitBox(): void {
    this.quitBox = openBox("esc");
    this.boxHover = 0;
    this.announce("종료하시겠습니까? 예(Y), 아니오(N)");
  }

  /** YES closes the program (0x458a77); NO hides the box. */
  private answer(result: BoxResult): void {
    this.quitBox = null;
    this.boxHover = 0;
    if (result === "exit") this.options.exit();
    else this.announce("");
  }

  private closeMemo(): void {
    this.memo = false;
    this.announce("공지 창을 닫았습니다.");
  }

  /** Esc on the login with the message box up: the original resets and reconnects (0x461590). */
  private closeMessage(): void {
    this.message = null;
    if (this.scene === "login") {
      this.pwLine.text = "";
      this.idLine.text = this.savedId;
      this.setFocus(this.savedId ? "pw" : "id");
    }
  }

  private key(event: KeyboardEvent): void {
    if (event.isComposing || event.keyCode === 229) return;
    // Keys typed into the page's own controls are theirs; the heading the shell focuses (shell.ts) is not
    // one, and keeps the focus when the list comes back with no edit box to take it.
    const active = document.activeElement;
    const ours =
      active === null ||
      active.tagName === "H1" ||
      this.statusPage.owns(active) ||
      [this.idLine.element, this.pwLine.element, this.options.canvas, document.body].includes(active as HTMLElement);
    if (!ours) return;
    this.options.sounds.unlock();
    if (event.code === "F1") {
      event.preventDefault();
      // 0x460264 refuses F1 only while loading (scene 1).
      if (this.scene !== "loading") this.helpScreen = !this.helpScreen;
      return;
    }
    if (this.quitBox && (this.scene === "servers" || this.scene === "status")) {
      this.helpScreen = false;
      const result = boxKey(this.quitBox, event.key);
      if (event.key === "ArrowLeft" || event.key === "ArrowRight") this.boxHover = boxKeyCursor(this.quitBox);
      if (result) {
        event.preventDefault();
        this.answer(result);
      }
      return;
    }
    if (event.code === "Escape") {
      event.preventDefault();
      this.escape();
      return;
    }
    if (this.scene === "status" && event.key === "Tab" && !event.shiftKey) {
      // WM_CHAR Tab (0x41f110): the next field. Shift+Tab is left to the page's controls.
      event.preventDefault();
      if (!this.blocked && !this.message && !this.helpScreen) this.statusPage.tab();
      return;
    }
    if (this.scene !== "login" || this.blocked || this.message || this.helpScreen) return;
    // Tab and Enter on the login (0x45ff0c, 0x45fb06). Shift+Tab is left to the page's controls.
    if (event.key === "Tab" && !event.shiftKey) {
      event.preventDefault();
      this.setFocus(this.focus === "id" ? "pw" : "id");
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      if (this.focus === "id") this.setFocus("pw");
      else this.login();
    }
  }

  /** Esc (0x461590): the help, the message box, then on the list the memo, then the quit box. */
  private escape(): void {
    if (this.helpScreen) this.helpScreen = false;
    else if (this.message) this.closeMessage();
    else if (this.scene !== "servers" || this.blocked) return;
    else if (this.memo) this.closeMemo();
    else this.openQuitBox();
  }

  // Frames

  private render(now: number): void {
    const { ctx } = this;
    ctx.imageSmoothingEnabled = false;
    this.advance(now);
    const frozen = this.frozen;
    const fade = this.fade;
    if (frozen && fade?.kind === "out") {
      // The scene is not drawn while fading out (0x405e08).
      ctx.drawImage(frozen.picture, 0, 0);
      drawDarkness(ctx, fade.darkness(now));
      if (fade.done(now)) {
        this.fade = null;
        this.frozen = null;
        frozen.then();
      }
      return;
    }
    this.drawScene(now);
    if (fade) {
      drawDarkness(ctx, fade.darkness(now));
      if (fade.done(now)) this.fade = null;
    }
  }

  /** The timers (SetTimer 8000, 9000, 7000) and the 30 fps steps of the list and the refresh art. */
  private advance(now: number): void {
    // A hidden tab's frames are not made up.
    if (now - this.tickAt > 1000) this.tickAt = now - FRAME_MS;
    while (now - this.tickAt >= FRAME_MS) {
      this.tickAt += FRAME_MS;
      if (this.scene === "servers" && !this.frozen) this.tick();
      else if (this.scene === "status" && !this.frozen) this.statusTick();
    }
    if (this.scene === "logo") this.logoTimer(now);
    else if (this.scene === "loading") this.loadingTimer(now);
  }

  private tick(): void {
    stepSlide(this.options.list.slide);
    if (this.refreshFrame !== null) {
      this.refreshFrame += 1;
      if (this.refreshFrame >= REFRESH_FRAMES.length) this.refreshFrame = null;
    }
    // Held on refresh while armed: the animation starts (0x4345f0).
    const held = this.pointer.held;
    if (held && this.refreshArmed && !this.memo && !this.quitBox && !this.message && inside(SERVER_BUTTONS.refresh.hit, held.x, held.y)) {
      this.refreshArmed = false;
      this.refreshFrame = 0;
    }
  }

  /** Scene 5's key change (0x402090) and held button (0x458e22), the button skipped while a box or the help is up (0x458750). */
  private statusTick(): void {
    this.statusPage.step();
    const held = this.pointer.held;
    if (held && !this.quitBox && !this.message && !this.helpScreen) this.statusPage.hold(held.x, held.y);
  }

  /** Two seconds from the first drawn logo frame, loading; the logo freezes and fades out. */
  private logoTimer(now: number): void {
    if (this.logoAt === null) {
      this.logoAt = now;
      return;
    }
    if (now - this.logoAt < LOGO_MS || this.frozen) return;
    this.scene = "loading";
    this.loading.switchedAt = now;
    this.announce("불러오는 중…");
    this.fadeOut(freezeCanvas(this.options.canvas), now, FRAME_MS, () => this.fadeIn(performance.now(), LOADING_FRAME_MS));
  }

  /**
   * The loader resumes 2 s after the switch; each frame waits up to 100 ms on it, so the bar and
   * the fade-in move at 10 fps. Done (and the help not up), the full bar shows 1 s, then the login.
   */
  private loadingTimer(now: number): void {
    const loading = this.loading;
    if (!loading.started && now - loading.switchedAt >= LOADER_DELAY_MS) {
      loading.started = true;
      this.options
        .preload((done, total) => {
          loading.done = done;
          loading.total = total;
        })
        .finally(() => {
          loading.finished = true;
        });
    }
    if (loading.fullAt === null && now - loading.frameAt >= LOADING_FRAME_MS) {
      loading.frameAt = now;
      loading.count = loading.total > 0 ? loadingCount(loading.done, loading.total) : 0;
      if (loading.finished && !this.helpScreen) {
        loading.count = LOADING_STEPS;
        loading.fullAt = now;
      }
    }
    if (loading.fullAt !== null && now - loading.fullAt >= FULL_BAR_MS && !this.frozen) {
      loading.fullAt = Number.POSITIVE_INFINITY;
      this.options.startMusic();
      this.fadeOut(freezeCanvas(this.options.canvas), now, FRAME_MS, () => {
        this.enterLogin();
        this.fadeIn(performance.now(), FRAME_MS);
      });
    }
  }

  private drawScene(now: number): void {
    const { ctx } = this;
    const { assets } = this.options;
    if (this.helpScreen) {
      drawHelpScreen(ctx, assets.help);
      this.drawTail(now);
      return;
    }
    switch (this.scene) {
      case "logo":
        // Opaque (0x414ca0), no text, no cursor.
        ctx.drawImage(assets.logo, 0, 0);
        return;
      case "loading":
        this.drawLoading();
        return;
      case "login":
        this.drawLogin(now);
        break;
      case "status":
        this.statusPage.draw(
          this.ctx,
          now,
          this.pointer.inside && !this.quitBox && !this.message ? this.pointer.mouse : null,
          this.pointer.held !== null,
        );
        if (this.quitBox) drawPracticeBox(this.ctx, assets.box, this.quitBox, this.boxHover, this.pointer.held !== null);
        break;
      case "servers":
        this.drawServers();
        break;
    }
    this.drawTail(now);
  }

  /** The fill under loading.shk; its keyed fuse shows the fill, black where the bar has not come. */
  private drawLoading(): void {
    const { ctx } = this;
    ctx.fillStyle = "#000000";
    ctx.fillRect(0, 0, SCREEN_W, SCREEN_H);
    const width = loadingBarWidth(this.loading.count);
    if (width > 0) {
      ctx.fillStyle = LOADING_BAR.colour;
      ctx.fillRect(LOADING_BAR.x, LOADING_BAR.y, width, LOADING_BAR.height);
    }
    ctx.drawImage(this.options.assets.loading, 0, 0);
  }

  /** new_server and the banner (0x433530 with 1), new_login, the fields, NEW ID's art, balloons. */
  private drawLogin(now: number): void {
    const { ctx } = this;
    const { assets } = this.options;
    ctx.drawImage(assets.server, 0, 0);
    blit(ctx, assets.banner, START_BANNER.src, START_BANNER.at.x, START_BANNER.at.y);
    ctx.drawImage(assets.login, LOGIN.panel.x, LOGIN.panel.y);
    const id = this.idLine.view();
    const pw = this.pwLine.view();
    outlinedText(ctx, id.text, LOGIN.id.text.x, LOGIN.id.text.y, LOGIN.colour, FONT_13);
    outlinedText(ctx, "*".repeat(cp949Bytes(pw.text)), LOGIN.pw.text.x, LOGIN.pw.text.y, LOGIN.colour, FONT_13);
    if (this.caret.shown(now) && !this.message) {
      const line = this.focus === "id" ? id : pw;
      const at = loginCaret(this.focus, line.caret);
      drawCaret(ctx, at.x, at.y, LOGIN.caretRows);
    }
    if (this.pointer.inside) {
      const { x, y } = this.pointer.mouse;
      const newId = LOGIN_BUTTONS.newId;
      if (inside(newId.hit, x, y)) blit(ctx, assets.button, newId.hover, newId.at.x, newId.at.y);
      for (const button of Object.values(LOGIN_BUTTONS)) {
        if (this.pressedOver(button.hit)) blit(ctx, assets.button, button.pressed, button.at.x, button.at.y);
      }
      const help = Object.values(LOGIN_BUTTONS).find((b) => inside(b.hit, x, y));
      if (help) drawBalloon(ctx, help.help, x, y);
    }
    outlinedText(ctx, `ver. ${INSTALLED_VERSION}`, VERSION_TEXT.x, VERSION_TEXT.y, YELLOW, FONT_13);
  }

  /** 0x433530 with 0: the list, the memo or the buttons' art, the refresh animation, the version. */
  private drawServers(): void {
    const { ctx } = this;
    const { assets, list } = this.options;
    ctx.drawImage(assets.server, 0, 0);
    blit(ctx, assets.banner, START_BANNER.src, START_BANNER.at.x, START_BANNER.at.y);
    for (const part of slideBlits(list.slide)) blit(ctx, assets.listWindow, part.src, part.x, part.y);
    if (rowsShown(list.slide)) this.drawRows();
    const { x, y } = this.pointer.mouse;
    if (this.memo) {
      blit(ctx, assets.memo, MEMO.src, MEMO.at.x, MEMO.at.y);
      if (this.pressedOver(MEMO.close.hit)) blit(ctx, assets.button2, MEMO.close.pressed, MEMO.close.at.x, MEMO.close.at.y);
      if (this.pointer.inside && !this.quitBox && !this.message && inside(MEMO.close.hit, x, y)) drawBalloon(ctx, MEMO.help, x, y);
    } else if (this.pointer.inside && !this.quitBox && !this.message) {
      for (const button of Object.values(SERVER_BUTTONS)) {
        if (!inside(button.hit, x, y)) continue;
        blit(ctx, assets.serverOb, button.hover, button.at.x, button.at.y);
        if (this.pressedOver(button.hit)) blit(ctx, assets.serverOb, button.pressed, button.at.x, button.at.y);
        const at = button.helpAt ?? { x, y };
        drawBalloon(ctx, button.help, at.x, at.y);
      }
    }
    if (this.refreshFrame !== null) {
      const top = REFRESH_FRAMES[this.refreshFrame];
      blit(ctx, assets.serverOb, [3, top, 125, top + 49], SERVER_BUTTONS.refresh.at.x, SERVER_BUTTONS.refresh.at.y);
    }
    outlinedText(ctx, `ver. ${INSTALLED_VERSION}`, VERSION_TEXT.x, VERSION_TEXT.y, YELLOW, FONT_13);
    if (this.quitBox) drawPracticeBox(ctx, assets.box, this.quitBox, this.boxHover, this.pointer.held !== null);
  }

  /** 0x433b10: the bars in lighten, the name and load with their shadows, the ping gauge. */
  private drawRows(): void {
    const { ctx } = this;
    const { assets, list } = this.options;
    const { x, y } = this.pointer.mouse;
    const hover = this.pointer.inside ? rowHoverAt(x, y, list.rows.length) : -1;
    list.rows.forEach((row, i) => {
      const origin = rowOrigin(i);
      let bar: Rect | null = null;
      if (i === list.selected) bar = rowBar(i, true);
      else if (i === hover) bar = rowBar(i, this.pointer.held !== null);
      if (bar) {
        ctx.save();
        ctx.globalCompositeOperation = "lighten";
        blit(ctx, assets.serverOb, bar, origin.x, origin.y);
        ctx.restore();
      }
      const at = rowTexts(i);
      // The auth server gives each row a colour; the remake's one row is white.
      const name = fitText(ctx, row.name, FONT_13, ROW_NAME_WIDTH);
      plainText(ctx, name, at.nameShadow.x, at.nameShadow.y, "#000000", FONT_13);
      plainText(ctx, name, at.name.x, at.name.y, "#ffffff", FONT_13);
      const percent = percentText(row.load);
      plainText(ctx, percent, at.percentShadow.x, at.percentShadow.y, "#000000", FONT_13);
      plainText(ctx, percent, at.percent.x, at.percent.y, "#ffffff", FONT_13);
      const level = gaugeLevel(row.ping);
      for (let k = 0; k <= level.n; k++) {
        const bx = at.leftward ? at.gauge.x - 4 * k : at.gauge.x + 4 * k;
        blit(ctx, assets.serverOb, gaugeBar(k, level.red), bx, at.gauge.y);
      }
    });
  }

  /** The frame tail (0x40cd56): the cursor, then the message box and the cursor again. */
  private drawTail(now: number): void {
    const { ctx } = this;
    const { assets } = this.options;
    if (this.pointer.inside) this.cursor.draw(ctx, assets.cursor, now, this.pointer.mouse, this.busy, this.handCursor);
    const message = this.message;
    if (!message) return;
    if (now - message.since >= MESSAGE_BOX.hideMs) {
      this.message = null;
      return;
    }
    blit(ctx, assets.messageBox, MESSAGE_BOX.src, MESSAGE_BOX.at.x, MESSAGE_BOX.at.y);
    for (const line of messageLines(message.text)) {
      outlinedText(ctx, line.text, line.x, line.y, MESSAGE_BOX.colour, FONT_12, "left", MESSAGE_BOX.outline);
    }
    const button = MESSAGE_BOX.button;
    if (this.pressedOver(button.hit)) blit(ctx, assets.button, button.pressed, button.at.x, button.at.y);
    if (!this.pointer.inside) return;
    const { x, y } = this.pointer.mouse;
    if (inside(button.hit, x, y)) drawBalloon(ctx, MESSAGE_HELP, x, y);
    this.cursor.draw(ctx, assets.cursor, now, this.pointer.mouse, this.busy, this.handCursor);
  }

  /** Scene 5 sets the hand over its banner each frame (0x41f580). */
  private get handCursor(): boolean {
    return this.scene === "status" && !this.helpScreen && this.statusPage.overBanner(this.pointer.mouse.x, this.pointer.mouse.y);
  }

  private pressedOver(hit: Rect): boolean {
    const held = this.pointer.held;
    return held !== null && inside(hit, held.x, held.y);
  }
}
