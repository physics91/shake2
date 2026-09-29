import { describe, expect, it } from "vitest";

import { playingMatch, PRACTICE } from "../sim/testing.ts";
import { ItemKind } from "../sim/types.ts";
import { practiceHelp } from "./practiceHelp.ts";

// practice.MAP's play area starts at (50, 50); cells are 40x32.
const AREA = { left: 50, top: 50 };
const ROWS = ["#B<" + ".".repeat(12), ...Array.from({ length: 13 }, () => ".".repeat(15)), ".".repeat(14) + "1"];

function at(col: number, row: number): { x: number; y: number } {
  return { x: AREA.left + col * 40 + 20, y: AREA.top + row * 32 + 16 };
}

describe("practice hover help (0x4557f0)", () => {
  it("asks to move the mouse when it is over nothing", () => {
    const state = playingMatch(ROWS, 1, PRACTICE);
    expect(practiceHelp(state, AREA, 0, 0)).toEqual({ title: "『마우스 움직여 보세요』", lines: [] });
  });

  it("names fixed blocks, bricks and jump pads from the tile words", () => {
    const state = playingMatch(ROWS, 1, PRACTICE);
    const { x, y } = at(0, 0);
    expect(practiceHelp(state, AREA, x, y)?.title).toBe("『터지지 않는 벽돌 입니다.』");
    expect(practiceHelp(state, AREA, x + 40, y)?.title).toBe("『터지는 벽돌입니다.』");
    expect(practiceHelp(state, AREA, x + 80, y)).toEqual({
      title: "『점프대』",
      lines: ["들어간 방향의 반대방향 또는 점프대위의 방향대로 점프하게 됩니다."],
    });
  });

  it("describes an item on the field by its kind, and says nothing for kinds past 15", () => {
    const state = playingMatch(ROWS, 1, PRACTICE);
    state.items.push({ cell: 20, kind: ItemKind.Fire, tick: 0, dropped: false });
    state.items.push({ cell: 21, kind: 21 as ItemKind, tick: 0, dropped: false });
    const fire = at(5, 1);
    expect(practiceHelp(state, AREA, fire.x, fire.y)).toEqual({ title: "『화력증가』", lines: ["폭탄의 화력이 1칸 증가합니다."] });
    const mine = at(6, 1);
    expect(practiceHelp(state, AREA, mine.x, mine.y)).toBeNull();
  });

  it("starts the field at y 63, so row 0's top strip falls through to the default", () => {
    const state = playingMatch(ROWS, 1, PRACTICE);
    expect(practiceHelp(state, AREA, 70, 62)?.title).toBe("『마우스 움직여 보세요』");
    expect(practiceHelp(state, AREA, 70, 63)?.title).toBe("『터지지 않는 벽돌 입니다.』");
  });

  it("wraps a column past the grid onto the next row, as the cell index does (0x410a90)", () => {
    const state = playingMatch(ROWS, 1, PRACTICE);
    state.items.push({ cell: 15, kind: ItemKind.Kick, tick: 0, dropped: false });
    expect(practiceHelp(state, AREA, 651, 70)?.title).toBe("『발』");
  });

  it("explains the clock, the chat bar and My Item", () => {
    const state = playingMatch(ROWS, 1, PRACTICE);
    expect(practiceHelp(state, AREA, 317, 2)?.title).toBe("『타이머』");
    expect(practiceHelp(state, AREA, 644, 590)?.title).toBe("『채팅바』");
    expect(practiceHelp(state, AREA, 794, 558)).toEqual({ title: "『My Item』", lines: ["현재 갖고 있는 아이템이 표시됩니다."] });
  });
});
