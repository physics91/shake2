// The start of the program on a canvas, from the original's art: the logo (scene 0xe, 0x418fb0),
// loading (1, 0x418fd0), login (3, 0x419a10), the old "My Status" menu (5, statusScreen.ts) and the
// server list (2, 0x433530), with the fades between them. Rules and geometry: startLayout.ts. The
// page's hidden controls (startView.ts) are the keyboard and screen reader path.
import type { Rect } from "../assets/types.ts";
import { cp949Bytes, cutBytes, typeable } from "../server/cp949.ts";
import type { OwnAccount } from "../server/protocol.ts";
import type { Sheet } from "./assets.ts";
import { loadImage, loadImageSheet, loadSheet } from "./assets.ts";
import type { SoundBank } from "./audio.ts";
import { CaretBlink } from "./chat.ts";
import { ChatLine } from "./chatLine.ts";
import { INSTALLED_VERSION, SCREEN_H, SCREEN_W, VERSION_TEXT } from "./hudLayout.ts";
import { MESSAGE_BOX, MESSAGE_HELP, messageLines } from "./lobbyLayout.ts";
import { characterIndex, nickRefusal } from "./myInfoLayout.ts";
import type { BoxImages, BoxResult, PracticeBox } from "./practiceBox.ts";
import { boxClick, boxHover, boxKey, boxKeyCursor, boxPointer, drawPracticeBox, openBox } from "./practiceBox.ts";
import { MENU_SOUNDS } from "./presentation.ts";
import type { RankingAccess } from "./ranking.ts";
import { inside } from "./roomLayout.ts";
import { CursorAnim, drawBalloon, drawCaret, drawDarkness, drawHelpScreen, Fade, fadeFrame, freezeCanvas, Pointer, registerFadeFrame } from "./screenKit.ts";
import { attachCapture } from "./screenCapture.ts";
import type { CheckKind, SignUpTarget } from "./signUpLayout.ts";
import { SignUpWindow } from "./signUpWindow.ts";
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
  SERVER_ROWS_PER_PAGE,
  serverPageCount,
  slideBlits,
  START_BANNER,
  stepSlide,
  toggleSlide,
} from "./startLayout.ts";
import type { SettingsStore } from "./settings.ts";
import { MAIN_BUTTONS, OPTION_PAGE, RANKING, STATUS_BUTTONS, STATUS_TEXT } from "./statusLayout.ts";
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
  /** new_id: the sign-up window. */
  signUp: HTMLImageElement;
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
  const [logo, loading, server, banner, login, listWindow, serverOb, memo, signUp, button, button2, messageBox, quitBox, images, help, cursor, status] = await Promise.all([
    image("Logo"),
    image("loading"),
    image("new_server"),
    image("new_banner"),
    image("new_login"),
    image("new_listwindow"),
    image("new_serverob"),
    image("new_memo"),
    image("new_id"),
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
    signUp,
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
  /** "#rrggbb" (+0x18..0x1a, 0x456e10): the name's and the load's colour. */
  colour: string;
  /** The auth server's row index, which the game server is asked for; none for the local row. */
  channel?: number;
  /** The remake's row for two players on this PC (AGENTS.md), after the server's. */
  local?: boolean;
}

/** The auth connect failed (0x46118f). */
export const AUTH_FAILED = "인증서버 접속 실패";
/** The auth server's refusal, whatever the reason (0x448ad4). */
export const LOGIN_FAILED = "로그인 실패";

/** What the login's OK did: sent to the auth server, gone on without it (R), or waiting for it to connect. */
export type LoginSent = "sent" | "offline" | "wait";

/** What the server list keeps between its screens: the slide's statics, the rows and the choice. */
export interface ServerList {
  slide: ListSlide;
  rows: ServerRow[];
  /** Overflow uses the original forty positions again. Kept on returning from a lobby (R). */
  page?: number;
  /** [0x46e994]: the chosen row, −1 for none. */
  selected: number;
}

export type StartScene = "logo" | "loading" | "login" | "status" | "servers";

/**
 * Scene 5's buttons the page's hidden controls stand for, and the page each is on (null: all); a
 * step stands for scrolling the guild list to the next or previous row and clicking it.
 */
const STATUS_COMMANDS = {
  go: { page: null, hit: STATUS_BUTTONS.go.hit },
  practice: { page: null, hit: STATUS_BUTTONS.practice.hit },
  ranking: { page: null, hit: STATUS_BUTTONS.ranking.hit },
  option: { page: null, hit: STATUS_BUTTONS.option.hit },
  exit: { page: null, hit: STATUS_BUTTONS.exit.hit },
  characterUp: { page: "main", hit: MAIN_BUTTONS.characterUp.hit },
  characterDown: { page: "main", hit: MAIN_BUTTONS.characterDown.hit },
  ok: { page: "main", hit: MAIN_BUTTONS.ok.hit },
  guildPrevious: { page: "main", step: -1 },
  guildNext: { page: "main", step: 1 },
  guildJoin: { page: "main", hit: MAIN_BUTTONS.guildPassword.hit },
  rankingUp: { page: "ranking", hit: RANKING.up.hit },
  rankingDown: { page: "ranking", hit: RANKING.down.hit },
  rankingFind: { page: "ranking", hit: RANKING.search.hit },
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
} satisfies Record<string, { page: StatusPageName | null } & ({ hit: Rect } | { step: 1 | -1 })>;

export type StatusCommand = keyof typeof STATUS_COMMANDS;

/** The sign-up window's controls the page's hidden buttons stand for; "open" is the login's NEW ID. */
export type SignUpCommand = "open" | Exclude<SignUpTarget, "id" | "nick" | "password" | "confirm">;

export interface StartScreenOptions {
  canvas: HTMLCanvasElement;
  /** The session's cursor.spr, retained when the screen is replaced. */
  cursor?: CursorAnim;
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
  /** The account server's login record, once logged in; null without it. */
  account(): OwnAccount | null;
  /** The auth connection (0x4486b0): made at 1→3 and when a message box on the login closes; kept when up. */
  authConnect(): void;
  /** The loader thread's work (0x404200): every file the next screens use; reports each one done. */
  preload(progress: (done: number, total: number) => void): Promise<void>;
  /** 1→3: the waiting tune starts (0x43fbe0(0)). */
  startMusic(): void;
  /** OK with both fields (C->S 0x0a, 0x44f920). Without the account server scene 5 opens anyway (R). */
  login(id: string, password: string): LoginSent;
  /** Scene 5's Go game: the server list's rows are made and asked for. */
  listServers(): void;
  /** Scene 5's Practice (0x45aa37) with its character and hue ([0x492770]). */
  practice(character: string, hue: number): void;
  /** Scene 5's Go (the old C->S 0x1a): the character, hue and ID check, kept by the account. */
  saveCharacter(character: string, hue: number, useId: boolean): void;
  /** Scene 5's 확인 (C->S 0x48); false when there is no account server to send it to. */
  saveStatus(profile: { nick: string; greeting: string; useId: boolean }): boolean;
  /** Scene 5's pw ▶ (the old C->S 0x4a); false likewise. */
  saveGuild(guild: number): boolean;
  /** The ranking's list and fetches over the auth connection (ranklist_2.asp in 0311). */
  ranking: RankingAccess;
  /** Scene 5's ▲ and ▼. */
  characterChanged(character: string): void;
  /** The sign-up window's 가입하기; false when there is no account server to send it to. */
  register(request: { id: string; nick: string; password: string }): boolean;
  /** Its 아이디검색 and 닉네임검색; false likewise. */
  check(kind: CheckKind, text: string): boolean;
  /** The chosen row clicked again (0x4441c0): connect and say hello. */
  connect(): void;
  /** EXIT on the login, YES on the quit box: the original closes its window; here the program starts over. */
  exit(): void;
}

export class StartScreen {
  private readonly options: StartScreenOptions;
  private readonly display: CanvasRenderingContext2D;
  /** The composition before the gamma fade, which F12 saves (0x413300 → 0x412c00). */
  private readonly ctx: CanvasRenderingContext2D;
  private readonly pointer = new Pointer();
  private readonly cursor: CursorAnim;
  private readonly caret = new CaretBlink();
  private readonly status = document.createElement("p");
  private readonly idLine: ChatLine;
  private readonly pwLine: ChatLine;
  private readonly statusPage: StatusPage;
  /** [0x493f30]: NEW ID's window over the login. */
  private readonly signUp: SignUpWindow;
  private scene: StartScene;
  private fade: Fade | null = null;
  private fadeOutFrame = 0;
  private fadeInFrame = 0;
  private darkness = 0;
  private readonly releaseFrames: (() => void)[];
  /** The picture a fade-out keeps, and what follows it. */
  private frozen: { picture: HTMLCanvasElement; then: () => void } | null = null;
  /** The 30 fps frame clock the slide and the refresh animation step on. */
  private tickAt = 0;
  private logoAt: number | null = null;
  private loading = { switchedAt: 0, started: false, done: 0, total: 0, finished: false, count: 0, frameAt: 0, fullAt: null as number | null };
  /** The ID a login without the account server went on with: scene 5's nick then. */
  private offlineNick = "";
  /** [0x46b0b9]: the login field with the focus. */
  private focus: "id" | "pw" = "id";
  /** [0x495670]: the memo, opened on each login. */
  private memo = false;
  /** [0x46e999] armed by a release; [0x49566c] the refresh animation's frame. */
  private refreshArmed = true;
  private refreshFrame: number | null = null;
  /** The busy cursor (0x43f0b0) and [0x48c2e8]: a connection under way. */
  private busy = false;
  private message: { text: string; since: number; closed?: () => void } | null = null;
  private quitBox: PracticeBox | null = null;
  private boxHover: 0 | 1 | 2 = 0;
  private helpScreen = false;
  private frame = 0;
  private stopped = false;
  private readonly detach: () => void;

  constructor(options: StartScreenOptions) {
    this.options = options;
    this.cursor = options.cursor ?? new CursorAnim();
    const ctx = options.canvas.getContext("2d");
    if (!ctx) throw new Error("canvas 2d context unavailable");
    this.display = ctx;
    const surface = document.createElement("canvas");
    surface.width = SCREEN_W;
    surface.height = SCREEN_H;
    const composition = surface.getContext("2d");
    if (!composition) throw new Error("canvas 2d context unavailable");
    this.ctx = composition;
    const read = () => ({ picture: this.frozen?.picture ?? this.ctx.canvas,
      outFrame: this.fadeOutFrame, inFrame: this.fadeInFrame, darkness: this.darkness });
    this.releaseFrames = [registerFadeFrame(options.canvas, read), registerFadeFrame(surface, read)];
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
      account: () => options.account(),
      save: (profile) => this.saveStatus(profile),
      joinGuild: (guild) => this.saveGuild(guild),
      characterChanged: (character) => options.characterChanged(character),
      ranking: {
        get rows() {
          return options.ranking.rows;
        },
        get windowPage() {
          return options.ranking.windowPage;
        },
        set windowPage(page) {
          options.ranking.windowPage = page;
        },
        page: (page) => this.waitFor(options.ranking.page(page)),
        search: (id) => this.waitFor(options.ranking.search(id)),
      },
    });
    this.signUp = new SignUpWindow({
      stage: options.stage,
      assets: { window: options.assets.signUp, button: options.assets.button, button2: options.assets.button2 },
      announce: (text) => this.announce(text),
      message: (text) => this.showMessage(text),
      // The auth connection takes one request at a time and drops the rest unanswered: while the
      // login waits, a check or a sign-up fails at once as a send that cannot go, not a window locked.
      register: (request) => !this.busy && options.register(request),
      check: (kind, text) => !this.busy && options.check(kind, text),
    });
    this.scene = options.begin;
    const now = performance.now();
    this.tickAt = now;
    if (options.begin === "login") this.enterLogin();
    // Practice's time limit (0x406224): 0x41f030 again, then scene 5 with the fade.
    if (options.begin === "status") {
      this.offlineNick = options.savedId;
      this.enterStatus();
    }
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

  /** A fade, the help screen, a message box, the quit box or the memo: the list's rows take no click (0x459041, 0x4591fb). */
  get dropsClicks(): boolean {
    return this.blocked || this.helpScreen || this.message !== null || this.quitBox !== null || this.memo;
  }

  /** The server list's rows take a click: on the list, open, nothing over it and no connection under way (0x4591fb). */
  get takesRowClicks(): boolean {
    return this.scene === "servers" && !this.dropsClicks && !this.busy && this.options.list.slide.open;
  }

  /** Keyboard mirror of closing and reopening the original refresh, which cycles overflow pages (R). */
  nextServerPage(): void {
    const { list } = this.options;
    if (this.scene !== "servers" || this.dropsClicks || serverPageCount(list.rows.length) === 1) return;
    const [left, top, right, bottom] = SERVER_BUTTONS.refresh.hit;
    const x = (left + right) / 2, y = (top + bottom) / 2;
    if (list.slide.open) this.serversRelease(x, y);
    this.serversRelease(x, y);
  }

  /**
   * The page's entry form stands for the login, scene 5's Go game and the first row in turn: it is
   * taken on those scenes with nothing over them and no connection under way (the login without its
   * sign-up window, the list open as for its rows), not on the logo or the loading, where the canvas
   * takes no input.
   */
  get takesForm(): boolean {
    if (this.dropsClicks || this.busy) return false;
    if (this.scene === "login") return !this.signUp.isOpen;
    if (this.scene === "servers") return this.options.list.slide.open;
    return this.scene === "status";
  }

  /** The quit box, or a fade out (Go game's ends on the list's memo): keys answer what comes, the page's buttons do not. */
  get awaitsKeys(): boolean {
    return this.quitBox !== null || this.frozen !== null;
  }

  /** The load query's answer, already in the list (thread 0x448410): read out. */
  serverInfo(row: ServerRow): void {
    this.announce(`${row.name} 서버: 부하 ${percentText(row.load).trim()}, 응답 ${row.ping < 0 ? "없음" : `${row.ping} ms`}`);
  }

  /** The message box over the scene (MSGBOX 0x443700); `closed` runs once it goes, however it goes. */
  showMessage(text: string, closed?: () => void): void {
    this.message = { text, since: performance.now(), closed };
    this.syncEditorBoxes();
    this.announce(text.replace("\n", " "));
  }

  /** Both boxes hold the editor-to-record copy (0x460368, 0x460374). Sign-up locks only MSGBOX. */
  private syncEditorBoxes(): void {
    this.signUp.box = this.message !== null;
    const defer = this.message !== null || this.quitBox !== null;
    this.idLine.deferChanges(defer);
    this.pwLine.deferChanges(defer);
    this.statusPage.deferChanges(defer);
  }

  /** The auth connect failed or the connection went (0x46118f): the message box, on the login only. */
  authFailed(): void {
    if (this.scene !== "login") return;
    this.setBusy(false);
    // A sign-up request out fails with its own message instead, and the reconnect a failed sign-up
    // send makes (R) does not cover that message when it fails too.
    if (this.signUp.pending) this.signUp.lost();
    else if (!(this.signUp.isOpen && this.message)) this.showMessage(AUTH_FAILED);
  }

  /** The account server's answer to the sign-up window's request. */
  signUpAnswer(kind: "register" | CheckKind, rcode: number): void {
    this.signUp.answer(kind, rcode);
  }

  /** A changed server uses the same login canvas and editors, with no old request or popup left. */
  resetLogin(id: string): void {
    this.fade = null;
    this.frozen = null;
    this.setBusy(false);
    this.message = null;
    this.quitBox = null;
    this.helpScreen = false;
    this.memo = false;
    this.signUp.close();
    this.syncEditorBoxes();
    this.statusPage.reset();
    this.enterLogin(cutBytes(typeable(id), LOGIN.limit - 1));
  }

  /** The auth server's answer (S->C 0x0a, 0x448ab0): the login's fields go and scene 5 opens with the account. */
  loggedIn(account: OwnAccount): void {
    if (this.scene !== "login") return;
    this.setBusy(false);
    const { status } = this.options;
    status.character = Math.max(0, characterIndex(account.character));
    status.hue = account.hue;
    status.useId = account.useId;
    if (this.signUp.isOpen) this.signUp.close();
    this.idLine.close();
    this.pwLine.close();
    this.enterStatus();
  }

  /** "로그인 실패" (0x448ad4): busy off; closing the box resets the fields. */
  loginFailed(): void {
    this.setBusy(false);
    this.showMessage(LOGIN_FAILED);
  }

  /** 확인's answer: busy off, the fields hold the server's copy. */
  statusSaved(account: OwnAccount): void {
    if (this.scene !== "status") return;
    this.setBusy(false);
    this.statusPage.saved(account.nick, account.greeting);
    this.showMessage(STATUS_TEXT.saved);
  }

  /** pw ▶'s answer (S->C 0x4a, 0x445464): busy off, the account's guild is the server's now. */
  guildSaved(): void {
    if (this.scene !== "status") return;
    this.setBusy(false);
    this.showMessage(STATUS_TEXT.guildSaved);
  }

  /** A save refused (S->C 0x57's codes, or the server's text). */
  saveRefused(code: number | string): void {
    this.setBusy(false);
    this.showMessage(typeof code === "number" ? nickRefusal(code) : code);
  }

  /** The game server closed before its version answer (0x460dde): busy off, the row kept, no fade. */
  serverFull(): void {
    this.setBusy(false);
    this.showMessage("사용자가 너무\n많습니다");
  }

  /** A connection from the page's form: the busy cursor as for a row's (0x45928b). */
  connecting(): void {
    this.setBusy(true);
  }

  /** S->C 0x0a accepted by the game server (0x444b58): its connection wait ends. */
  connected(): void {
    this.setBusy(false);
  }

  /** The form's wait for its login ended with the auth connection: its busy cursor goes (scene 5's saves keep theirs). */
  formFailed(): void {
    this.setBusy(false);
  }

  /** FD_CONNECT failed (0x460edc): busy off and the message; the row stays chosen. */
  connectFailed(): void {
    this.setBusy(false);
    this.showMessage("게임 서버에 연결할 수\n없습니다");
  }

  /** S->C 0x0a refused (0x444b58): busy off, the message, the row let go. */
  refused(text: string): void {
    this.setBusy(false);
    this.options.list.selected = -1;
    this.showMessage(text);
  }

  /** FD_CLOSE (0x460dbe): the message, the row let go and a fade back to the list, even from it. */
  disconnected(): void {
    this.setBusy(false);
    this.options.list.selected = -1;
    this.showMessage("서버로 부터 접속이\n끊어졌습니다");
    this.fadeOut(freezeCanvas(this.ctx.canvas), performance.now(), FRAME_MS, () => this.fadeIn(performance.now(), FRAME_MS));
  }

  /** A hidden control for scene 5: the release a click on that button makes, on scene 5 and its page only. */
  statusCommand(command: StatusCommand): void {
    if (this.scene !== "status") return;
    const entry: { page: StatusPageName | null; hit?: Rect; step?: 1 | -1 } = STATUS_COMMANDS[command];
    if (entry.page !== null && entry.page !== this.statusPage.pageName) {
      this.announce({ option: "옵션 쪽이 열려 있지 않습니다.", ranking: "랭킹 쪽이 열려 있지 않습니다.", main: "내 정보 쪽이 열려 있지 않습니다." }[entry.page]);
      return;
    }
    if (entry.step) this.statusStep(entry.step);
    else if (entry.hit) this.release(Math.trunc((entry.hit[0] + entry.hit[2]) / 2), Math.trunc((entry.hit[1] + entry.hit[3]) / 2));
  }

  /** A hidden control for the sign-up window: the release a click there makes, on the login only. */
  signUpCommand(command: SignUpCommand): void {
    if (this.scene !== "login") return;
    if (command === "open") {
      if (this.signUp.isOpen) return;
      const hit = LOGIN_BUTTONS.newId.hit;
      this.release(Math.trunc((hit[0] + hit[2]) / 2), Math.trunc((hit[1] + hit[3]) / 2));
      return;
    }
    if (!this.signUp.isOpen) {
      this.announce("회원가입 창이 열려 있지 않습니다.");
      return;
    }
    const at = SignUpWindow.centre(command);
    this.release(at.x, at.y);
  }

  /** 2→4 (0x449172): the list freezes and fades out; then the lobby is shown. */
  leave(then: () => void): void {
    this.fadeOut(freezeCanvas(this.ctx.canvas), performance.now(), FRAME_MS, then);
  }

  dispose(): void {
    for (const release of this.releaseFrames) release();
    this.stopped = true;
    cancelAnimationFrame(this.frame);
    this.idLine.dispose();
    this.pwLine.dispose();
    this.statusPage.dispose();
    this.signUp.dispose();
    this.status.remove();
    this.detach();
  }

  // Scenes

  private announce(text: string): void {
    this.status.textContent = text;
  }

  private fadeOut(picture: HTMLCanvasElement, now: number, frameMs: number, then: () => void): void {
    const carried = fadeFrame(picture);
    this.fadeOutFrame = carried.outFrame;
    this.fadeInFrame = carried.inFrame;
    this.darkness = carried.darkness;
    this.fade = new Fade("out", now, frameMs, this.fadeOutFrame);
    this.frozen = { picture, then };
  }

  private fadeIn(now: number, frameMs: number): void {
    this.fade = new Fade("in", now, frameMs, this.fadeInFrame);
    this.frozen = null;
  }

  /** 0x41bc00: a saved ID puts the focus on the password; both are cleared otherwise. */
  private enterLogin(id = this.savedId): void {
    this.scene = "login";
    this.idLine.open();
    this.pwLine.open();
    this.idLine.text = id;
    this.setFocus(id ? "pw" : "id");
    this.announce("로그인 화면. 아이디와 비밀번호를 넣고 Enter. Tab으로 칸을 바꿉니다. 가입은 NEW ID 단추입니다.");
    this.options.authConnect();
  }

  /** The saved ID as the 10-byte editor takes it. */
  private get savedId(): string {
    return cutBytes(typeable(this.options.savedId), LOGIN.limit - 1);
  }

  private setFocus(field: "id" | "pw", reload = true): void {
    if (this.focus !== field) (this.focus === "id" ? this.idLine : this.pwLine).discardDeferredChanges();
    this.focus = field;
    const line = field === "id" ? this.idLine : this.pwLine;
    if (reload) line.reloadRecord();
    line.focus();
  }

  /** Apply waiting settings at the event, like 0x43f0b0, even when that kind is already selected. */
  private setBusy(busy: boolean): void {
    this.busy = busy;
    this.cursor.set(busy);
  }

  /**
   * 0x44f920: both fields must hold something, and the busy cursor waits for the auth server. Its
   * answer cuts at once (0x448be3), here to scene 5, as Shake1's login does (R). Without the auth
   * server, scene 5 opens with the ID as the nick: practice and two players on one PC need no account (R).
   */
  private login(): void {
    const id = this.idLine.view().text;
    const password = this.pwLine.view().text;
    if (this.busy || !id || !password) return;
    const sent = this.options.login(id, password);
    if (sent === "sent") {
      this.setBusy(true);
      this.announce("로그인하는 중…");
    } else if (sent === "wait") {
      this.announce("인증 서버에 연결하는 중입니다.");
    } else {
      this.idLine.close();
      this.pwLine.close();
      this.offlineNick = id.trim();
      this.enterStatus();
    }
  }

  /** Scene 5 (0x41f030): the nick and greeting from the account, or the ID without one. */
  private enterStatus(): void {
    this.scene = "status";
    const account = this.options.account();
    const nick = account?.nick ?? cutBytes(typeable(this.offlineNick), LOGIN.limit - 1);
    this.statusPage.enter(nick, account?.greeting ?? "");
  }

  /** 확인 (0x41eab7): busy on until the answer; nothing to send it to shows the auth failure. */
  private saveStatus(profile: { nick: string; greeting: string; useId: boolean }): void {
    if (this.busy) return;
    if (!this.options.saveStatus(profile)) {
      this.showMessage(AUTH_FAILED);
      return;
    }
    this.setBusy(true);
    this.announce("저장하는 중…");
  }

  /** A ranking fetch holds the busy cursor as 0x447290's blocking socket held the frame (0x43f0b0). */
  private async waitFor(fetch: Promise<boolean>): Promise<boolean> {
    this.setBusy(true);
    try {
      return await fetch;
    } finally {
      this.setBusy(false);
    }
  }

  /** pw ▶ (0x41ebd8): busy on until the answer, as 확인. */
  private saveGuild(guild: number): void {
    if (this.busy) return;
    if (!this.options.saveGuild(guild)) {
      this.showMessage(AUTH_FAILED);
      return;
    }
    this.setBusy(true);
    this.announce("저장하는 중…");
  }

  /** Go game: scene 5 fades out and the server list in, its notice window open, its rows asked for. */
  private goServers(): void {
    this.statusPage.leave();
    this.fadeOut(freezeCanvas(this.ctx.canvas), performance.now(), FRAME_MS, () => {
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
      released: (x, y) => this.release(x, y, true),
      pressed: (x, y) => this.press(x, y),
    });
    const onKey = (event: KeyboardEvent) => this.key(event);
    const onGesture = () => this.options.sounds.unlock();
    const onWheel = (event: WheelEvent) => this.wheel(event);
    window.addEventListener("keydown", onKey);
    this.options.canvas.addEventListener("pointerdown", onGesture);
    this.options.canvas.addEventListener("wheel", onWheel, { passive: false });
    const detachCapture = attachCapture(this.options.canvas, () => this.quitBox !== null, () => this.ctx.canvas);
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
  private release(x: number, y: number, fromCanvas = false): void {
    if (this.blocked || this.helpScreen) return;
    if (this.scene === "logo" || this.scene === "loading") return;
    if (this.message && !inside(MESSAGE_BOX.button.hit, x, y)) return;
    const statusClick = fromCanvas && this.scene === "status" && (!this.busy || this.message !== null);
    if (this.scene === "servers" || statusClick) {
      // Return from assistive controls to the canvas keys, including EXIT's Y/N.
      const active = document.activeElement;
      if (active instanceof HTMLElement && active !== document.body && !this.options.stage.contains(active)) active.blur();
    }
    if (statusClick) this.statusPage.refocus();
    if (this.message) {
      this.closeMessage();
      return;
    }
    if (this.scene === "login") this.loginRelease(x, y);
    else if (this.scene === "status") this.statusRelease(x, y);
    else this.serversRelease(x, y);
  }

  /** The guild list's step from the keyboard, taken only where a click on the list would be. */
  private statusStep(step: 1 | -1): void {
    if (this.busy || this.blocked || this.helpScreen || this.message || this.quitBox) return;
    this.statusPage.stepGuild(step);
  }

  /** Scene 5 (0x45a8d3): the quit box takes the click while it is up; busy, the mouse is not read (0x458750). */
  private statusRelease(x: number, y: number): void {
    if (this.busy) return;
    if (this.quitBox) {
      const result = boxClick(this.quitBox, x, y);
      if (result) this.answer(result);
      return;
    }
    switch (this.statusPage.release(x, y)) {
      case "go":
        this.options.saveCharacter(this.statusPage.character, this.options.status.hue, this.options.status.useId);
        this.goServers();
        break;
      case "practice":
        this.statusPage.leave();
        this.options.practice(this.statusPage.character, this.options.status.hue);
        break;
      case "exit":
        // The network box (0x443ce0); its YES resets scene 5 and leaves (0x4205e0).
        this.openQuitBox({ x, y });
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
    if (this.signUp.isOpen) {
      this.signUp.release(x, y);
      if (!this.signUp.isOpen) this.setFocus(this.focus);
      return;
    }
    switch (loginButtonAt(x, y)) {
      case "ok":
        sounds.play(MENU_SOUNDS.primary);
        this.login();
        break;
      case "newId":
        // SND 0x25, then the window (0x41bd70); the login's pending flag does not stop it.
        sounds.play(MENU_SOUNDS.primary);
        this.signUp.open();
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
        this.setFocus(this.focus, false);
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
      else {
        const pages = serverPageCount(list.rows.length);
        list.page = ((list.page ?? 0) + 1) % pages;
        if (pages > 1) this.announce(`서버 목록 ${list.page + 1}/${pages}쪽. 줄을 두 번 누르면 접속합니다.`);
      }
      toggleSlide(list.slide);
      return;
    }
    if (this.memo) {
      if (inside(MEMO.close.hit, x, y)) this.closeMemo();
      return;
    }
    const row = list.slide.open ? rowClickAt(x, y, list.rows.length, list.page ?? 0) : -1;
    if (row >= 0 && list.rows[row].load !== -1) {
      if (row !== list.selected) {
        list.selected = row;
        this.announce(`${list.rows[row].name} 서버를 골랐습니다. 한 번 더 누르면 접속합니다.`);
      } else if (!this.busy) {
        this.setBusy(true);
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
      this.openQuitBox({ x, y });
    }
  }

  /** The mouse rests at `at`: the Exit release's place (a hidden mirror's click leaves the real mouse elsewhere), or the mouse for Esc. */
  private openQuitBox(at: { x: number; y: number } = this.pointer.mouse): void {
    this.quitBox = openBox("esc");
    this.syncEditorBoxes();
    // Scenes 2 and 5 draw it at 0x40cac4: a mouse resting on a button selects it.
    this.boxHover = boxHover(this.quitBox, at);
    this.announce("종료하시겠습니까? 예(Y), 아니오(N)");
  }

  /** YES closes the program (0x458a77); NO hides the box. */
  private answer(result: BoxResult): void {
    this.quitBox = null;
    this.syncEditorBoxes();
    this.boxHover = 0;
    if (result === "exit") this.options.exit();
    else this.announce("");
  }

  /** Esc with the window up (0x461737): it closes and the login's field takes the editor again. */
  private closeSignUp(): void {
    if (this.signUp.pending) return;
    this.signUp.close();
    this.announce("회원가입 창을 닫았습니다.");
    this.setFocus(this.focus);
  }

  private closeMemo(): void {
    this.memo = false;
    this.announce("공지 창을 닫았습니다.");
  }

  /** OK or Esc on the login's message box: the fields reset and the auth server is connected again (0x461590, 0x4588c3). */
  private closeMessage(): void {
    const closed = this.message?.closed;
    this.message = null;
    this.syncEditorBoxes();
    closed?.();
    // Over the sign-up window the box only hides: no reset, no reconnect (0x4615d4, 0x45885d).
    if (this.scene === "login" && this.signUp.isOpen) {
      this.signUp.refocus();
      return;
    }
    if (this.scene === "login") {
      this.pwLine.text = "";
      this.idLine.text = this.savedId;
      this.setFocus(this.savedId ? "pw" : "id");
      this.options.authConnect();
    }
  }

  private key(event: KeyboardEvent): void {
    // Only the browser's IME process key is excluded; real F1, Esc and Tab retain their scene actions.
    if (event.keyCode === 229) return;
    // Keys typed into the page's own controls are theirs; the heading the shell focuses (shell.ts) is not
    // one, and keeps the focus when the list comes back with no edit box to take it.
    const active = document.activeElement;
    const ours =
      active === null ||
      active.tagName === "H1" ||
      this.statusPage.owns(active) ||
      this.signUp.owns(active) ||
      [this.idLine.element, this.pwLine.element, this.options.canvas, document.body].includes(active as HTMLElement);
    if (!ours) return;
    this.options.sounds.unlock();
    if (this.quitBox && (this.scene === "servers" || this.scene === "status")) {
      // 0x460097: while the box is up every key, F1 too, only turns the help screen off.
      this.helpScreen = false;
      // Keep its keys out of the status editor. Delete still edits the buffer before the box's
      // key gate (0x403a97); characters/Backspace and caret arrows do not (0x403b70, 0x40394f).
      if (event.key !== "Delete") event.preventDefault();
      const result = boxKey(this.quitBox, event.key);
      if (event.key === "ArrowLeft" || event.key === "ArrowRight") this.boxHover = boxKeyCursor(this.quitBox);
      if (result) {
        this.answer(result);
      }
      return;
    }
    if (event.code === "F1") {
      event.preventDefault();
      // 0x460264 refuses F1 only while loading (scene 1).
      if (this.scene !== "loading") this.helpScreen = !this.helpScreen;
      return;
    }
    if (event.code === "Escape") {
      event.preventDefault();
      this.escape();
      return;
    }
    if ((this.scene === "login" || this.scene === "status") && event.key === "Tab" && !event.shiftKey) {
      // WM_CHAR Tab changes fields before MSGBOX's copy gate and while help is up (0x45ff0c).
      // Shift+Tab is left to the page's controls.
      event.preventDefault();
      if (this.blocked) return;
      if (this.scene === "status") this.statusPage.tab();
      else if (this.signUp.isOpen) this.signUp.tab();
      else this.setFocus(this.focus === "id" ? "pw" : "id");
      return;
    }
    // Enter's scene action precedes MSGBOX's copy gate too (0x45fbb3); help does not block it.
    if (this.scene !== "login" || this.blocked) return;
    if (this.signUp.isOpen) {
      // Enter in the sign-up window (0x45fbb3) never signs up.
      if (event.key === "Enter") {
        event.preventDefault();
        this.signUp.enter();
      }
      return;
    }
    // Enter on the login (0x45fb06).
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
    else if (this.scene === "login" && this.signUp.isOpen) this.closeSignUp();
    else if (this.scene !== "servers" || this.blocked) return;
    else if (this.memo) this.closeMemo();
    else this.openQuitBox();
  }

  // Frames

  private render(now: number): void {
    const { ctx } = this;
    ctx.imageSmoothingEnabled = false;
    this.display.imageSmoothingEnabled = false;
    this.advance(now);
    const frozen = this.frozen;
    const fade = this.fade;
    if (frozen && fade?.kind === "out") {
      // The scene is not drawn while fading out (0x405e08).
      ctx.drawImage(frozen.picture, 0, 0);
      this.display.drawImage(ctx.canvas, 0, 0);
      this.darkness = fade.darkness(now);
      drawDarkness(this.display, this.darkness);
      this.fadeOutFrame = fade.frame(now) + 1;
      if (fade.done(now)) {
        // The last step fills the composition with black, rather than changing only its gamma.
        ctx.fillStyle = "#000000";
        ctx.fillRect(0, 0, SCREEN_W, SCREEN_H);
        this.fade = null;
        this.frozen = null;
        this.fadeOutFrame = 0;
        frozen.then();
      }
      return;
    }
    this.drawScene(now);
    this.display.drawImage(ctx.canvas, 0, 0);
    this.darkness = fade ? fade.darkness(now) : 0;
    if (fade) {
      drawDarkness(this.display, this.darkness);
      this.fadeInFrame = fade.frame(now) + 1;
      if (fade.done(now)) { this.fade = null; this.fadeInFrame = 0; }
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

  /** Help skips the key poll (0x458750); boxes also skip scene 5's held buttons (0x458e22). */
  private statusTick(): void {
    if (!this.helpScreen) this.statusPage.step();
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
    this.fadeOut(freezeCanvas(this.ctx.canvas), now, FRAME_MS, () => this.fadeIn(performance.now(), LOADING_FRAME_MS));
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
      this.fadeOut(freezeCanvas(this.ctx.canvas), now, FRAME_MS, () => {
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
    if (this.signUp.isOpen) {
      // new_id in new_login's place (0x419a5e); no balloons.
      const mouse = this.pointer.inside ? this.pointer.mouse : null;
      this.signUp.draw(ctx, mouse, this.pointer.held, this.caret.shown(now) && !this.message);
      outlinedText(ctx, `ver. ${INSTALLED_VERSION}`, VERSION_TEXT.x, VERSION_TEXT.y, YELLOW, FONT_13);
      return;
    }
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
    const page = list.page ?? 0, first = page * SERVER_ROWS_PER_PAGE;
    const hover = this.pointer.inside ? rowHoverAt(x, y, list.rows.length, page) : -1;
    list.rows.slice(first, first + SERVER_ROWS_PER_PAGE).forEach((row, slot) => {
      const i = first + slot, origin = rowOrigin(slot);
      let bar: Rect | null = null;
      if (i === list.selected) bar = rowBar(slot, true);
      else if (i === hover) bar = rowBar(slot, this.pointer.held !== null);
      if (bar) {
        ctx.save();
        ctx.globalCompositeOperation = "lighten";
        blit(ctx, assets.serverOb, bar, origin.x, origin.y);
        ctx.restore();
      }
      const at = rowTexts(slot);
      // The auth server gives each row a colour for its name and load (0x433d85).
      const name = fitText(ctx, row.name, FONT_13, ROW_NAME_WIDTH);
      plainText(ctx, name, at.nameShadow.x, at.nameShadow.y, "#000000", FONT_13);
      plainText(ctx, name, at.name.x, at.name.y, row.colour, FONT_13);
      const percent = percentText(row.load);
      plainText(ctx, percent, at.percentShadow.x, at.percentShadow.y, "#000000", FONT_13);
      plainText(ctx, percent, at.percent.x, at.percent.y, row.colour, FONT_13);
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
    if (this.pointer.inside) this.cursor.draw(ctx, assets.cursor, now, this.pointer.mouse, this.waiting, this.handCursor);
    const message = this.message;
    if (!message) return;
    if (now - message.since >= MESSAGE_BOX.hideMs) {
      this.message = null;
      this.syncEditorBoxes();
      // A successful sign-up closes its editors. Return the login's editor after the box,
      // unless the user has already moved to one of the page's assistive controls.
      if (this.scene === "login" && !this.signUp.isOpen && document.activeElement === document.body) this.setFocus(this.focus);
      message.closed?.();
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
    this.cursor.draw(ctx, assets.cursor, now, this.pointer.mouse, this.waiting, this.handCursor);
  }

  /** The busy cursor: a connection under way, or the sign-up's request (R: the original's froze the frame). */
  private get waiting(): boolean {
    return this.busy || this.signUp.pending;
  }

  /** Scene 5 sets the hand over its banner each frame (0x41f580). */
  private get handCursor(): boolean {
    // Help skips the scene's hover handler and draws the current cursor (0x40ca70).
    if (this.helpScreen) return this.cursor.hand;
    return this.scene === "status" && this.statusPage.overBanner(this.pointer.mouse.x, this.pointer.mouse.y);
  }

  private pressedOver(hit: Rect): boolean {
    const held = this.pointer.held;
    return held !== null && inside(hit, held.x, held.y);
  }
}
