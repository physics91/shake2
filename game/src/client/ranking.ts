// The ranking's list (0x447290, 0x447700). One list ([0x48c2ac]) serves scene 5's page and the
// lobby's ranking window, and the window's page ([0x46e740]) is also what scene 5's FIND writes.
// The original asked ranklist_2.asp on a blocking socket; the remake asks its server (R).
import type { ClientMessage, RankingRow, ServerMessage } from "../server/protocol.ts";

/** A page cannot block as the original's socket did; an answer later than this counts as none. */
export const RANKING_TIMEOUT_MS = 5000;

export type RankingReply = Extract<ServerMessage, { type: "ranking" | "ranking-search" }>;

type Send = (message: ClientMessage) => boolean;

/** The list and its two fetches, bound to one connection. */
export interface RankingAccess {
  /** The list as the last fetch that brought rows left it. */
  readonly rows: readonly RankingRow[];
  /** 0x447290: true when rows came, which then replace the list; otherwise it stays. */
  page(page: number): Promise<boolean>;
  /** 0x447700: true when the ID was found, its page then the list and the window's page. */
  search(id: string): Promise<boolean>;
}

export class RankingBoard {
  rows: readonly RankingRow[] = [];
  /** [0x46e740]: the lobby window's page. */
  windowPage = 1;
  private waiting: { type: RankingReply["type"]; done: (reply: RankingReply | null) => void } | null = null;

  async page(send: Send, page: number): Promise<boolean> {
    return this.take(await this.ask(send, { type: "ranking", page }));
  }

  /** An empty ID is not asked (0x447700 returns 0 for it). */
  async search(send: Send, id: string): Promise<boolean> {
    if (!id) return false;
    const reply = await this.ask(send, { type: "ranking-search", id });
    if (reply?.type !== "ranking-search" || reply.page === null) return false;
    // The page line comes first: it is taken even when no row follows it.
    this.windowPage = reply.page;
    return this.take(reply);
  }

  receive(reply: RankingReply): void {
    if (this.waiting?.type === reply.type) this.waiting.done(reply);
  }

  /** The connection went: an awaited answer will not come. */
  drop(): void {
    this.waiting?.done(null);
  }

  access(send: Send): RankingAccess {
    const board = this;
    return {
      get rows() {
        return board.rows;
      },
      page: (page) => board.page(send, page),
      search: (id) => board.search(send, id),
    };
  }

  /** No rows keep the old list (0x447290 frees it only when some came). */
  private take(reply: RankingReply | null): boolean {
    if (!reply || reply.rows.length === 0) return false;
    this.rows = reply.rows;
    return true;
  }

  /** One request at a time, as the blocking socket allowed; a second while one waits fails. */
  private ask(send: Send, message: Extract<ClientMessage, { type: RankingReply["type"] }>): Promise<RankingReply | null> {
    if (this.waiting) return Promise.resolve(null);
    return new Promise((resolve) => {
      const timer = setTimeout(() => done(null), RANKING_TIMEOUT_MS);
      const done = (reply: RankingReply | null) => {
        clearTimeout(timer);
        this.waiting = null;
        resolve(reply);
      };
      this.waiting = { type: message.type, done };
      if (!send(message)) done(null);
    });
  }
}
