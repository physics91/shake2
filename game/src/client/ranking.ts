// The ranking's list (0x447290, 0x447700). One list ([0x48c2ac]) serves scene 5's page and the
// lobby's ranking window, and the window's page ([0x46e740]) is also what scene 5's FIND writes.
// The original asked ranklist_2.asp on a blocking socket; the remake asks its server (R).
import type { ClientMessage, RankingRow, ServerMessage } from "../server/protocol.ts";

/** A page cannot block as the original's socket did; an answer later than this counts as none. */
export const RANKING_TIMEOUT_MS = 5000;

export type RankingReply = Extract<ServerMessage, { type: "ranking" | "ranking-search" }>;

type RankingRequest = Extract<ClientMessage, { type: RankingReply["type"] }>;
type Send = (message: ClientMessage) => boolean;

/** The shared list and its fetches; each wait belongs to the connection that sent it. */
export interface RankingAccess {
  /** The list as the last fetch that brought rows left it. */
  readonly rows: readonly RankingRow[];
  /** 0x447290: true when rows came, which then replace the list; otherwise it stays. */
  page(page: number): Promise<boolean>;
  /** 0x447700: true when the ID was found, its page then the list and the window's page. */
  search(id: string): Promise<boolean>;
  /** [0x46e740]: the lobby window's page. */
  windowPage: number;
}

export class RankingBoard {
  rows: readonly RankingRow[] = [];
  /** [0x46e740]: the lobby window's page. */
  windowPage = 1;
  private waiting: {
    message: RankingRequest;
    connection: object | null;
    done: (reply: RankingReply | null) => void;
  } | null = null;
  /** Kept across drop/reset, so an old reply cannot answer a new program's request either. */
  private requestId = 0;

  async page(send: Send, page: number, connection: object | null = send): Promise<boolean> {
    return this.take(await this.ask(send, { type: "ranking", page, requestId: ++this.requestId }, connection));
  }

  /** An empty ID is not asked (0x447700 returns 0 for it). */
  async search(send: Send, id: string, connection: object | null = send): Promise<boolean> {
    if (!id) return false;
    const reply = await this.ask(send, { type: "ranking-search", id, requestId: ++this.requestId }, connection);
    if (reply?.type !== "ranking-search" || reply.page === null) return false;
    // The page line comes first: it is taken even when no row follows it.
    this.windowPage = reply.page;
    return this.take(reply);
  }

  /** Only this request's answer counts: a timed-out or dropped request can still arrive later. */
  receive(reply: RankingReply): void {
    const waiting = this.waiting;
    if (waiting?.message.type !== reply.type) return;
    if (waiting.message.requestId !== reply.requestId) return;
    if (waiting.message.type === "ranking" && reply.page !== waiting.message.page) return;
    waiting.done(reply);
  }

  /** The given connection went; without one, abandon any wait (the whole program ends). */
  drop(connection?: object | null): void {
    if (connection === undefined || this.waiting?.connection === connection) this.waiting?.done(null);
  }

  /** A new program's list: no rows, the window on page 1, nothing awaited. */
  reset(): void {
    this.drop();
    this.rows = [];
    this.windowPage = 1;
  }

  access(send: Send, connection: object | null = send): RankingAccess {
    const board = this;
    return {
      get rows() {
        return board.rows;
      },
      get windowPage() {
        return board.windowPage;
      },
      set windowPage(page) {
        board.windowPage = page;
      },
      page: (page) => board.page(send, page, connection),
      search: (id) => board.search(send, id, connection),
    };
  }

  /** No rows keep the old list (0x447290 frees it only when some came). */
  private take(reply: RankingReply | null): boolean {
    if (!reply || reply.rows.length === 0) return false;
    this.rows = reply.rows;
    return true;
  }

  /** One request at a time, as the blocking socket allowed; a second while one waits fails. */
  private ask(send: Send, message: RankingRequest, connection: object | null): Promise<RankingReply | null> {
    if (this.waiting) return Promise.resolve(null);
    return new Promise((resolve) => {
      const timer = setTimeout(() => done(null), RANKING_TIMEOUT_MS);
      const done = (reply: RankingReply | null) => {
        clearTimeout(timer);
        this.waiting = null;
        resolve(reply);
      };
      this.waiting = { message, connection, done };
      if (!send(message)) done(null);
    });
  }
}
