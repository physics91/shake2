// Practice's textbox help (0x4557f0): what is under the mouse, shown at (49,560) with its
// description at (140,560) and (140,575). The texts are shake.exe's, verbatim.
import type { MatchState } from "../sim/types.ts";

export interface Help {
  title: string;
  lines: readonly string[];
}

interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** Hover areas (0x454010-0x4540bb), both edges included. */
const FIELD: Rect = { left: 49, top: 63, right: 651, bottom: 546 };
const TIMER: Rect = { left: 317, top: 2, right: 421, bottom: 41 };
const CHAT_BAR: Rect = { left: 50, top: 552, right: 644, bottom: 590 };
const MY_ITEM: Rect = { left: 701, top: 456, right: 794, bottom: 558 };

/** Item help by kind (jump table 0x4566a8); kinds past 15 have none. */
const ITEM_HELP: readonly Help[] = [
  { title: "『폭탄증가』", lines: ["연속으로 사용할 수 있는 폭탄의 수가 한 개씩 늘어납니다."] }, // 0
  { title: "『화력증가』", lines: ["폭탄의 화력이 1칸 증가합니다."] }, // 1
  { title: "『속도증가』", lines: ["캐릭터 속도가 한 단계 빨라집니다."] }, // 2
  { title: "『손』", lines: ["폭탄을 벽 넘어로 던질 수 있습니다. SPACE 키를 두 번 누르십시오", "다연발 아이템을 먹으면 던기기 능력은 사라집니다."] }, // 3
  { title: "『발』", lines: ["폭탄을 발로 찰 수 있습니다.", "폭탄 설치후 뒤로 물러났다가 폭탄으로 다가갑니다."] }, // 4
  { title: "『점프』", lines: ["화염을 피해 점프할 수 있습니다. 기본 설정키는 Z 키입니다.", "1회 사용 가능하며 순간이동을 습득하면 사라집니다."] }, // 5
  { title: "『핵폭탄』", lines: ["폭탄을 중심으로 일정범위안에 있으면 데미지를 입습니다.", "1회 사용 가능하며, 직격탄,시한폭탄을 습득하면 사라집니다."] }, // 6
  { title: "『화력짱』", lines: ["폭탄의 화력이 최대로 증가 됩니다."] }, // 7
  { title: "『직격탄』", lines: ["상대편을 향해 폭탄을 직격으로 던질수 있습니다. 기본 설정키는 ", "CTRL키입니다. 1회 사용가능합니다. 핵폭탄,시한폭탄을 먹으면 사라집니다."] }, // 8
  { title: "『시한폭탄』", lines: ["원하는 때에 폭탄을 터트릴 수 있으며,일정시간이 지나면 자동으로 터집니다.", "기본 설정키는 CTRL키입니다. 사용 가능한 폭탄 수만큼 쓸 수 있습니다."] }, // 9
  { title: "『다연발폭탄』", lines: ["연속으로 사용 가능한 폭탄을 동시에 놓을수 있습니다. SPACE 키를 ", "두 번 누르십시오. 던지기 아이템을 먹으면 다연발능력은 사라집니다."] }, // 10
  { title: "『노란물음표』", lines: ["현재 갖고있는 아이템이 사라지거나 이동속도가 느려지기도 하며,", "공격불능상태가 되기도 합니다."] }, // 11
  { title: "『폭탄스위치』", lines: ["현재 맵에 보이는 폭탄이 동시에 터집니다."] }, // 12
  { title: "『빨간물음표』", lines: ["일정시간 무적이 되거나 투명인간이 됩니다."] }, // 13
  { title: "『순간이동』", lines: ["랜덤하게 상대편의 위치로 워프합니다. 기본 설정키는 Z 키입니다.", "1회 사용 가능하며, 점프아이템을 습득하면 사라집니다."] }, // 14
  { title: "『더블폭탄』", lines: ["같은 자리에서 폭탄이 두 번 터집니다."] }, // 15
];
const TILE_HELP = {
  fixed: { title: "『터지지 않는 벽돌 입니다.』", lines: [] },
  brick: { title: "『터지는 벽돌입니다.』", lines: [] },
  blueArrow: { title: "『파란색 화살표』", lines: ["     이 화살표가 그려진 곳으로 들어가면 반대편으로 나갈수 있습니다."] },
  blackArrow: { title: "『검정색 화살표』", lines: ["     이 화살표 위에서 폭탄을 던지거나 발로 찼을 경우 ", "     화살표의 방향을 따라 폭탄이 이동합니다."] },
  zone: { title: "『동시폭발지역』", lines: ["     이곳에 폭탄이 놓이거나, 폭탄의 화력이 이곳까지 미칠 경우", "     동시폭발존으로 연결된 모든 바닥이 폭발하게 됩니다."] },
  ice: { title: "『얼음바닥』", lines: ["이곳은 얼음바닥으로 미끄러워 집니다."] },
  water: { title: "『물바닥』", lines: ["이곳을 지나 갈때는 속도가 느려집니다."] },
  conveyor: { title: "『강제이동』", lines: ["     이곳위에 있으면 이동방향을 따라", "     강제 이동하게 됩니다."] },
  reverse: { title: "『이동방향 전환』", lines: ["     이곳을 밟으면 강제이동지역의 방향이", "     반대로 바뀌게 됩니다."] },
  speed: { title: "『이동속도 증가,감소』", lines: ["         한번 밟을때마다 3번까지 강제이동지역의 ", "         속도가 빨라집니다."] },
  stop: { title: "『멈춤버튼』", lines: ["한번 밟으면 손가락이 위로 향하며 강제이동지역이 움직입니다.", "반대로 손가락이 아래를 가리키면 강제이동지역이 멈춥니다."] },
  boost: { title: "『폭발증폭』", lines: ["이곳에 폭탄을 놓으면 폭탄의 화력과 관계없이 ", "폭발능력이 최고가 되어 터집니다."] },
  pad: { title: "『점프대』", lines: ["들어간 방향의 반대방향 또는 점프대위의 방향대로 점프하게 됩니다."] },
  warp: { title: "『워프존』", lines: ["노랑,파랑,빨간,초록색의 워프존이 있으며 ", "같은 색의 워프존끼리 연결됩니다."] },
  timer: { title: "『타이머』", lines: ["한 판에 2분 30초의 경기시간이 주어집니다.", "1분이 남게되면 벽돌로 주위가 채워지며 그 벽돌에 닿아도 데미지를 입습니다."] },
  chat: { title: "『채팅바』", lines: ["이곳은 채팅바가 생기는 위치입니다.", "채팅바는 엔터키로 나타나게 됩니다."] },
  myItem: { title: "『My Item』", lines: ["현재 갖고 있는 아이템이 표시됩니다."] },
  idle: { title: "『마우스 움직여 보세요』", lines: [] },
} satisfies Record<string, Help>;

/**
 * The help for the mouse at (x, y) in screen pixels, or null when an item without help lies
 * under it (the loop only draws for kinds 0-15). `area` is the play area's top left.
 */
export function practiceHelp(state: MatchState, area: { left: number; top: number }, x: number, y: number): Help | null {
  if (inside(FIELD, x, y)) return fieldHelp(state, cellAt(state, area, x, y));
  if (inside(TIMER, x, y)) return TILE_HELP.timer;
  if (inside(CHAT_BAR, x, y)) return TILE_HELP.chat;
  if (inside(MY_ITEM, x, y)) return TILE_HELP.myItem;
  return TILE_HELP.idle;
}

function inside(rect: Rect, x: number, y: number): boolean {
  return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
}

/**
 * The cell index as 0x410a90 computes it: both offsets divided towards zero and no column
 * check, so a column past the grid lands on the next row.
 */
function cellAt(state: MatchState, area: { left: number; top: number }, x: number, y: number): number {
  const { width, cellW, cellH } = state.layout;
  return Math.trunc((y - area.top) / cellH) * width + Math.trunc((x - area.left) / cellW);
}

/**
 * An item on the cell (tile +0x10 & 0x200) is described by its kind; otherwise the tile words
 * are tested in the original's order. A cell outside the grid reads past the tile array in the
 * original; here it is an empty tile.
 */
function fieldHelp(state: MatchState, cell: number): Help | null {
  if (cell < 0 || cell >= state.grid.length) return TILE_HELP.idle;
  const items = state.items.filter((item) => item.cell === cell);
  if (items.length > 0) {
    const described = items.filter((item) => item.kind <= 15);
    return described.length > 0 ? ITEM_HELP[described[described.length - 1].kind] : null;
  }
  // The block and brick bits of A follow the live grid: a burst brick is cleared at once.
  const a = (state.layout.tileA[cell] & ~3) | state.grid[cell];
  const b = state.layout.tileB[cell];
  if (a & 1) return TILE_HELP.fixed;
  if (a & 2) return TILE_HELP.brick;
  if (a & 0xf000) return TILE_HELP.blueArrow;
  if (b & 0x1e) return TILE_HELP.blackArrow;
  if (a & 0x10000) return TILE_HELP.zone;
  if (a & 0x800) return TILE_HELP.ice;
  if (a & 0xe0000700 || b & 1 || a & 0xfc) return TILE_HELP.water;
  if (a & 0x1ffe0000) return TILE_HELP.conveyor;
  if (b & 0x4000) return TILE_HELP.reverse;
  if (b & 0x8000) return TILE_HELP.speed;
  if (b & 0x600000) return TILE_HELP.stop;
  if (b & 0x10000) return TILE_HELP.boost;
  if (b & 0x1e0000) return TILE_HELP.pad;
  if (b & 0x3c00) return TILE_HELP.warp;
  return TILE_HELP.idle;
}
