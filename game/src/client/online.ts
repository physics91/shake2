import type { Manifest } from "../assets/types.ts";
import { compareIgnoreCase, cp949Bytes, cutBytes, typeable } from "../server/cp949.ts";
import type { ChannelRow, ClientMessage, OwnAccount, PanelBar, RoomChange, RoomInfo, ServerMessage } from "../server/protocol.ts";
import { badgeOf, shownName, START_BARS, typingPacketDue } from "../server/protocol.ts";
import { hasItem, ITEM_KICK, ITEM_WHISPER } from "../server/items.ts";
import {
  chatLine,
  fromWireState,
  gameChatLine,
  PROTOCOL_VERSION,
  RANDOM_MAP,
  ROOM_CHAT_LIMIT,
  STATUS_NOTICE_BYTES,
} from "../server/protocol.ts";
import { MAX_PLAYERS, MEDALS_TO_WIN } from "../sim/constants.ts";
import { SCREEN_H, SCREEN_W } from "./hudLayout.ts";
import { isTeamMode, MODE_NAMES, TEAM_COUNT, teamName } from "../sim/modes.ts";
import type { GameMode, InputFrame, LevelLayout, MatchState, SimEvent } from "../sim/types.ts";
import { teamColor } from "./hudLayout.ts";
import type { MusicTrack } from "./audio.ts";
import { loadImage } from "./assets.ts";
import type { AuthState } from "./authLink.ts";
import { AuthLink } from "./authLink.ts";
import { resetBlindCentre } from "./blind.ts";
import { CaretBlink, chatRecall, commandCycle, gameRecall, keepRecall } from "./chat.ts";
import { ChatLine } from "./chatLine.ts";
import { GameView } from "./gameView.ts";
import { Balloons, closesExitBox, countdownEnd, enterOpensChat, helpAllowed, hostSilent, matchEscape, sendsChat } from "./matchChat.ts";
import { FrameRate, PingMeter } from "./panelBars.ts";
import type { BoxImages, BoxResult, PracticeBox } from "./practiceBox.ts";
import { boxClick, boxHover, boxKey, boxKeyCursor, boxPointer, drawPracticeBox, openBox } from "./practiceBox.ts";
import { startPracticeGame } from "./practiceGame.ts";
import type { ChatDraw } from "./renderer.ts";
import { addReply, deleteReply } from "./friends.ts";
import { connectedPad, padFrame } from "./gamepad.ts";
import type { KeyBinding } from "./input.ts";
import { attachKeyboard, boundCodes, isButtonActivation, KeyState, soloKeys, soloKeysHelp, VERSUS_KEYS } from "./input.ts";
import { banSlot, ChatTimers, chatSubmit, targetWhisper } from "./chatCommand.ts";
import type { LocalPlayer } from "./localGame.ts";
import { startLocalGame } from "./localGame.ts";
import type { LocalLists, LocalMode } from "./localRoom.ts";
import { answerLocal, LOCAL_IDS, localLists, localRoom, nextCharacter, VERSUS_RULES } from "./localRoom.ts";
import { macroOpens, macroSlot } from "./macro.ts";
import { mapChoices, mapTitle, portraitCanvas } from "./menu.ts";
import type { MyProfile } from "./lobbyScreen.ts";
import { CHARACTER_IDS, nickRefusal } from "./myInfoLayout.ts";
import type { LobbyState } from "./lobbyView.ts";
import { LobbyView } from "./lobbyView.ts";
import { listedTrack, playWaitingMusic } from "./music.ts";
import { NoticeLine } from "./noticeLine.ts";
import { MENU_SOUNDS } from "./presentation.ts";
import { RankingBoard } from "./ranking.ts";
import { chatEntry, chatLineClass, kickLine, shownChat, usersLine, whisperAllowLine, whisperLines } from "./roomChat.ts";
import { KICKED_TEXT, NOTICE } from "./roomLayout.ts";
import { loadRoomAssets, RoomScreen } from "./roomScreen.ts";
import { loadSceneAssets } from "./scene.ts";
import { attachCapture, resetCapture } from "./screenCapture.ts";
import type { GameScreen } from "./shell.ts";
import { CursorAnim, fadeOver, freezeCanvas, Pointer } from "./screenKit.ts";
import { gameScreen, mount, settings, sounds } from "./shell.ts";
import { newSlide } from "./startLayout.ts";
import type { LoginSent, ServerList, ServerRow, StartScene } from "./startScreen.ts";
import { AUTH_FAILED, LOGIN_FAILED } from "./startScreen.ts";
import { defaultServerUrl, StartView } from "./startView.ts";
import { STATUS_TEXT, statusNoticeLines } from "./statusLayout.ts";
import { newStatusState } from "./statusScreen.ts";
import { choiceGroup, h, readPreference, replaceChildrenKeepingFocus, writePreference } from "./ui.ts";

/** The match's keys as the option window set them. */
function keysHelp(): string {
  const { keys, control } = settings.current;
  return (
    `${soloKeysHelp(soloKeys(keys), control === 1)} · 채팅: Enter(보내기), Esc(취소), ↑(이전 줄), F2~F10(단축 메시지) · 도움말: F1 · ` +
    "나가기: Esc(첫 라운드 대기 화면에서는 바로, 그 밖에는 손님만 확인 상자). 방장은 경기 중 나갈 수 없습니다."
  );
}

/** Practice's keys (scene 9), for the screen reader's key help. */
function practiceKeysHelp(): string {
  const { keys, control } = settings.current;
  return `${soloKeysHelp(soloKeys(keys), control === 1)} · 채팅: Enter(보내기 Enter, 취소 Esc), F2~F10(단축 메시지) · 종료 상자: Esc · 도움말: F1 · 상자: ←/→와 Enter, Y/N 또는 마우스`;
}

/** Two players on one keyboard (VERSUS_KEYS). */
const VERSUS_KEYS_HELP = `1P: WASD · 폭탄 Space(왼쪽 Shift) · 공격용 Q · 회피용 E / 2P: 방향키 · 폭탄 Enter(오른쪽 Shift) · 공격용 오른쪽 Ctrl(.) · 회피용 ,(쉼표) · 먼저 ${MEDALS_TO_WIN}승 · 나가기: Esc`;

/** The server list's row for two players on this PC, under the server's (AGENTS.md: a remake row, R). */
const LOCAL_ROW: ServerRow = { name: "2인 대전", load: 0, ping: 0, colour: "#ffffff", local: true };
const AI_ROW: ServerRow = { name: "AI 대전", load: 0, ping: 0, colour: "#ffffff", local: true, ai: true };

/** hello refused (S->C 0x0a +8, 0x445970): 0 res#19, 2 and 3; another code keeps the old lines (0x44596e). */
const REFUSALS: Readonly<Record<number, string>> = {
  0: LOGIN_FAILED,
  2: "이미 로그인 되어 있습니다",
  3: "레벨이 맞지 않습니다",
};

/** res#37, which the original shows in a Windows box before its updater runs (0x4612f0). */
const VERSION_UPDATED = "버전이 업데이트 되었습니다\n업데이트된 버전을 다운 로드합니다.";

/** The logo and loading have shown in this page load. */
let startShown = false;
/** The load query's wait; the original's thread has none. */
const QUERY_TIMEOUT_MS = 5000;
/** 0x46abbc. */
const NETWORK_PROBLEM = "network problem!";

/** The row's name when the server does not answer: its address. */
function serverName(url: string): string {
  try {
    return new URL(url).hostname || url;
  } catch {
    return url;
  }
}

interface Welcome {
  playerId: number;
  maps: { id: string; title: string }[];
  music: string[];
}

/** Keep what the room's editors take: cp949 text under `limit` bytes. */
function fitBytes(input: HTMLInputElement, limit: number): void {
  const kept = cutBytes(typeable(input.value), limit - 1);
  if (kept !== input.value) input.value = kept;
}

/** Online mode: connection, lobby/room screens and the snapshot-driven game screen. */
export function mountOnline(manifest: Manifest): () => void {
  const session = new OnlineSession(manifest);
  session.showStart();
  return () => session.dispose();
}

class OnlineSession {
  private readonly manifest: Manifest;
  /** [0x496348]: cursor.spr outlives every menu, practice and match screen. */
  private readonly cursor = new CursorAnim();
  /** The auth server's connection, kept across the start's screens. */
  private readonly auth: AuthLink;
  /** The login's record (the lobby's copy once in one) and session; null before a login or without the auth server. */
  private account: OwnAccount | null = null;
  private token: string | null = null;
  private channels: ChannelRow[] = [];
  /** The page's form logged in to go straight into the first row. */
  private enterAfterLogin = false;
  /** Scene 5's 확인 or pw ▶ waits for its answer on the auth connection. */
  private statusSaving: "status" | "guild" | null = null;
  /** The current load query per row: its identity and send time for the ping. */
  private readonly asked = new Map<number, { requestId: number; at: number }>();
  private loadRequestId = 0;
  /** [0x49272c]: the game server has not answered the version yet; a close now means it is full. */
  private awaitingVersion = false;
  private socket: WebSocket | null = null;
  private welcome: Welcome | null = null;
  private lobby: LobbyState | null = null;
  /** Left the room for "network problem!"; its news is ignored until the server lets go of it. */
  private leftForProblem = false;
  /** Put out of the room (S->C 0x44): its screen stays under the message box until that closes. */
  private kicked = false;
  private lobbyView: LobbyView | null = null;
  /** The lobby's chat log (listbox 0x48c220), apart from the room's; cleared on each entry (0x418c60). */
  private lobbyLog: string[] = [];
  /** WAIT GAME: off on logging in, kept on the way back from a room (0x448c50, 0x449e50). */
  private lobbyWaitingOnly = false;
  /** The next lobby is the first since hello: it shows the F1 notice, a room's return does not. */
  private firstLobby = true;
  private room: RoomInfo | null = null;
  private roomView: RoomView | null = null;
  /** The room's chat log: kept across a match, cleared on create or join (0x418c60). */
  private chatLog: string[] = [];
  /** One set of send timers for the canvas line and the page's chat form (0x446200). */
  private timers = new ChatTimers();
  /** The last room request, so a joiner gets the F1 notice (a creator does not, 0x444ddc). */
  private lastAct: ClientMessage["type"] | null = null;
  private game: OnlineGame | null = null;
  private startView: StartView | null = null;
  /** The server list's slide, rows and choice, kept like the original's statics. */
  private readonly list: ServerList = { slide: newSlide(), rows: [], selected: -1, page: 0 };
  /** Scene 5's character, check and guild list place, kept like the original's statics. */
  private readonly status = newStatusState(readPreference("p1"));
  /** The list is fading out toward the lobby. */
  private leavingStart = false;
  /** The my-info window's data, from the account as the lobby's welcome and later answers give it. */
  private profile: MyProfile = { character: "", hue: 0, nick: "", greeting: "", useId: false };
  private errorLine: HTMLElement | null = null;
  private disposed = false;
  /** The fade over the screen mounted last (screenKit.fadeOver). */
  private stopVeil: (() => void) | null = null;
  /** Two players on one PC: the room kept in the page, whose choices last the session, and its chat. */
  private local: { room: RoomInfo; lists: LocalLists; log: string[]; mode: LocalMode } | null = null;
  /** Practice or a two-player match running on this PC. */
  private localGame: { stop(): void } | null = null;
  /** The ranking's list, scene 5's and the lobby window's. */
  private readonly ranking = new RankingBoard();
  /**
   * The lobby's saves on their way, oldest first. The greeting's (0x58) and the nickname's (0x57)
   * both come back as saved, one answer each in turn; a new connection waits for none.
   */
  private lobbySaves: ("greeting" | "nick")[] = [];
  /** The text of the greeting save on its way, which a nickname save carries in place of the old one. */
  private greetingSent: string | null = null;
  /** [0x4927c8]: the ID a slot's whisper icon or the lobby's ID popup chose; only an empty ID popup clears it. */
  private whisperTarget = "";
  /** [0x4927dc]: the one notice line the lobby, the room and the match draw. */
  private noticeLine = new NoticeLine();

  constructor(manifest: Manifest) {
    this.manifest = manifest;
    this.auth = new AuthLink({
      stateChanged: (state) => this.authStateChanged(state),
      receive: (message) => this.receiveAuth(message),
    });
  }

  dispose(): void {
    this.disposed = true;
    this.stopVeil?.();
    this.stopGame();
    // Each screen runs its own frame loop and window keys until disposed.
    this.startView?.dispose();
    this.startView = null;
    this.lobbyView?.dispose();
    this.lobbyView = null;
    this.roomView?.dispose();
    this.roomView = null;
    this.auth.dispose();
    this.socket?.close();
    this.socket = null;
  }

  // Screens

  /**
   * The start (logo 0xe → loading 1 → login 3 → server list 2). The logo and loading show once a
   * page load, as once a program start; later entries begin at the login.
   */
  showStart(options: { begin?: StartScene; fadeFrom?: HTMLCanvasElement; message?: string } = {}): void {
    if (this.disposed) return;
    this.stopVeil?.();
    this.roomView?.dispose();
    this.roomView = null;
    this.lobbyView?.dispose();
    this.lobbyView = null;
    this.startView?.dispose();
    const begin = options.begin ?? (startShown ? "login" : "logo");
    startShown = true;
    this.startView = new StartView({
      cursor: this.cursor,
      manifest: this.manifest,
      list: this.list,
      status: this.status,
      begin,
      fadeFrom: options.fadeFrom,
      message: options.message,
      actions: {
        startMusic: () => playWaitingMusic(sounds, this.manifest, "lobby"),
        account: () => this.account,
        authConnect: () => this.auth.connect(this.serverUrl),
        serverChanged: () => this.changeServer(),
        login: (id, password) => this.login(id, password),
        listServers: () => this.listServer(),
        practice: (character, hue) => this.startPractice(character, hue),
        saveCharacter: (character, hue, useId) => this.saveCharacter(character, hue, useId),
        saveStatus: (profile) => this.saveStatus("status", { type: "set-status", ...profile }),
        saveGuild: (guild) => this.saveStatus("guild", { type: "set-guild", guild }),
        ranking: this.ranking.access((message) => this.account !== null && this.auth.send(message), this.auth),
        characterChanged: (character) => writePreference("p1", character),
        // The web site's sign-up and checks go to the account server (R); a send that finds it gone
        // connects again, so the next try can go (the original made a new connection each time).
        register: (request) => this.authSend({ type: "register", ...request }),
        check: (kind, text) => this.authSend(kind === "id" ? { type: "check-id", id: text } : { type: "check-nick", nick: text }),
        connect: () => {
          const row = this.list.rows[this.list.selected];
          if (row?.local) this.openLocalRoom(row.ai ? "ai" : "versus");
          else this.enter(row?.channel ?? 0);
        },
        // The row's double click, dropped while a connection is under way (the busy cursor): a
        // row's, or the page form's login that goes on to one.
        local: (mode = "versus") => {
          if (!this.socket && !this.enterAfterLogin) this.openLocalRoom(mode);
        },
        enter: ({ id, password }) => this.formEnter(id, password),
        // A page cannot close its window: the program starts over, silent, from its logo, logged out.
        exit: () => {
          sounds.stopAll();
          this.auth.dispose();
          // A connection under way goes with the program, and so do the form's wait for one and the
          // fade out toward the lobby or the local room, whose screen goes too.
          this.dropSocket();
          this.enterAfterLogin = false;
          this.leavingStart = false;
          this.welcome = null;
          this.lobby = null;
          this.account = null;
          this.token = null;
          this.channels = [];
          this.list.rows = [];
          // The new program's statics: no whisper target, no last line to repeat (0x4927c8, 0x446200)
          // or to recall (0x497d00), the Down key's commands from the start ([0x497f24]), no ranking
          // rows ([0x48c2ac]), no F12 taken yet ([0x497f28]), the blind window's centre at (0,0)
          // ([0x471878]), an empty notice line (0x4927dc), the list's slide as it starts with no row
          // chosen, and scene 5 as the YES leaves it (0x4205e0): no guild chosen, no notices until
          // this login's S->C 0x101.
          this.whisperTarget = "";
          chatRecall.line = "";
          commandCycle.reset();
          this.ranking.reset();
          resetCapture();
          resetBlindCentre();
          this.timers = new ChatTimers();
          this.noticeLine = new NoticeLine();
          this.list.slide = newSlide();
          this.list.selected = -1;
          this.list.page = 0;
          Object.assign(this.status, newStatusState(readPreference("p1")));
          this.showStart({ begin: "logo" });
        },
      },
    });
    this.errorLine = this.startView.errorLine;
    mount(this.startView.root);
  }

  /**
   * The login's OK (C->S 0x0a to the auth server). Without the auth server, scene 5 opens with no
   * account: practice and local versus modes need none (R).
   */
  private login(id: string, password: string): LoginSent {
    switch (this.auth.state) {
      case "open":
        this.auth.send({ type: "login", id, password });
        return "sent";
      case "connecting":
        return "wait";
      default:
        this.account = null;
        this.token = null;
        this.channels = [];
        return "offline";
    }
  }

  private authSend(message: ClientMessage): boolean {
    if (this.auth.send(message)) return true;
    this.auth.connect(this.serverUrl);
    return false;
  }

  /** The page's form: the login, then the first row's lobby once the auth server answers. */
  private formEnter(id: string, password: string): void {
    // Logged in, the canvas offers no other login until the quit box's YES starts the program over.
    if (this.account && compareIgnoreCase(id, this.account.id) !== 0) {
      this.showError(`이미 ${this.account.id} 아이디로 로그인했습니다. 다른 아이디는 종료 상자의 YES로 다시 시작한 뒤 넣으세요.`);
      return;
    }
    if (this.auth.state !== "open") {
      this.auth.connect(this.serverUrl);
      this.showError("인증 서버에 접속하지 못했습니다. 잠시 뒤 다시 시도하세요.");
      return;
    }
    this.enterAfterLogin = true;
    this.startView?.connecting();
    this.auth.send({ type: "login", id, password });
  }

  /** Scene 5's Go game (the old C->S 0x1a's place): the character, hue and ID check, kept and saved to the account. */
  private saveCharacter(character: string, hue: number, useId: boolean): void {
    writePreference("p1", character);
    if (this.account) this.auth.send({ type: "set-character", character, hue, useId });
  }

  /** Scene 5's save on the auth connection, answered by saved or a refusal; false with nothing to send it to. */
  private saveStatus(kind: "status" | "guild", message: ClientMessage): boolean {
    this.statusSaving = this.account !== null && this.auth.send(message) ? kind : null;
    return this.statusSaving !== null;
  }

  private authStateChanged(state: AuthState): void {
    if (state !== "failed") return;
    if (this.statusSaving !== null) this.startView?.saveRefused(AUTH_FAILED);
    this.statusSaving = null;
    this.ranking.drop(this.auth);
    if (this.enterAfterLogin) {
      this.enterAfterLogin = false;
      this.showError("인증 서버에 접속하지 못했습니다.");
      this.startView?.formFailed();
    }
    this.startView?.authFailed();
  }

  /** The auth server's answers: the login (0x448ab0), the rows' loads, scene 5's saves. */
  private receiveAuth(message: ServerMessage): void {
    if (this.disposed) return;
    switch (message.type) {
      case "login":
        if (!message.ok) {
          this.enterAfterLogin = false;
          this.startView?.loginFailed();
          return;
        }
        this.account = message.account;
        this.token = message.token;
        this.channels = message.channels;
        // The options keep the ID of a login that worked (0x44d590).
        writePreference("online.name", message.account.id);
        this.startView?.loggedIn(message.account);
        if (this.enterAfterLogin) {
          this.enterAfterLogin = false;
          // The form stands for scene 5's Go game too, which saves what scene 5 shows first and
          // makes the list from the login's rows, in place of one made without the auth server.
          this.saveCharacter(CHARACTER_IDS[this.status.character], this.status.hue, this.status.useId);
          this.listServer();
          this.enter(0);
          // The login's answer ended the busy cursor; the form goes on to a row's connection, which keeps it.
          if (this.socket) this.startView?.connecting();
        }
        return;
      case "server-info":
        this.rowAnswered(message.channel, message.requestId, message.load);
        return;
      case "status-notice":
        // S->C 0x101 (0x45eb70, 0x41cdd0): the lines replace the last ones; an odd text is dropped.
        if (typeof message.text === "string" && cp949Bytes(message.text) <= STATUS_NOTICE_BYTES) this.status.notices = statusNoticeLines(message.text);
        return;
      case "registered":
        this.startView?.signUpAnswer("register", message.rcode);
        return;
      case "checked":
        this.startView?.signUpAnswer(message.kind, message.rcode);
        return;
      case "ranking":
      case "ranking-search":
        this.ranking.receive(message);
        return;
      case "saved":
        this.account = takeSaved(this.account, message.account);
        if (this.statusSaving === "status") this.startView?.statusSaved(this.account);
        else if (this.statusSaving === "guild") this.startView?.guildSaved();
        this.statusSaving = null;
        return;
      case "nick-refused":
      case "error":
        if (this.statusSaving === "guild") this.startView?.saveRefused(STATUS_TEXT.guildFailed);
        else if (this.statusSaving === "status") this.startView?.saveRefused(message.type === "error" ? message.message : message.code);
        this.statusSaving = null;
        return;
      default:
        return;
    }
  }

  /**
   * The login's reply zeroes each row's load and ping and asks for them (0x448be3): the auth
   * server's rows with their colours, then the remake's AI and keyboard rows. Without the auth server the one
   * row is this address's, shown as its connect failure (−1 ms, 1000 %), still selectable.
   */
  private listServer(): void {
    this.list.rows = this.account
      ? this.channels.map((row, channel) => ({ name: row.name, colour: row.colour, channel, load: 0, ping: 0 }))
      : [{ name: serverName(this.serverUrl), colour: "#ffffff", channel: 0, load: 1000, ping: -1 }];
    this.list.rows.push({ ...AI_ROW }, { ...LOCAL_ROW });
    this.list.selected = -1;
    this.list.page = 0;
    this.queryServers();
  }

  /**
   * The load queries (thread 0x448410, one per row): here each goes over the auth connection, the
   * ping from the send to the answer. A row not answered shows as the connect failure's.
   */
  private queryServers(): void {
    if (!this.account) return;
    for (const row of this.list.rows) {
      const channel = row.channel;
      if (channel === undefined || row.local) continue;
      const at = performance.now();
      const requestId = ++this.loadRequestId;
      this.asked.set(channel, { requestId, at });
      if (!this.auth.send({ type: "server-info", channel, requestId })) {
        this.rowAnswered(channel, requestId, null);
        continue;
      }
      setTimeout(() => {
        this.rowAnswered(channel, requestId, null);
      }, QUERY_TIMEOUT_MS);
    }
  }

  /** A row's answer, or null for none. */
  private rowAnswered(channel: number, requestId: number, load: number | null): void {
    const query = this.asked.get(channel);
    if (!query || query.requestId !== requestId) return;
    this.asked.delete(channel);
    const row = this.list.rows.find((r) => r.channel === channel && !r.local);
    if (!row) return;
    Object.assign(row, load === null ? { load: 1000, ping: -1 } : { load, ping: Math.round(performance.now() - query.at) });
    this.startView?.serverInfo(row);
  }

  private get serverUrl(): string {
    const url = this.startView?.serverUrl ?? readPreference("online.server") ?? defaultServerUrl();
    writePreference("online.server", url);
    return url;
  }

  /** A different server has different accounts and sessions: return to the existing login screen. */
  private changeServer(): void {
    const url = this.serverUrl;
    // During the logo/loading no auth connection exists yet; login will use the new setting.
    if (this.auth.url === null || this.auth.url === url) return;
    this.auth.dispose();
    this.dropSocket();
    this.account = null;
    this.token = null;
    this.channels = [];
    this.list.rows = [];
    this.list.selected = -1;
    this.list.page = 0;
    this.enterAfterLogin = false;
    this.leavingStart = false;
    this.welcome = null;
    this.lobby = null;
    this.room = null;
    this.statusSaving = null;
    this.ranking.reset();
    this.status.notices = [];
    this.noticeLine = new NoticeLine();
    this.startView?.resetLogin();
    this.auth.connect(url);
  }

  private showRoom(room: RoomInfo, change?: RoomChange): void {
    const welcome = this.welcome;
    if (!welcome || this.disposed) return;
    if (this.roomView?.code !== room.code) {
      const entering = this.roomView === null && this.lastAct === "join-room";
      this.lastAct = null;
      const from = this.shownPicture();
      // Create/join replies reset the global cursor before scene 7 (0x444e60, 0x445022).
      if (this.lobbyView) this.cursor.set(false);
      this.lobbyView?.dispose();
      this.lobbyView = null;
      this.roomView?.dispose();
      this.roomView = new RoomView(this.manifest, welcome, room, this.chatLog, {
        cursor: this.cursor,
        send: (message) => this.send(message),
        say: (text) => this.say(text),
        kickedOut: () => this.leaveKicked(),
        items: () => this.account?.items ?? [],
        whisperTo: (id) => {
          this.whisperTarget = id;
        },
        notice: this.noticeLine,
      });
      // The joiner's F1 hint (0x449dd6), only into an empty buffer.
      if (entering) this.noticeLine.hint(NOTICE.joinText, performance.now());
      this.errorLine = this.roomView.errorLine;
      mount(this.roomView.root);
      // Create, join (0x444e4b, 0x449e1b) and the final result's return (0x44fc09) fade.
      this.fadeTo(this.roomView.root, from);
      playWaitingMusic(sounds, this.manifest, "room");
    }
    this.roomView.update(room, change);
  }

  /**
   * The lobby (scene 4): shown after hello and on leaving a room (0x449fa6). From the server list
   * it comes with the fade (0x449172): the list fades out, the lobby fades in.
   */
  private showLobby(fadeIn = false, music = true): void {
    // Put out of a room, the lobby waits for the message box (0x44a1db).
    if (this.kicked) return;
    const { welcome, lobby } = this;
    if (!welcome || !lobby || this.room || this.game || this.disposed) return;
    if (this.lobbyView) {
      this.lobbyView.update(lobby);
      return;
    }
    const startView = this.startView;
    if (startView) {
      if (this.leavingStart) return;
      this.leavingStart = true;
      this.lobbyLog = [];
      startView.leave(() => {
        this.leavingStart = false;
        if (this.startView !== startView) return;
        startView.dispose();
        this.startView = null;
        this.showLobby(true);
      });
      return;
    }
    // From a room or a match: the leave reply (0x44a015) and EXITGAME (0x44f8f9) fade.
    const from = this.shownPicture();
    this.roomView?.dispose();
    this.roomView = null;
    // Chat that came during the fade from the list is kept; a room's return starts empty (0x449e50).
    if (!fadeIn) this.lobbyLog = [];
    this.lobbyView = new LobbyView(welcome, lobby, this.lobbyLog, this.lobbyWaitingOnly, {
      cursor: this.cursor,
      send: (message) => this.send(message),
      say: (text) => this.say(text),
      exit: (askServers) => this.exit(askServers),
      filterChanged: (waitingOnly) => {
        this.lobbyWaitingOnly = waitingOnly;
      },
      profile: this.profile,
      account: () => this.account,
      saveCharacter: (character, hue, useId) => this.send({ type: "set-character", character, hue, useId }),
      saveGreeting: (greeting) => {
        this.lobbySaves.push("greeting");
        this.greetingSent = greeting;
        this.send({ type: "set-greeting", greeting });
      },
      // C->S 0x57's place: scene 5's save with the greeting (the one on its way, if any) and the ID
      // check as saved, so only the nick changes (R).
      saveNick: (nick) => {
        this.lobbySaves.push("nick");
        this.send({ type: "set-status", nick, greeting: this.greetingSent ?? this.profile.greeting, useId: this.profile.useId });
      },
      whisperTo: (id) => {
        this.whisperTarget = id;
      },
      settings,
      notice: this.noticeLine,
      ranking: this.ranking.access((message) => {
        if (this.socket?.readyState !== WebSocket.OPEN) return false;
        this.send(message);
        return true;
      }, this.socket),
    }, false);
    // The F1 hint on the first lobby (0x44911e), only into an empty buffer: a live S->C 0x50 stays.
    if (this.firstLobby) this.noticeLine.hint(NOTICE.joinText, performance.now());
    this.firstLobby = false;
    this.errorLine = this.lobbyView.errorLine;
    mount(this.lobbyView.root);
    this.fadeTo(this.lobbyView.root, from, fadeIn);
    if (music) playWaitingMusic(sounds, this.manifest, "lobby");
  }

  /**
   * EXIT (0x459d4b), 채널변경 (0x459b2c) or Esc (0x46181e): disconnect and fade back to the server
   * list. EXIT alone then zeroes every row's load and ping and asks again (0x459d94); the others keep them.
   */
  private exit(askServers: boolean): void {
    const socket = this.socket;
    this.socket = null;
    this.ranking.drop(socket);
    this.dropLobbySaves();
    this.welcome = null;
    this.lobby = null;
    this.room = null;
    socket?.close();
    this.backToList(undefined, askServers);
  }

  /** Scene 2 with fade(1) from whatever screen is up (0x459d8c, FD_CLOSE 0x460eb7); the row let go. */
  private backToList(message?: string, askServers = false): void {
    const fadeFrom = this.shownPicture() ?? undefined;
    this.stopGame();
    this.list.selected = -1;
    this.showStart({ begin: "servers", fadeFrom, message });
    // The page's form skips the login that fills the list; the row is still needed to connect again.
    if (this.list.rows.length === 0) this.listServer();
    else if (askServers && this.account) {
      for (const row of this.list.rows) Object.assign(row, { load: 0, ping: 0 });
      this.queryServers();
    }
  }

  /** A line typed in the lobby or the room (0x446200): chat, or a command. */
  private say(text: string): void {
    // A kick notice drops the line before it can change the timers or the last sent text.
    if (this.kicked) return;
    const line = chatLine(text);
    if (line === null) return;
    const now = performance.now();
    const submit = chatSubmit(line, this.room !== null);
    const whisper = targetWhisper(this.whisperTarget, submit);
    if (whisper) this.send({ type: "whisper", ...whisper });
    switch (submit.kind) {
      case "chat":
        if (this.timers.chat(submit.text, now)) this.send({ type: "chat", text: submit.text });
        break;
      case "whisper":
        if (this.timers.whisper(now) && submit.line) this.send({ type: "whisper", ...submit.line });
        break;
      case "clear":
        this.clearChat();
        break;
      case "users":
        if (this.timers.users(now)) this.send({ type: "users" });
        break;
      case "whisper-allow":
        this.send({ type: "whisper-allow", on: submit.on });
        break;
      case "go":
        this.send({ type: "join-number", number: submit.index });
        break;
      case "ban":
        this.ban(submit.name);
        break;
    }
  }

  /** /ban (0x4464e3): the room's host only; the first slot whose ID matches, and the busy cursor (0x4465ae). */
  private ban(name: string): void {
    const room = this.room;
    if (!room || this.game || room.hostId !== this.welcome?.playerId) return;
    const slot = banSlot(room.players, name);
    if (slot === null) return;
    this.send({ type: "kick", slot });
    this.roomView?.waitForKick();
  }

  /** S->C 0x44 (0x44a040): for the own slot the message box, for another its line; the room's update drops the slot. */
  private kickArrived(slot: number): void {
    const out = this.room?.players.find((p) => p.slot === slot);
    if (!out) return;
    if (out.id === this.welcome?.playerId) {
      this.kicked = true;
      this.roomView?.showKicked();
    } else {
      this.addLine(kickLine(shownName(out)));
    }
  }

  /**
   * The kick notice's button or Esc (0x4588f3, 0x461686): the lobby's lists asked again with both
   * logs cleared (0x44b2b0), then the lobby with the fade; no music call, so the room's tune plays on.
   */
  private leaveKicked(): void {
    if (!this.kicked) return;
    this.kicked = false;
    this.room = null;
    this.chatLog = [];
    this.showLobby(false, false);
  }

  /** /cls, /clear (0x418c60): the lobby's log and the room's, both. */
  private clearChat(): void {
    this.lobbyLog.length = 0;
    this.chatLog.length = 0;
    this.lobbyView?.clearChat();
    this.roomView?.clearChat();
  }

  /** CHAT_addLine (0x418a80): to the lobby's log in the lobby, the room's in the room; lost anywhere else. */
  private addLine(line: string): void {
    if (this.game) return;
    if (this.roomView) {
      this.chatLog.push(line);
      this.roomView.addChat(line);
    } else if (this.lobbyView) {
      this.lobbyLog.push(line);
      this.lobbyView.addChat(line);
    }
  }

  private showError(text: string): void {
    if (this.errorLine) this.errorLine.textContent = text;
  }

  // Connection

  /**
   * A row's game server (0x4441c0): on connect the version (C->S 0x47), on its answer the login's
   * session (C->S 0x0a); the server answers with welcome, then the lobby.
   */
  private enter(channel: number): void {
    const url = this.serverUrl;
    sounds.unlock();
    this.showError("");
    if (this.socket) return; // one game server at a time
    this.firstLobby = true;
    this.lobbyWaitingOnly = false;
    this.awaitingVersion = false;
    let socket: WebSocket;
    try {
      socket = new WebSocket(url);
    } catch (error) {
      this.showError(`서버 주소가 올바르지 않습니다: ${(error as Error).message}`);
      this.startView?.connectFailed();
      return;
    }
    this.socket = socket;
    this.showError("서버에 연결하는 중…");
    let opened = false;
    socket.addEventListener("open", () => {
      opened = true;
      this.showError("");
      this.awaitingVersion = true;
      this.send({ type: "version", version: PROTOCOL_VERSION, channel });
    });
    socket.addEventListener("message", (event) => {
      if (this.socket !== socket) return;
      try {
        this.receive(JSON.parse(String(event.data)) as ServerMessage);
      } catch (error) {
        console.error("bad server message", error);
      }
    });
    socket.addEventListener("close", () => {
      if (this.socket !== socket) return;
      this.ranking.drop(socket);
      this.dropLobbySaves();
      const full = this.awaitingVersion;
      this.awaitingVersion = false;
      this.socket = null;
      this.welcome = null;
      this.lobby = null;
      this.room = null;
      this.leftForProblem = false;
      this.kicked = false;
      this.leavingStart = false;
      if (this.disposed) return;
      // FD_CLOSE before the version's answer: the server is full (0x460dde). FD_CONNECT's error
      // (0x460edc), or FD_CLOSE (0x460dbe) on the list or on any later screen.
      if (this.startView) {
        if (full) this.startView.serverFull();
        else if (opened) this.startView.disconnected();
        else this.startView.connectFailed();
        return;
      }
      this.backToList("서버로 부터 접속이\n끊어졌습니다");
    });
  }

  private send(message: ClientMessage): void {
    // Out of the room, nothing more goes from its screen; the page's leave button closes the notice.
    if (this.kicked) {
      if (message.type === "leave-room") this.leaveKicked();
      return;
    }
    if (message.type === "create-room" || message.type === "join-room" || message.type === "join-number") {
      this.lastAct = message.type === "create-room" ? "create-room" : "join-room";
      // SEND_create and SEND_join (0x448790, 0x448800) lock the input and show the busy cursor until the answer.
      this.lobbyView?.waitForRoom();
    }
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(message));
  }

  private receive(message: ServerMessage): void {
    if (this.disposed) return;
    // Any data from the host resets its silence clock (0x4471d3); the server is the host here.
    this.game?.heard(performance.now());
    switch (message.type) {
      case "version":
        // S->C 0x47 (0x445378): another version reloads the page as the updater would run.
        this.awaitingVersion = false;
        if (message.version !== PROTOCOL_VERSION) this.versionMismatch();
        else this.send({ type: "hello", token: this.token ?? "" });
        break;
      case "refused":
        // S->C 0x0a's failure (0x444b58): the message, the row let go, the socket gone.
        this.dropSocket();
        this.startView?.refused(REFUSALS[message.code] ?? LOGIN_FAILED);
        break;
      case "welcome": {
        // Game-server S->C 0x0a ends the row's wait before the lobby data arrives (0x444b58).
        if (this.startView) this.startView.connected();
        else this.cursor.set(false);
        this.welcome = { playerId: message.playerId, maps: message.maps, music: message.music };
        const { character, hue, nick, greeting, useId } = message.account;
        this.account = message.account;
        Object.assign(this.profile, { character, hue, nick, greeting, useId });
        break;
      }
      case "lobby":
        // Lobby news goes only to players in no room: the room left for "network problem!" is gone.
        this.leftForProblem = false;
        this.lobby = { channel: message.channel, rooms: message.rooms, users: message.users };
        this.showLobby();
        break;
      case "notice":
        // S->C 0x50 (0x44579f), in any scene: the buffer the screens draw from.
        this.noticeLine.receive(message.text, performance.now());
        break;
      case "lobby-chat":
        this.lobbyLog.push(chatEntry({ kind: "talk", name: message.name, text: message.text }));
        this.lobbyView?.addChat(this.lobbyLog.at(-1)!);
        break;
      case "room-info":
        this.lobbyView?.showRoomInfo(message);
        break;
      case "ranking":
      case "ranking-search":
        this.ranking.receive(message);
        break;
      case "friends":
        this.lobbyView?.friendsAnswered(message.friends);
        break;
      case "friend-added":
        this.lobbyView?.friendReplied(addReply(message.result, message.name));
        break;
      case "friend-deleted":
        this.lobbyView?.friendReplied(deleteReply(message.result, message.name));
        break;
      case "whisper":
        for (const line of whisperLines(message.from, message.text)) this.addLine(line);
        break;
      case "users":
        this.addLine(usersLine(message.count));
        break;
      case "whisper-allowed":
        this.addLine(whisperAllowLine(message.on));
        break;
      case "join-password":
        this.lobbyView?.passwordAsked(message.code);
        break;
      case "kick":
        // S->C 0x44 (0x4452e0): the busy cursor goes off whatever it says.
        this.cursor.set(false);
        this.roomView?.refused();
        if (message.ok) this.kickArrived(message.slot);
        break;
      case "profile": {
        // S->C 0x1a: the server's values stick (findings: only a success keeps the choice).
        const { character, hue, useId } = message;
        Object.assign(this.profile, { character, hue, useId });
        if (this.account) Object.assign(this.account, { character, hue, useId });
        writePreference("p1", character);
        this.lobbyView?.profileSaved();
        break;
      }
      case "saved":
        // S->C 0x58 or 0x57: the greeting or the nick is the server's copy.
        this.account = takeSaved(this.account, message.account);
        this.profile.greeting = message.account.greeting;
        this.profile.nick = message.account.nick;
        if (this.lobbySaveAnswered() === "nick") this.lobbyView?.nickSaved();
        else this.lobbyView?.greetingSaved();
        break;
      case "nick-refused":
        // 0x44b080: the message box, and the popup stays.
        this.lobbySaveAnswered();
        this.lobbyView?.showMessage(nickRefusal(message.code));
        break;
      case "room":
        // S->C 0x45/0x2e always reset the global cursor, including identical or ignored room data.
        if (message.change === "slot" || message.change === "team") this.cursor.set(false);
        // Put out, the room's screen stays under the message box; the server has let go of the player.
        if (this.kicked) {
          if (!message.room) this.room = null;
          break;
        }
        // After "network problem!" the room stays left, whatever the server still says of it.
        if (this.leftForProblem) {
          if (message.room) break;
          this.leftForProblem = false;
        }
        if (message.room && message.room.code !== this.room?.code) this.chatLog = [];
        this.room = message.room;
        if (!message.room) {
          this.stopGame();
          this.showLobby();
        } else if (!this.game) {
          this.showRoom(message.room, message.change);
        } else {
          this.game.hostChanged(message.room.hostId);
        }
        break;
      case "match-start":
        // S->C 0x25 sets the global cursor before its room/scene checks (0x445128, 0x44a281).
        this.cursor.set(false);
        if (this.room && this.welcome) this.startGame(message.layout, message.music, this.room, this.welcome.playerId);
        break;
      case "snapshot":
        this.game?.snapshot(message.state, message.events, message.typing, message.bars);
        break;
      case "pong":
        this.game?.pong(message.at);
        break;
      case "game-chat":
        this.game?.chatReceived(message.playerId, message.text);
        break;
      case "chat":
        // Room lines that come during a match are lost (0x444e9b, 0x418a80).
        if (this.game) break;
        this.chatLog.push(chatEntry(message));
        this.roomView?.addChat(this.chatLog.at(-1)!);
        break;
      case "match-end":
        this.stopGame();
        if (this.room) this.showRoom(this.room);
        break;
      case "error":
        // Refused before the lobby: as hello's refusal, the message, the row let go, the socket gone.
        if (this.startView && !this.welcome) {
          this.dropSocket();
          this.startView.refused(message.message);
          break;
        }
        this.showError(message.message);
        this.lobbyView?.refused(message.message);
        // In the room the server's refusals come as system lines of the chat log (0x44a260).
        if (this.roomView) {
          this.chatLog.push(`sys${message.message}`);
          this.roomView.addChat(this.chatLog.at(-1)!);
          this.roomView.refused();
        }
        break;
    }
  }

  /** The oldest lobby save on its way has its answer. */
  private lobbySaveAnswered(): "greeting" | "nick" | undefined {
    const saving = this.lobbySaves.shift();
    if (!this.lobbySaves.includes("greeting")) this.greetingSent = null;
    return saving;
  }

  private dropLobbySaves(): void {
    this.lobbySaves = [];
    this.greetingSent = null;
  }

  /** The game socket let go of by the page, so its close is not a lost connection. */
  private dropSocket(): void {
    const socket = this.socket;
    this.socket = null;
    this.ranking.drop(socket);
    this.dropLobbySaves();
    this.awaitingVersion = false;
    socket?.close();
  }

  /** The version check failed (0x4d6 → 0x4612f0): the box, then the page loads again (the updater's run). */
  private versionMismatch(): void {
    this.dropSocket();
    let reloaded = false;
    const reload = () => {
      if (reloaded) return;
      reloaded = true;
      location.reload();
    };
    if (this.startView) this.startView.showMessage(VERSION_UPDATED, reload);
    else reload();
  }

  private startGame(layout: LevelLayout, music: number, room: RoomInfo, playerId: number): void {
    const from = this.shownPicture();
    this.stopGame();
    this.roomView?.dispose();
    this.roomView = null;
    // 0x44a3d4: the room tune stops with the start itself, before the world load, however that goes.
    sounds.stopMusic();
    const screen = gameScreen(`온라인 대전 · 방 ${room.code}`, keysHelp(), () => this.send({ type: "leave-room" }));
    this.errorLine = null;
    mount(screen.root);
    // 0x44a424: the room's last frame stays while the world loads, then fades to the wait screen.
    this.fadeTo(screen.root, from);
    const track = listedTrack(this.manifest, this.welcome?.music ?? [], music);
    const candy = this.account?.candy ?? 0;
    this.game = new OnlineGame(screen, layout, room, playerId, track, candy, this.noticeLine, this.cursor, (message) => this.send(message), () => this.networkProblem());
  }

  private stopGame(keepMusic = false): void {
    // The candy picked up counted on the client as it went (0x410827): the login's count grows by it.
    if (this.game && this.account) this.account.candy += this.game.candy;
    this.game?.stop(keepMusic);
    this.game = null;
    this.localGame?.stop();
  }

  // This PC: practice, AI, and two players on one keyboard

  /**
   * Practice (0x4542d0, scene 9) with the character scene 5 chose. Its Esc box's YES goes to the
   * server list (0x458bc5) and its time limit to scene 5 (0x406235), each with the fade.
   */
  private startPractice(character: string, hue: number): void {
    this.runLocal("혼자 연습", practiceKeysHelp(), this.shownPicture(), () => this.backToList(), (screen, finish, cancelled, failed, signal) =>
      startPracticeGame({
        canvas: screen.canvas,
        cursor: this.cursor,
        local: { id: 1, name: readPreference("online.name") || "1P", character },
        hue,
        sounds,
        settings: settings.current,
        announce: screen.announce,
        onExit: () => finish(() => this.backToList()),
        setExitAction: screen.setExitAction,
        onTimeUp: () => finish(() => this.backToStatus()),
        onFailed: failed,
        badge: this.account ? badgeOf(this.account) : undefined,
        cancelled,
        signal,
      }),
    );
  }

  /** Practice's time limit (0x406224): scene 5 again (0x41f030) with the fade. */
  private backToStatus(): void {
    const fadeFrom = this.shownPicture() ?? undefined;
    this.stopGame();
    this.showStart({ begin: "status", fadeFrom });
  }

  /** A local row chosen twice: the list fades out and the room in, as 2→4 does for the lobby. */
  private openLocalRoom(mode: LocalMode = "versus"): void {
    if (this.local?.mode !== mode) this.local = null;
    const startView = this.startView;
    if (!startView) {
      this.showLocalRoom(this.shownPicture(), mode);
      return;
    }
    if (this.leavingStart) return;
    this.leavingStart = true;
    startView.leave(() => {
      this.leavingStart = false;
      if (this.startView !== startView) return;
      startView.dispose();
      this.startView = null;
      // The local row completes the same connection wait before drawing the room (R).
      this.cursor.set(false);
      this.showLocalRoom(null, mode);
    });
  }

  /** The local room on the GAME ROOM screen, faded in from `from` (or from black). */
  private showLocalRoom(from: HTMLCanvasElement | null, mode: LocalMode = this.local?.mode ?? "versus"): void {
    if (this.disposed) return;
    const saved = (key: string, fallback: string) => {
      const name = readPreference(key) ?? fallback;
      return this.manifest.characters.includes(name) ? name : this.manifest.characters[0];
    };
    const lists = localLists(this.manifest);
    const opponent = mode === "ai" ? (this.manifest.characters.includes("doona") ? "doona" : this.manifest.characters[0]) : saved("p2", "doona");
    this.local ??= { lists, room: localRoom(lists, [saved("p1", "bobo"), opponent], mode), log: [], mode };
    const local = this.local;
    if (mode === "ai") {
      // As scene 5's Go game does for scene 8, carry the chosen character, hue and ID check.
      const character = CHARACTER_IDS[this.status.character];
      Object.assign(local.room.players[0], {
        character: this.manifest.characters.includes(character) ? character : this.manifest.characters[0],
        hue: this.status.hue,
        useId: this.status.useId,
      });
      if (this.account) {
        const { id, nick, wins, cell } = this.account;
        Object.assign(local.room.players[0], { name: id, nick, wins, cell, badge: badgeOf(this.account) });
      }
    }
    const welcome: Welcome = { playerId: LOCAL_IDS[0], maps: local.lists.maps, music: local.lists.music };
    this.roomView?.dispose();
    this.roomView = new RoomView(this.manifest, welcome, structuredClone(local.room), local.log, {
      cursor: this.cursor,
      send: (message) => this.localSend(message),
      say: (text) => this.localSay(text),
      kickedOut: () => undefined,
      pickCharacter: mode === "versus" ? (slot) => this.pickLocalCharacter(slot) : undefined,
    });
    this.errorLine = this.roomView.errorLine;
    mount(this.roomView.root);
    this.fadeTo(this.roomView.root, from);
    playWaitingMusic(sounds, this.manifest, "room");
  }

  /** What the room's screen sends, answered as the server's room would (localRoom.ts). */
  private localSend(message: ClientMessage): void {
    const local = this.local;
    if (!local) return;
    const answer = answerLocal(local.room, local.lists, message);
    // A refusal also ends the busy cursor a slot click set.
    if (!answer) this.roomView?.refused();
    else if (answer.kind === "changed") this.roomView?.update(structuredClone(local.room));
    else if (answer.kind === "start") this.startLocalMatch(answer.mapId, answer.music);
    else {
      // The EXIT box's YES: back to the server list, with the waiting tune of the list (0x460add).
      this.backToList();
      playWaitingMusic(sounds, this.manifest, "lobby");
    }
  }

  /** The room's chat stays on this PC: 1P speaks, and /cls clears the log. */
  private localSay(text: string): void {
    const local = this.local;
    const line = chatLine(text);
    if (!local || line === null) return;
    const submit = chatSubmit(line, true);
    if (submit.kind === "clear") {
      // In place: the room's screen takes this array once its art is in.
      local.log.length = 0;
      this.roomView?.clearChat();
      return;
    }
    if (submit.kind !== "chat" || !this.timers.chat(submit.text, performance.now())) return;
    const entry = chatEntry({ kind: "talk", name: shownName(local.room.players[0]), text: submit.text });
    local.log.push(entry);
    this.roomView?.addChat(entry);
  }

  /** A seated slot clicked: that player's next character, kept for the next time (R). */
  private pickLocalCharacter(slot: number): void {
    const local = this.local;
    const player = local?.room.players.find((p) => p.slot === slot);
    if (!local || local.mode !== "versus" || !player) return;
    player.character = nextCharacter(this.manifest.characters, player.character);
    writePreference(slot === 0 ? "p1" : "p2", player.character);
    // The secondary click, as scene 5's character arrows sound (0x26).
    sounds.play(MENU_SOUNDS.secondary);
    this.roomView?.update(structuredClone(local.room));
  }

  /** START: fade to the match; its final result or an allowed exit fades back to the room. */
  private startLocalMatch(mapId: string, music: number): void {
    const local = this.local;
    if (!local) return;
    const from = this.shownPicture();
    this.roomView?.dispose();
    this.roomView = null;
    // As at 0x44a3d4, stop the room tune before waiting for the world's pictures.
    sounds.stopMusic();
    const ai = local.mode === "ai";
    const players: LocalPlayer[] = local.room.players.map((p, i) => {
      const setup = { id: p.id, name: p.name, character: p.character };
      return ai && i === 1 ? { setup, ai: true } : { setup, binding: ai ? soloKeys(settings.current.keys) : VERSUS_KEYS[i] };
    });
    const back = () => this.showLocalRoom(this.shownPicture());
    const help = ai ? `${keysHelp()} · 먼저 ${MEDALS_TO_WIN}승` : VERSUS_KEYS_HELP;
    this.runLocal(local.room.title, help, from, back, (screen, finish, cancelled, _failed, signal) =>
      startLocalGame({
        canvas: screen.canvas,
        cursor: this.cursor,
        levelId: mapId,
        players,
        settings: ai ? settings.current : undefined,
        tints: ai ? local.room.players.map((p) => ({ id: p.id, character: p.character, hue: p.hue, face: true, head: true })) : undefined,
        people: ai ? new Map(local.room.players.map((p) => [p.id, { name: shownName(p), badge: p.badge }])) : undefined,
        candyBase: ai ? this.account?.candy : undefined,
        rules: VERSUS_RULES,
        sounds,
        music: listedTrack(this.manifest, local.lists.music, music),
        announce: screen.announce,
        onExit: () => finish(back),
        setExitAction: screen.setExitAction,
        cancelled,
        signal,
      }),
    );
  }

  /**
   * A game screen for a match on this PC, faded in from `from`. `start` runs it and calls `finish`
   * with what comes next when it ends; the page's hidden exit button finishes it with `leave`,
   * `cancelled` tells a start still loading that it was, and `failed` tells a load that failed later.
   */
  private runLocal(
    title: string,
    keys: string,
    from: HTMLCanvasElement | null,
    leave: () => void,
    start: (
      screen: GameScreen,
      finish: (then: () => void) => void,
      cancelled: () => boolean,
      failed: (error: unknown) => void,
      signal: AbortSignal,
    ) => Promise<() => void>,
  ): void {
    this.stopGame();
    this.startView?.dispose();
    this.startView = null;
    let running: (() => void) | null = null;
    let over = false;
    const cancel = new AbortController();
    const finish = (then: () => void) => {
      if (over) return;
      over = true;
      cancel.abort();
      running?.();
      if (this.localGame === entry) this.localGame = null;
      then();
    };
    const entry = { stop: () => finish(() => undefined) };
    const screen = gameScreen(title, keys, () => finish(leave));
    this.localGame = entry;
    this.errorLine = null;
    mount(screen.root);
    this.fadeTo(screen.root, from);
    const failed = (error: unknown) => screen.failed(`시작하지 못했습니다: ${(error as Error).message}`);
    start(screen, finish, () => over, failed, cancel.signal).then(
      (stop) => {
        if (over) stop();
        else {
          running = stop;
          screen.loaded();
        }
      },
      failed,
    );
  }

  /**
   * The host silent 5 s in play (0x40bf99-0x40c003): leave the room (C->S 0x4e, 0x05), clean up
   * with no music call (0x44f4e0, so the game's tune goes on), "network problem!" (0x46abbc) and the
   * lobby with its fade, before any answer.
   */
  private networkProblem(): void {
    this.send({ type: "leave-room" });
    this.leftForProblem = true;
    this.stopGame(true);
    this.room = null;
    this.chatLog = [];
    this.showLobby(false, false);
    this.lobbyView?.showMessage(NETWORK_PROBLEM);
  }

  /** The screen shown now, frozen for the fade to the next: the fade out does not redraw it (0x405e08). */
  private shownPicture(): HTMLCanvasElement | null {
    const canvas = document.querySelector<HTMLCanvasElement>("canvas.game-canvas");
    return canvas ? freezeCanvas(canvas) : null;
  }

  /** fade(1) onto the screen just mounted. */
  private fadeTo(root: HTMLElement, from: HTMLCanvasElement | null, inOnly = false): void {
    this.stopVeil?.();
    const stage = root.querySelector<HTMLElement>(".stage");
    this.stopVeil = stage ? fadeOver(stage, from, inOnly) : null;
  }
}

/**
 * The room as page controls. The original's room is a mouse screen; these stay as the keyboard and
 * screen reader path. Only the host has START; a guest's START is ready (0x45a412).
 */
interface RoomActions {
  cursor?: CursorAnim;
  send(message: ClientMessage): void;
  /** A chat line, through the session's send rule. */
  say(text: string): void;
  /** The kick notice closed: on to the lobby. */
  kickedOut(): void;
  /** Two players on one PC only: the next character for a seated slot. */
  pickCharacter?(slot: number): void;
  /** The account's items, which light the slot icons; none in the local room. */
  items?(): readonly number[];
  /** A slot's whisper icon: the whisper target. */
  whisperTo?(id: string): void;
  /** The session's notice line; the local room has none. */
  notice?: NoticeLine;
}

class RoomView {
  readonly root: HTMLElement;
  readonly errorLine: HTMLElement;
  readonly code: string;
  private readonly welcome: Welcome;
  private readonly manifest: Manifest;
  /** The page's controls: what a release on the canvas sends, dropped where the canvas drops it. */
  private readonly send: (message: ClientMessage) => void;
  private readonly canvas = h("canvas", {
    width: SCREEN_W,
    height: SCREEN_H,
    class: "game-canvas",
    role: "img",
    "aria-label": "대기실 화면. 마우스로 조작하며, 같은 기능이 아래 버튼에도 있습니다.",
  });
  private readonly loading = h("p", { class: "loading", role: "status" }, "대기실을 불러오는 중…");
  private readonly stage = h("div", { class: "stage" }, this.canvas, this.loading);
  private screen: RoomScreen | null = null;
  private room: RoomInfo | null = null;
  private kicked = false;
  private disposed = false;
  private readonly heading = h("span", {});
  private readonly slots = h("ul", { class: "roster", "aria-label": "자리" });
  private readonly mapSection = h("div", {});
  private readonly musicSection = h("div", {});
  private readonly modeSection = h("div", {});
  private readonly teamNote = h("p", { class: "note" });
  /** SELECTTEAM's six buttons, built once so focus stays put across room updates. */
  private readonly teamButtons = Array.from({ length: TEAM_COUNT }, (_, i) =>
    h(
      "button",
      {
        class: "btn small team-button",
        type: "button",
        style: `--team: ${teamColor(i + 1)}`,
        "aria-pressed": "false",
        onclick: () => this.send({ type: "set-team", team: i + 1 }),
      },
      teamName(i + 1),
    ),
  );
  private readonly teamSection = h(
    "fieldset",
    { class: "choices" },
    h("legend", {}, "팀"),
    h("div", { class: "team-grid" }, ...this.teamButtons),
    this.teamNote,
  );
  private readonly readyButton = h("button", { class: "btn", type: "button", "aria-pressed": "false" }, "준비");
  private readonly startButton = h("button", { class: "btn primary", type: "button" }, "시작");
  private readonly startHint = h("p", { class: "note", role: "status" });
  private readonly chatList = h("ol", { class: "chat-log", "aria-label": "채팅", "aria-live": "polite" });
  private readonly chatInput = h("input", { id: "room-chat", autocomplete: "off" });
  private ownName = "";
  private hostId = -1;
  private ready = false;
  private readonly pickCharacter: ((slot: number) => void) | undefined;
  private readonly items: () => readonly number[];

  constructor(manifest: Manifest, welcome: Welcome, room: RoomInfo, chatLog: readonly string[], actions: RoomActions) {
    const { send, say } = actions;
    this.pickCharacter = actions.pickCharacter;
    this.items = actions.items ?? (() => []);
    this.manifest = manifest;
    this.welcome = welcome;
    this.code = room.code;
    this.send = (message) => {
      if (!this.screen?.dropsClicks) send(message);
      // The browser has already moved the radio of a pick the canvas drops: back to the room's value.
      else if (this.room) this.syncChoices(this.room);
    };
    this.errorLine = h("p", { class: "error", role: "alert" });
    this.readyButton.addEventListener("click", () => this.send({ type: "set-ready", ready: !this.ready }));
    this.startButton.addEventListener("click", () => this.send({ type: "start" }));
    this.chatInput.addEventListener("input", () => fitBytes(this.chatInput, ROOM_CHAT_LIMIT));
    const submitChat = (event: Event) => {
      event.preventDefault();
      // The canvas's line sends nothing while the EXIT box takes the keys; the form keeps its text as the line does.
      if (this.screen?.boxUp) return;
      keepRecall(this.chatInput.value);
      say(this.chatInput.value);
      this.chatInput.value = "";
    };
    this.root = h(
      "main",
      { class: "screen lobby shake" },
      h(
        "header",
        { class: "toolbar" },
        h("button", { class: "btn small", type: "button", onclick: () => this.screen ? this.screen.leaveRoom() : send({ type: "leave-room" }) }, "← 방 나가기"),
        h(
          "h1",
          { tabindex: "-1" },
          this.heading,
          " · 코드 ",
          h("span", { class: "room-code", "data-testid": "room-code" }, room.code),
        ),
      ),
      this.stage,
      h(
        "p",
        { class: "keys" },
        `친구에게 방 코드 ${room.code}를 알려 주세요. 대기실 화면에서 바로 채팅할 수 있고, F2~F10은 옵션의 단축 메시지를 채팅 줄에 넣습니다. F1은 도움말 화면(다시 F1이나 Esc로 닫기), Esc는 나가기 확인 상자(예 Y·아니오 N)입니다. ${keysHelp()}`,
      ),
      this.slots,
      this.modeSection,
      this.teamSection,
      this.mapSection,
      this.musicSection,
      h("div", { class: "actions" }, this.readyButton, this.startButton),
      this.startHint,
      this.errorLine,
      h(
        "section",
        { class: "chat", "aria-label": "채팅" },
        this.chatList,
        h(
          "form",
          { class: "row", onsubmit: submitChat },
          h("div", { class: "field" }, h("label", { for: "room-chat" }, "채팅"), this.chatInput),
          h("button", { class: "btn small", type: "submit" }, "보내기"),
        ),
      ),
    );
    this.update(room);
    for (const line of chatLog) this.addChat(line);
    loadRoomAssets().then(
      (assets) => {
        if (this.disposed) return;
        this.screen = new RoomScreen(
          {
            canvas: this.canvas,
            cursor: actions.cursor,
            stage: this.stage,
            assets,
            playerId: welcome.playerId,
            maps: welcome.maps,
            music: welcome.music,
            sounds,
            settings,
            send,
            say,
            leave: () => send({ type: "leave-room" }),
            kickedOut: () => actions.kickedOut(),
            pickCharacter: actions.pickCharacter,
            items: actions.items,
            whisperTo: actions.whisperTo,
            notice: actions.notice,
          },
          this.room ?? room,
        );
        this.screen.setLog(chatLog);
        if (this.kicked) this.screen.showKicked();
        this.loading.remove();
      },
      (error: Error) => {
        this.loading.textContent = `대기실 그림을 불러오지 못했습니다: ${error.message}`;
        this.loading.classList.add("asset-error");
      },
    );
  }

  addChat(line: string): void {
    const item = h("li", { class: `chat-${chatLineClass(line, this.ownName)}` }, shownChat(line));
    this.chatList.append(item);
    this.chatList.scrollTop = this.chatList.scrollHeight;
    this.screen?.addLine(line);
  }

  /** /cls, /clear (0x418c60). */
  clearChat(): void {
    this.chatList.replaceChildren();
    this.screen?.setLog([]);
  }

  /** A refusal ends the busy cursor; a refused pick leaves the page's radios on the room's values. */
  refused(): void {
    this.screen?.refused();
    if (this.room) this.syncChoices(this.room);
  }

  waitForKick(): void {
    this.screen?.waitForKick();
  }

  /** S->C 0x44 for the own slot: the canvas's message box, and the page's alert line. */
  showKicked(): void {
    this.kicked = true;
    this.errorLine.textContent = `${KICKED_TEXT} 방 나가기 단추나 캔버스의 확인·Esc로 로비에 갑니다.`;
    this.screen?.showKicked();
  }

  dispose(): void {
    this.disposed = true;
    this.screen?.dispose();
    this.screen = null;
  }

  update(room: RoomInfo, change?: RoomChange): void {
    this.room = room;
    this.screen?.update(room, change);
    const me = this.welcome.playerId;
    const isHost = room.hostId === me;
    const own = room.players.find((p) => p.id === me);
    // The own-line test reads the name the room shows (0x427a3c).
    this.ownName = own ? shownName(own) : this.ownName;
    this.ready = own?.ready ?? false;
    this.heading.textContent = `방 ${String(room.number + 1).padStart(3, "0")} ${room.title}`;
    this.readyButton.hidden = isHost;
    this.readyButton.setAttribute("aria-pressed", String(this.ready));
    this.readyButton.textContent = this.ready ? "준비 취소" : "준비";

    const teams = isTeamMode(room.mode);
    replaceChildrenKeepingFocus(this.slots, ...Array.from({ length: MAX_PLAYERS }, (_, slot) => this.slotItem(room, slot, isHost, teams)));
    this.updateTeams(room, isHost);

    const guests = room.players.filter((p) => p.id !== room.hostId);
    const allReady = room.players.length >= 2 && guests.every((p) => p.ready);
    const teamsFit = !teams || new Set(room.players.map((p) => p.team)).size >= 2;
    this.startButton.hidden = !isHost;
    this.startButton.toggleAttribute("disabled", !allReady || !teamsFit);
    this.startHint.textContent = !allReady
      ? `${room.players.length}명 참가 중 · 2명 이상이고 방장 말고 모두 준비하면 방장이 시작할 수 있습니다.`
      : !teamsFit
        ? "팀 구성이 적합하지 않습니다. 두 팀 이상으로 나누어야 시작할 수 있습니다."
        : isHost
          ? "모두 준비되었습니다. 시작을 누르세요."
          : "방장이 시작하기를 기다리는 중입니다.";

    if (room.hostId !== this.hostId) {
      this.hostId = room.hostId;
      this.renderChoices(room, isHost);
    } else if (!isHost) {
      this.renderChoices(room, false);
    } else {
      // The host may have changed them on the canvas: keep the radios in step without rebuilding them.
      this.syncChoices(room);
    }
  }

  private syncChoices(room: RoomInfo): void {
    syncChoice(this.modeSection, String(room.mode));
    syncChoice(this.mapSection, room.mapId);
    syncChoice(this.musicSection, String(room.music));
  }

  private slotItem(room: RoomInfo, slot: number, isHost: boolean, teams: boolean): HTMLElement {
    const me = this.welcome.playerId;
    const p = room.players.find((player) => player.slot === slot);
    if (!p) {
      const closed = room.closed[slot];
      return h(
        "li",
        {},
        h("span", {}, `${slot + 1}번 자리: ${closed ? "닫힘" : "빈 자리"}`),
        isHost
          ? h(
              "button",
              { class: "btn small", type: "button", "data-focus-key": `slot:${slot}`, onclick: () => this.send({ type: "set-slot", slot, open: closed }) },
              closed ? "열기" : "닫기",
            )
          : null,
      );
    }
    return h(
      "li",
      {},
      portraitCanvas(p.character, 40),
      h("span", {}, p.name, p.id === me ? " (나)" : "", p.id === room.hostId ? " · 방장" : ""),
      teams ? h("span", { class: "team-chip", style: `--team: ${teamColor(p.team)}` }, teamName(p.team)) : null,
      p.id === room.hostId ? null : h("span", { class: "ready" }, p.ready ? "준비 완료" : "대기"),
      // The canvas's lit slot icons on another's slot, pressed in its middle.
      p.id !== me && isHost && hasItem(this.items(), ITEM_KICK)
        ? h("button", { class: "btn small", type: "button", "data-focus-key": `kick:${p.id}`, onclick: () => this.screen?.slotIcon(slot, "kick") }, `${p.name} 강퇴 (강퇴 아이콘)`)
        : null,
      p.id !== me && hasItem(this.items(), ITEM_WHISPER)
        ? h("button", { class: "btn small", type: "button", "data-focus-key": `whisper:${p.id}`, onclick: () => this.screen?.slotIcon(slot, "whisper") }, `${p.name}에게 귓말 (귓말 아이콘)`)
        : null,
      // The slot's click, dropped where the canvas drops it.
      this.pickCharacter
        ? h(
            "button",
            { class: "btn small", type: "button", "data-focus-key": `character:${p.id}`, onclick: () => !this.screen?.dropsClicks && this.pickCharacter?.(slot) },
            `${p.name} 캐릭터 바꾸기 (지금 ${p.character})`,
          )
        : null,
    );
  }

  /**
   * The team buttons show in the team modes only. A ready player cannot change team (0x448970),
   * and the host only while another player is not ready (0x428108).
   */
  private updateTeams(room: RoomInfo, isHost: boolean): void {
    const me = this.welcome.playerId;
    const own = room.players.find((p) => p.id === me)?.team;
    const hostLocked = isHost && !room.players.some((p) => p.id !== me && !p.ready);
    this.teamSection.hidden = !isTeamMode(room.mode);
    this.teamButtons.forEach((button, i) => {
      button.setAttribute("aria-pressed", String(own === i + 1));
      button.toggleAttribute("disabled", this.ready || hostLocked);
    });
    this.teamNote.textContent = this.ready
      ? "준비를 풀어야 팀을 바꿀 수 있습니다."
      : hostLocked
        ? "방장은 준비하지 않은 참가자가 있을 때만 팀을 바꿀 수 있습니다."
        : "같은 팀끼리도 폭탄에 맞습니다.";
  }

  private renderChoices(room: RoomInfo, isHost: boolean): void {
    this.renderModes(room, isHost);
    this.renderMaps(room, isHost);
    this.renderMusic(room, isHost);
  }

  private renderModes(room: RoomInfo, isHost: boolean): void {
    if (isHost) {
      const choices = MODE_NAMES.map((label, mode) => ({ value: String(mode), label }));
      this.modeSection.replaceChildren(
        choiceGroup("게임 방식", "online-mode", choices, String(room.mode), (value) =>
          this.send({ type: "set-mode", mode: Number(value) as GameMode }),
        ),
      );
      return;
    }
    this.modeSection.replaceChildren(h("p", { class: "keys" }, `게임 방식: ${MODE_NAMES[room.mode]} (방장이 고릅니다)`));
  }

  /** The list is RANDOM, then the maps in the server's order (0x404200). */
  private renderMaps(room: RoomInfo, isHost: boolean): void {
    if (isHost) {
      const images = new Map(mapChoices(this.manifest).map((c) => [c.value, c.image]));
      const choices = [
        { value: RANDOM_MAP, label: RANDOM_MAP },
        ...this.welcome.maps.map((m) => ({ value: m.id, label: mapTitle(m.title), image: images.get(m.id) })),
      ];
      this.mapSection.replaceChildren(
        choiceGroup("맵", "online-map", choices, room.mapId, (mapId) => this.send({ type: "set-map", mapId })),
      );
      return;
    }
    const title = this.welcome.maps.find((m) => m.id === room.mapId)?.title;
    this.mapSection.replaceChildren(h("p", { class: "keys" }, `맵: ${title ? mapTitle(title) : room.mapId} (방장이 고릅니다)`));
  }

  private renderMusic(room: RoomInfo, isHost: boolean): void {
    const names = [RANDOM_MAP, ...this.welcome.music];
    if (isHost) {
      const choices = names.map((label, music) => ({ value: String(music), label }));
      this.musicSection.replaceChildren(
        choiceGroup("배경음악", "online-music", choices, String(room.music), (value) =>
          this.send({ type: "set-music", music: Number(value) }),
        ),
      );
      return;
    }
    this.musicSection.replaceChildren(h("p", { class: "keys" }, `배경음악: ${names[room.music] ?? "RANDOM"} (방장이 고릅니다)`));
  }
}

function syncChoice(section: HTMLElement, value: string): void {
  for (const input of section.querySelectorAll<HTMLInputElement>('input[type="radio"]')) input.checked = input.value === value;
}

/**
 * A save's answer changes only what was saved: S->C 0x58 the greeting, 0x57 the nick, 0x1a the
 * character, 0x4a the guild. The record's cell point, record, level and rank stay the login's
 * (0x448c50 is their only writer), so a match's result shows from the next login (V).
 */
function takeSaved(account: OwnAccount | null, saved: OwnAccount): OwnAccount {
  if (!account) return saved;
  const { nick, greeting, character, hue, useId, guild } = saved;
  return { ...account, nick, greeting, character, hue, useId, guild };
}

class OnlineGame {
  private readonly screen: GameScreen;
  private readonly layout: LevelLayout;
  private readonly playerId: number;
  private hostId: number;
  private readonly music: MusicTrack | null;
  private readonly send: (message: ClientMessage) => void;
  private readonly keys = new KeyState();
  /** Key1..Key3 and the device as the option window left them (0x4699ac, control +0x218). */
  private readonly binding: KeyBinding = soloKeys(settings.current.keys);
  private readonly joystick = settings.current.control === 1;
  private readonly detachKeyboard: () => void;
  private readonly detachCapture: () => void;
  private readonly pointer = new Pointer();
  private readonly detachPointer: () => void;
  private readonly listeners: [EventTarget, string, EventListener][] = [];
  private view: GameView | null = null;
  /** A requested capture waits until the scene has composed its first actual frame. */
  private captureReady = false;
  private state: MatchState | null = null;
  /** The snapshots that came before the pictures, each with its own state; none once the load is over. */
  private queued: { state: MatchState; events: SimEvent[] }[] | null = [];
  private lastSent: Required<InputFrame> = { dir: null, bomb: false, attack: false, evade: false };
  /** The server must skip the input poll too: keeping the old keys would still turn or act. */
  private pausedSent = false;
  private frame = 0;
  private stopped = false;
  /** The chat line ([0x48c0e8]): closed at the start (0x44a3db); what the server was last told of it. */
  private readonly chat: ChatLine;
  private typingSent = false;
  private readonly blink = new CaretBlink();
  private readonly balloons = new Balloons();
  /** The other players whose line is open, from the last snapshot. */
  private typing: readonly number[] = [];
  /** The panel's bars from the last snapshot, and the own frame rate and ping behind them. */
  private bars = new Map<number, Omit<PanelBar, "id">>();
  private readonly frameRate = new FrameRate();
  private readonly pingMeter = new PingMeter();
  private statsSent = { fps: -1, ping: -1 };
  /** The own bar A (+0x234): 30 from the world load, then the frame count at each state packet (0x40c5ca). */
  private ownFps: number = START_BARS.fps;
  private ownPacketMs = Number.NEGATIVE_INFINITY;
  /** The F1 help ([0x492856]) and the exit box (0x484698) with its button under the mouse. */
  private help = false;
  private box: PracticeBox | null = null;
  private hover: 0 | 1 | 2 = 0;
  /** The mouse in screen pixels, which the box reads even when it has not moved. */
  private mouse = { x: 0, y: 0 };
  private boxImages: BoxImages | null = null;
  /** The last data from the host (+0x25c), and the one call made when it has been silent too long. */
  private lastHeard = performance.now();
  /** When the countdown the snapshots show runs out on this PC (0x40c868). */
  private playFrom = Number.POSITIVE_INFINITY;
  private readonly hostLost: () => void;
  private hostGone = false;
  /** The account's candy as the match began. */
  private readonly candyBase: number;
  /** The session's notice line, in the bottom message's place while it holds a text (0x40c1d2). */
  private readonly notice: NoticeLine;
  private readonly cursor: CursorAnim;

  constructor(
    screen: GameScreen,
    layout: LevelLayout,
    room: RoomInfo,
    playerId: number,
    music: MusicTrack | null,
    candyBase: number,
    notice: NoticeLine,
    cursor: CursorAnim,
    send: (message: ClientMessage) => void,
    hostLost: () => void,
  ) {
    this.cursor = cursor;
    this.hostLost = hostLost;
    this.candyBase = candyBase;
    this.notice = notice;
    this.screen = screen;
    this.layout = layout;
    this.playerId = playerId;
    this.hostId = room.hostId;
    this.music = music;
    this.send = send;
    this.chat = new ChatLine(screen.stage);
    // With the joystick the keyboard's game keys are not read (0x402520 mode 1), but a browser
    // shows no pad until one of its buttons is pressed, so the keys play until then.
    // A bound Enter/F-key must open chat/help before its action is sent. Otherwise a server
    // tick between that action and the pause packet can consume an input the scene never reads.
    this.listen(window, "keydown", (event) => this.onKey(event as KeyboardEvent));
    this.detachKeyboard = attachKeyboard(this.keys, boundCodes([this.binding]), () => this.syncInput());
    this.detachCapture = attachCapture(
      screen.canvas,
      () => this.box !== null,
      () => this.captureReady ? this.view?.composition ?? null : null,
    );
    this.detachPointer = this.pointer.attach(screen.canvas, {
      moved: () => this.onPointer(),
      pressed: () => this.onPointer(),
      released: (x, y) => this.onRelease(x, y),
    });
    void this.load(room);
  }

  private listen(target: EventTarget, type: string, listener: EventListener): void {
    target.addEventListener(type, listener);
    this.listeners.push([target, type, listener]);
  }

  private async load(room: RoomInfo): Promise<void> {
    try {
      // The room may say RANDOM; the layout is the map the server rolled.
      const [assets, panel, messageBox, buttons] = await Promise.all([
        // Each slot's hue turns its sheets, panel face and head (0x44de67, 0x4406ca).
        loadSceneAssets(
          this.layout.id,
          room.players.map((p) => p.character),
          room.players.map((p) => ({ id: p.id, character: p.character, hue: p.hue, face: true, head: true })),
        ),
        loadImage("image/images.png"),
        loadImage("image/new_messagebox.png"),
        loadImage("image/new_button2.png"),
      ]);
      if (this.stopped) return;
      this.boxImages = { panel, messageBox, buttons };
      // Shadows and the invisible blend read the screen back each frame (0x413620 works on the surface).
      const ctx = this.screen.canvas.getContext("2d", { willReadFrequently: true });
      if (!ctx) throw new Error("canvas 2d context unavailable");
      this.view = new GameView(ctx, assets, sounds, {
        cursor: this.cursor,
        localPlayerIds: [this.playerId],
        hostId: this.hostId,
        music: this.music,
        announce: this.screen.announce,
        people: new Map(room.players.map((p) => [p.id, { name: shownName(p), badge: p.badge }])),
        candyBase: this.candyBase,
        notice: this.notice,
      });
      this.screen.setExitAction(() => this.requestExit());
      this.screen.loaded();
      this.view.catchUp(this.queued ?? []);
      this.queued = null;
      const draw = () => {
        if (this.stopped) return;
        this.render();
        this.frame = requestAnimationFrame(draw);
      };
      this.frame = requestAnimationFrame(draw);
    } catch (error) {
      if (this.stopped) return;
      // A failed scene cannot show a move or an editor. Release its server state and inputs;
      // the failure notice keeps the screen's initial exit action.
      this.send({ type: "typing", on: false });
      // First drop queued taps, then poll released keys: a skipped poll keeps an old walk going.
      this.send({ type: "input", dir: null, bomb: false, attack: false, evade: false, paused: true });
      this.send({ type: "input", dir: null, bomb: false, attack: false, evade: false, paused: false });
      this.stop();
      this.screen.failed(`에셋을 불러오지 못했습니다: ${(error as Error).message}`);
    }
  }

  snapshot(wire: Parameters<typeof fromWireState>[0], events: SimEvent[], typing: readonly number[], bars: readonly PanelBar[]): void {
    const state = fromWireState(wire, this.layout);
    this.state = state;
    if (state.phase === "countdown") this.playFrom = countdownEnd(state, performance.now());
    this.typing = typing;
    this.bars = new Map(bars.map(({ id, ...bar }) => [id, bar]));
    // The next round's world load frees every balloon (0x44d740 → 0x44feb0) and clears the ping table (0x44ef7b).
    if (events.some((event) => event.type === "round-start")) {
      this.balloons.clear();
      this.pingMeter.reset();
      this.ownFps = START_BARS.fps;
    }
    // Browser checks read the latest snapshot in development; production builds drop this.
    if (import.meta.env.DEV) {
      const own = { fps: this.frameRate.value, ping: this.pingMeter.value };
      Object.assign(window, { shakeMatch: { ...state, events }, shakeBars: { bars, own } });
    }
    if (this.view) this.view.ingest(state, events);
    else this.queued?.push({ state, events });
    const stage = this.screen.stage.dataset;
    stage.phase = state.phase;
    stage.round = String(state.round);
    stage.medals = state.players.map((p) => `${p.id}:${p.medals}`).join(",");
    stage.alive = state.players.map((p) => `${p.id}:${p.alive ? 1 : 0}`).join(",");
    stage.me = String(this.playerId);
  }

  /** The candy the own player has picked up in this match. */
  get candy(): number {
    return this.state?.players.find((p) => p.id === this.playerId)?.candy ?? 0;
  }

  /** A line said in the match, the own one back from the server too: it goes in the speaker's balloon (0x45ec00). */
  chatReceived(playerId: number, text: string): void {
    const speaker = this.state?.players.find((p) => p.id === playerId);
    if (!speaker) return;
    this.balloons.say(speaker.slot, text, performance.now());
    if (playerId !== this.playerId) this.screen.announce(`${speaker.name}: ${text}`);
  }

  /** The room's host changed during the match (the host left). */
  hostChanged(hostId: number): void {
    this.hostId = hostId;
    this.view?.setHost(hostId);
  }

  private get isHost(): boolean {
    return this.playerId === this.hostId;
  }

  /** The keys go unread under the chat line, the box and the help (0x45aec8); a walk goes on. */
  private get frozen(): boolean {
    return this.chat.isOpen || this.box !== null || this.help;
  }

  /**
   * Tell the server what changed: the chat line first, then the keys. Taps are dropped each
   * time, so a Space typed into the line does not become a bomb when it closes.
   */
  private syncInput(): void {
    const typing = this.chat.isOpen;
    if (typing !== this.typingSent) {
      this.typingSent = typing;
      this.send({ type: "typing", on: typing });
    }
    const pad = this.joystick ? connectedPad() : null;
    const next = pad ? padFrame(pad) : this.keys.sample(this.binding);
    this.keys.endTick();
    const paused = this.frozen;
    if (paused && this.pausedSent) return;
    const same = paused === this.pausedSent && (Object.keys(next) as (keyof InputFrame)[]).every((key) => next[key] === this.lastSent[key]);
    if (same) return;
    this.lastSent = next;
    this.pausedSent = paused;
    this.send({ type: "input", ...next, paused });
  }

  private onKey(event: KeyboardEvent): void {
    if (isButtonActivation(event)) return;
    if (event.code === "F1") event.preventDefault();
    // The IME's process key belongs to the editor; real keys retain the scene's handling.
    if (event.keyCode === 229) return;
    const state = this.state;
    const slot = macroSlot(event.code);
    if (slot !== null) {
      event.preventDefault();
      // 0x461a50: a match takes the macro in every phase; the exit box takes F2..F9 first.
      if (macroOpens(slot, { box: this.box !== null, blocked: false })) {
        this.chat.open();
        this.chat.text = settings.current.macros[slot];
        this.screen.announce("채팅 입력: 단축 메시지가 들어갔습니다. Enter로 보내기, Esc로 취소");
        this.syncInput();
        return;
      }
    }
    if (this.box) {
      // Any key clears the help while the box is up (0x460097); Enter answers the box, not the line.
      // WM_CHAR drops characters/Backspace, but Delete and IME still edit the buffer (0x403a97, 0x40368b).
      if (event.key !== "Delete") event.preventDefault();
      this.help = false;
      const result = boxKey(this.box, event.key);
      if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        this.hover = boxKeyCursor(this.box);
        this.screen.announce(this.box.selection === 1 ? "예" : "아니오");
      }
      if (result) {
        this.answer(result);
      }
      return;
    }
    if (event.code === "F1") {
      this.help = !this.help && state !== null && helpAllowed(state.phase); // 0x460264
    } else if (event.code === "Escape") {
      if (state) this.escape(state);
    } else if (event.key === "Enter") {
      // Enter sends and closes the line (0x45fb47), or opens it off the result screens (0x45fec8).
      event.preventDefault();
      if (this.chat.isOpen) this.say(this.chat.close());
      else if (state && enterOpensChat(state.phase)) {
        this.chat.open();
        this.screen.announce("채팅 입력: Enter로 보내기, Esc로 취소");
      }
    } else if (event.key === "ArrowUp" && this.chat.isOpen) {
      this.chat.text = gameRecall(); // 0x4600d9
    }
    this.syncInput();
  }

  private escape(state: MatchState): void {
    const action = matchEscape({ help: this.help, chatOpen: this.chat.isOpen, host: this.isHost, round: state.round, phase: state.phase });
    switch (action) {
      case "help":
        this.help = false;
        break;
      case "chat":
        this.chat.close(); // 0x4618e1: the text is dropped.
        break;
      case "leave":
        this.send({ type: "leave-room" });
        break;
      case "box":
        this.box = openBox("esc");
        this.chat.deferChanges(true);
        this.hover = boxHover(this.box, this.mouse);
        this.screen.announce("종료하시겠습니까? 예(Y), 아니오(N)");
        break;
      case "none":
        break;
    }
  }

  /** The hidden Esc + confirmation sequence only leaves where the scene offers it. */
  private requestExit(): void {
    const state = this.state;
    if (this.help || (state && closesExitBox(state.phase, state.round))) return;
    if (state) {
      const action = matchEscape({ help: false, chatOpen: false, host: this.isHost, round: state.round, phase: state.phase });
      if (action !== "leave" && action !== "box") return;
    }
    this.send({ type: "leave-room" });
  }

  /** 0x446200: the recall buffer takes the line as typed; a blank line, or one on the wait and result screens, goes nowhere. */
  private say(raw: string): void {
    keepRecall(raw);
    const state = this.state;
    const text = gameChatLine(raw);
    if (!text || !state || !sendsChat(state.phase)) return;
    this.send({ type: "game-chat", text });
    const own = state.players.find((p) => p.id === this.playerId);
    if (own) this.balloons.say(own.slot, text, performance.now());
  }

  /** YES leaves for the lobby (0x461bc0 → 0x448870, 0x44f6b0); NO closes the box. */
  private answer(result: BoxResult): void {
    this.closeBox();
    if (result === "exit") this.send({ type: "leave-room" });
  }

  private closeBox(): void {
    this.box = null;
    // Keep the record until the next editor message, including when a result frame closes it.
    this.chat.deferChanges(false);
    this.hover = 0;
    this.pointer.held = null;
    this.syncInput();
  }

  private onPointer(): void {
    this.mouse = this.pointer.mouse;
    if (!this.box) return;
    this.hover = boxPointer(this.box, this.mouse.x, this.mouse.y);
  }

  private onRelease(x: number, y: number): void {
    if (!this.box || this.help) return;
    const result = boxClick(this.box, x, y);
    if (!result) return;
    // A click on the box's buttons sounds menu2 (0x4589a9); its keys are silent (0x461bc0).
    sounds.play(MENU_SOUNDS.primary);
    this.answer(result);
  }

  private render(): void {
    const { state, view } = this;
    if (!state || !view) return;
    // The joystick is polled each frame, as DirectInput's device state was.
    if (this.joystick) this.syncInput();
    if (!this.hostGone && hostSilent(state.phase, performance.now(), this.lastHeard, this.playFrom)) {
      this.hostGone = true;
      this.hostLost();
      return;
    }
    this.measure(state);
    if (this.box && closesExitBox(state.phase, state.round)) this.closeBox();
    if (this.help && !helpAllowed(state.phase)) {
      // The keys are read again (0x45aec8): one let go under the help no longer walks into the next round.
      this.help = false;
      this.syncInput();
    }
    const box = this.box;
    const images = this.boxImages;
    const overlay = box && images ? (ctx: CanvasRenderingContext2D) => drawPracticeBox(ctx, images, box, this.hover, this.pointer.held !== null) : undefined;
    view.render(state, { overlay, help: this.help, chat: this.chatDraw(state), bars: this.ownBars() });
    this.captureReady = true;
  }

  /**
   * The balloons are dropped after 5 s only while the field is drawn (0x40c254). The others'
   * "chat" marks come with the state packets, which the countdown does not send and the world
   * load clears (0x44fc50), so they show only in play.
   */
  private chatDraw(state: MatchState): ChatDraw {
    const field = state.phase === "countdown" || state.phase === "playing";
    if (!field) return { balloons: [], line: null };
    const now = performance.now();
    const typing = state.phase === "playing" ? this.typing.filter((id) => id !== this.playerId) : [];
    const balloons = this.balloons.shown(now);
    if (!this.chat.isOpen) return { balloons, line: null, typing };
    const line = this.chat.view();
    return { balloons, line: { text: line.text, caret: this.blink.shown(now) ? line.caret : null }, typing };
  }

  /** A word from the server, which plays the host. */
  heard(now: number): void {
    this.lastHeard = now;
  }

  /** The ping record back (0x44497c): the trip goes into the own bar B at once. */
  pong(at: number): void {
    this.pingMeter.answered(at, Math.floor(performance.now()));
  }

  /**
   * The others' bars as the server last took them from their state packets; the own ones as this
   * screen holds them, B straight from the last answer (0x44499f), A from the last state packet.
   */
  private ownBars(): ReadonlyMap<number, Omit<PanelBar, "id">> {
    const bars = new Map(this.bars);
    bars.set(this.playerId, { fps: this.ownFps, ping: this.pingMeter.value });
    return bars;
  }

  /**
   * Once a frame: count it for bar A, send the ping record every 5 s while in play and not gone
   * (0x40c646-0x40c69c), and tell the server when the values the state packet carries change.
   */
  private measure(state: MatchState): void {
    const now = performance.now();
    this.frameRate.draw(state.tick, now);
    const me = state.players.find((p) => p.id === this.playerId);
    if (state.phase === "playing" && me && !me.gone && this.pingMeter.due(now)) {
      this.send({ type: "ping", at: Math.floor(now) });
    }
    if (me && typingPacketDue(state.phase, me, now, this.ownPacketMs)) {
      this.ownPacketMs = now;
      this.ownFps = this.frameRate.value;
    }
    const stats = { fps: this.frameRate.value, ping: this.pingMeter.value };
    if (stats.fps === this.statsSent.fps && stats.ping === this.statsSent.ping) return;
    this.statsSent = stats;
    this.send({ type: "stats", ...stats });
  }

  stop(keepMusic = false): void {
    if (this.stopped) return;
    this.stopped = true;
    this.queued = null;
    cancelAnimationFrame(this.frame);
    this.view?.dispose(keepMusic);
    this.chat.dispose();
    this.detachKeyboard();
    this.detachCapture();
    this.detachPointer();
    for (const [target, type, listener] of this.listeners) target.removeEventListener(type, listener);
  }
}
