// The connection to the auth server (0x4486b0, [0x48c0f4]): opened as loading gives way to the login,
// and again when a message box on the login closes. It carries the login and, in the remake, what
// the original sent to servers now lost: the server list's load queries and scene 5's saves (R).
import type { ClientMessage, ServerMessage } from "../server/protocol.ts";

/** "connecting" until the socket opens or fails; "failed" also after it closed. */
export type AuthState = "idle" | "connecting" | "open" | "failed";

/** The blocking connect has no time limit in the original; a page cannot block, so it waits this long. */
export const AUTH_CONNECT_TIMEOUT_MS = 5000;

export interface AuthLinkEvents {
  stateChanged(state: AuthState): void;
  receive(message: ServerMessage): void;
}

export class AuthLink {
  private socket: WebSocket | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private current: AuthState = "idle";
  private readonly events: AuthLinkEvents;

  constructor(events: AuthLinkEvents) {
    this.events = events;
  }

  get state(): AuthState {
    return this.current;
  }

  /** Connects unless connected or connecting. */
  connect(url: string): void {
    if (this.current === "open" || this.current === "connecting") return;
    let socket: WebSocket;
    try {
      socket = new WebSocket(url);
    } catch {
      this.setState("failed");
      return;
    }
    this.socket = socket;
    this.setState("connecting");
    this.timer = setTimeout(() => {
      if (this.socket === socket && this.current === "connecting") this.drop(socket);
    }, AUTH_CONNECT_TIMEOUT_MS);
    socket.addEventListener("open", () => {
      if (this.socket !== socket) return;
      this.clearTimer();
      this.setState("open");
    });
    socket.addEventListener("message", (event) => {
      if (this.socket !== socket) return;
      let message: ServerMessage;
      try {
        message = JSON.parse(String(event.data)) as ServerMessage;
      } catch {
        return;
      }
      this.events.receive(message);
    });
    socket.addEventListener("close", () => {
      if (this.socket === socket) this.drop(socket);
    });
  }

  /** Sends when open; false when there is no connection to send on. */
  send(message: ClientMessage): boolean {
    if (this.current !== "open" || this.socket?.readyState !== WebSocket.OPEN) return false;
    this.socket.send(JSON.stringify(message));
    return true;
  }

  dispose(): void {
    const socket = this.socket;
    this.socket = null;
    this.clearTimer();
    this.current = "idle";
    socket?.close();
  }

  private drop(socket: WebSocket): void {
    this.socket = null;
    this.clearTimer();
    socket.close();
    this.setState("failed");
  }

  private clearTimer(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }

  private setState(state: AuthState): void {
    this.current = state;
    this.events.stateChanged(state);
  }
}
