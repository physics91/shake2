import { afterEach, describe, expect, it, vi } from "vitest";

import type { ClientMessage, RankingRow } from "../server/protocol.ts";
import { RANKING_TIMEOUT_MS, RankingBoard } from "./ranking.ts";

const row = (rank: number, id = `id${rank}`): RankingRow => ({ rank, id, cell: 1000 - rank, wins: rank, level: 3, guild: -1, gender: 0 });

function wired() {
  const board = new RankingBoard();
  const sent: ClientMessage[] = [];
  const access = board.access((message) => {
    sent.push(message);
    return true;
  });
  return { board, sent, access };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("the ranking list (0x447290, 0x447700)", () => {
  it("replaces the list only when a page brings rows", async () => {
    const { board, sent, access } = wired();
    const first = access.page(1);
    expect(sent).toEqual([{ type: "ranking", page: 1 }]);
    board.receive({ type: "ranking", page: 1, rows: [row(1), row(2)] });
    expect(await first).toBe(true);
    expect(access.rows.map((r) => r.rank)).toEqual([1, 2]);

    const past = access.page(2);
    board.receive({ type: "ranking", page: 2, rows: [] });
    expect(await past).toBe(false);
    expect(access.rows.map((r) => r.rank)).toEqual([1, 2]);
  });

  it("takes a found ID's page as the window's, and keeps the list on Not Found", async () => {
    const { board, access } = wired();
    const found = access.search("id17");
    board.receive({ type: "ranking-search", page: 2, rows: [row(16), row(17)] });
    expect(await found).toBe(true);
    expect(board.windowPage).toBe(2);
    expect(access.rows.map((r) => r.id)).toEqual(["id16", "id17"]);

    const missing = access.search("nobody");
    board.receive({ type: "ranking-search", page: null, rows: [] });
    expect(await missing).toBe(false);
    expect(board.windowPage).toBe(2);
    expect(access.rows).toHaveLength(2);
  });

  it("asks nothing for an empty ID, and fails with nothing to send on", async () => {
    const board = new RankingBoard();
    const sent: ClientMessage[] = [];
    expect(await board.search((m) => (sent.push(m), true), "")).toBe(false);
    expect(await board.page(() => false, 1)).toBe(false);
    expect(sent).toEqual([]);
  });

  it("fails an answer that does not come in time, or one asked while another waits", async () => {
    vi.useFakeTimers();
    const { board, access } = wired();
    const slow = access.page(1);
    expect(await access.page(2)).toBe(false);
    vi.advanceTimersByTime(RANKING_TIMEOUT_MS);
    expect(await slow).toBe(false);
    // A late answer finds nothing waiting.
    board.receive({ type: "ranking", page: 1, rows: [row(1)] });
    expect(access.rows).toEqual([]);
  });

  it("fails an awaited answer when the connection goes", async () => {
    const { board, access } = wired();
    const asked = access.search("id1");
    board.drop();
    expect(await asked).toBe(false);
  });
});
