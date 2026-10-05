import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AuthLink } from "./authLink.ts";

class Socket extends EventTarget {
  static OPEN = 1;
  readyState = 0;
  closed = false;
  sent: string[] = [];
  url: string;

  constructor(url: string) {
    super();
    this.url = url;
    sockets.push(this);
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.closed = true;
    this.readyState = 3;
  }

  open(): void {
    this.readyState = Socket.OPEN;
    this.dispatchEvent(new Event("open"));
  }
}

const sockets: Socket[] = [];

beforeEach(() => {
  sockets.length = 0;
  vi.useFakeTimers();
  vi.stubGlobal("WebSocket", Socket);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("the auth connection's server address", () => {
  it.each([false, true])("changes servers while the previous connection is open=%s", (open) => {
    const receive = vi.fn();
    const stateChanged = vi.fn();
    const link = new AuthLink({ receive, stateChanged });
    link.connect("ws://first/ws");
    const first = sockets[0];
    if (open) first.open();
    link.connect("ws://second/ws");

    expect(first.closed).toBe(true);
    expect(sockets).toHaveLength(2);
    const second = sockets[1];
    second.open();
    expect(link.send({ type: "login", id: "tester", password: "test1234" })).toBe(true);
    expect(first.sent).toEqual([]);
    expect(second.sent.map((text) => JSON.parse(text).type)).toEqual(["login"]);

    first.dispatchEvent(new MessageEvent("message", { data: '{"type":"login","ok":false}' }));
    first.dispatchEvent(new Event("close"));
    expect(receive).not.toHaveBeenCalled();
    expect(link.state).toBe("open");
    link.dispose();
  });

  it("keeps an open or connecting socket when its address has not changed", () => {
    const link = new AuthLink({ receive() {}, stateChanged() {} });
    link.connect("ws://first/ws");
    link.connect("ws://first/ws");
    expect(sockets).toHaveLength(1);
    sockets[0].open();
    link.connect("ws://first/ws");
    expect(sockets).toHaveLength(1);
    expect(sockets[0].closed).toBe(false);
    link.dispose();
  });
});
