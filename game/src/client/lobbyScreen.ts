// The lobby (scene 4, "LOBBY") on a canvas, from the original's art and layout: draw 0x42ac60,
// clicks on release 0x459796, keys 0x45fa70. A mouse screen like the original; the page's controls
// under it (lobbyView.ts) are the keyboard and screen reader path. Geometry: lobbyLayout.ts.
import type { Rect } from "../assets/types.ts";
import { animDue } from "../sim/constants.ts";
import { cp949Bytes, trimChat } from "../server/cp949.ts";
import { hasItem, ITEM_MASK, ITEM_WHISPER } from "../server/items.ts";
import type { Badge, ClientMessage, OwnAccount, RoomStatus, RoomSummary, UserCard } from "../server/protocol.ts";
import { chatLine as sendableChat, RANDOM_MAP, shownName } from "../server/protocol.ts";
import type { Sheet } from "./assets.ts";
import { loadCp949, loadImage, loadImageSheet, loadSheet } from "./assets.ts";
import { drawBadge, guildLines, guildName, levelTitle } from "./badge.ts";
import type { SoundBank } from "./audio.ts";
import { CaretBlink, commandCycle, lobbyKeyOpensChat } from "./chat.ts";
import { ChatLine } from "./chatLine.ts";
import { INSTALLED_VERSION, VERSION_TEXT } from "./hudLayout.ts";
import type { LobbyState } from "./lobbyView.ts";
import {
  BANNER,
  CHANNEL_AT,
  CHANNEL_COLOUR,
  CREATE,
  CREATE_PASSWORD_LIMIT,
  CREATE_POPUP,
  CREATE_TITLE_LIMIT,
  createPopupAt,
  createTitle,
  EXIT,
  LOBBY_CHAT,
  LOBBY_NOTICE,
  LOBBY_SCROLL,
  lobbyHelpAt,
  MESSAGE_BOX,
  MESSAGE_HELP,
  messageLines,
  MY_INFO,
  PASSWORD_EMPTY,
  PASSWORD_LIMIT,
  PASSWORD_POPUP,
  passwordMask,
  passwordPopupAt,
  REMOTE,
  REMOTE_POPUP,
  remoteButtonAt,
  ROOM_COLOURS,
  ROOM_ICONS,
  ROOM_INFO,
  ROOM_NEXT,
  ROOM_PARTS,
  ROOM_PREV,
  ROOM_ROW,
  ROOM_ROW_ART,
  roomCountText,
  roomDoorIcon,
  roomIconRect,
  roomInfoRow,
  roomInfoStatus,
  roomPage,
  roomPages,
  roomRowAt,
  roomRowY,
  SHOP,
  SHOW_ALL,
  turnPage,
  USER_ART,
  USER_NEXT,
  USER_PARTS,
  USER_PREV,
  userPage,
  userPages,
  userRowAt,
  userRowY,
  WAIT_GAME,
} from "./lobbyLayout.ts";
import {
  CHARACTER_IDS,
  CHARACTER_NAME_AT,
  CHARACTER_NAMES,
  characterIndex,
  DROPDOWN,
  dropdownHeight,
  dropdownLineAt,
  dropdownLineLit,
  dropdownLines,
  FIELD_COLOUR,
  FIELDS,
  GREETING_LIMIT,
  GREETING_POPUP,
  greetingCaret,
  greetingLines,
  MY_INFO_BUTTONS,
  MY_INFO_WINDOW,
  myInfoButtonAt,
  myInfoHelpAt,
  OWNED,
  PORTRAIT_AT,
  stepCharacter,
  USE_ID_MARK,
} from "./myInfoLayout.ts";
import { recordText, USER_INFO, USER_INFO_CLOSE, USER_INFO_FIELDS, USER_INFO_ITEMS } from "./userInfoLayout.ts";
import { MENU_SOUNDS } from "./presentation.ts";
import type { Button } from "./roomLayout.ts";
import { CHAT_INPUT, ChatScroll, inside, roomNumberText, shownMapName, wrapChat } from "./roomLayout.ts";
import { CursorAnim, drawBalloon, drawCaret, drawChatLines, drawDarkness, drawHelpScreen, drawThumb, Fade, Notice, Pointer } from "./screenKit.ts";
import { attachCapture } from "./screenCapture.ts";
import { isMacroKey, macroOpens, macroSlot } from "./macro.ts";
import type { FriendReply } from "./friends.ts";
import type { FriendRecord } from "./optionWindow.ts";
import { OptionScreen } from "./optionScreen.ts";
import type { SettingsStore } from "./settings.ts";
import { FRAME_MS } from "./startLayout.ts";
import { portraitSheetName } from "./scene.ts";
import { blit } from "./sprite.ts";
import { FONT_12, FONT_13, FONT_14, FONT_COURIER_15, outlinedText, plainText, YELLOW } from "./text.ts";

export interface LobbyScreenAssets {
  background: HTMLImageElement;
  banner: HTMLImageElement;
  button: HTMLImageElement;
  button2: HTMLImageElement;
  roomButton: HTMLImageElement;
  gameInfo: HTMLImageElement;
  remote: HTMLImageElement;
  /** images2: the scene's message box (the boy and the blue panel). */
  messageBox: HTMLImageElement;
  guild: HTMLImageElement;
  mark: HTMLImageElement;
  /** shake_help: the F1 help screen. */
  help: HTMLImageElement;
  /** The my-info window (scene 10), its greeting popup and its character list. */
  statusWindow: HTMLImageElement;
  charChange: HTMLImageElement;
  winObject: HTMLImageElement;
  /** The option window (scene 13) and its friend popup. */
  option: HTMLImageElement;
  basicWindow: HTMLImageElement;
  /** new_userinfo: the user information window. */
  userInfo: HTMLImageElement;
  /** guild.dat's lines: the guilds' names. */
  guilds: string[];
  cursor: Sheet;
}

export async function loadLobbyAssets(): Promise<LobbyScreenAssets> {
  const image = (name: string) => loadImage(`image/${name}.png`);
  const [background, banner, button, button2, roomButton, gameInfo, remote, messageBox, guild, mark, help, statusWindow, charChange, winObject, option, basicWindow, userInfo, guilds, cursor] = await Promise.all([
    image("new_status"),
    image("new_banner"),
    image("new_button"),
    image("new_button2"),
    image("new_roombutton"),
    image("new_gameinfo"),
    image("new_remote"),
    image("images2"),
    image("guild"),
    image("mark"),
    image("shake_help"),
    image("new_statuswindow"),
    image("new_charchange"),
    image("new_winobject"),
    image("new_option"),
    image("new_basicwindow"),
    image("new_userinfo"),
    loadCp949("guild.dat").then(guildLines),
    loadImageSheet("cursor"),
  ]);
  return { background, banner, button, button2, roomButton, gameInfo, remote, messageBox, guild, mark, help, statusWindow, charChange, winObject, option, basicWindow, userInfo, guilds, cursor };
}

export interface LobbyScreenOptions {
  canvas: HTMLCanvasElement;
  /** The canvas's positioned parent, for the editors' hidden inputs. */
  stage: HTMLElement;
  assets: LobbyScreenAssets;
  playerId: number;
  /** The server's map list, for the rows' map names. */
  maps: readonly { id: string; title: string }[];
  sounds: SoundBank;
  /** WAIT GAME as the lobby was left: back from a room it stays on (0x449e50). */
  waitingOnly: boolean;
  send(message: ClientMessage): void;
  /** A chat line to send; the session drops repeats and lines too soon, like 0x43f7a0. */
  say(text: string): void;
  /** EXIT, 채널변경 or Esc with nothing open: leave the server. Only EXIT asks the servers again (0x459d94). */
  exit(askServers: boolean): void;
  /** WAIT GAME was turned on or off. */
  filterChanged(waitingOnly: boolean): void;
  /** What the my-info window shows and edits; the session keeps it. */
  profile: MyProfile;
  /** The account's login record as last sent: the my-info window's other fields, the items the user info window tests. */
  account(): OwnAccount | null;
  /** The my-info window's O with a change (C->S 0x1a); the answer comes to profileSaved. */
  saveCharacter(character: string, useId: boolean): void;
  /** The greeting popup's O (C->S 0x58); the answer comes to greetingSaved. */
  saveGreeting(text: string): void;
  /** The first frames fade in, as after the server list (0x449172). */
  fadeIn?: boolean;
  /** The option object (0x48acd0): the option window edits it, the balloons and F2..F10 read it. */
  settings: SettingsStore;
}

/** The player's data the my-info window shows, as the account server last sent it. */
export interface MyProfile {
  character: string;
  /** [0x484714]: −180..180. */
  hue: number;
  nick: string;
  greeting: string;
  /** 아이디 체크 ([0x48aeec]): the ID instead of the nickname where names show. */
  useId: boolean;
}

/**
 * The my-info window's state (0x43c3c0): the character shown ([0x48c1dc]), the arrows' own index
 * ([0x49631c], which the list does not move), the one to go back to ([0x496324]), the ID check's
 * edit copy ([0x4961e8]), the character list ([0x496340]), the greeting popup ([0x496338]) and
 * the wait for the save's reply ([0x496ca0]).
 */
interface MyInfo {
  character: number;
  arrow: number;
  snapshot: number;
  useId: boolean;
  dropdown: boolean;
  greeting: boolean;
  busy: boolean;
  /** The portrait's frame: the sprite is loaded again on each change, from frame 0 (0x413d30). */
  face: { frame: number; lastMs: number };
}

/** The popup open over the lobby; the message box is apart and may sit on the create popup. My-info is scene 10, option 13. */
type Popup = "create" | "password" | "remote" | "roomInfo" | "userInfo" | "myInfo" | "option" | null;

interface RoomInfoView {
  status: RoomStatus;
  round: number;
  players: readonly { slot: number; name: string; badge: Badge }[];
}

/** The popup's record before the reply: zeroed, so "ROUND 1" and no rows (0x430880). */
const ZEROED_INFO: RoomInfoView = { status: "round", round: 1, players: [] };

/** 0x45fa70's default branch: keys that open a closed chat line. Space and the F keys do not. */
export class LobbyScreen {
  private readonly options: LobbyScreenOptions;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly chat: ChatLine;
  private readonly title: ChatLine;
  /** The create popup's password, open while its secret check is on. */
  private readonly secretLine: ChatLine;
  /** The password popup's editor (0x42f500). */
  private readonly passwordLine: ChatLine;
  /** The greeting popup's editor (0x43ea00: 36 bytes). */
  private readonly greetingLine: ChatLine;
  private myInfo: MyInfo | null = null;
  /** The option window (scene 13). */
  private option: OptionScreen | null = null;
  private readonly portraits = new Map<string, Sheet | null>();
  private readonly scroll = new ChatScroll(LOBBY_SCROLL.geometry);
  private readonly caret = new CaretBlink();
  private readonly pointer = new Pointer();
  private readonly cursor = new CursorAnim();
  private readonly notice = new Notice();
  /** Tells a screen reader what only the canvas shows: a popup or a message. */
  private readonly status = document.createElement("p");
  private state: LobbyState;
  private log: string[] = [];
  /** A create or join is waiting for the server's answer. */
  private roomAsked = false;
  private popup: Popup = null;
  /** The create popup's secret check ([0x495392]); item 5, which it needs, is everyone's here. */
  private secret = false;
  /** The create popup's editor is on the password, not the title ([0x46e7e4] = 0). */
  private onPassword = false;
  /** The room the password popup is for ([0x46e7d4]). */
  private passwordRoom: string | null = null;
  private roomInfo: RoomInfoView = ZEROED_INFO;
  /** The user information window's copy of a row's record (0x42f160): a later list does not change it. */
  private userInfo: { name: string; card: UserCard } | null = null;
  /** MSGBOX ([0x48c248]): its text and when it opened; it closes itself after 2 s. */
  private message: { text: string; since: number } | null = null;
  private roomPageNo = 1;
  private userPageNo = 1;
  /** WAIT GAME ([0x49284d]): only the rooms that are waiting. */
  private waitingOnly: boolean;
  /** The F1 help screen ([0x492856]). */
  private helpScreen = false;
  private lastSent = "";
  private frame = 0;
  private stopped = false;
  private fade: Fade | null = null;
  private readonly detach: () => void;

  constructor(options: LobbyScreenOptions, state: LobbyState) {
    this.options = options;
    this.state = state;
    this.waitingOnly = options.waitingOnly;
    const ctx = options.canvas.getContext("2d");
    if (!ctx) throw new Error("canvas 2d context unavailable");
    this.ctx = ctx;
    this.status.className = "sr-only";
    this.status.setAttribute("role", "status");
    options.stage.append(this.status);
    this.chat = new ChatLine(options.stage, { limit: LOBBY_CHAT.limit, at: CHAT_INPUT, trapFocus: false });
    this.title = new ChatLine(options.stage, { limit: CREATE_TITLE_LIMIT, at: CREATE_POPUP.title.text, trapFocus: false });
    this.title.element.setAttribute("aria-label", "방 제목");
    this.secretLine = new ChatLine(options.stage, { limit: CREATE_PASSWORD_LIMIT, at: CREATE_POPUP.password.text, trapFocus: false });
    this.secretLine.element.setAttribute("aria-label", "비밀방 비밀번호");
    this.passwordLine = new ChatLine(options.stage, { limit: PASSWORD_LIMIT, at: PASSWORD_POPUP.field.text, trapFocus: false });
    this.passwordLine.element.setAttribute("aria-label", "방 비밀번호 (Enter 확인, Esc 취소)");
    this.greetingLine = new ChatLine(options.stage, { limit: GREETING_LIMIT, at: GREETING_POPUP.text, trapFocus: false });
    this.greetingLine.element.setAttribute("aria-label", "인사말");
    this.chat.open();
    if (options.fadeIn) this.fade = new Fade("in", performance.now(), FRAME_MS);
    this.detach = this.attach();
    const draw = () => {
      if (this.stopped) return;
      this.render(performance.now());
      this.frame = requestAnimationFrame(draw);
    };
    this.frame = requestAnimationFrame(draw);
  }

  update(state: LobbyState): void {
    this.state = state;
    this.roomPageNo = Math.min(this.roomPageNo, roomPages(state.rooms, this.waitingOnly));
    this.userPageNo = Math.min(this.userPageNo, userPages(state.users));
  }

  setLog(lines: readonly string[]): void {
    this.log = lines.flatMap(wrapChat);
  }

  addLine(line: string): void {
    this.log.push(...wrapChat(line));
  }

  showNotice(text: string): void {
    this.notice.show(text, performance.now());
  }

  /** The message box (MSGBOX 0x443700): a refusal or a reply, over whatever is open. */
  showMessage(text: string): void {
    this.message = { text, since: performance.now() };
    this.status.textContent = text;
    // A refused save ends the wait; the window stays with its edits (0x445069).
    if (this.myInfo) this.myInfo.busy = false;
    // So does a refused create or join (S->C 0x03, 0x04: lock and cursor off, then the box).
    this.roomAsked = false;
  }

  /** SEND_create, SEND_join (0x448790, 0x448800): the lock and the busy cursor until the answer; a room's answer ends the lobby. */
  waitForRoom(): void {
    this.roomAsked = true;
  }

  /** S->C 0x1a accepted: the ID check is kept, the window closes and says so over the lobby (0x445069). */
  profileSaved(): void {
    const info = this.myInfo;
    if (info) {
      this.closeMyInfo();
    }
    this.showMessage("수정 되었습니다.");
  }

  /** S->C 0x63: the option window's friend list and the end of its wait. */
  friendsAnswered(friends: readonly FriendRecord[]): void {
    this.option?.friendsAnswered(friends);
  }

  /** S->C 0x64 or 0x65: the answer to the option window's friend popup. */
  friendReplied(reply: FriendReply): void {
    this.option?.friendReplied(reply);
  }

  /** Join reply 3 (0x444ffd): the password popup again, empty, then the wait ends; no message. */
  passwordAsked(code: string): void {
    this.askPassword(code);
    this.roomAsked = false;
  }

  /** A room's line (0x459e06): a playing room says so, a secret one asks for its password, any other is joined. */
  joinRoom(room: RoomSummary): void {
    if (room.playing) this.showMessage("이미 시작 되었습니다.");
    else if (room.secret) this.askPassword(room.code);
    else this.options.send({ type: "join-room", code: room.code });
  }

  /**
   * The roster's mirror of turning to the user's page and clicking the row; the lobby must be clear,
   * as for the click. True when the window opened.
   */
  showUser(id: number): boolean {
    if (this.helpScreen || this.busy || !this.clear) return false;
    const user = this.state.users.find((u) => u.id === id);
    if (user) this.openUserInfo(user.name, user.card);
    return Boolean(user);
  }

  /** S->C 0x55: the room info popup's record, whichever room it answers (the original does not check). */
  showRoomInfo(info: RoomInfoView): void {
    if (this.popup === "roomInfo") this.roomInfo = info;
  }

  dispose(): void {
    this.stopped = true;
    cancelAnimationFrame(this.frame);
    this.chat.dispose();
    this.title.dispose();
    this.secretLine.dispose();
    this.passwordLine.dispose();
    this.greetingLine.dispose();
    this.option?.dispose();
    this.status.remove();
    this.detach();
  }

  // State

  private get ownId(): string {
    return this.state.users.find((u) => u.id === this.options.playerId)?.name ?? "";
  }

  /** The own name as the chat's own-line test reads it: the ID or the nick, by 아이디 체크 (0x42d393). */
  private get ownName(): string {
    const { nick, useId } = this.options.profile;
    return shownName({ name: this.ownId, nick, useId });
  }

  private get rows(): (RoomSummary | null)[] {
    return roomPage(this.state.rooms, this.roomPageNo, this.waitingOnly);
  }

  /** PHELP (+0x20b, 0x44cd40): the balloons are drawn only with it on. */
  private get balloons(): boolean {
    return this.options.settings.current.balloons;
  }

  /** Waiting for a reply ([0x496ca0]): the mouse and Esc are dropped, the busy cursor shows. */
  private get busy(): boolean {
    return this.roomAsked || (this.myInfo?.busy ?? false) || (this.option?.window.busy ?? false);
  }

  /** Nothing over the lobby: its own hover, held and balloon art show (the "no popup" gate). */
  private get clear(): boolean {
    return this.popup === null && this.message === null;
  }

  // Input

  private attach(): () => void {
    const detachPointer = this.pointer.attach(this.options.canvas, {
      moved: () => undefined,
      released: (x, y) => this.release(x, y),
      rightReleased: (x, y) => this.rightRelease(x, y),
    });
    const onKey = (event: KeyboardEvent) => this.key(event);
    window.addEventListener("keydown", onKey);
    // The lobby has no yes/no box, the one thing that keeps F12 off (0x460097).
    const detachCapture = attachCapture(this.options.canvas);
    return () => {
      detachPointer();
      detachCapture();
      window.removeEventListener("keydown", onKey);
    };
  }

  /** Each frame the button is held (0x42f810): the track drags the chat log's thumb. */
  private holdFrame(): void {
    // While the help screen shows, the mouse is dropped every frame (0x458750).
    if (this.helpScreen) this.pointer.held = null;
    const held = this.pointer.held;
    if (this.option) return;
    const info = this.myInfo;
    if (info) {
      // Held on the name box, the character list opens (0x458dbf → 0x43ece0).
      if (held && !info.dropdown && !info.greeting && !info.busy && !this.message && myInfoButtonAt(held.x, held.y) === "names") info.dropdown = true;
      return;
    }
    if (!held || !this.clear) return;
    if (inside(LOBBY_SCROLL.track, held.x, held.y)) this.scroll.hold(this.log.length, held.y);
    else this.scroll.dragging = false;
  }

  /** A release (0x459796): the message box takes every one, then the open popup, then the lobby. */
  private release(x: number, y: number): void {
    if (this.helpScreen) return;
    this.scroll.release();
    // While a save or a list waits for its reply, the mouse is dropped (0x458794).
    if (this.busy) return;
    if (this.message) {
      // No sound; only its button closes it (0x458819).
      if (inside(MESSAGE_BOX.button.hit, x, y)) this.hideMessage();
      return;
    }
    if (this.option) {
      this.option.release(x, y);
      return;
    }
    if (this.popup === "myInfo") {
      this.myInfoRelease(x, y);
      return;
    }
    if (this.popup === "roomInfo") {
      if (inside(ROOM_INFO.close.hit, x, y)) this.closePopup(true);
      return;
    }
    if (this.popup === "userInfo") {
      // Only X acts (0x4597e8); the whisper and mask icons do nothing.
      if (inside(USER_INFO_CLOSE.hit, x, y)) this.closePopup(true);
      return;
    }
    if (this.popup === "create") {
      this.createRelease(x, y);
      return;
    }
    if (this.popup === "password") {
      this.passwordRelease(x, y);
      return;
    }
    if (this.popup === "remote") {
      this.remoteRelease(x, y);
      return;
    }
    this.lobbyRelease(x, y);
  }

  /** 0x459a18: the remote's buttons; 친구찾기 and BBS do nothing, other clicks are swallowed. */
  private remoteRelease(x: number, y: number): void {
    switch (remoteButtonAt(x, y)) {
      case "close":
        this.closePopup(true);
        break;
      case "ranking":
        // It opens the ranking window, which the remake has not (the chat stays closed).
        this.closePopup(false);
        break;
      case "option":
        this.openOption();
        break;
      case "channel":
        // 채널변경 (0x459b2c): menu2, then back to the server list.
        this.closePopup(false);
        this.options.sounds.play(MENU_SOUNDS.primary);
        this.options.exit(false);
        break;
    }
  }

  private lobbyRelease(x: number, y: number): void {
    const { sounds } = this.options;
    if (inside(WAIT_GAME.off.hit, x, y)) {
      // 0x42fcc0: the filter asks the server for the waiting rooms, off asks for page 1.
      this.waitingOnly = !this.waitingOnly;
      this.roomPageNo = 1;
      this.options.filterChanged(this.waitingOnly);
      return;
    }
    if (inside(MY_INFO.hit, x, y)) {
      this.openMyInfo();
      return;
    }
    if (inside(REMOTE.hit, x, y)) {
      this.chat.close();
      this.openPopup("remote", "리모컨 창이 열렸습니다. 채널변경은 서버 목록으로 나갑니다. Esc로 닫습니다.");
      return;
    }
    if (inside(EXIT.hit, x, y)) {
      // 0x459d4b: menu2, disconnect, the server list.
      sounds.play(MENU_SOUNDS.primary);
      this.options.exit(true);
      return;
    }
    if (inside(CREATE.hit, x, y)) {
      this.openCreate();
      return;
    }
    const row = roomRowAt(x, y);
    const room = row >= 0 ? this.rows[row] : null;
    if (room?.title) {
      this.joinRoom(room);
      return;
    }
    const userRow = userRowAt(x, y);
    const user = userRow >= 0 ? userPage(this.state.users, this.userPageNo)[userRow] : null;
    if (user?.name) {
      this.openUserInfo(user.name, user.card);
      return;
    }
    const count = this.log.length;
    if (inside(LOBBY_SCROLL.up.hit, x, y)) this.scroll.up(count);
    else if (inside(LOBBY_SCROLL.down.hit, x, y)) this.scroll.down(count);
    else if (inside(LOBBY_SCROLL.track, x, y)) this.scroll.trackClick(count, y);
    const pages = roomPages(this.state.rooms, this.waitingOnly);
    if (inside(ROOM_PREV.hit, x, y)) this.roomPageNo = turnPage(this.roomPageNo, pages, -1);
    else if (inside(ROOM_NEXT.hit, x, y)) this.roomPageNo = turnPage(this.roomPageNo, pages, 1);
    const users = userPages(this.state.users);
    if (inside(USER_PREV.hit, x, y)) this.userPageNo = turnPage(this.userPageNo, users, -1);
    else if (inside(USER_NEXT.hit, x, y)) this.userPageNo = turnPage(this.userPageNo, users, 1);
  }

  /** A right release on a room (0x430880): its info popup, filled by the server's reply. */
  private rightRelease(x: number, y: number): void {
    if (this.helpScreen || !this.clear) return;
    const row = roomRowAt(x, y);
    const room = row >= 0 ? this.rows[row] : null;
    if (!room?.title) return;
    this.chat.close();
    this.roomInfo = ZEROED_INFO;
    this.openPopup("roomInfo", `${roomNumberText(room.number)}번 방 정보 창이 열렸습니다. Esc로 닫습니다.`);
    this.options.send({ type: "room-info", code: room.code });
  }

  /** A user row (0x4307b0 → 0x42f160): the row's record in the window; nothing is sent, no sound. */
  private openUserInfo(name: string, card: UserCard): void {
    this.chat.close();
    this.userInfo = { name, card };
    const { guilds } = this.options.assets;
    const parts = [
      `${name} 정보 창`,
      `닉네임 ${card.nick}`,
      card.greeting && `인사말 ${card.greeting}`,
      guildName(guilds, card.guild) && `길드 ${guildName(guilds, card.guild)}`,
      `레벨 ${levelTitle(card.level).trim()}`,
      `순위 ${card.rank}`,
      `셀포인트 ${card.cell}`,
      `전적 ${recordText(card.wins, card.losses)}`,
      "Esc로 닫습니다.",
    ];
    this.openPopup("userInfo", parts.filter(Boolean).join(". "));
  }

  private openPopup(popup: Exclude<Popup, null>, announce: string): void {
    this.popup = popup;
    this.status.textContent = announce;
  }

  /**
   * 내정보 (0x43c3c0): no sound or fade; the chat line closes. A character not owned becomes 루키
   * (index 0); this remake owns them all, but its "w-" variants are not in the window's list.
   */
  private openMyInfo(): void {
    const index = characterIndex(this.options.profile.character);
    const character = OWNED.includes(index) ? index : 0;
    this.chat.close();
    this.myInfo = {
      character,
      arrow: character,
      snapshot: character,
      useId: this.options.profile.useId,
      dropdown: false,
      greeting: false,
      busy: false,
      face: { frame: 0, lastMs: performance.now() },
    };
    this.loadPortrait(character);
    this.openPopup("myInfo", `내 정보 창: 캐릭터 ${CHARACTER_NAMES[character].replace(/\s+/g, "")}. ◀▶로 고르고 Enter로 저장, Esc로 취소합니다.`);
  }

  /**
   * 옵션 (0x459ab3 → 0x420dd0): the remote closes, the chat line stays closed, and the window
   * waits with the busy cursor for the friend list (C->S 0x63).
   */
  private openOption(): void {
    this.closePopup(false);
    this.chat.close();
    const { stage, assets, settings, send } = this.options;
    this.option = new OptionScreen({
      stage,
      assets,
      settings,
      send,
      message: (text) => this.showMessage(text),
      close: () => this.closeOption(),
      announce: (text) => (this.status.textContent = text),
    });
    this.openPopup("option", "옵션 창이 열렸습니다. 마우스로 고치고 Enter로 저장, Esc로 취소합니다. 같은 설정이 아래 옵션 부분에도 있습니다.");
  }

  /** 0x420e90: back to the lobby (scene 4) with the chat line open again. */
  private closeOption(): void {
    this.option?.dispose();
    this.option = null;
    this.closePopup(true);
  }

  /** 0x43c4c0: back to the lobby with the chat line open again. */
  private closeMyInfo(): void {
    if (this.myInfo?.greeting) this.greetingLine.close();
    this.myInfo = null;
    this.closePopup(true);
  }

  private loadPortrait(index: number): void {
    const id = CHARACTER_IDS[index];
    if (this.portraits.has(id)) return;
    this.portraits.set(id, null);
    loadSheet("character", portraitSheetName(id)).then(
      (sheet) => this.portraits.set(id, sheet),
      () => undefined,
    );
  }

  /** A new character is shown: its sprite is loaded again with anim 0 (0x413d30, 0x462e30). */
  private showCharacter(info: MyInfo, index: number): void {
    info.character = index;
    info.face = { frame: 0, lastMs: performance.now() };
    this.loadPortrait(index);
    this.status.textContent = `캐릭터 ${CHARACTER_NAMES[index].replace(/\s+/g, "")}`;
  }

  /** A release on the window (0x459552): the list, then the greeting popup, then the window's buttons. No sounds. */
  private myInfoRelease(x: number, y: number): void {
    const info = this.myInfo;
    if (!info) return;
    if (info.dropdown) {
      // The line under the release, if any; the list closes either way (0x43eda0, 0x43ed10).
      const lines = dropdownLines(OWNED);
      const j = dropdownLineAt(x, y, lines.length);
      if (j >= 0) this.showCharacter(info, lines[j]);
      info.dropdown = false;
      return;
    }
    if (info.greeting) {
      if (inside(GREETING_POPUP.ok.hit, x, y)) this.submitGreeting();
      else if (inside(GREETING_POPUP.cancel.hit, x, y)) this.closeGreeting();
      return;
    }
    switch (myInfoButtonAt(x, y)) {
      case "close":
        this.closeMyInfo();
        break;
      case "save":
        this.saveMyInfo();
        break;
      case "prev":
      case "next":
        info.arrow = stepCharacter(info.arrow, myInfoButtonAt(x, y) === "prev" ? -1 : 1, OWNED);
        this.showCharacter(info, info.arrow);
        break;
      case "useId":
        info.useId = !info.useId;
        this.status.textContent = info.useId ? "게임에서 아이디 사용" : "게임에서 닉네임 사용";
        break;
      case "greeting":
        info.greeting = true;
        this.greetingLine.open();
        this.greetingLine.text = this.options.profile.greeting;
        this.status.textContent = "인사말 창: 입력하고 Enter, 닫으려면 Esc.";
        break;
      // 머니 충전, SHOP and the item arrows do nothing; the colour and nickname icons need items.
      default:
        break;
    }
  }

  /** O or Enter (0x43e110): nothing changed closes; a change is sent and the window waits for the reply. */
  private saveMyInfo(): void {
    const info = this.myInfo;
    if (!info || info.busy) return;
    if (info.character === info.snapshot && info.useId === this.options.profile.useId) {
      this.closeMyInfo();
      return;
    }
    info.busy = true;
    this.status.textContent = "저장하는 중…";
    this.options.saveCharacter(CHARACTER_IDS[info.character], info.useId);
  }

  /** The greeting popup's O or Enter (0x44b120): trailing blanks cut; empty closes, all blank does nothing. */
  private submitGreeting(): void {
    const raw = this.greetingLine.view().text;
    if (raw === "") {
      this.closeGreeting();
      return;
    }
    const text = trimChat(raw);
    if (!text.trim()) return;
    // C->S 0x58: the popup stays until the server's copy comes back (greetingSaved).
    this.options.saveGreeting(text);
  }

  /** S->C 0x58 accepted: the greeting is the server's copy, and the popup closes. */
  greetingSaved(): void {
    this.closeGreeting();
  }

  private closeGreeting(): void {
    if (!this.myInfo) return;
    this.myInfo.greeting = false;
    this.greetingLine.close();
    this.status.textContent = "";
  }

  /** CREATE (0x42f340): the title editor takes the keys, the secret check is off; the chat line closes until the popup does. */
  private openCreate(): void {
    this.chat.close();
    this.secret = false;
    this.onPassword = false;
    this.openPopup("create", "방 만들기 창: 방 제목을 입력하고 Enter, 닫으려면 Esc.");
    this.title.open();
  }

  /** A release on the create popup (0x459800); no sounds. */
  private createRelease(x: number, y: number): void {
    switch (createPopupAt(x, y)) {
      case "cancel":
        this.closePopup(true);
        break;
      case "ok":
        this.submitCreate();
        break;
      case "secret":
        this.toggleSecret();
        break;
      case "title":
        this.editCreate(false);
        break;
      case "password":
        // The field takes the editor only while the secret check is on (0x4302d0).
        if (this.secret) this.editCreate(true);
        break;
      default:
        break;
    }
  }

  /** The secret check (0x42ff40): off clears the password and puts the editor back on the title; on leaves it where it is. */
  private toggleSecret(): void {
    this.secret = !this.secret;
    if (this.secret) this.secretLine.open();
    else this.secretLine.close();
    this.editCreate(this.secret && this.onPassword);
    this.status.textContent = this.secret ? "비밀방: 비밀번호 칸이 생겼습니다. Tab으로 옮겨 갑니다." : "비밀방 해제";
  }

  /** The create popup's editor on the password or the title (0x42f3f0). */
  private editCreate(password: boolean): void {
    this.onPassword = password;
    (password ? this.secretLine : this.title).focus();
  }

  /**
   * The password popup (0x42f500): the chat line closes and the popup's editor takes the keys,
   * empty. Anything open over the lobby closes first: only the page's buttons reach here with one.
   */
  private askPassword(code: string): void {
    if (this.myInfo) this.closeMyInfo();
    if (this.option) this.closeOption();
    if (this.popup) this.closePopup(false);
    this.chat.close();
    this.passwordRoom = code;
    const room = this.state.rooms.find((r) => r.code === code);
    const name = room ? `${roomNumberText(room.number)}번 방은 ` : "";
    this.openPopup("password", `${name}비밀방입니다. 비밀번호를 입력하고 Enter, 닫으려면 Esc.`);
    this.passwordLine.open();
  }

  /** A release on the password popup (0x459942): OK, then 취소; no sounds. The field takes the page's focus back. */
  private passwordRelease(x: number, y: number): void {
    const hit = passwordPopupAt(x, y);
    if (hit === "ok") this.submitPassword();
    else if (hit === "cancel") this.closePopup(true);
    else if (inside(PASSWORD_POPUP.field.hit, x, y)) this.passwordLine.focus();
  }

  /** OK or Enter (0x42fe60): nothing typed asks for it and the popup stays; else the join goes with it and the popup closes. */
  private submitPassword(): void {
    const code = this.passwordRoom;
    if (code === null) return;
    const password = this.passwordLine.view().text;
    if (password === "") {
      this.passwordLine.text = "";
      this.showMessage(PASSWORD_EMPTY);
      return;
    }
    this.options.send({ type: "join-room", code, password });
    this.closePopup(true);
  }

  /** Closes the popup; the create, password and room info popups open the chat line again, the remote's X too. */
  private closePopup(reopenChat: boolean): void {
    if (this.popup === "create") {
      this.title.close();
      this.secretLine.close();
      this.secret = false;
      this.onPassword = false;
    } else if (this.popup === "password") {
      this.passwordLine.close();
      this.passwordRoom = null;
    }
    this.popup = null;
    this.roomInfo = ZEROED_INFO;
    this.userInfo = null;
    this.status.textContent = "";
    if (reopenChat) this.chat.open();
  }

  private hideMessage(): void {
    this.message = null;
    this.status.textContent = "";
  }

  /** OK or Enter (0x4300d0). */
  private submitCreate(): void {
    const result = createTitle(this.title.view().text);
    if (!result) return;
    if ("message" in result) {
      this.title.text = "";
      this.showMessage(result.message);
      return;
    }
    // The check itself is not sent (C->S 0x03 has the title and the password only).
    const password = this.secret ? this.secretLine.view().text : "";
    this.closePopup(true);
    this.options.send({ type: "create-room", title: result.title, ...(password && { password }) });
  }

  /** Keys (0x45fa70): Enter sends or submits, Esc closes the top thing or leaves, F1 shows the help screen. */
  private key(event: KeyboardEvent): void {
    const active = document.activeElement;
    const editors = [this.chat, this.title, this.secretLine, this.passwordLine, this.greetingLine].map((line) => line.element);
    const ours =
      [...editors, this.options.canvas, document.body].includes(active as HTMLElement) ||
      (this.option?.owns(active) ?? false) ||
      active === null;
    if (!ours) return;
    // Tab moves on to the page's controls, which do everything the canvas does; a key change takes
    // it, and so does the create popup with the secret check on, where it swaps the fields (0x45fa70).
    if (event.key === "Tab") {
      if (this.popup === "create" && this.secret) {
        event.preventDefault();
        this.editCreate(!this.onPassword);
        return;
      }
      if (!(this.option && this.option.window.changing >= 0)) return;
    }
    if (event.code === "F1") {
      event.preventDefault();
      this.helpScreen = !this.helpScreen;
      return;
    }
    if (isMacroKey(event.code)) {
      // The browser's F-key actions are kept off; the macro opens the chat in the lobby only (0x461a50).
      event.preventDefault();
      this.macro(event.code);
      return;
    }
    if (this.option) {
      this.optionKey(event);
      return;
    }
    if (event.code === "Escape") {
      event.preventDefault();
      this.escape();
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      this.enter();
      return;
    }
    if (this.chat.isOpen) {
      if (event.key === "ArrowUp" && active === this.chat.element) {
        event.preventDefault();
        this.chat.text = this.lastSent;
        return;
      }
      if (event.key === "ArrowDown" && active === this.chat.element) {
        event.preventDefault();
        this.chat.text = commandCycle.next();
        return;
      }
      // The page may have taken the focus from the chat line: any character goes back to it.
      if (active !== this.chat.element && event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
        this.chat.focus();
      }
      return;
    }
    // A closed chat line opens on the next key while no popup is open, and that key types into it.
    if (this.popup === null && lobbyKeyOpensChat(event)) this.chat.open();
  }

  /** F2..F10 in the lobby (0x461a50): with no popup, the chat line opens empty and takes the macro, unsent. */
  private macro(code: string): void {
    const slot = macroSlot(code);
    if (slot === null || !macroOpens(slot, { box: false, blocked: this.popup !== null })) return;
    this.chat.open();
    this.chat.text = this.options.settings.current.macros[slot];
  }

  /** Enter and Esc in the option window (0x45fd3b, 0x46189c); Esc waits on the wait, the help and the message box first. */
  private optionKey(event: KeyboardEvent): void {
    const option = this.option;
    if (!option) return;
    if (event.key === "Enter") {
      event.preventDefault();
      option.enter(this.message !== null);
    } else if (event.code === "Escape") {
      event.preventDefault();
      if (option.window.busy) return;
      if (this.helpScreen) this.helpScreen = false;
      else if (this.message) this.hideMessage();
      else option.window.escape();
    }
  }

  /** Esc (0x461590): the help screen, the message box, then the popup; with nothing open, leave. */
  private escape(): void {
    // A request waiting for its reply takes no Esc (0x461590).
    if (this.busy) return;
    if (this.helpScreen) this.helpScreen = false;
    else if (this.message) this.hideMessage();
    else if (this.myInfo?.greeting) this.closeGreeting();
    // X and Esc drop the edits: the character shown goes back (0x43ecc0).
    else if (this.myInfo) this.closeMyInfo();
    // Esc on the remote leaves the chat line closed; only its X opens it again.
    else if (this.popup) this.closePopup(this.popup !== "remote");
    else this.options.exit(false);
  }

  /**
   * Enter (0x45fa70): the chat line sends its text; with it closed, the create popup submits. The
   * original also closes the line until the next key; here it stays open, as it looks the same
   * (empty, the caret at its start) and an IME's first syllable is not lost on reopening.
   */
  private enter(): void {
    if (this.chat.isOpen) {
      const text = this.chat.close();
      this.chat.open();
      if (sendableChat(text) !== null) {
        this.lastSent = text;
        this.options.say(text);
      }
    } else if (this.popup === "create") {
      this.submitCreate();
    } else if (this.popup === "password") {
      this.submitPassword();
    } else if (this.myInfo?.greeting) {
      this.submitGreeting();
    } else if (this.myInfo) {
      this.saveMyInfo();
    }
  }

  // Drawing (0x42ac60, then MSGBOX 0x443770 and the cursor again, 0x40cd74)

  private render(now: number): void {
    const { ctx } = this;
    const { assets } = this.options;
    ctx.imageSmoothingEnabled = false;
    this.holdFrame();
    if (this.message && now - this.message.since >= MESSAGE_BOX.hideMs) this.hideMessage();
    if (this.helpScreen) {
      // 0x40ca70: the help screen instead of the lobby; the message box still shows over it.
      drawHelpScreen(ctx, assets.help);
    } else if (this.myInfo) {
      this.drawMyInfoScene(this.myInfo, now);
    } else if (this.option) {
      this.drawOptionScene(this.option, now);
    } else {
      this.drawLobby(now);
    }
    this.drawMessage();
    if (this.pointer.inside) this.cursor.draw(ctx, assets.cursor, now, this.pointer.mouse, this.busy);
    if (this.fade) {
      drawDarkness(ctx, this.fade.darkness(now));
      if (this.fade.done(now)) this.fade = null;
    }
  }

  private drawLobby(now: number): void {
    const { ctx } = this;
    const { assets } = this.options;
    ctx.drawImage(assets.background, 0, 0);
    blit(ctx, assets.banner, BANNER.src, BANNER.at.x, BANNER.at.y);
    outlinedText(ctx, this.state.channel, CHANNEL_AT.x, CHANNEL_AT.y, CHANNEL_COLOUR, FONT_12);
    if (this.waitingOnly) this.button(SHOW_ALL.src, SHOW_ALL.at);
    if (this.clear) this.drawButtonArt();
    this.drawUsers();
    this.drawRooms();
    this.drawChat();
    this.notice.draw(ctx, now, LOBBY_NOTICE);
    this.drawPopup();
    this.drawEditorCaret(now);
    this.drawBalloons();
    outlinedText(ctx, `ver. ${INSTALLED_VERSION}`, VERSION_TEXT.x, VERSION_TEXT.y, YELLOW, FONT_13);
  }

  private button(src: Rect, at: { x: number; y: number }): void {
    blit(this.ctx, this.options.assets.button, src, at.x, at.y);
  }

  /** Pressed art where the held button is over `hit`. */
  private pressedOver(hit: Rect): boolean {
    const held = this.pointer.held;
    return held !== null && inside(hit, held.x, held.y);
  }

  /** Hover art while the mouse is over a button, pressed art while it is held there (0x42c0f0). */
  private drawButtonArt(): void {
    if (!this.pointer.inside) return;
    const { x, y } = this.pointer.mouse;
    const held = this.pointer.held !== null;
    const art = (button: Button) => {
      if (!inside(button.hit, x, y)) return;
      if (held) this.button(button.pressed, button.at);
      else if (button.hover) this.button(button.hover, button.at);
    };
    [CREATE, this.waitingOnly ? WAIT_GAME.on : WAIT_GAME.off, MY_INFO, SHOP, REMOTE, EXIT, ROOM_PREV, ROOM_NEXT, USER_PREV, USER_NEXT].forEach(art);
    if (held) [LOBBY_SCROLL.up, LOBBY_SCROLL.down].forEach(art);
  }

  /** 0x42d1d0: the bar under the mouse (lit, or pressed while held), guild, rank and name. */
  private drawUsers(): void {
    const { ctx } = this;
    const { assets } = this.options;
    const { x, y: mouseY } = this.pointer.mouse;
    const users = userPage(this.state.users, this.userPageNo);
    const under = this.clear && this.pointer.inside ? userRowAt(x, mouseY) : -1;
    users.forEach((user, row) => {
      if (!user) return;
      const y = userRowY(row);
      if (row === under && user.name) {
        if (this.pointer.held) this.button(USER_ART.held.src, { x: USER_ART.held.x, y: y + USER_ART.held.dy });
        else {
          ctx.save();
          ctx.globalCompositeOperation = "lighten";
          this.button(USER_ART.hover.src, { x: USER_ART.hover.x, y: y + USER_ART.hover.dy });
          ctx.restore();
        }
      }
      drawBadge(ctx, assets, user.card, { x: USER_PARTS.guild, y }, { x: USER_PARTS.rank, y });
      outlinedText(ctx, user.name, USER_PARTS.name, y, USER_PARTS.colour, FONT_12);
    });
  }

  /** 0x42c6b0: eight rows of the room table; a waiting row held under the mouse shows its held art. */
  private drawRooms(): void {
    const { ctx } = this;
    const { assets, maps } = this.options;
    const held = this.clear && this.pointer.held ? roomRowAt(this.pointer.held.x, this.pointer.held.y, true) : -1;
    this.rows.forEach((room, row) => {
      if (!room || !room.title) return;
      const y = roomRowY(row);
      const style = room.playing ? "playing" : "waiting";
      blit(ctx, assets.roomButton, row === held && !room.playing ? ROOM_ROW_ART.held : ROOM_ROW_ART[style], ROOM_ROW.x, y);
      const [titleFill, titleOutline] = ROOM_COLOURS[style].title;
      const [mapFill, mapOutline] = ROOM_COLOURS[style].map;
      outlinedText(ctx, roomNumberText(room.number), ROOM_PARTS.number.x, y + ROOM_PARTS.number.dy, titleFill, FONT_12, "left", titleOutline);
      outlinedText(ctx, room.title, ROOM_PARTS.title.x, y + ROOM_PARTS.title.dy, titleFill, FONT_13, "left", titleOutline);
      const icons = ROOM_ICONS[style];
      const icon = (k: number, part: { x: number; dy: number }) => blit(ctx, assets.roomButton, roomIconRect(k), part.x, y + part.dy);
      icon(icons.mode[room.mode], ROOM_PARTS.mode);
      icon(roomDoorIcon(room), ROOM_PARTS.door);
      icon(icons.disc, ROOM_PARTS.disc);
      const title = room.mapId === RANDOM_MAP ? RANDOM_MAP : maps.find((m) => m.id === room.mapId)?.title;
      if (title) outlinedText(ctx, shownMapName(title), ROOM_PARTS.map.x, y + ROOM_PARTS.map.dy, mapFill, FONT_13, "left", mapOutline);
      outlinedText(ctx, roomCountText(room), ROOM_PARTS.count.x, y + ROOM_PARTS.count.dy, mapFill, FONT_12, "left", mapOutline);
    });
  }

  /** 0x42d350: the log, its thumb and the input; the message box hides the input. */
  private drawChat(): void {
    const { ctx } = this;
    const first = this.scroll.first(this.log.length);
    drawChatLines(ctx, this.log, { first, count: LOBBY_CHAT.lines, x: LOBBY_CHAT.x, y: LOBBY_CHAT.y, step: LOBBY_CHAT.lineStep }, this.ownName);
    const thumb = this.scroll.drawnThumb(this.log.length);
    if (thumb !== null) drawThumb(ctx, this.options.assets.button, this.scroll.dragging ? LOBBY_SCROLL.thumbDragging : LOBBY_SCROLL.thumb, LOBBY_SCROLL.x, thumb);
    if (!this.chat.isOpen || this.message) return;
    const line = this.chat.view();
    if (line.text) outlinedText(ctx, line.text, CHAT_INPUT.x, CHAT_INPUT.y, "#ffffff", FONT_13, "left", LOBBY_CHAT.inputOutline);
  }

  /**
   * The caret (0x42eef0) of the editor in use: the create popup's field, the password popup's, else
   * the chat line's, shown even while it is closed. The remote, the room info and the message box hide it.
   */
  private drawEditorCaret(now: number): void {
    if (this.message || this.popup === "remote" || this.popup === "roomInfo") return;
    if (!this.caret.shown(now)) return;
    if (this.popup === "create") {
      const at = this.onPassword ? CREATE_POPUP.password.text : CREATE_POPUP.title.text;
      const line = this.onPassword ? this.secretLine : this.title;
      drawCaret(this.ctx, at.x + 7 * line.view().caret, at.y);
      return;
    }
    if (this.popup === "password") {
      const at = PASSWORD_POPUP.field.text;
      drawCaret(this.ctx, at.x + 7 * this.passwordLine.view().caret, at.y);
      return;
    }
    const caret = this.chat.isOpen ? this.chat.view().caret : 0;
    drawCaret(this.ctx, CHAT_INPUT.x + 7 * caret, CHAT_INPUT.y);
  }

  private drawPopup(): void {
    const { ctx } = this;
    const { assets } = this.options;
    if (this.popup === "create") {
      // 0x42e130: the right half of new_gameinfo, then item 5's secret check; the highlight and
      // betting checks need items 6 and 7, which nobody has.
      blit(ctx, assets.gameInfo, CREATE_POPUP.src, CREATE_POPUP.at.x, CREATE_POPUP.at.y);
      const { secret } = CREATE_POPUP;
      this.button(secret.icon.src, secret.icon.at);
      if (this.secret) {
        for (const part of [secret.check, secret.label, secret.field]) this.button(part.src, part.at);
      }
      for (const button of [CREATE_POPUP.ok, CREATE_POPUP.cancel]) {
        if (this.pressedOver(button.hit)) this.button(button.pressed, button.at);
      }
      const at = CREATE_POPUP.title.text;
      outlinedText(ctx, this.title.view().text, at.x, at.y, CREATE_POPUP.titleColour, FONT_13);
      const mask = passwordMask(this.secretLine.view().text);
      const star = CREATE_POPUP.password.text;
      if (mask) outlinedText(ctx, mask, star.x, star.y, CREATE_POPUP.titleColour, FONT_13);
    } else if (this.popup === "password") {
      // 0x42ea30 draws nothing while the message box is up; the popup stays open under it.
      if (!this.message) this.drawPasswordPopup();
    } else if (this.popup === "remote") {
      blit(ctx, assets.remote, REMOTE_POPUP.src, REMOTE_POPUP.at.x, REMOTE_POPUP.at.y);
      this.drawRemoteArt();
    } else if (this.popup === "roomInfo") {
      this.drawRoomInfo();
    } else if (this.popup === "userInfo") {
      this.drawUserInfo();
    }
  }

  /** 0x42da60: the snapshot's fields in #F5FF00; name, e-mail and gender stay empty (R). */
  private drawUserInfo(): void {
    const info = this.userInfo;
    if (!info) return;
    const { ctx } = this;
    const { assets } = this.options;
    const { card } = info;
    const f = USER_INFO_FIELDS;
    const text = (value: string, at: { x: number; y: number }, font = FONT_12) => outlinedText(ctx, value, at.x, at.y, USER_INFO.colour, font);
    blit(ctx, assets.userInfo, USER_INFO.src, USER_INFO.at.x, USER_INFO.at.y);
    text(info.name, f.id);
    text(card.nick, f.nick);
    greetingLines(card.greeting).forEach((line, i) => text(line, { x: f.greeting.x, y: f.greeting.y + f.greeting.lineStep * i }, FONT_13));
    drawBadge(ctx, assets, card, f.guild.icon, f.level.icon);
    text(guildName(assets.guilds, card.guild), f.guild.name);
    text(String(card.manner), f.manner);
    text(String(card.rank), f.rank);
    text(levelTitle(card.level), f.level.title);
    text(String(card.cell), f.cell);
    text(recordText(card.wins, card.losses), f.record);
    text(String(card.exp), f.exp);
    const items = this.options.account()?.items ?? [];
    const { whisper, mask } = USER_INFO_ITEMS;
    if (hasItem(items, ITEM_WHISPER)) this.button(whisper.lit, whisper.litAt);
    if (hasItem(items, ITEM_MASK)) this.button(mask.lit, mask.litAt);
    // Pressed art, the first held over (no message box gate): X, then the icons the items light.
    const held = this.pointer.held;
    if (!held) return;
    if (inside(USER_INFO_CLOSE.hit, held.x, held.y)) this.button(USER_INFO_CLOSE.pressed, USER_INFO_CLOSE.at);
    else if (hasItem(items, ITEM_WHISPER) && inside(whisper.hit, held.x, held.y)) this.button(whisper.pressed, whisper.at);
    else if (hasItem(items, ITEM_MASK) && inside(mask.hit, held.x, held.y)) this.button(mask.pressed, mask.at);
  }

  /** 0x42ea30: new_basicwindow, the lock and its label, OK or 취소 held, and one '*' a byte. */
  private drawPasswordPopup(): void {
    const { ctx } = this;
    const { assets } = this.options;
    const popup = PASSWORD_POPUP;
    blit(ctx, assets.basicWindow, popup.window.src, popup.window.at.x, popup.window.at.y);
    this.button(popup.lock.src, popup.lock.at);
    blit(ctx, assets.button2, popup.label.src, popup.label.at.x, popup.label.at.y);
    for (const button of [popup.ok, popup.cancel]) {
      if (this.pressedOver(button.hit)) blit(ctx, assets.button2, button.pressed, button.at.x, button.at.y);
    }
    const mask = passwordMask(this.passwordLine.view().text);
    if (mask) plainText(ctx, mask, popup.field.text.x, popup.field.text.y, popup.colour, FONT_13);
  }

  /** 0x42e560: hover art under the mouse, pressed art while held; the message box does not stop it. */
  private drawRemoteArt(): void {
    const { assets } = this.options;
    const close = REMOTE_POPUP.close;
    if (this.pressedOver(close.hit)) blit(this.ctx, assets.button2, close.pressed, close.at.x, close.at.y);
    if (!this.pointer.inside) return;
    const { x, y } = this.pointer.mouse;
    for (const button of REMOTE_POPUP.buttons) {
      if (!inside(button.hit, x, y)) continue;
      blit(this.ctx, assets.button2, button.hover, button.at.x, button.at.y);
      if (this.pointer.held) blit(this.ctx, assets.button2, button.pressed, button.at.x, button.at.y);
    }
  }

  /** 0x42d800: the status, and each seated player by slot (guild, rank, name). */
  private drawRoomInfo(): void {
    const { ctx } = this;
    const { assets } = this.options;
    blit(ctx, assets.gameInfo, ROOM_INFO.src, ROOM_INFO.at.x, ROOM_INFO.at.y);
    const { colour, outline } = ROOM_INFO;
    outlinedText(ctx, roomInfoStatus(this.roomInfo), ROOM_INFO.status.x, ROOM_INFO.status.y, colour, FONT_COURIER_15, "left", outline);
    for (const player of this.roomInfo.players) {
      if (!player.name) continue;
      const row = roomInfoRow(player.slot);
      // No gender (every remake account's is 0) and no stars (their source is not known).
      drawBadge(ctx, assets, player.badge, row.guild, row.rank);
      outlinedText(ctx, player.name, row.name.x, row.name.y, colour, FONT_13, "left", outline);
    }
    const close = ROOM_INFO.close;
    if (this.pressedOver(close.hit)) this.button(close.pressed, close.at);
  }

  /** MSGBOX (0x443770): images2, one or two lines, the button's pressed art and its own balloon. */
  private drawMessage(): void {
    const message = this.message;
    if (!message) return;
    const { ctx } = this;
    blit(ctx, this.options.assets.messageBox, MESSAGE_BOX.src, MESSAGE_BOX.at.x, MESSAGE_BOX.at.y);
    for (const line of messageLines(message.text)) {
      outlinedText(ctx, line.text, line.x, line.y, MESSAGE_BOX.colour, FONT_12, "left", MESSAGE_BOX.outline);
    }
    const button = MESSAGE_BOX.button;
    if (this.pressedOver(button.hit)) this.button(button.pressed, button.at);
    const { x, y } = this.pointer.mouse;
    if (this.balloons && this.pointer.inside && inside(button.hit, x, y)) drawBalloon(ctx, MESSAGE_HELP, x, y);
  }

  /** 0x42b450: the balloon under the mouse; a popup's go on under the message box, the lobby's stop. */
  private drawBalloons(): void {
    if (!this.balloons || !this.pointer.inside) return;
    const balloon = lobbyHelpAt(this.pointer.mouse.x, this.pointer.mouse.y, {
      // My-info and the option window draw their own balloons.
      popup: this.popup === "myInfo" || this.popup === "option" ? null : this.popup,
      // The user information window's only balloon is its X's (0x42be43).
      message: this.message !== null,
      waitingOnly: this.waitingOnly,
      rows: this.rows,
    });
    if (balloon) drawBalloon(this.ctx, balloon.text, balloon.x, balloon.y);
  }

  /**
   * The lobby's draw returns early for scenes 10-13 (0x42ae43): its background, banner, channel,
   * SHOW ALL and user list, not dimmed.
   */
  private drawPartialLobby(): void {
    const { ctx } = this;
    const { assets } = this.options;
    ctx.drawImage(assets.background, 0, 0);
    blit(ctx, assets.banner, BANNER.src, BANNER.at.x, BANNER.at.y);
    outlinedText(ctx, this.state.channel, CHANNEL_AT.x, CHANNEL_AT.y, CHANNEL_COLOUR, FONT_12);
    if (this.waitingOnly) this.button(SHOW_ALL.src, SHOW_ALL.at);
    this.drawUsers();
  }

  /** Scene 13 (0x420ed0): the partial lobby, then the window; no "ver." (0x420ed0 never calls 0x440490). */
  private drawOptionScene(option: OptionScreen, now: number): void {
    const frame = { mouse: this.pointer.mouse, inside: this.pointer.inside, held: this.pointer.held, message: this.message !== null };
    option.update(frame);
    this.drawPartialLobby();
    option.draw(this.ctx, now, frame);
  }

  // My-info (scene 10: 0x43c510, main draw 0x43c790)

  /** Scene 10: the partial lobby, then the window, its tooltips, the character list and "ver. %d". */
  private drawMyInfoScene(info: MyInfo, now: number): void {
    const { ctx } = this;
    const { assets } = this.options;
    this.drawPartialLobby();
    blit(ctx, assets.statusWindow, MY_INFO_WINDOW.src, MY_INFO_WINDOW.at.x, MY_INFO_WINDOW.at.y);
    if (info.useId) this.button(USE_ID_MARK.src, USE_ID_MARK.at);
    this.drawMyInfoFields();
    this.drawPortrait(info, now);
    outlinedText(ctx, CHARACTER_NAMES[info.character], CHARACTER_NAME_AT.x, CHARACTER_NAME_AT.y, FIELD_COLOUR, FONT_14);
    // A popup is not drawn while the message box is up (0x443980); the button art only with the list closed.
    if (info.greeting) {
      if (!this.message) this.drawGreetingPopup(now);
    } else if (!info.dropdown) {
      this.drawMyInfoButtons();
    }
    this.drawMyInfoBalloon(info);
    if (info.dropdown && !info.greeting) this.drawDropdown();
    outlinedText(ctx, `ver. ${INSTALLED_VERSION}`, VERSION_TEXT.x, VERSION_TEXT.y, YELLOW, FONT_13);
  }

  /**
   * The fields in #F5FF00 from the login record (0x43c790): its numbers as of the login, as the
   * original never refreshed them. Name, gender and e-mail are the sign-up's and stay empty (R).
   */
  private drawMyInfoFields(): void {
    const { ctx } = this;
    const { assets, profile } = this.options;
    const account = this.options.account();
    const text = (value: string, at: { x: number; y: number }, font = FONT_12) => outlinedText(ctx, value, at.x, at.y, FIELD_COLOUR, font);
    text(account?.id ?? this.ownId, FIELDS.id);
    text(profile.nick, FIELDS.nick);
    greetingLines(profile.greeting).forEach((line, i) => text(line, { x: FIELDS.greeting.x, y: FIELDS.greeting.y + FIELDS.greeting.lineStep * i }, FONT_13));
    if (!account) return;
    drawBadge(ctx, assets, account, FIELDS.guild.icon, FIELDS.level.icon);
    text(guildName(assets.guilds, account.guild), FIELDS.guild.name);
    text(String(account.manner), FIELDS.manner);
    text(String(account.rank), FIELDS.standing);
    text(levelTitle(account.level), FIELDS.level.title);
    text(String(account.cell), FIELDS.cellPoint);
    text(recordText(account.wins, account.losses), FIELDS.record);
    text(String(account.exp), FIELDS.exp);
  }

  /** `_p.spr` from its top-left, its one animation at its own rate (0x462b90, 0x4620e0). */
  private drawPortrait(info: MyInfo, now: number): void {
    const sheet = this.portraits.get(CHARACTER_IDS[info.character]);
    const anim = sheet?.meta.animations[0];
    if (!sheet || !anim || anim.frames.length === 0) return;
    if (animDue(now, info.face.lastMs, anim.unknown_u16)) {
      info.face = { frame: (info.face.frame + 1) % anim.frames.length, lastMs: now };
    }
    blit(this.ctx, sheet.image, anim.frames[info.face.frame % anim.frames.length].rect, PORTRAIT_AT.x, PORTRAIT_AT.y);
  }

  /** Pressed art for the first button held over, in the window's order; hover art for 머니 충전, SHOP and 수정. */
  private drawMyInfoButtons(): void {
    if (!this.pointer.inside) return;
    const { assets } = this.options;
    const held = this.pointer.held;
    const { x, y } = held ?? this.pointer.mouse;
    for (const [name, b] of Object.entries(MY_INFO_BUTTONS)) {
      if (!inside(b.hit, x, y)) continue;
      const sheet = name === "save" ? assets.button2 : assets.button;
      if (held) {
        blit(this.ctx, sheet, b.pressed, b.at.x, b.at.y);
        return;
      }
      if (b.hover) blit(this.ctx, sheet, b.hover, b.at.x, b.at.y);
    }
  }

  /** The greeting popup (0x43c790, 0x43e040): new_charchange's lower half, two lines of 굴림체 13, its caret, O and X held. */
  private drawGreetingPopup(now: number): void {
    const { ctx } = this;
    const { assets } = this.options;
    const popup = GREETING_POPUP;
    blit(ctx, assets.charChange, popup.src, popup.at.x, popup.at.y);
    const line = this.greetingLine.view();
    greetingLines(line.text).forEach((text, i) => outlinedText(ctx, text, popup.text.x, popup.text.y + popup.text.lineStep * i, FIELD_COLOUR, FONT_13));
    if (this.caret.shown(now)) {
      const at = greetingCaret(cp949Bytes(line.text), line.caret);
      drawCaret(ctx, at.x, at.y);
    }
    for (const button of [popup.ok, popup.cancel]) {
      if (this.pressedOver(button.hit)) blit(ctx, assets.button2, button.pressed, button.at.x, button.at.y);
    }
  }

  /** 0x43d9a0: none while the list is open; under the message box only the popup's. */
  private drawMyInfoBalloon(info: MyInfo): void {
    if (!this.balloons || !this.pointer.inside || info.dropdown) return;
    if (this.message && !info.greeting) return;
    const { x, y } = this.pointer.mouse;
    const balloon = myInfoHelpAt(x, y, { useId: info.useId, greeting: info.greeting });
    if (balloon) drawBalloon(this.ctx, balloon.text, balloon.x, balloon.y);
  }

  /** The character list (new_winobject) under the name box: the line under the mouse lit, no outline. */
  private drawDropdown(): void {
    const { ctx } = this;
    const lines = dropdownLines(OWNED);
    blit(ctx, this.options.assets.winObject, [1, 1, 72, dropdownHeight(OWNED)], DROPDOWN.at.x, DROPDOWN.at.y);
    const { x, y } = this.pointer.mouse;
    lines.forEach((index, j) => {
      const colour = this.pointer.inside && dropdownLineLit(j, x, y) ? DROPDOWN.lit : DROPDOWN.idle;
      plainText(ctx, CHARACTER_NAMES[index], DROPDOWN.text.x, DROPDOWN.text.y + DROPDOWN.text.step * j, colour, FONT_12);
    });
  }
}
