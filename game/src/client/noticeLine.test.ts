import { describe, expect, it } from "vitest";

import { NOTICE_SHOW_MS, NOTICE_SWAP_MS, NoticeLine } from "./noticeLine.ts";

const HINT = "도움말을 보시려면 F1키를 눌러주세요.";

describe("the notice line (S->C 0x50 0x44579f, drawer 0x4142d0)", () => {
  it("takes a server notice of 1..99 bytes and drops an empty, too long or odd one", () => {
    const line = new NoticeLine();
    line.receive("", 10_000);
    line.receive("가".repeat(50), 10_000);
    line.receive(42, 10_000);
    expect(line.held).toBe(false);
    line.receive("가".repeat(49) + "a", 10_000);
    expect(line.frame(10_000)?.text).toBe("가".repeat(49) + "a");
  });

  it("puts the F1 hint only into an empty buffer, so a live server notice stays", () => {
    const line = new NoticeLine();
    line.receive("점검 안내", 10_000);
    line.hint(HINT, 10_100);
    expect(line.frame(10_100)?.text).toBe("점검 안내");
    const empty = new NoticeLine();
    empty.hint(HINT, 10_000);
    expect(empty.frame(10_000)?.text).toBe(HINT);
  });

  it("shows yellow first and swaps each time more than 500 ms have passed", () => {
    const line = new NoticeLine();
    line.hint(HINT, 10_000);
    expect(line.frame(10_000)?.yellow).toBe(true);
    expect(line.frame(10_000 + NOTICE_SWAP_MS)?.yellow).toBe(true);
    expect(line.frame(10_001 + NOTICE_SWAP_MS)?.yellow).toBe(false);
    expect(line.frame(10_002 + 2 * NOTICE_SWAP_MS)?.yellow).toBe(true);
  });

  it("keeps the running blink when a new notice comes, and restarts only its 60 s", () => {
    const line = new NoticeLine();
    line.hint(HINT, 10_000);
    line.frame(10_000);
    line.frame(10_600);
    line.receive("새 공지", 10_700);
    expect(line.frame(10_700)).toEqual({ text: "새 공지", yellow: false });
    expect(line.frame(10_700 + NOTICE_SHOW_MS)?.text).toBe("새 공지");
  });

  it("empties after more than 60 s, drawing nothing that frame, and the next notice starts yellow", () => {
    const line = new NoticeLine();
    line.hint(HINT, 10_000);
    line.frame(10_000);
    line.frame(10_600);
    expect(line.frame(10_000 + NOTICE_SHOW_MS)).not.toBeNull();
    expect(line.frame(10_001 + NOTICE_SHOW_MS)).toBeNull();
    expect(line.held).toBe(false);
    line.hint(HINT, 80_000);
    expect(line.frame(80_000)?.yellow).toBe(true);
  });
});
