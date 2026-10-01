// The program's start (logo, loading, login, scene 5, server list) as a page: the original's screens
// on a canvas (startScreen.ts) and, hidden from sight, the keyboard and screen reader controls:
// scene 5's buttons and an entry form that logs in and connects at once.
import type { Manifest } from "../assets/types.ts";
import { cutBytes, typeable } from "../server/cp949.ts";
import type { OwnAccount } from "../server/protocol.ts";
import { SCREEN_H, SCREEN_W } from "./hudLayout.ts";
import type { RankingAccess } from "./ranking.ts";
import { settings, sounds } from "./shell.ts";
import type { CheckKind } from "./signUpLayout.ts";
import type { LoginSent, ServerList, ServerRow, SignUpCommand, StartScene, StatusCommand } from "./startScreen.ts";
import { loadStartAssets, preloadOnline, StartScreen } from "./startScreen.ts";
import { LOGIN } from "./startLayout.ts";
import type { StatusState } from "./statusScreen.ts";
import { h, readPreference } from "./ui.ts";

export interface StartActions {
  /** 1→3: the waiting tune. */
  startMusic(): void;
  /** The account server's login record, once logged in. */
  account(): OwnAccount | null;
  /** The auth connection, made at the login and again when its message box closes. */
  authConnect(): void;
  /** The canvas login's OK. */
  login(id: string, password: string): LoginSent;
  /** Scene 5's Go game: the server list's rows. */
  listServers(): void;
  /** Scene 5's Practice. */
  practice(character: string, hue: number): void;
  /** Scene 5's Go: the character kept by the account. */
  saveCharacter(character: string, hue: number, useId: boolean): void;
  /** Scene 5's 확인; false without the account server. */
  saveStatus(profile: { nick: string; greeting: string; useId: boolean }): boolean;
  /** Scene 5's pw ▶; false likewise. */
  saveGuild(guild: number): boolean;
  /** Scene 5's ranking page. */
  ranking: RankingAccess;
  /** Scene 5's ▲ and ▼. */
  characterChanged(character: string): void;
  /** The sign-up window's 가입하기; false without the account server. */
  register(request: { id: string; nick: string; password: string }): boolean;
  /** Its ID and nick checks; false without the account server. */
  check(kind: CheckKind, text: string): boolean;
  /** The chosen row clicked again. */
  connect(): void;
  /** The page's form: log in and go into the first row's lobby. */
  enter(login: { id: string; password: string }): void;
  /** The server list's "2인 대전" row, for the page's button too. */
  local(): void;
  /** The quit box's YES: the program ends, which here starts it again. */
  exit(): void;
}

export interface StartViewOptions {
  manifest: Manifest;
  list: ServerList;
  status: StatusState;
  begin: StartScene;
  fadeFrom?: HTMLCanvasElement;
  /** A message box to show as the screen opens (a lost connection). */
  message?: string;
  actions: StartActions;
}

/** Scene 5's canvas buttons for the keyboard: each clicks the same place, on scene 5 only. */
const STATUS_MIRRORS: readonly [StatusCommand, string][] = [
  ["go", "Go game: 서버 목록으로 (내 정보 화면)"],
  ["practice", "Practice: 혼자 연습 (내 정보 화면)"],
  ["characterUp", "앞 캐릭터 (내 정보 화면 ▲)"],
  ["characterDown", "다음 캐릭터 (내 정보 화면 ▼)"],
  ["ok", "확인: 닉네임·인사말 저장 (내 정보 화면)"],
  ["guildPrevious", "앞 길드 고르기 (내 정보 화면 길드 목록)"],
  ["guildNext", "다음 길드 고르기 (내 정보 화면 길드 목록)"],
  ["guildJoin", "▶: 고른 길드에 가입, 없음이면 탈퇴 (내 정보 화면)"],
  ["ranking", "Ranking (내 정보 화면)"],
  ["rankingUp", "▲: 앞 랭킹 쪽 (랭킹 쪽)"],
  ["rankingDown", "▼: 다음 랭킹 쪽 (랭킹 쪽)"],
  ["rankingFind", "찾기: 넣은 아이디의 쪽 (랭킹 쪽)"],
  ["option", "Option: 옵션 쪽 (내 정보 화면)"],
  ["exit", "Exit: 종료 상자 (내 정보 화면)"],
  ["musicOn", "음악 켬 (옵션 쪽)"],
  ["musicOff", "음악 끔 (옵션 쪽)"],
  ["soundOn", "효과음 켬 (옵션 쪽)"],
  ["soundOff", "효과음 끔 (옵션 쪽)"],
  ["keyboard", "키보드 (옵션 쪽)"],
  ["joystick", "조이스틱 (옵션 쪽)"],
  ["key1", "폭탄 내려놓기 키 바꾸기 (옵션 쪽)"],
  ["key2", "아이템 사용 1 키 바꾸기 (옵션 쪽)"],
  ["key3", "아이템 사용 2 키 바꾸기 (옵션 쪽)"],
  ["optionOk", "확인: 옵션 저장 (옵션 쪽)"],
  ["optionCancel", "취소: 옵션 쪽 닫기 (옵션 쪽)"],
];

/** The sign-up window's mouse-only controls for the keyboard: each clicks the same place, on the login only. */
const SIGN_UP_MIRRORS: readonly [SignUpCommand, string][] = [
  ["open", "NEW ID: 회원가입 창 열기 (로그인 화면)"],
  ["idCheck", "아이디검색 (회원가입 창)"],
  ["nickCheck", "닉네임검색 (회원가입 창)"],
  ["termsUp", "안내 글 위로 (회원가입 창 ▲)"],
  ["termsDown", "안내 글 아래로 (회원가입 창 ▼)"],
  ["agree", "동의함 (회원가입 창)"],
  ["disagree", "동의안함 (회원가입 창)"],
  ["submit", "가입하기 (회원가입 창)"],
  ["close", "창 닫기 (회원가입 창 X)"],
];

/** The ID editor's 10 bytes (0x41bc00), for the page's name field too. */
const NAME_BYTES = LOGIN.limit - 1;

export function defaultServerUrl(): string {
  const scheme = location.protocol === "https:" ? "wss" : "ws";
  return `${scheme}://${location.host}/ws`;
}

export class StartView {
  readonly root: HTMLElement;
  readonly errorLine = h("p", { class: "error", role: "alert" });
  private readonly canvas = h("canvas", {
    width: SCREEN_W,
    height: SCREEN_H,
    class: "game-canvas",
    role: "img",
    "aria-label": "시작 화면. 마우스와 키보드로 조작하며, 같은 기능이 아래 입장 양식에도 있습니다.",
  });
  private readonly loading = h("p", { class: "loading", role: "status" }, "시작 화면을 불러오는 중…");
  private readonly stage = h("div", { class: "stage" }, this.canvas, this.loading);
  private readonly nameInput: HTMLInputElement;
  private readonly passwordInput: HTMLInputElement;
  private readonly serverInput: HTMLInputElement;
  private screen: StartScreen | null = null;
  private disposed = false;
  /** What arrived before the canvas was ready. */
  private pending: ((screen: StartScreen) => void)[] = [];

  constructor(options: StartViewOptions) {
    const { actions } = options;
    this.nameInput = h("input", {
      id: "online-name",
      value: readPreference("online.name") ?? "",
      autocomplete: "username",
      required: true,
    });
    this.passwordInput = h("input", { id: "online-password", type: "password", autocomplete: "current-password", required: true });
    for (const input of [this.nameInput, this.passwordInput]) {
      input.addEventListener("input", () => {
        const kept = cutBytes(typeable(input.value), NAME_BYTES);
        if (kept !== input.value) input.value = kept;
      });
    }
    this.serverInput = h("input", { id: "online-server", value: readPreference("online.server") ?? defaultServerUrl() });
    const enter = (event: Event) => {
      event.preventDefault();
      const id = this.nameInput.value.trim();
      const password = this.passwordInput.value;
      if (!id || !password) return;
      this.passwordInput.value = "";
      actions.enter({ id, password });
    };

    this.root = h(
      "main",
      { class: "screen lobby shake" },
      h("header", { class: "toolbar" }, h("h1", { tabindex: "-1" }, "쉐이크2")),
      this.stage,
      h(
        "p",
        { class: "keys" },
        "로그인: 아이디를 넣고 Enter, 비밀번호를 넣고 Enter. Tab은 칸 바꾸기, Shift+Tab은 아래 조작으로. 가입은 아래 회원가입 창 버튼으로 창을 열고 Tab으로 칸을 옮겨 넣은 뒤 동의함과 가입하기. 인증 서버에 닿지 않으면 로그인 없이 내 정보 화면으로 가서 연습과 2인 대전만 할 수 있습니다. 내 정보 화면: 아래 버튼으로 Go game(서버 목록), Practice(혼자 연습), 캐릭터 바꾸기. 서버 선택: 공지 창 X, 서버 줄을 한 번 눌러 고르고 한 번 더 눌러 접속. Esc는 메시지·공지 닫기, 서버 목록에서는 그다음 종료 상자. F1은 도움말.",
      ),
      h(
        "div",
        { class: "actions", role: "group", "aria-label": "내 정보 화면 버튼" },
        ...STATUS_MIRRORS.map(([command, label]) =>
          h("button", { class: "btn", type: "button", onclick: () => this.withScreen((screen) => screen.statusCommand(command)) }, label),
        ),
      ),
      h(
        "div",
        { class: "actions", role: "group", "aria-label": "회원가입 창 버튼" },
        ...SIGN_UP_MIRRORS.map(([command, label]) =>
          h("button", { class: "btn", type: "button", onclick: () => this.withScreen((screen) => screen.signUpCommand(command)) }, label),
        ),
      ),
      h(
        "form",
        { class: "lobby", onsubmit: enter },
        h("div", { class: "field" }, h("label", { for: "online-name" }, `아이디 (최대 ${NAME_BYTES}바이트)`), this.nameInput),
        h("div", { class: "field" }, h("label", { for: "online-password" }, `비밀번호 (최대 ${NAME_BYTES}바이트)`), this.passwordInput),
        h("div", { class: "actions" }, h("button", { class: "btn primary", type: "submit" }, "로그인하고 첫 서버 로비 입장")),
      ),
      // The row's double click, dropped where the canvas drops it.
      h("button", { class: "btn", type: "button", onclick: () => this.screen?.takesRowClicks && actions.local() }, "2인 대전 (한 키보드, 서버 목록의 둘째 줄)"),
      h(
        "details",
        {},
        h("summary", {}, "서버 주소"),
        h("div", { class: "field" }, h("label", { for: "online-server" }, "WebSocket 주소 (기본값은 이 페이지와 같은 서버의 /ws)"), this.serverInput),
      ),
      this.errorLine,
    );
    // The canvas box hides after 2 s and the row's answer takes the status line: the alert keeps it.
    if (options.message) this.errorLine.textContent = options.message.replace(/\n/g, " ");

    loadStartAssets().then(
      (assets) => {
        if (this.disposed) return;
        const screen = new StartScreen({
          canvas: this.canvas,
          stage: this.stage,
          assets,
          sounds,
          settings,
          list: options.list,
          begin: options.begin,
          fadeFrom: options.fadeFrom,
          savedId: readPreference("online.name") ?? "",
          status: options.status,
          account: actions.account,
          authConnect: actions.authConnect,
          preload: preloadOnline,
          startMusic: actions.startMusic,
          login: (id, password) => {
            this.nameInput.value = id;
            return actions.login(id, password);
          },
          listServers: actions.listServers,
          practice: actions.practice,
          saveCharacter: actions.saveCharacter,
          saveStatus: actions.saveStatus,
          saveGuild: actions.saveGuild,
          ranking: actions.ranking,
          characterChanged: actions.characterChanged,
          register: actions.register,
          check: actions.check,
          connect: actions.connect,
          exit: actions.exit,
        });
        this.screen = screen;
        if (options.message) screen.showMessage(options.message);
        for (const run of this.pending) run(screen);
        this.pending = [];
        this.loading.remove();
      },
      (error: Error) => {
        this.loading.textContent = `시작 화면 그림을 불러오지 못했습니다: ${error.message}`;
      },
    );
  }

  /** The address the form holds, or this page's own /ws. */
  get serverUrl(): string {
    return this.serverInput.value.trim() || defaultServerUrl();
  }

  serverInfo(row: ServerRow): void {
    this.withScreen((screen) => screen.serverInfo(row));
  }

  /** The auth connection failed or closed: the login's message box. */
  authFailed(): void {
    this.errorLine.textContent = "인증 서버에 접속하지 못했습니다. 로그인 없이 연습과 2인 대전만 할 수 있습니다.";
    this.withScreen((screen) => screen.authFailed());
  }

  loggedIn(account: OwnAccount): void {
    this.errorLine.textContent = "";
    this.withScreen((screen) => screen.loggedIn(account));
  }

  loginFailed(): void {
    this.errorLine.textContent = "로그인 실패: 아이디나 비밀번호가 맞지 않습니다.";
    this.withScreen((screen) => screen.loginFailed());
  }

  statusSaved(account: OwnAccount): void {
    this.withScreen((screen) => screen.statusSaved(account));
  }

  guildSaved(): void {
    this.withScreen((screen) => screen.guildSaved());
  }

  /** The account server's answer to the sign-up window. */
  signUpAnswer(kind: "register" | CheckKind, rcode: number): void {
    this.withScreen((screen) => screen.signUpAnswer(kind, rcode));
  }

  saveRefused(code: number | string): void {
    this.withScreen((screen) => screen.saveRefused(code));
  }

  /** A connection from the page's form: the busy cursor. */
  connecting(): void {
    this.withScreen((screen) => screen.connecting());
  }

  serverFull(): void {
    this.errorLine.textContent = "사용자가 너무 많습니다";
    this.withScreen((screen) => screen.serverFull());
  }

  /** A message box over the screen; `closed` runs when it goes, by a click, Esc or its own time. */
  showMessage(text: string, closed?: () => void): void {
    this.errorLine.textContent = text.replace(/\n+/g, " ");
    this.withScreen((screen) => screen.showMessage(text, closed));
  }

  connectFailed(): void {
    this.errorLine.textContent = "게임 서버에 연결할 수 없습니다. 서버(npm run server)가 켜져 있는지 확인하세요.";
    this.withScreen((screen) => screen.connectFailed());
  }

  refused(text: string): void {
    this.errorLine.textContent = text;
    this.withScreen((screen) => screen.refused(text));
  }

  disconnected(): void {
    this.errorLine.textContent = "서버로 부터 접속이 끊어졌습니다";
    this.withScreen((screen) => screen.disconnected());
  }

  /** 2→4: the canvas fades out, then `then` shows the lobby (at once if the canvas never came up). */
  leave(then: () => void): void {
    if (this.screen) this.screen.leave(then);
    else then();
  }

  dispose(): void {
    this.disposed = true;
    this.screen?.dispose();
    this.screen = null;
  }

  private withScreen(run: (screen: StartScreen) => void): void {
    if (this.screen) run(this.screen);
    else this.pending.push(run);
  }
}
