import { describe, expect, it } from "vitest";

import type { RoomSummary } from "../server/protocol.ts";
import {
  createPopupAt,
  createTitle,
  LOBBY_SCROLL,
  lobbyHelpAt,
  messageLines,
  passwordMask,
  passwordPopupAt,
  remoteButtonAt,
  roomCountText,
  roomDoorIcon,
  roomIconRect,
  roomInfoStatus,
  roomPage,
  roomPages,
  roomRowAt,
  turnPage,
  userPage,
  userPages,
  userRowAt,
} from "./lobbyLayout.ts";
import { ChatScroll } from "./roomLayout.ts";

const room = (number: number, playing = false): RoomSummary => ({
  code: `R${number}`,
  number,
  title: `방${number}`,
  mapId: "arena",
  mode: 0,
  players: 1,
  max: 6,
  playing,
  secret: false,
});

describe("lobby room list (0x42c6b0)", () => {
  it("puts room n on page n / 8 + 1, row n % 8, leaving free numbers empty", () => {
    const rooms = [room(0), room(2), room(9)];
    expect(roomPage(rooms, 1, false).map((r) => r?.number ?? null)).toEqual([0, null, 2, null, null, null, null, null]);
    expect(roomPage(rooms, 2, false).map((r) => r?.number ?? null)).toEqual([null, 9, null, null, null, null, null, null]);
    expect(roomPages(rooms, false)).toBe(2);
    expect(roomPages([], false)).toBe(1);
  });

  it("packs the waiting rooms for WAIT GAME", () => {
    const rooms = [room(0, true), room(3), room(5), room(12, true)];
    expect(roomPage(rooms, 1, true).map((r) => r?.number ?? null)).toEqual([3, 5, null, null, null, null, null, null]);
    expect(roomPages(rooms, true)).toBe(1);
  });

  it("keeps the page within 1..pages", () => {
    expect(turnPage(1, 3, -1)).toBe(1);
    expect(turnPage(2, 3, 1)).toBe(3);
    expect(turnPage(3, 3, 1)).toBe(3);
  });

  it("writes the count as cur/max, or Full", () => {
    expect(roomCountText({ players: 2, max: 6 })).toBe("2/6");
    expect(roomCountText({ players: 5, max: 5 })).toBe("Full");
  });

  it("finds the row under the mouse, 28 px apart from y 103, clicks on y..y+26", () => {
    expect(roomRowAt(57, 103)).toBe(0);
    expect(roomRowAt(538, 129)).toBe(0);
    expect(roomRowAt(300, 130)).toBe(-1);
    expect(roomRowAt(300, 131)).toBe(1);
    expect(roomRowAt(300, 299)).toBe(7);
    expect(roomRowAt(56, 110)).toBe(-1);
    expect(roomRowAt(300, 331)).toBe(-1);
  });

  it("shows the held art one row taller than the click (y..y+27)", () => {
    expect(roomRowAt(300, 130, true)).toBe(0);
    expect(roomRowAt(300, 131, true)).toBe(1);
  });

  it("shows a waiting secret room's door as icon 5; a playing room's is 3 either way", () => {
    expect(roomDoorIcon(room(0))).toBe(10);
    expect(roomDoorIcon({ ...room(0), secret: true })).toBe(5);
    expect(roomDoorIcon({ ...room(0, true), secret: true })).toBe(3);
  });

  it("cuts icon k of the strip at (1 + 21 k, 85), 20 px square", () => {
    expect(roomIconRect(0)).toEqual([1, 85, 21, 105]);
    expect(roomIconRect(9)).toEqual([190, 85, 210, 105]);
  });
});

describe("lobby user list (0x42d1d0)", () => {
  it("pages ten users and finds the row under the mouse", () => {
    const card = { nick: "", greeting: "", wins: 0, losses: 0, cell: 0, rank: 0, manner: 0, exp: 0, guild: -1, level: 12 };
    const users = Array.from({ length: 12 }, (_, i) => ({ id: i, name: `u${i}`, card }));
    expect(userPages(users)).toBe(2);
    expect(userPage(users, 2).map((u) => u?.id ?? null)).toEqual([10, 11, null, null, null, null, null, null, null, null]);
    expect(userRowAt(619, 158)).toBe(0);
    expect(userRowAt(749, 178)).toBe(0);
    expect(userRowAt(700, 180)).toBe(1);
    expect(userRowAt(618, 170)).toBe(-1);
  });
});

describe("create popup clicks (0x459800)", () => {
  it("takes 취소, OK, the secret icon or check, then the title and password fields", () => {
    expect(createPopupAt(519, 362)).toBe("cancel");
    expect(createPopupAt(272, 394)).toBe("ok");
    expect(createPopupAt(373, 309)).toBe("secret");
    expect(createPopupAt(418, 330)).toBe("secret");
    expect(createPopupAt(402, 320)).toBeNull();
    expect(createPopupAt(384, 260)).toBe("title");
    expect(createPopupAt(381, 283)).toBe("password");
    expect(createPopupAt(515, 302)).toBe("password");
    // The highlight and betting checks need items 6 and 7, which nobody has.
    expect(createPopupAt(460, 320)).toBeNull();
  });

  it("shows a password as one '*' a cp949 byte (0x42e46f)", () => {
    expect(passwordMask("")).toBe("");
    expect(passwordMask("ab1")).toBe("***");
    expect(passwordMask("비밀")).toBe("****");
  });
});

describe("password popup (0x42ea30, 0x459942)", () => {
  it("takes OK and 취소, inclusive, and nothing else", () => {
    expect(passwordPopupAt(198, 292)).toBe("ok");
    expect(passwordPopupAt(229, 323)).toBe("ok");
    expect(passwordPopupAt(416, 323)).toBe("cancel");
    expect(passwordPopupAt(300, 250)).toBeNull();
  });
});

describe("create popup OK (0x4300d0)", () => {
  it("asks for a title that starts with a space, ignores an empty one", () => {
    expect(createTitle(" 방")).toEqual({ message: "방제목을 입력하세요" });
    expect(createTitle("")).toBeNull();
    expect(createTitle("빨리 오세요")).toEqual({ title: "빨리 오세요" });
  });
});

describe("lobby chat scroll (0x42d350)", () => {
  it("rests at 416 / 452 / 489 and shows eight lines", () => {
    const scroll = new ChatScroll(LOBBY_SCROLL.geometry);
    expect(scroll.first(20)).toBe(12);
    expect(scroll.drawnThumb(20)).toBe(489);
    scroll.up(20);
    expect(scroll.thumb).toBe(452);
    expect(scroll.first(20)).toBe(2);
    scroll.up(20);
    expect(scroll.thumb).toBe(416);
    expect(scroll.first(20)).toBe(0);
    scroll.trackClick(20, 490);
    expect(scroll.thumb).toBe(489);
  });

  it("ignores the arrows and hides the thumb up to eight lines", () => {
    const scroll = new ChatScroll(LOBBY_SCROLL.geometry);
    scroll.up(8);
    expect(scroll.thumb).toBe(489);
    expect(scroll.drawnThumb(8)).toBeNull();
  });
});

describe("message box (0x443770)", () => {
  it("puts one line at (356,290), two at 282 and 298", () => {
    expect(messageLines("이미 시작 되었습니다.")).toEqual([{ text: "이미 시작 되었습니다.", x: 356, y: 290 }]);
    expect(messageLines("게임이 이미 존재\n합니다.")).toEqual([
      { text: "게임이 이미 존재", x: 356, y: 282 },
      { text: "합니다.", x: 356, y: 298 },
    ]);
  });
});

describe("remote popup (0x459a18)", () => {
  it("finds the button under the mouse, inclusive", () => {
    expect(remoteButtonAt(469, 319)).toBe("ranking");
    expect(remoteButtonAt(560, 494)).toBe("channel");
    expect(remoteButtonAt(500, 352)).toBeNull();
    expect(remoteButtonAt(589, 555)).toBe("close");
  });
});

describe("room info popup (0x42d800)", () => {
  it("writes the round, the match's end, or waiting", () => {
    expect(roomInfoStatus({ status: "round", round: 2 })).toBe("ROUND 2");
    expect(roomInfoStatus({ status: "over", round: 3 })).toBe("게임종료");
    expect(roomInfoStatus({ status: "waiting", round: 0 })).toBe("대 기 중");
  });
});

describe("lobby balloons (0x42b450)", () => {
  const rows = [room(0), room(1, true), null, null, null, null, null, null];
  const base = { popup: null, message: false, waitingOnly: false, rows } as const;

  it("names the lobby's buttons, with WAIT GAME following the filter", () => {
    expect(lobbyHelpAt(100, 350, base)?.text).toBe("게임방 만들기");
    expect(lobbyHelpAt(400, 350, base)?.text).toBe("대기중인 방 보기");
    expect(lobbyHelpAt(400, 350, { ...base, waitingOnly: true })?.text).toBe("모든 방 리스트 보기");
    expect(lobbyHelpAt(680, 530, base)).toEqual({ text: "서버리스트 화면으로 이동", x: 640, y: 530 });
    expect(lobbyHelpAt(740, 400, base)?.x).toBe(693);
    expect(lobbyHelpAt(100, 20, base)).toEqual({ text: "대기실입니다.", x: 100, y: 26 });
  });

  it("tells a waiting room from a playing one, and skips empty rows", () => {
    expect(lobbyHelpAt(300, 110, base)?.text).toBe("대기중인 방, 우측버튼으로 정보확인");
    expect(lobbyHelpAt(300, 140, base)?.text).toBe("게임중인방, 우측버튼으로 정보 확인");
    expect(lobbyHelpAt(300, 170, base)).toBeNull();
  });

  it("gives an open popup's balloons, even under the message box, and stops the lobby's", () => {
    expect(lobbyHelpAt(100, 350, { ...base, message: true })).toBeNull();
    expect(lobbyHelpAt(250, 370, { ...base, popup: "create", message: true })?.text).toBe("입력 확인(enter)");
    expect(lobbyHelpAt(100, 350, { ...base, popup: "create" })).toBeNull();
    expect(lobbyHelpAt(500, 330, { ...base, popup: "remote" })?.text).toBe("랭킹을 확인");
    expect(lobbyHelpAt(400, 380, { ...base, popup: "roomInfo" })?.text).toBe("창닫기(esc)");
    expect(lobbyHelpAt(300, 250, { ...base, popup: "password", message: true })?.text).toBe("비밀번호 입력창");
    expect(lobbyHelpAt(200, 300, { ...base, popup: "password" })?.text).toBe("입력 확인(enter)");
    expect(lobbyHelpAt(400, 300, { ...base, popup: "password" })?.text).toBe("취소 버튼(esc)");
    expect(lobbyHelpAt(300, 110, { ...base, popup: "password" })).toBeNull();
  });
});
