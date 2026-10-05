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
    expect(sent).toEqual([{ type: "ranking", page: 1, requestId: 1 }]);
    board.receive({ type: "ranking", requestId: 1, page: 1, rows: [row(1), row(2)] });
    expect(await first).toBe(true);
    expect(access.rows.map((r) => r.rank)).toEqual([1, 2]);

    const past = access.page(2);
    board.receive({ type: "ranking", requestId: 2, page: 2, rows: [] });
    expect(await past).toBe(false);
    expect(access.rows.map((r) => r.rank)).toEqual([1, 2]);
  });

  it("takes a found ID's page as the window's, and keeps the list on Not Found", async () => {
    const { board, access } = wired();
    const found = access.search("id17");
    board.receive({ type: "ranking-search", requestId: 1, page: 2, rows: [row(16), row(17)] });
    expect(await found).toBe(true);
    expect(board.windowPage).toBe(2);
    expect(access.windowPage).toBe(2);
    access.windowPage = 1;
    expect(board.windowPage).toBe(1);
    access.windowPage = 2;
    expect(access.rows.map((r) => r.id)).toEqual(["id16", "id17"]);

    const missing = access.search("nobody");
    board.receive({ type: "ranking-search", requestId: 2, page: null, rows: [] });
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
    board.receive({ type: "ranking", requestId: 1, page: 1, rows: [row(1)] });
    expect(access.rows).toEqual([]);
  });

  it("does not take a late answer for the next page asked", async () => {
    vi.useFakeTimers();
    const { board, access } = wired();
    const slow = access.page(1);
    vi.advanceTimersByTime(RANKING_TIMEOUT_MS);
    expect(await slow).toBe(false);
    const next = access.page(2);
    // The server answers in order: the first page's late answer comes before the second's.
    board.receive({ type: "ranking", requestId: 1, page: 1, rows: [row(1), row(2)] });
    board.receive({ type: "ranking", requestId: 2, page: 2, rows: [row(16), row(17)] });
    expect(await next).toBe(true);
    expect(access.rows.map((r) => r.rank)).toEqual([16, 17]);
  });

  it.each(["id1", "id17"])("does not take a timed-out search's answer for the next search of %s", async (id) => {
    vi.useFakeTimers();
    const { board, access } = wired();
    const slow = access.search("id1");
    vi.advanceTimersByTime(RANKING_TIMEOUT_MS);
    expect(await slow).toBe(false);
    const next = access.search(id);
    board.receive({ type: "ranking-search", requestId: 1, page: 1, rows: [row(1)] });
    board.receive({ type: "ranking-search", requestId: 2, page: 2, rows: [row(16), row(17, id)] });

    expect(await next).toBe(true);
    expect(board.windowPage).toBe(2);
    expect(access.rows.map((r) => r.rank)).toEqual([16, 17]);
  });

  it("does not take an old page's answer when the same page is retried", async () => {
    vi.useFakeTimers();
    const { board, access } = wired();
    const slow = access.page(1);
    vi.advanceTimersByTime(RANKING_TIMEOUT_MS);
    expect(await slow).toBe(false);
    const next = access.page(1);
    board.receive({ type: "ranking", requestId: 1, page: 1, rows: [row(1, "old")] });
    board.receive({ type: "ranking", requestId: 2, page: 1, rows: [row(1, "new")] });

    expect(await next).toBe(true);
    expect(access.rows[0].id).toBe("new");
  });

  it.each(["drop", "reset"] as const)("does not reuse a request number after %s", async (end) => {
    const { board, access } = wired();
    const abandoned = access.search("id1");
    board[end]();
    expect(await abandoned).toBe(false);
    const next = access.search("id17");
    board.receive({ type: "ranking-search", requestId: 1, page: 1, rows: [row(1)] });
    board.receive({ type: "ranking-search", requestId: 2, page: 2, rows: [row(17)] });

    expect(await next).toBe(true);
    expect(access.rows[0].id).toBe("id17");
  });

  it("fails an awaited answer when the connection goes", async () => {
    const { board, access } = wired();
    const asked = access.search("id1");
    board.drop();
    expect(await asked).toBe(false);
  });

  it.each(["auth", "game"] as const)("keeps the %s request when the other connection drops", async (live) => {
    const board = new RankingBoard();
    const connections = { auth: {}, game: {} };
    const access = board.access(() => true, connections[live]);
    const asked = access.page(1);
    board.drop(connections[live === "auth" ? "game" : "auth"]);
    board.receive({ type: "ranking", requestId: 1, page: 1, rows: [row(1)] });
    expect(await asked).toBe(true);
    expect(access.rows).toEqual([row(1)]);
  });

  it.each(["auth", "game"] as const)("drops the %s request when its own connection goes", async (gone) => {
    const board = new RankingBoard();
    const connections = { auth: {}, game: {} };
    const asked = board.access(() => true, connections[gone]).search("id1");
    board.drop(connections[gone]);
    expect(await asked).toBe(false);
    const next = board.access(() => true, connections[gone === "auth" ? "game" : "auth"]).page(1);
    board.receive({ type: "ranking-search", requestId: 1, page: 1, rows: [row(1, "old")] });
    board.receive({ type: "ranking", requestId: 2, page: 1, rows: [row(1, "new")] });
    expect(await next).toBe(true);
    expect(board.rows[0].id).toBe("new");
  });

  it("empties the list and the window's page for a new program", async () => {
    const { board, access } = wired();
    const asked = access.search("id1");
    board.receive({ type: "ranking-search", requestId: 1, page: 3, rows: [row(41)] });
    expect(await asked).toBe(true);
    board.reset();
    expect({ rows: board.rows, windowPage: board.windowPage }).toEqual({ rows: [], windowPage: 1 });
  });
});
