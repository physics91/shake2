import { describe, expect, it } from "vitest";

import {
  ChatScroll,
  dropdownPanel,
  dropdownRowAt,
  dropdownTextAt,
  endsBusy,
  helpAt,
  helpBox,
  mapPreviewRect,
  ROOM_ITEM_ICONS,
  roomNumberText,
  shownMapName,
  SLOT_ICONS,
  SLOT_ORIGINS,
  slotAt,
  slotIconAt,
  stepList,
  teamAt,
  THUMB,
  wrapChat,
} from "./roomLayout.ts";

describe("waiting room layout (scene 7)", () => {
  it("writes the room number as %03d of number + 1 and drops a map name's list prefix", () => {
    expect(roomNumberText(0)).toBe("001");
    expect(roomNumberText(32)).toBe("033");
    expect(shownMapName("08점프옐로우")).toBe("점프옐로우");
    expect(shownMapName("RANDOM")).toBe("RANDOM");
  });

  it("finds the slot under the mouse with both edges included, never the own slot (0x428a30)", () => {
    expect(slotAt(65, 105, -1)).toBe(0);
    expect(slotAt(291, 187, -1)).toBe(0);
    expect(slotAt(292, 187, -1)).toBe(-1);
    expect(slotAt(530, 369, -1)).toBe(5);
    expect(slotAt(400, 250, 3)).toBe(-1);
    expect(slotAt(400, 250, 0)).toBe(3);
  });

  it("wraps ◀ and ▶: maps over RANDOM + count, tunes short of the last one, modes 0..7 (0x428340)", () => {
    expect(stepList("map", 0, 16, -1)).toBe(16);
    expect(stepList("map", 16, 16, 1)).toBe(0);
    expect(stepList("music", 0, 14, -1)).toBe(13);
    expect(stepList("music", 13, 14, 1)).toBe(0);
    expect(stepList("mode", 7, 0, 1)).toBe(0);
    expect(stepList("mode", 0, 0, -1)).toBe(7);
  });

  it("finds SELECTTEAM's buttons by their hit columns (0x427f60)", () => {
    expect(teamAt(630, 412)).toBe(1);
    expect(teamAt(666, 420)).toBe(0);
    expect(teamAt(738, 429)).toBe(6);
    expect(teamAt(700, 430)).toBe(0);
  });

  it("takes a map's preview from mapimage by its list position, 5 per row", () => {
    expect(mapPreviewRect(0)).toEqual([1, 1, 120, 96]);
    expect(mapPreviewRect(7)).toEqual([241, 97, 360, 192]);
  });

  it("lays out a dropdown under its strip: 15 px rows, the panel 15 n + 3 high (0x428700)", () => {
    expect(dropdownPanel("mode", 8)).toEqual({ src: [1, 1, 111, 123], at: { x: 629, y: 382 } });
    expect(dropdownPanel("map", 17).src[3]).toBe(258);
    expect(dropdownTextAt("mode", 0)).toEqual({ x: 635, y: 385 });
    expect(dropdownTextAt("music", 2)).toEqual({ x: 635, y: 372 });
    expect(dropdownRowAt("mode", 8, 629, 383)).toBe(0);
    expect(dropdownRowAt("mode", 8, 737, 397)).toBe(0);
    expect(dropdownRowAt("mode", 8, 700, 398)).toBe(1);
    expect(dropdownRowAt("mode", 8, 700, 382)).toBe(-1);
    expect(dropdownRowAt("mode", 8, 700, 503)).toBe(-1);
  });
});

describe("room chat wrapping", () => {
  it("cuts at 70 bytes and moves a two-byte character that would start at byte 69", () => {
    expect(wrapChat("a".repeat(70))).toEqual(["a".repeat(70)]);
    expect(wrapChat("a".repeat(75))).toEqual(["a".repeat(70), `        ${"a".repeat(5)}`]);
    expect(wrapChat(`${"a".repeat(69)}가`)).toEqual(["a".repeat(69), "        가"]);
  });
});

describe("room chat scroll bar (0x471888)", () => {
  const scrolled = (count: number, act: (s: ChatScroll) => void) => {
    const scroll = new ChatScroll();
    scroll.first(count);
    act(scroll);
    return scroll;
  };

  it("shows everything from line 0 up to 7 lines, then follows new lines to the bottom", () => {
    const scroll = new ChatScroll();
    expect(scroll.first(5)).toBe(0);
    expect(scroll.first(12)).toBe(5);
    expect(scroll.drawnThumb(8)).toBeNull();
    expect(scroll.drawnThumb(12)).toBe(THUMB.bottom);
  });

  it("steps the thumb between its three stops; the middle shows from count / 2 - 8", () => {
    const scroll = scrolled(30, (s) => s.up(30));
    expect(scroll.thumb).toBe(THUMB.middle);
    expect(scroll.first(30)).toBe(7);
    scroll.up(30);
    expect(scroll.first(30)).toBe(0);
    scroll.down(30);
    expect(scroll.first(30)).toBe(7);
    scroll.down(30);
    expect(scroll.first(30)).toBe(23);
  });

  it("shows the last 7 lines in the middle while count / 2 - 8 is negative", () => {
    const scroll = scrolled(12, (s) => s.up(12));
    expect(scroll.first(12)).toBe(5);
  });

  it("jumps to the new bottom when a line arrives, unless dragging", () => {
    const scroll = scrolled(30, (s) => {
      s.up(30);
      s.up(30);
    });
    expect(scroll.first(30)).toBe(0);
    expect(scroll.first(31)).toBe(24);
    expect(scroll.thumb).toBe(THUMB.bottom);
  });

  it("does nothing on the arrows or the track up to 8 lines", () => {
    const scroll = scrolled(8, (s) => {
      s.up(8);
      s.trackClick(8, 430);
    });
    expect(scroll.thumb).toBe(THUMB.bottom);
  });

  it("sends the thumb to an end on a track click", () => {
    const scroll = scrolled(30, (s) => s.trackClick(30, 430));
    expect(scroll.first(30)).toBe(0);
    scroll.trackClick(30, 480);
    expect(scroll.first(30)).toBe(23);
  });

  it("drags only after the first held frame and within 16 px of the thumb (0x456770)", () => {
    const scroll = scrolled(40, (s) => s.hold(40, 490));
    expect(scroll.thumb).toBe(THUMB.bottom);
    scroll.hold(40, 490);
    expect(scroll.thumb).toBe(490);
    scroll.hold(40, 440);
    expect(scroll.thumb).toBe(490);
    // Moving from 490: the first stop under it, 500 - 17 k, is 483 at k = 1, so line 40 - 10 - 1.
    scroll.hold(40, 475);
    expect(scroll.first(40)).toBe(29);
    scroll.release();
    expect(scroll.dragging).toBe(false);
  });
});

describe("room help balloons (0x426570)", () => {
  const context = { isHost: true, slots: [{ host: true }, null, { host: false }, null, null, null], closed: [false, true, false, false, false, false] };

  it("names the room's parts, some at a fixed or clamped x", () => {
    expect(helpAt(250, 30, context)).toEqual({ text: "방번호 표시", x: 250, y: 30 });
    expect(helpAt(700, 290, context)).toEqual({ text: "버튼을 누르면 맵선택", x: 627, y: 290 });
    expect(helpAt(720, 470, context)).toEqual({ text: "게임시작 버튼", x: 705, y: 470 });
    expect(helpAt(730, 200, context)).toEqual({ text: "맵 미리 보기", x: 711, y: 200 });
  });

  it("tells the host what a click on an empty slot does, and marks the host's square and the points", () => {
    expect(helpAt(400, 150, context)?.text).toBe("클릭하면 Open됩니다.");
    expect(helpAt(400, 330, context)?.text).toBe("클릭하면 Close됩니다.");
    expect(helpAt(80, 120, context)?.text).toBe("방장 빨간바탕표시");
    expect(helpAt(80, 210, context)).toBeNull();
    expect(helpAt(260, 240, context)?.text).toBe("게임에 걸려있는 셀포인트");
    expect(helpAt(400, 150, { ...context, isHost: false })).toBeNull();
  });

  it("names the kick icon's place on every taken slot, the host's own too, for the host alone (0x31)", () => {
    // Slot 0 (65,105): the icon's balloon rect is (L+91,T+41)-(L+119,T+70), whether or not the icon is lit.
    expect(helpAt(65 + 91, 105 + 41, context)?.text).toBe("강제 퇴장 아이콘");
    expect(helpAt(65 + 119, 105 + 70, context)?.text).toBe("강제 퇴장 아이콘");
    expect(helpAt(65 + 91, 196 + 50, context)?.text).toBe("강제 퇴장 아이콘");
    expect(helpAt(65 + 91, 105 + 41, { ...context, isHost: false })).toBeNull();
    expect(helpAt(304 + 100, 105 + 50, context)?.text).not.toBe("강제 퇴장 아이콘");
  });

  it("sizes the box at 6 px per byte + 2, hung 20 px above the point", () => {
    expect(helpBox("방번호 표시", 100, 50)).toEqual({
      rect: [103, 30, 103 + 6 * 11 + 2, 46],
      dark: { x: 104, y: 32 },
      light: { x: 105, y: 33 },
    });
  });
});

describe("endsBusy", () => {
  const player = (id: number, team: number, ready = false) => ({
    id,
    name: `P${id}`,
    nick: `P${id}`,
    useId: true,
    character: "bobo",
    hue: 0,
    wins: 0,
    cell: 0,
    badge: { guild: -1, level: 12 },
    ready,
    team,
    slot: id - 1,
  });
  const room = {
    code: "ABCD",
    number: 0,
    title: "",
    hostId: 1,
    mapId: "RANDOM",
    music: 0,
    mode: 1 as const,
    closed: [false, false, false, false, false, false],
    players: [player(1, 1), player(2, 2)],
    playing: false,
  };

  it("ends on a slot opened or closed (S->C 0x45, 0x4452fd) and on a team change (0x2e, 0x44511e)", () => {
    expect(endsBusy(room, { ...room, closed: [false, false, true, false, false, false] })).toBe(true);
    expect(endsBusy(room, { ...room, players: [player(1, 1), player(2, 1)] })).toBe(true);
  });

  it("goes on through ready, map, music, mode, host, join and leave news (0x4b, 0x53, 0x54, 0x56, 0x40, 0x17)", () => {
    expect(endsBusy(room, { ...room, players: [player(1, 1), player(2, 2, true)] })).toBe(false);
    expect(endsBusy(room, { ...room, mapId: "desert01", music: 3, mode: 2 })).toBe(false);
    expect(endsBusy(room, { ...room, hostId: 2, players: [player(2, 2)] })).toBe(false);
    expect(endsBusy(room, { ...room, players: [player(1, 1), player(2, 2), player(3, 1)] })).toBe(false);
  });
});

describe("the account's item icons in the room (0x425560, 0x428b40)", () => {
  it("finds kick, mask and whisper by x on a slot, from T+41 to its bottom − 14", () => {
    const { x, y } = SLOT_ORIGINS[3];
    expect(slotIconAt(3, x + 92, y + 41)).toBe("kick");
    expect(slotIconAt(3, x + 119, y + 68)).toBe("kick");
    expect(slotIconAt(3, x + 120, y + 50)).toBe("mask");
    expect(slotIconAt(3, x + 146, y + 50)).toBe("mask");
    expect(slotIconAt(3, x + 147, y + 50)).toBe("whisper");
    expect(slotIconAt(3, x + 174, y + 50)).toBe("whisper");
    expect(slotIconAt(3, x + 91, y + 50)).toBeNull();
    expect(slotIconAt(3, x + 175, y + 50)).toBeNull();
    expect(slotIconAt(3, x + 100, y + 40)).toBeNull();
    expect(slotIconAt(3, x + 100, y + 69)).toBeNull();
  });

  it("draws each lit at L+91, L+120, L+147 and T+41, the kick's pressed art one pixel right", () => {
    expect(SLOT_ICONS.kick).toMatchObject({ lit: [285, 61, 313, 90], pressed: [285, 91, 313, 120], at: { x: 91, y: 41 }, pressedAt: { x: 92, y: 41 } });
    expect(SLOT_ICONS.mask).toMatchObject({ lit: [285, 1, 312, 30], pressed: [285, 31, 312, 60], at: { x: 120, y: 41 }, pressedAt: { x: 120, y: 41 } });
    expect(SLOT_ICONS.whisper).toMatchObject({ lit: [251, 94, 279, 123], pressed: [222, 94, 250, 123], at: { x: 147, y: 41 }, pressedAt: { x: 147, y: 41 } });
  });

  it("puts the bottom mask and whisper icons where their balloons are", () => {
    expect(ROOM_ITEM_ICONS.mask).toEqual({ lit: [285, 1, 312, 30], pressed: [285, 31, 312, 60], at: { x: 71, y: 535 }, hit: [71, 535, 100, 564] });
    expect(ROOM_ITEM_ICONS.whisper).toEqual({ lit: [251, 94, 279, 123], pressed: [222, 94, 250, 123], at: { x: 101, y: 535 }, hit: [101, 535, 128, 563] });
    const context = { isHost: false, slots: [null, null, null, null, null, null], closed: [false, false, false, false, false, false] };
    expect(helpAt(80, 550, context)?.text).toBe("마스크 설정 및 해지(현재지원안함)");
    expect(helpAt(110, 550, context)?.text).toBe("채팅창에서 /w 아이디");
  });
});
