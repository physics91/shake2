// The lobby (scene 4, "LOBBY", draw 0x42ac60): positions, hit tests and list paging. Rects are
// [left, top, right, bottom]; blits exclude right and bottom, hit tests include them.
// Evidence: re_work/findings_room4.md, findings_room4b.md and original/FIDELITY.md §14.
import type { Rect } from "../assets/types.ts";
import { cp949Bytes } from "../server/cp949.ts";
import type { LobbyUser, RoomSummary } from "../server/protocol.ts";
import type { Button, Point, ScrollGeometry } from "./roomLayout.ts";
import { inside, ROOM_EDITOR_LIMIT } from "./roomLayout.ts";

function button(hit: Rect, hover: Rect | null, pressed: Rect): Button {
  return { hit, hover, pressed, at: { x: hit[0], y: hit[1] } };
}

// Header

/** new_banner at (209,14); the channel name (S->C 0x0a's last string) in 굴림 12 #fed030. */
export const BANNER = { src: [1, 1, 386, 48] as Rect, at: { x: 209, y: 14 } };
export const CHANNEL_AT: Point = { x: 84, y: 39 };
export const CHANNEL_COLOUR = "#fed030";

// Buttons (new_button art; the pressed art is drawn while the button is held over it)

export const CREATE = button([44, 339, 202, 367], [1, 252, 159, 280], [160, 252, 318, 280]);
/** WAIT GAME: its art follows the filter (off: all rooms, on: waiting rooms only). */
export const WAIT_GAME = {
  off: button([376, 339, 534, 367], [1, 223, 159, 251], [160, 223, 318, 251]),
  on: button([376, 339, 534, 367], [1, 343, 159, 372], [160, 343, 318, 371]),
};
/** "SHOW ALL" over the list while the filter is on. */
export const SHOW_ALL = { src: [1, 178, 110, 193] as Rect, at: { x: 398, y: 346 } };
export const MY_INFO = button([649, 431, 717, 459], [1, 312, 71, 342], [143, 312, 214, 342]);
export const SHOP = button([649, 461, 717, 489], [72, 281, 142, 311], [215, 281, 286, 311]);
export const REMOTE = button([649, 491, 717, 519], [1, 281, 71, 311], [143, 281, 214, 311]);
export const EXIT = button([649, 521, 717, 549], [72, 312, 142, 342], [215, 312, 286, 342]);
export const ROOM_PREV = button([230, 339, 287, 367], [1, 194, 58, 222], [117, 194, 174, 222]);
/** ▶'s pressed art is another cut of the sheet (105,8)-(161,35), as the code has it. */
export const ROOM_NEXT = button([291, 339, 348, 367], [59, 194, 116, 222], [105, 8, 161, 35]);
export const USER_PREV = button([624, 391, 681, 419], [1, 194, 58, 222], [117, 194, 174, 222]);
export const USER_NEXT = button([685, 391, 742, 419], [59, 194, 116, 222], [105, 8, 161, 35]);

// Room list (0x42c6b0)

export const ROOMS_PER_PAGE = 8;
/** A row takes clicks on y..y+26 and shows its held art on y..y+27 (0x430640, 0x42c6b0). */
export const ROOM_ROW = { x: 57, y: 103, step: 28, right: 538, height: 26, heldHeight: 27 };
/** new_roombutton rows: a playing room, a waiting one, and a waiting one held under the mouse. */
export const ROOM_ROW_ART = {
  playing: [1, 1, 482, 28] as Rect,
  waiting: [1, 29, 482, 56] as Rect,
  held: [1, 57, 482, 84] as Rect,
};
/** Icon k of new_roombutton's strip: 20 x 20 at (1 + 21 k, 85). */
export function roomIconRect(k: number): Rect {
  return [1 + 21 * k, 85, 21 + 21 * k, 105];
}
/** Mode icons by game mode 0..7 (0x42d188 playing, 0x42d1a8 waiting); door and disc icons after them. */
export const ROOM_ICONS = {
  playing: { mode: [2, 0, 1, 14, 12, 13, 18, 19], door: 3, disc: 4 },
  waiting: { mode: [9, 7, 8, 17, 15, 16, 20, 21], door: 10, secretDoor: 5, disc: 11 },
};
/** The door icon (+0x28): a waiting secret room's is locked; a playing room shows one door either way. */
export function roomDoorIcon(room: Pick<RoomSummary, "playing" | "secret">): number {
  if (room.playing) return ROOM_ICONS.playing.door;
  return room.secret ? ROOM_ICONS.waiting.secretDoor : ROOM_ICONS.waiting.door;
}
/** Where each part of a row goes, from its top (x absolute, dy from the row's y). */
export const ROOM_PARTS = {
  number: { x: 68, dy: 7 },
  title: { x: 94, dy: 6 },
  mode: { x: 215, dy: 4 },
  door: { x: 235, dy: 4 },
  disc: { x: 255, dy: 4 },
  map: { x: 288, dy: 7 },
  count: { x: 408, dy: 8 },
};
/** [fill, outline] per row style: the number and title, then the map name and the count. */
export const ROOM_COLOURS = {
  playing: { title: ["#ffffff", "#3e60a0"], map: ["#ffffff", "#1f3d78"] },
  waiting: { title: ["#ffec1a", "#43000f"], map: ["#ffffff", "#521b00"] },
} as const;

export function roomRowY(row: number): number {
  return ROOM_ROW.y + ROOM_ROW.step * row;
}

/** The room row under the mouse, 0..7, or -1; `held` tests the held art's one row taller rect. */
export function roomRowAt(x: number, y: number, held = false): number {
  const height = held ? ROOM_ROW.heldHeight : ROOM_ROW.height;
  for (let row = 0; row < ROOMS_PER_PAGE; row++) {
    const top = roomRowY(row);
    if (inside([ROOM_ROW.x, top, ROOM_ROW.right, top + height], x, y)) return row;
  }
  return -1;
}

/** "%d/%d", or "Full" when every open slot is taken. */
export function roomCountText(room: Pick<RoomSummary, "players" | "max">): string {
  return room.players === room.max ? "Full" : `${room.players}/${room.max}`;
}

/**
 * The rows of a page. The full list is the server's room table: room n sits on page n / 8 + 1,
 * row n % 8, and a free number leaves its row empty. The WAIT GAME list packs the waiting rooms.
 */
export function roomPage(rooms: readonly RoomSummary[], page: number, waitingOnly: boolean): (RoomSummary | null)[] {
  const first = (page - 1) * ROOMS_PER_PAGE;
  if (waitingOnly) {
    const waiting = rooms.filter((room) => !room.playing);
    return Array.from({ length: ROOMS_PER_PAGE }, (_, i) => waiting[first + i] ?? null);
  }
  return Array.from({ length: ROOMS_PER_PAGE }, (_, i) => rooms.find((room) => room.number === first + i) ?? null);
}

/** Pages up to the last one holding a room (R: the original asks the server for any page). */
export function roomPages(rooms: readonly RoomSummary[], waitingOnly: boolean): number {
  if (waitingOnly) return Math.max(1, Math.ceil(rooms.filter((room) => !room.playing).length / ROOMS_PER_PAGE));
  const last = Math.max(-1, ...rooms.map((room) => room.number));
  return Math.max(1, Math.floor(last / ROOMS_PER_PAGE) + 1);
}

/** One page back or on, kept within 1..pages. */
export function turnPage(page: number, pages: number, dir: -1 | 1): number {
  return Math.min(pages, Math.max(1, page + dir));
}

// User list (0x42d1d0)

export const USERS_PER_PAGE = 10;
export const USER_ROW = { y: 162, step: 22, left: 619, right: 749 };
/** Under the mouse: the lit bar blended at (613, y - 5); held: new_button's bar at (619, y - 4). */
export const USER_ART = {
  hover: { src: [132, 373, 275, 397] as Rect, x: 613, dy: -5 },
  held: { src: [1, 394, 131, 414] as Rect, x: 619, dy: -4 },
};
export const USER_PARTS = { guild: 643, rank: 659, name: 677, colour: "#e5f7ff" };

export function userRowY(row: number): number {
  return USER_ROW.y + USER_ROW.step * row;
}

/** The user row under the mouse, 0..9, or -1: (619, 158 + 22 i)-(749, 178 + 22 i). */
export function userRowAt(x: number, y: number): number {
  for (let row = 0; row < USERS_PER_PAGE; row++) {
    const top = userRowY(row) - 4;
    if (inside([USER_ROW.left, top, USER_ROW.right, top + 20], x, y)) return row;
  }
  return -1;
}

export function userPage(users: readonly LobbyUser[], page: number): (LobbyUser | null)[] {
  const first = (page - 1) * USERS_PER_PAGE;
  return Array.from({ length: USERS_PER_PAGE }, (_, i) => users[first + i] ?? null);
}

export function userPages(users: readonly LobbyUser[]): number {
  return Math.max(1, Math.ceil(users.length / USERS_PER_PAGE));
}

// Chat (0x42d350): the room's editor, colours and wrap; 8 lines; its own scroll bar

export const LOBBY_CHAT = { x: 51, y: 377, lineStep: 17, lines: 8, limit: ROOM_EDITOR_LIMIT, inputOutline: "#212070" };
export const LOBBY_NOTICE: Point = { x: 51, y: 515 };
export const LOBBY_SCROLL = {
  up: button([528, 394, 542, 406], null, [111, 180, 125, 193]),
  down: button([528, 499, 542, 512], null, [126, 180, 140, 193]),
  track: [527, 408, 542, 497] as Rect,
  thumb: [91, 93, 107, 109] as Rect,
  thumbDragging: [108, 93, 124, 109] as Rect,
  x: 527,
  /** Stops 416 / 452 / 489; the track's 89 px over 5 is 17 px a line (0x4299f0). */
  geometry: { top: 416, middle: 452, bottom: 489, lines: 8, dragStep: 17 } satisfies ScrollGeometry,
};

// Message box (MSGBOX 0x443700, drawn last by 0x443770)

/** images2 (the boy and the blue panel) at (203,198), its text in 굴림 12 #19edff, closed 2 s after it opens. */
export const MESSAGE_BOX = {
  src: [0, 0, 395, 204] as Rect,
  at: { x: 203, y: 198 },
  colour: "#19edff",
  outline: "#000000",
  /** The round button: pressed art only (new_button). */
  button: { hit: [546, 360, 578, 391] as Rect, pressed: [1, 110, 34, 142] as Rect, at: { x: 546, y: 360 } },
  hideMs: 2000,
};

/** One line at (356,290); two at (356,282) and (356,298). A "\n" parts them. */
export function messageLines(text: string): { text: string; x: number; y: number }[] {
  const lines = text.split("\n").slice(0, 2);
  const ys = lines.length === 1 ? [290] : [282, 298];
  return lines.map((line, i) => ({ text: line, x: 356, y: ys[i] }));
}

// Remote popup (리모컨, draw 0x42e560, clicks 0x459a18)

export type RemoteButton = "ranking" | "option" | "friends" | "bbs" | "channel";

function remoteButton(id: RemoteButton, top: number, bottom: number, srcTop: number) {
  return {
    id,
    hit: [469, top, 560, bottom] as Rect,
    hover: [1, srcTop, 91, srcTop + 28] as Rect,
    pressed: [92, srcTop, 182, srcTop + 28] as Rect,
    at: { x: 470, y: top },
  };
}

/** new_remote at (435,265); its buttons' art is new_button2's, at x 470. */
export const REMOTE_POPUP = {
  src: [1, 1, 165, 300] as Rect,
  at: { x: 435, y: 265 },
  buttons: [
    remoteButton("ranking", 319, 349, 1),
    remoteButton("option", 357, 385, 30),
    remoteButton("friends", 391, 423, 59),
    remoteButton("bbs", 428, 456, 88),
    remoteButton("channel", 466, 494, 117),
  ],
  close: { hit: [559, 525, 589, 555] as Rect, pressed: [34, 146, 66, 178] as Rect, at: { x: 559, y: 525 } },
};

export function remoteButtonAt(x: number, y: number): RemoteButton | "close" | null {
  if (inside(REMOTE_POPUP.close.hit, x, y)) return "close";
  return REMOTE_POPUP.buttons.find((b) => inside(b.hit, x, y))?.id ?? null;
}

// Room info popup (right click on a room, draw 0x42d800)

/** new_gameinfo's left half at (160,118); the status and the names in #eeefff outlined #757ac7. */
export const ROOM_INFO = {
  src: [1, 1, 288, 295] as Rect,
  at: { x: 160, y: 118 },
  status: { x: 279, y: 179 },
  colour: "#eeefff",
  outline: "#757ac7",
  close: { hit: [396, 374, 427, 405] as Rect, pressed: [101, 110, 133, 142] as Rect, at: { x: 396, y: 374 } },
};

/** Row k of the popup: gender (not drawn), guild, rank, then the name 1 px higher. */
export function roomInfoRow(k: number): { guild: Point; rank: Point; name: Point } {
  const y = 209 + 24 * k;
  return { guild: { x: 225, y }, rank: { x: 243, y }, name: { x: 263, y: y - 1 } };
}

/** "ROUND %d" while a match runs (+0xc = 0), 게임종료 (10), else 대 기 중. */
export function roomInfoStatus(info: { status: "round" | "over" | "waiting"; round: number }): string {
  if (info.status === "round") return `ROUND ${info.round}`;
  return info.status === "over" ? "게임종료" : "대 기 중";
}

// Help balloons (0x42b450), shown while the 풍선 도움말 option is on (on by default)

export interface LobbyHelpContext {
  popup: "create" | "password" | "remote" | "roomInfo" | null;
  /** The message box is up: the lobby's own balloons stop, a popup's go on. */
  message: boolean;
  waitingOnly: boolean;
  /** The rows of the page shown. */
  rows: readonly (RoomSummary | null)[];
}

type HelpEntry = { rect: Rect; text: string; x?: (x: number) => number; y?: (y: number) => number };

const MAIN_HELP: HelpEntry[] = [
  { rect: [51, 14, 184, 60], text: "대기실입니다.", y: (y) => Math.max(y, 26) },
  { rect: CREATE.hit, text: "게임방 만들기" },
  { rect: WAIT_GAME.off.hit, text: "" },
  { rect: ROOM_NEXT.hit, text: "다음 리스트 보기" },
  { rect: ROOM_PREV.hit, text: "이전리스트 보기" },
  { rect: USER_PREV.hit, text: "이전리스트 보기" },
  { rect: USER_NEXT.hit, text: "다음 리스트 보기", x: (x) => Math.min(x, 693) },
  { rect: [619, 158, 749, 376], text: "유져 정보 보기", x: (x) => Math.min(x, 705) },
  { rect: [71, 535, 99, 564], text: "마스크 설정 및 해지(현재지원안함)" },
  { rect: [100, 535, 129, 564], text: "채팅창에서 /w 아이디" },
  { rect: MY_INFO.hit, text: "내 정보보기 및 수정", x: (x) => Math.min(x, 674) },
  { rect: SHOP.hit, text: "현재 지원안함", x: (x) => Math.min(x, 705) },
  { rect: REMOTE.hit, text: "랭킹, 옵션등 보조기능 사용", x: () => 633 },
  { rect: EXIT.hit, text: "서버리스트 화면으로 이동", x: () => 640 },
];

const CREATE_HELP: HelpEntry[] = [
  { rect: [384, 260, 515, 278], text: "방 제목 적기" },
  { rect: [381, 283, 515, 302], text: "비밀번호 지정" },
  { rect: [373, 309, 401, 337], text: "비방을 만들려면 체크" },
  { rect: [403, 315, 418, 330], text: "비방을 만들려면 체크" },
  { rect: [453, 315, 468, 330], text: "자신의 게임방이 잘 보이게 한다." },
  { rect: [503, 315, 518, 330], text: "베팅방을 만든다" },
  { rect: [241, 363, 272, 394], text: "입력 확인(enter)" },
  { rect: [519, 362, 550, 393], text: "취소 버튼(esc)" },
];

const REMOTE_HELP: HelpEntry[] = [
  { rect: REMOTE_POPUP.buttons[0].hit, text: "랭킹을 확인" },
  { rect: REMOTE_POPUP.buttons[1].hit, text: "키설정, 채팅설정, 친구등록 가능" },
  { rect: REMOTE_POPUP.buttons[2].hit, text: "현재 지원안함" },
  { rect: REMOTE_POPUP.buttons[3].hit, text: "현재 지원안함" },
  { rect: REMOTE_POPUP.buttons[4].hit, text: "서버리스트 화면으로 이동" },
  { rect: REMOTE_POPUP.close.hit, text: "창닫기(esc)" },
];

const ROOM_INFO_HELP: HelpEntry[] = [{ rect: ROOM_INFO.close.hit, text: "창닫기(esc)" }];

const PASSWORD_HELP: HelpEntry[] = [
  { rect: [249, 241, 369, 257], text: "비밀번호 입력창" },
  { rect: [198, 292, 229, 323], text: "입력 확인(enter)" },
  { rect: [385, 292, 416, 323], text: "취소 버튼(esc)" },
];

/** The message box's own balloon on its button (0x443947). */
export const MESSAGE_HELP = "확인(esc)";

function firstHelp(entries: readonly HelpEntry[], x: number, y: number) {
  const entry = entries.find((e) => inside(e.rect, x, y));
  return entry ? { text: entry.text, x: entry.x ? entry.x(x) : x, y: entry.y ? entry.y(y) : y } : null;
}

/** The balloon under the mouse (0x42b450), or null. */
export function lobbyHelpAt(x: number, y: number, context: LobbyHelpContext): { text: string; x: number; y: number } | null {
  if (context.popup === "create") return firstHelp(CREATE_HELP, x, y);
  if (context.popup === "password") return firstHelp(PASSWORD_HELP, x, y);
  if (context.popup === "roomInfo") return firstHelp(ROOM_INFO_HELP, x, y);
  if (context.popup === "remote") return firstHelp(REMOTE_HELP, x, y);
  if (context.message) return null;
  const main = firstHelp(MAIN_HELP, x, y);
  if (main) {
    if (main.text !== "") return main;
    return { ...main, text: context.waitingOnly ? "모든 방 리스트 보기" : "대기중인 방 보기" };
  }
  const row = roomRowAt(x, y);
  const room = row >= 0 ? context.rows[row] : null;
  if (!room?.title) return null;
  const waiting = context.waitingOnly || !room.playing;
  return { text: waiting ? "대기중인 방, 우측버튼으로 정보확인" : "게임중인방, 우측버튼으로 정보 확인", x, y };
}

// Create popup (draw 0x42e130, open 0x42f340, OK 0x4300d0)

/** The title editor is set to 17 and, like every editor here (0x403b70), holds under that: 16 bytes. */
export const CREATE_TITLE_LIMIT = 17;
export const CREATE_POPUP = {
  /** new_gameinfo's right half. */
  src: [289, 1, 613, 195] as Rect,
  at: { x: 234, y: 206 },
  title: { hit: [384, 260, 515, 278] as Rect, text: { x: 386, y: 262 } },
  titleColour: "#ffffff",
  ok: { hit: [241, 363, 272, 394] as Rect, pressed: [35, 110, 67, 142] as Rect, at: { x: 241, y: 363 } },
  cancel: { hit: [519, 362, 550, 393] as Rect, pressed: [68, 110, 100, 142] as Rect, at: { x: 519, y: 362 } },
  /**
   * Item 5's secret check, all new_button art: the icon, and while checked ([0x495392]) the check,
   * PASSWORD and the field. The password shows as one '*' a byte, in the title's colours.
   */
  secret: {
    icon: { src: [1, 77, 30, 107] as Rect, at: { x: 372, y: 308 }, hit: [373, 309, 401, 337] as Rect },
    check: { src: [125, 94, 140, 109] as Rect, at: { x: 403, y: 315 }, hit: [403, 315, 418, 330] as Rect },
    label: { src: [1, 40, 104, 55] as Rect, at: { x: 273, y: 286 } },
    field: { src: [1, 56, 138, 76] as Rect, at: { x: 381, y: 283 } },
  },
  password: { hit: [381, 283, 515, 302] as Rect, text: { x: 386, y: 287 } },
};
/** The password editor is set to 11 (0x42ff40): 10 bytes. */
export const CREATE_PASSWORD_LIMIT = 11;

export type CreateHit = "cancel" | "ok" | "secret" | "title" | "password";

/** A release on the create popup (0x459800): 취소, OK, the secret check (0x42ff40), then the fields (0x4302d0). */
export function createPopupAt(x: number, y: number): CreateHit | null {
  const popup = CREATE_POPUP;
  if (inside(popup.cancel.hit, x, y)) return "cancel";
  if (inside(popup.ok.hit, x, y)) return "ok";
  if (inside(popup.secret.icon.hit, x, y) || inside(popup.secret.check.hit, x, y)) return "secret";
  if (inside(popup.title.hit, x, y)) return "title";
  if (inside(popup.password.hit, x, y)) return "password";
  return null;
}

/** A password as the popups show it (0x42e46f, 0x42ebc8): one '*' for each byte. */
export function passwordMask(text: string): string {
  return "*".repeat(cp949Bytes(text));
}

// Password popup (a secret room's line or join reply 3; open 0x42f500, draw 0x42ea30, OK 0x459962)

/** new_basicwindow, the lock (new_button), the label and the pressed OK and 취소 (new_button2); '*' plain in #c8e5fd. */
export const PASSWORD_POPUP = {
  window: { src: [2, 2, 240, 181] as Rect, at: { x: 191, y: 151 } },
  lock: { src: [1, 77, 30, 107] as Rect, at: { x: 242, y: 206 } },
  label: { src: [178, 204, 281, 219] as Rect, at: { x: 278, y: 215 } },
  field: { hit: [249, 241, 369, 257] as Rect, text: { x: 248, y: 242 } },
  colour: "#c8e5fd",
  ok: { hit: [198, 292, 229, 323] as Rect, pressed: [1, 147, 33, 179] as Rect, at: { x: 198, y: 292 } },
  cancel: { hit: [385, 292, 416, 323] as Rect, pressed: [34, 146, 66, 178] as Rect, at: { x: 385, y: 292 } },
};
/** The editor is set to 16 (0x42f500): 15 bytes. */
export const PASSWORD_LIMIT = 16;
/** OK with nothing typed (0x42fe60): the box, and the popup stays. */
export const PASSWORD_EMPTY = "비밀번호를 입력하세요";

/** A release on the password popup: OK, then 취소; the field takes no click. */
export function passwordPopupAt(x: number, y: number): "ok" | "cancel" | null {
  if (inside(PASSWORD_POPUP.ok.hit, x, y)) return "ok";
  if (inside(PASSWORD_POPUP.cancel.hit, x, y)) return "cancel";
  return null;
}

/** What OK does with the title (0x4300d0): a leading space asks for one, an empty title does nothing. */
export function createTitle(text: string): { title: string } | { message: string } | null {
  if (text.startsWith(" ")) return { message: "방제목을 입력하세요" };
  if (text === "") return null;
  return { title: text };
}
