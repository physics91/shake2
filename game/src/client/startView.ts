// The program's start (logo, loading, login, scene 5, server list) as a page: the original's screens
// on a canvas (startScreen.ts) and, hidden from sight, the keyboard and screen reader controls:
// scene 5's buttons and an entry form that logs in and connects at once.
import type { Manifest } from "../assets/types.ts";
import { cutBytes, typeable } from "../server/cp949.ts";
import { SCREEN_H, SCREEN_W } from "./hudLayout.ts";
import { characterChoices } from "./menu.ts";
import { settings, sounds } from "./shell.ts";
import type { ServerList, ServerRow, StartScene, StatusCommand } from "./startScreen.ts";
import { loadStartAssets, preloadOnline, StartScreen } from "./startScreen.ts";
import { LOGIN } from "./startLayout.ts";
import type { StatusState } from "./statusScreen.ts";
import { choiceGroup, h, readPreference } from "./ui.ts";

export interface StartActions {
  /** 1→3: the waiting tune. */
  startMusic(): void;
  /** The canvas login: the ID becomes the player's name. */
  loggedIn(id: string): void;
  /** Scene 5's Go game: the server list's rows. */
  listServers(): void;
  /** Scene 5's Practice. */
  practice(character: string): void;
  /** Scene 5's 확인. */
  saveProfile(profile: { nick: string; greeting: string }): void;
  /** Scene 5's ▲ and ▼. */
  characterChanged(character: string): void;
  /** The chosen row clicked again. */
  connect(): void;
  /** The page's form: straight to the lobby with this name and character. */
  enter(profile: { name: string; character: string }): void;
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
  ["ranking", "Ranking (내 정보 화면)"],
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
  private readonly serverInput: HTMLInputElement;
  private screen: StartScreen | null = null;
  private disposed = false;
  /** What arrived before the canvas was ready. */
  private pending: ((screen: StartScreen) => void)[] = [];

  constructor(options: StartViewOptions) {
    const { manifest, actions } = options;
    this.nameInput = h("input", {
      id: "online-name",
      value: readPreference("online.name") ?? "",
      autocomplete: "nickname",
      placeholder: "플레이어",
    });
    this.nameInput.addEventListener("input", () => {
      const kept = cutBytes(typeable(this.nameInput.value), NAME_BYTES);
      if (kept !== this.nameInput.value) this.nameInput.value = kept;
    });
    this.serverInput = h("input", { id: "online-server", value: readPreference("online.server") ?? defaultServerUrl() });
    let character = readPreference("p1") ?? "bobo";
    if (!manifest.characters.includes(character)) character = manifest.characters[0];
    const enter = (event: Event) => {
      event.preventDefault();
      this.screen?.connecting();
      actions.enter({ name: this.nameInput.value.trim(), character });
    };

    this.root = h(
      "main",
      { class: "screen lobby shake" },
      h("header", { class: "toolbar" }, h("h1", { tabindex: "-1" }, "쉐이크2")),
      this.stage,
      h(
        "p",
        { class: "keys" },
        "로그인: 아이디(이름)를 넣고 Enter, 비밀번호 칸에서 Enter(비밀번호는 쓰지 않음). Tab은 칸 바꾸기, Shift+Tab은 아래 조작으로. 내 정보 화면: 아래 버튼으로 Go game(서버 목록), Practice(혼자 연습), 캐릭터 바꾸기. 서버 선택: 공지 창 X, 서버 줄을 한 번 눌러 고르고 한 번 더 눌러 접속. Esc는 메시지·공지 닫기, 서버 목록에서는 그다음 종료 상자. F1은 도움말.",
      ),
      h(
        "div",
        { class: "actions", role: "group", "aria-label": "내 정보 화면 버튼" },
        ...STATUS_MIRRORS.map(([command, label]) =>
          h("button", { class: "btn", type: "button", onclick: () => this.withScreen((screen) => screen.statusCommand(command)) }, label),
        ),
      ),
      h(
        "form",
        { class: "lobby", onsubmit: enter },
        h("div", { class: "field" }, h("label", { for: "online-name" }, `이름 (최대 ${NAME_BYTES}바이트)`), this.nameInput),
        choiceGroup("캐릭터", "online-character", characterChoices(manifest), character, (value) => {
          character = value;
        }),
        h("div", { class: "actions" }, h("button", { class: "btn primary", type: "submit" }, "로비 입장")),
      ),
      h("button", { class: "btn", type: "button", onclick: () => actions.local() }, "2인 대전 (한 키보드, 서버 목록의 둘째 줄)"),
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
          greeting: readPreference("online.greeting") ?? "",
          preload: preloadOnline,
          startMusic: actions.startMusic,
          loggedIn: (id) => {
            this.nameInput.value = id;
            actions.loggedIn(id);
          },
          listServers: actions.listServers,
          practice: actions.practice,
          saveProfile: (profile) => {
            this.nameInput.value = profile.nick;
            actions.saveProfile(profile);
          },
          characterChanged: actions.characterChanged,
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
