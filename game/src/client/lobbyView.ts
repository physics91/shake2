// The lobby (scene 4, "LOBBY") as a page: the original's screen on a canvas (lobbyScreen.ts) and,
// under it, page controls for the keyboard and screen readers. The room code join is the remake's.
import { cutBytes, typeable } from "../server/cp949.ts";
import { hasItem, ITEM_COLOUR } from "../server/items.ts";
import type { Badge, ClientMessage, LobbyUser, OwnAccount, RoomStatus, RoomSummary } from "../server/protocol.ts";
import { RANDOM_MAP, ROOM_CHAT_LIMIT, ROOM_CODE_LENGTH, shownName } from "../server/protocol.ts";
import type { FriendRecord } from "./optionWindow.ts";
import { MODE_NAMES } from "../sim/modes.ts";
import { SCREEN_H, SCREEN_W } from "./hudLayout.ts";
import type { FriendReply } from "./friends.ts";
import { CREATE_PASSWORD_LIMIT, CREATE_TITLE_LIMIT, createTitle, roomCountText, roomInfoStatus } from "./lobbyLayout.ts";
import type { MyProfile } from "./lobbyScreen.ts";
import { loadLobbyAssets, LobbyScreen } from "./lobbyScreen.ts";
import { mapTitle } from "./menu.ts";
import { CHARACTER_IDS, CHARACTER_NAMES } from "./myInfoLayout.ts";
import { OptionPanel } from "./optionPanel.ts";
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
  /** The option object, for the option window and the page's option controls. */
  settings: SettingsStore;
}

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
  private readonly optionPanel: OptionPanel;
  private screen: LobbyScreen | null = null;
  private state: LobbyState;
  private notice: string | null = null;
  /** The room whose 정보 button was pressed last. */
  private infoAsked: string | null = null;
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
    const { send, say, exit, filterChanged, profile, account, saveCharacter, saveGreeting, settings } = actions;

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
    const saveMyInfo = (event: Event) => {
      event.preventDefault();
      // The window's O: nothing changed closes without asking the server (0x43e110).
      const hue = this.hueInput.disabled ? profile.hue : Math.max(-180, Math.min(180, Math.trunc(Number(this.hueInput.value) || 0)));
      if (this.characterSelect.value === profile.character && hue === profile.hue) return;
      saveCharacter(this.characterSelect.value, hue, profile.useId);
    };
    this.optionPanel = new OptionPanel({
      settings,
      send,
      message: (text) => this.showMessage(text),
    });
    const submitChat = (event: Event) => {
      event.preventDefault();
      say(this.chatInput.value);
      this.chatInput.value = "";
    };

    this.root = h(
      "main",
      { class: "screen lobby shake" },
      h(
        "header",
        { class: "toolbar" },
        h("button", { class: "btn small", type: "button", onclick: () => exit(true) }, "← 나가기"),
        h("h1", { tabindex: "-1" }, this.heading),
      ),
      this.stage,
      h(
        "p",
        { class: "keys" },
        "방 줄을 누르면 들어가고 오른쪽 버튼은 방 정보입니다. CREATE GAME은 방 만들기, WAIT GAME은 기다리는 방만 보기, 내정보는 캐릭터 고르기(◀▶ 또는 이름 칸을 누른 채 끌기, Enter 저장), 리모컨의 OPTION은 옵션 창(같은 설정이 아래 옵션 부분에도 있음), F2~F10은 채팅 줄에 단축 메시지 넣기, F1은 도움말 화면(다시 F1이나 Esc로 닫기), Esc는 메시지·열린 창 닫기(없으면 나가기)입니다.",
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
        { class: "row", onsubmit: join },
        h("div", { class: "field" }, h("label", { for: "lobby-code" }, "방 코드"), code),
        h("button", { class: "btn", type: "submit" }, "코드로 참가"),
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
            send,
            say,
            exit,
            filterChanged,
            profile,
            account,
            saveCharacter,
            saveGreeting,
            fadeIn,
            settings,
          },
          this.state,
        );
        this.screen.setLog(chatLog);
        if (this.notice) this.screen.showNotice(this.notice);
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

  showNotice(text: string): void {
    this.notice = text;
    this.screen?.showNotice(text);
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
    this.screen?.profileSaved();
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

  /** S->C 0x63: the option window's friend list. */
  friendsAnswered(friends: readonly FriendRecord[]): void {
    this.screen?.friendsAnswered(friends);
    this.optionPanel.friendsAnswered(friends);
  }

  /** S->C 0x64 or 0x65: the canvas window or the page section, whichever asked, takes it. */
  friendReplied(reply: FriendReply): void {
    this.screen?.friendReplied(reply);
    this.optionPanel.friendReplied(reply);
  }

  /** A refusal (a join reply, a bad title): the original's message box, and the page's alert line. */
  showMessage(text: string): void {
    this.errorLine.textContent = text;
    this.screen?.showMessage(text);
  }

  dispose(): void {
    this.disposed = true;
    this.optionPanel.dispose();
    this.screen?.dispose();
    this.screen = null;
  }
}
