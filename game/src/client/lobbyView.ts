// The lobby (scene 4, "LOBBY") as a page: the original's screen on a canvas (lobbyScreen.ts) and,
// under it, page controls for the keyboard and screen readers. The room code join is the remake's.
import { cutBytes, trimChat, typeable } from "../server/cp949.ts";
import { hasItem, ITEM_COLOUR, ITEM_NICK, ITEM_WHISPER } from "../server/items.ts";
import type { Badge, ClientMessage, LobbyUser, OwnAccount, RoomStatus, RoomSummary } from "../server/protocol.ts";
import { RANDOM_MAP, ROOM_CHAT_LIMIT, ROOM_CODE_LENGTH, shownName } from "../server/protocol.ts";
import type { FriendRecord } from "./optionWindow.ts";
import { MODE_NAMES } from "../sim/modes.ts";
import { SCREEN_H, SCREEN_W } from "./hudLayout.ts";
import type { FriendReply } from "./friends.ts";
import { CREATE_PASSWORD_LIMIT, CREATE_TITLE_LIMIT, createTitle, ID_LIMIT, roomCountText, roomInfoStatus } from "./lobbyLayout.ts";
import type { MyProfile, RankingCommand } from "./lobbyScreen.ts";
import { loadLobbyAssets, LobbyScreen } from "./lobbyScreen.ts";
import { mapTitle } from "./menu.ts";
import type { NoticeLine } from "./noticeLine.ts";
import { CHARACTER_IDS, CHARACTER_NAMES, NICK_LIMIT } from "./myInfoLayout.ts";
import { keepRecall } from "./chat.ts";
import { OptionPanel } from "./optionPanel.ts";
import type { RankingAccess } from "./ranking.ts";
import { chatLineClass, shownChat } from "./roomChat.ts";
import { roomNumberText } from "./roomLayout.ts";
import type { SettingsStore } from "./settings.ts";
import { sounds } from "./shell.ts";
import { h } from "./ui.ts";

export interface LobbyState {
  channel: string;
  rooms: RoomSummary[];
  users: LobbyUser[];
}

export interface LobbyActions {
  send(message: ClientMessage): void;
  /** A chat line, through the session's send rule. */
  say(text: string): void;
  /** EXIT, 채널변경 or Esc: back to the server list (scene 2); only EXIT asks the servers again. */
  exit(askServers: boolean): void;
  /** WAIT GAME was turned on or off, for the way back from a room. */
  filterChanged(waitingOnly: boolean): void;
  /** The my-info window's data; the session keeps it. */
  profile: MyProfile;
  /** The login record as last sent. */
  account(): OwnAccount | null;
  /** Save the character, its hue and the ID check (set-character); the server answers with profile or an error. */
  saveCharacter(character: string, hue: number, useId: boolean): void;
  /** Save the greeting (set-greeting); the server answers with the account. */
  saveGreeting(text: string): void;
  /** Change the nickname (item 9, once a day); the server answers with the account or a refusal. */
  saveNick(nick: string): void;
  /** The whisper target the chat lines also go to (item 8's ID popup); "" clears it. */
  whisperTo(id: string): void;
  /** The option object, for the option window and the page's option controls. */
  settings: SettingsStore;
  /** The ranking's list and its fetches on the lobby's connection, for the ranking window. */
  ranking: RankingAccess;
  /** The session's notice line, which the canvas draws. */
  notice: NoticeLine;
}

/** The ranking window's mouse-only controls for the keyboard: each clicks the same place. */
const RANKING_MIRRORS: readonly [RankingCommand, string][] = [
  ["open", "랭킹 창 열기 (리모컨의 랭킹)"],
  ["prev", "◀: 이전 리스트 보기 (랭킹 창)"],
  ["next", "▶: 다음 리스트 보기 (랭킹 창)"],
  ["find", "FIND: 아이디 찾기 창 열기 (랭킹 창)"],
  ["ok", "확인: 넣은 아이디 찾기 (아이디 찾기 창 O)"],
  ["cancel", "취소: 아이디 찾기 창 닫기 (아이디 찾기 창 X)"],
  ["close", "창 닫기 (랭킹 창 X)"],
];

/** S->C 0x55: a room's status and its players by slot. */
export interface RoomInfoReply {
  code: string;
  status: RoomStatus;
  round: number;
  players: { slot: number; name: string; badge: Badge }[];
}

interface LobbyWelcome {
  playerId: number;
  maps: { id: string; title: string }[];
}

/** Keep what the lobby's editors take: cp949 text under `limit` bytes. */
function fitBytes(input: HTMLInputElement, limit: number): void {
  const kept = cutBytes(typeable(input.value), limit - 1);
  if (kept !== input.value) input.value = kept;
}

export class LobbyView {
  readonly root: HTMLElement;
  readonly errorLine = h("p", { class: "error", role: "alert" });
  private readonly welcome: LobbyWelcome;
  private readonly actions: LobbyActions;
  private readonly canvas = h("canvas", {
    width: SCREEN_W,
    height: SCREEN_H,
    class: "game-canvas",
    role: "img",
    "aria-label": "로비 화면. 마우스로 조작하며, 같은 기능이 아래 버튼에도 있습니다.",
  });
  private readonly loading = h("p", { class: "loading", role: "status" }, "로비를 불러오는 중…");
  private readonly stage = h("div", { class: "stage" }, this.canvas, this.loading);
  private readonly heading = h("span", {});
  private readonly roomList = h("ul", { class: "roster room-list", "aria-label": "방 목록" });
  private readonly userList = h("ul", { class: "roster", "aria-label": "로비 사용자" });
  private readonly chatList = h("ol", { class: "chat-log", "aria-label": "로비 채팅", "aria-live": "polite" });
  private readonly chatInput = h("input", { id: "lobby-chat", autocomplete: "off" });
  /** The room info a 정보 button asked for, read out; the canvas shows it in its popup. */
  private readonly infoLine = h("p", { role: "status" });
  /** The my-info window's character, for the keyboard: the window's list order and names. */
  private readonly characterSelect = h(
    "select",
    { id: "lobby-character" },
    ...CHARACTER_IDS.map((id, i) => h("option", { value: id }, CHARACTER_NAMES[i].replace(/\s+/g, ""))),
  );
  /** The colour popup's hue (item 20), for the keyboard: −180..180. */
  private readonly hueInput = h("input", { id: "lobby-hue", type: "number", min: "-180", max: "180", step: "1" });
  /** The nickname popup's nick (item 9), for the keyboard. */
  private readonly nickInput = h("input", { id: "lobby-nick", autocomplete: "off" });
  private readonly nickButton = h("button", { class: "btn", type: "submit" }, "닉네임 바꾸기");
  /** The whisper icon's ID popup (item 8), for the keyboard: the icon, the ID and OK in one. */
  private readonly whisperInput = h("input", { id: "lobby-whisper", autocomplete: "off" });
  private readonly whisperButton = h("button", { class: "btn", type: "submit" }, "귓말 대상 정하기");
  private readonly optionPanel: OptionPanel;
  private screen: LobbyScreen | null = null;
  /** A message box asked for before the canvas screen came up: it shows once the screen is there. */
  private pendingMessage: string | null = null;
  private state: LobbyState;
  /** The room whose 정보 button was pressed last. */
  private infoAsked: string | null = null;
  /** Who sent each add or delete still unanswered, in order: the server answers them in turn. */
  private friendAskers: ("window" | "section")[] = [];
  private disposed = false;

  constructor(
    welcome: LobbyWelcome,
    state: LobbyState,
    chatLog: readonly string[],
    waitingOnly: boolean,
    actions: LobbyActions,
    /** Coming from the server list: the lobby's first frames fade in (0x449172). */
    fadeIn = false,
  ) {
    this.welcome = welcome;
    this.actions = actions;
    this.state = state;
    const { send, say, exit, filterChanged, profile, account, saveCharacter, saveGreeting, saveNick, whisperTo, settings, ranking } = actions;

    const title = h("input", { id: "lobby-title", autocomplete: "off" });
    title.addEventListener("input", () => fitBytes(title, CREATE_TITLE_LIMIT));
    // The create popup's secret check and its password (item 5, 0x42ff40): unchecking clears it.
    const secret = h("input", { id: "lobby-secret", type: "checkbox" });
    const password = h("input", { id: "lobby-password", autocomplete: "off", disabled: true });
    password.addEventListener("input", () => fitBytes(password, CREATE_PASSWORD_LIMIT));
    secret.addEventListener("change", () => {
      password.disabled = !secret.checked;
      if (!secret.checked) password.value = "";
    });
    const create = (event: Event) => {
      event.preventDefault();
      if (this.screen?.dropsClicks) return;
      // The create popup's OK (0x4300d0): a leading space asks for a title; an empty one does nothing there.
      const result = createTitle(title.value);
      if (result === null || "message" in result) {
        this.showMessage(result?.message ?? "방제목을 입력하세요");
        title.focus();
        return;
      }
      const typed = secret.checked ? password.value : "";
      send({ type: "create-room", title: result.title, ...(typed && { password: typed }) });
    };
    const code = h("input", {
      id: "lobby-code",
      maxlength: ROOM_CODE_LENGTH,
      autocomplete: "off",
      autocapitalize: "characters",
      spellcheck: "false",
      placeholder: "ABCD",
      class: "code-input",
    });
    const join = (event: Event) => {
      event.preventDefault();
      if (this.screen?.dropsClicks) return;
      const value = code.value.trim().toUpperCase();
      if (value.length !== ROOM_CODE_LENGTH) {
        this.errorLine.textContent = `방 코드 ${ROOM_CODE_LENGTH}자리를 입력하세요.`;
        code.focus();
        return;
      }
      send({ type: "join-room", code: value });
    };
    this.chatInput.addEventListener("input", () => fitBytes(this.chatInput, ROOM_CHAT_LIMIT));
    this.characterSelect.value = profile.character;
    this.showHue();
    this.nickInput.addEventListener("input", () => fitBytes(this.nickInput, NICK_LIMIT));
    this.showNick();
    this.whisperInput.addEventListener("input", () => fitBytes(this.whisperInput, ID_LIMIT));
    const locked = !hasItem(account()?.items ?? [], ITEM_WHISPER);
    this.whisperInput.disabled = locked;
    this.whisperButton.disabled = locked;
    const setWhisper = (event: Event) => {
      event.preventDefault();
      // The popup's OK takes the ID as typed; empty clears the target. The remote's 귓말 opens it only
      // when the lobby takes clicks.
      if (this.screen?.dropsClicks) return;
      if (this.screen) this.screen.setWhisper(this.whisperInput.value);
      else whisperTo(this.whisperInput.value);
    };
    // EXIT's release, dropped as the canvas drops it under the help or a wait.
    const leave = () => {
      if (!this.screen?.dropsClicks) exit(true);
    };
    const saveMyInfo = (event: Event) => {
      event.preventDefault();
      if (this.screen?.dropsClicks) return;
      // The window's O: nothing changed closes without asking the server (0x43e110).
      const hue = this.hueInput.disabled ? profile.hue : Math.max(-180, Math.min(180, Math.trunc(Number(this.hueInput.value) || 0)));
      if (this.characterSelect.value === profile.character && hue === profile.hue) return;
      saveCharacter(this.characterSelect.value, hue, profile.useId);
    };
    const saveNickname = (event: Event) => {
      event.preventDefault();
      if (this.screen?.dropsClicks) return;
      // The nickname popup's O (0x44aff0): trailing blanks cut, empty or all blank sends nothing.
      const nick = trimChat(this.nickInput.value);
      if (nick === "" || nick === profile.nick) return;
      saveNick(nick);
    };
    this.optionPanel = new OptionPanel({
      settings,
      send: (message) => {
        this.noteFriendAsk(message, "section");
        send(message);
      },
      message: (text) => this.showMessage(text),
      busy: () => this.screen?.dropsClicks ?? false,
    });
    const submitChat = (event: Event) => {
      event.preventDefault();
      // As the canvas line's Enter: nothing goes while a window has closed the line, and the form
      // keeps its text as the line does; the ↑ recall line takes it first.
      if (this.screen && !this.screen.takesChat) return;
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
        h("button", { class: "btn small", type: "button", onclick: leave }, "← 나가기"),
        h("h1", { tabindex: "-1" }, this.heading),
      ),
      this.stage,
      h(
        "p",
        { class: "keys" },
        "방 줄을 누르면 들어가고 오른쪽 버튼은 방 정보입니다. CREATE GAME은 방 만들기, WAIT GAME은 기다리는 방만 보기, 내정보는 캐릭터 고르기(◀▶ 또는 이름 칸을 누른 채 끌기, Enter 저장), 리모컨의 OPTION은 옵션 창(같은 설정이 아래 옵션 부분에도 있음), 리모컨의 랭킹은 랭킹 창(아래 랭킹 창 버튼으로도 열고 넘기며, FIND 창에서 아이디를 넣고 Enter), F2~F10은 채팅 줄에 단축 메시지 넣기, 채팅 아래 귓말·마스크 아이콘은 아이디 창(Enter 없음, 편집기 뒤 OK·취소 버튼, 귓말은 아래 귓말 대상 칸으로도), F1은 도움말 화면(다시 F1이나 Esc로 닫기), Esc는 메시지·열린 창 닫기(없으면, 또는 아이디 창이 열려 있으면 나가기)입니다.",
      ),
      h(
        "form",
        { class: "row", onsubmit: create },
        h("div", { class: "field" }, h("label", { for: "lobby-title" }, `방 제목 (최대 ${CREATE_TITLE_LIMIT - 1}바이트)`), title),
        h("div", { class: "field" }, secret, h("label", { for: "lobby-secret" }, "비밀방")),
        h("div", { class: "field" }, h("label", { for: "lobby-password" }, `비밀번호 (최대 ${CREATE_PASSWORD_LIMIT - 1}바이트)`), password),
        h("button", { class: "btn primary", type: "submit" }, "방 만들기"),
      ),
      h(
        "form",
        { class: "row", onsubmit: saveMyInfo },
        h("div", { class: "field" }, h("label", { for: "lobby-character" }, "내 캐릭터 (내정보)"), this.characterSelect),
        h("div", { class: "field" }, h("label", { for: "lobby-hue" }, "캐릭터 색조 −180~180 (내정보 색조 창, 아이템 20)"), this.hueInput),
        h("button", { class: "btn", type: "submit" }, "저장"),
      ),
      h(
        "form",
        { class: "row", onsubmit: saveNickname },
        h("div", { class: "field" }, h("label", { for: "lobby-nick" }, `닉네임 (내정보 닉네임 창, 아이템 9, 하루 한 번, 최대 ${NICK_LIMIT - 1}바이트)`), this.nickInput),
        this.nickButton,
      ),
      h(
        "form",
        { class: "row", onsubmit: setWhisper },
        h(
          "div",
          { class: "field" },
          h("label", { for: "lobby-whisper" }, `귓말 대상 아이디 (로비 귓말 아이콘의 아이디 창, 아이템 8, 비우면 해제, 최대 ${ID_LIMIT - 1}바이트)`),
          this.whisperInput,
        ),
        this.whisperButton,
      ),
      h(
        "form",
        { class: "row", onsubmit: join },
        h("div", { class: "field" }, h("label", { for: "lobby-code" }, "방 코드"), code),
        h("button", { class: "btn", type: "submit" }, "코드로 참가"),
      ),
      h(
        "div",
        { class: "actions", role: "group", "aria-label": "랭킹 창 버튼" },
        ...RANKING_MIRRORS.map(([command, label]) =>
          h("button", { class: "btn", type: "button", onclick: () => this.screen?.rankingCommand(command) }, label),
        ),
      ),
      this.optionPanel.root,
      this.errorLine,
      h("h2", { class: "sr-only" }, "방 목록"),
      this.roomList,
      this.infoLine,
      h("h2", { class: "sr-only" }, "로비 사용자"),
      this.userList,
      h(
        "section",
        { class: "chat", "aria-label": "로비 채팅" },
        this.chatList,
        h(
          "form",
          { class: "row", onsubmit: submitChat },
          h("div", { class: "field" }, h("label", { for: "lobby-chat" }, "채팅"), this.chatInput),
          h("button", { class: "btn small", type: "submit" }, "보내기"),
        ),
      ),
    );
    for (const line of chatLog) this.addChat(line);
    this.update(state);

    loadLobbyAssets().then(
      (assets) => {
        if (this.disposed) return;
        this.screen = new LobbyScreen(
          {
            canvas: this.canvas,
            stage: this.stage,
            assets,
            playerId: welcome.playerId,
            maps: welcome.maps,
            sounds,
            waitingOnly,
            send: (message) => {
              this.noteFriendAsk(message, "window");
              send(message);
            },
            say,
            exit,
            filterChanged,
            profile,
            account,
            saveCharacter,
            saveGreeting,
            saveNick,
            whisperTo,
            fadeIn,
            settings,
            ranking,
            notice: actions.notice,
          },
          this.state,
        );
        this.screen.setLog(chatLog);
        if (this.pendingMessage !== null) this.screen.showMessage(this.pendingMessage);
        this.pendingMessage = null;
        this.loading.remove();
      },
      (error: Error) => {
        this.loading.textContent = `로비 그림을 불러오지 못했습니다: ${error.message}`;
      },
    );
  }

  update(state: LobbyState): void {
    this.state = state;
    this.screen?.update(state);
    this.heading.textContent = `로비 · ${state.channel}`;
    const maps = new Map(this.welcome.maps.map((m) => [m.id, mapTitle(m.title)]));
    this.roomList.replaceChildren(
      ...(state.rooms.length === 0
        ? [h("li", {}, "만들어진 방이 없습니다.")]
        : state.rooms.map((room) =>
            h(
              "li",
              {},
              h(
                "span",
                {},
                `${roomNumberText(room.number)} ${room.title} · ${MODE_NAMES[room.mode]} · ${room.mapId === RANDOM_MAP ? RANDOM_MAP : (maps.get(room.mapId) ?? room.mapId)} · ${roomCountText(room)} · ${room.playing ? "게임 중" : "대기 중"}${room.secret ? " · 비밀방" : ""}`,
              ),
              h(
                "button",
                {
                  class: "btn small",
                  type: "button",
                  // What a click on the room's line does; before the canvas is up, the server asks for a password.
                  onclick: () => (this.screen ? this.screen.joinRoom(room) : this.actions.send({ type: "join-room", code: room.code })),
                },
                "참가",
              ),
              h(
                "button",
                {
                  class: "btn small",
                  type: "button",
                  "aria-label": `${roomNumberText(room.number)}번 방 정보`,
                  onclick: () => {
                    // What a right release on the room does, dropped as it is under the help, a wait, a popup or a message.
                    if (this.screen && !this.screen.takesRoomInfo) return;
                    this.infoAsked = room.code;
                    this.actions.send({ type: "room-info", code: room.code });
                  },
                },
                "정보",
              ),
            ),
          )),
    );
    this.userList.replaceChildren(
      ...state.users.map((user) =>
        h(
          "li",
          {},
          user.name,
          user.id === this.welcome.playerId ? " (나)" : "",
          h(
            "button",
            {
              class: "btn small",
              type: "button",
              "aria-label": `${user.name} 정보`,
              // What a click on the user's line does: the user info window, which Esc closes once the
              // focus leaves the button for the page.
              onclick: (event: Event) => {
                if (this.screen?.showUser(user.id)) (event.currentTarget as HTMLElement).blur();
              },
            },
            "정보",
          ),
        ),
      ),
    );
  }

  addChat(line: string): void {
    const { nick, useId } = this.actions.profile;
    const own = shownName({ name: this.state.users.find((u) => u.id === this.welcome.playerId)?.name ?? "", nick, useId });
    this.chatList.append(h("li", { class: `chat-${chatLineClass(line, own)}` }, shownChat(line)));
    this.chatList.scrollTop = this.chatList.scrollHeight;
    this.screen?.addLine(line);
  }

  /** /cls, /clear (0x418c60). */
  clearChat(): void {
    this.chatList.replaceChildren();
    this.screen?.setLog([]);
  }

  /** A create or join went out: the canvas waits for the answer. */
  waitForRoom(): void {
    this.screen?.waitForRoom();
  }

  /** Join reply 3: the canvas's password popup takes the keys (its editor is the page's password field). */
  passwordAsked(code: string): void {
    this.screen?.passwordAsked(code);
  }

  /** S->C 0x55: the canvas's popup, and the page's line when its 정보 button asked. */
  showRoomInfo(info: RoomInfoReply): void {
    this.screen?.showRoomInfo(info);
    if (info.code !== this.infoAsked) return;
    this.infoAsked = null;
    const room = this.state.rooms.find((r) => r.code === info.code);
    const players = info.players.map((p) => p.name).join(", ") || "없음";
    this.infoLine.textContent = `${room ? `${roomNumberText(room.number)}번 방` : "방"}: ${roomInfoStatus(info)} · 참가자 ${players}`;
  }

  /** S->C 0x1a: the saved character; the window closes and says so. */
  profileSaved(): void {
    this.characterSelect.value = this.actions.profile.character;
    this.showHue();
    this.errorLine.textContent = "수정 되었습니다.";
    if (this.screen) this.screen.profileSaved();
    else this.pendingMessage = "수정 되었습니다.";
  }

  /** The hue field holds the account's hue, and takes a new one only with the colour item, as the icon does. */
  private showHue(): void {
    this.hueInput.value = String(this.actions.profile.hue);
    this.hueInput.disabled = !hasItem(this.actions.account()?.items ?? [], ITEM_COLOUR);
  }

  /** S->C 0x58: the greeting popup closes. */
  greetingSaved(): void {
    this.screen?.greetingSaved();
  }

  /** S->C 0x57 accepted: the nickname popup closes. */
  nickSaved(): void {
    this.showNick();
    this.screen?.nickSaved();
  }

  /** The nick field holds the account's nick, and takes a new one only with the nickname item, as the icon does. */
  private showNick(): void {
    const locked = !hasItem(this.actions.account()?.items ?? [], ITEM_NICK);
    this.nickInput.value = this.actions.profile.nick;
    this.nickInput.disabled = locked;
    this.nickButton.disabled = locked;
  }

  /** S->C 0x63: the option window's friend list. */
  friendsAnswered(friends: readonly FriendRecord[]): void {
    this.screen?.friendsAnswered(friends);
    this.optionPanel.friendsAnswered(friends);
  }

  /** S->C 0x64 or 0x65: the canvas window or the page section, whichever asked, takes it. */
  friendReplied(reply: FriendReply): void {
    if (this.friendAskers.shift() === "section") this.optionPanel.friendReplied(reply);
    else this.screen?.friendReplied(reply);
  }

  private noteFriendAsk(message: ClientMessage, asker: "window" | "section"): void {
    if (message.type === "add-friend" || message.type === "delete-friend") this.friendAskers.push(asker);
  }

  /** A reply or a bad title: the original's message box, and the page's alert line. */
  showMessage(text: string): void {
    this.errorLine.textContent = text;
    if (this.screen) this.screen.showMessage(text);
    else this.pendingMessage = text;
  }

  /** The server's refusal, which also ends a create or join's wait. */
  refused(text: string): void {
    this.errorLine.textContent = text;
    if (this.screen) this.screen.refused(text);
    else this.pendingMessage = text;
  }

  dispose(): void {
    this.disposed = true;
    this.optionPanel.dispose();
    this.screen?.dispose();
    this.screen = null;
  }
}
