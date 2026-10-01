import { describe, expect, it } from "vitest";

import { layoutFromAscii, VERSUS } from "../sim/testing.ts";
import { AccountBook, ID_TAKEN, levelFor, REGISTERED } from "./accounts.ts";
import { FriendBook } from "./friends.ts";
import type { Channel, GateConfig } from "./gate.ts";
import {
  CHECK_INTERVAL_MS,
  Gate,
  GUILD_FAILED,
  LOGIN_RETRY_MAX_MS,
  LOGIN_RETRY_MS,
  NICK_CHANGE_INTERVAL_MS,
  NICK_FAILED,
  NICK_ONCE,
  NICK_TAKEN_CODE,
  REFUSED_DUPLICATE,
  REFUSED_LEVEL,
  REFUSED_LOGIN,
  SESSION_IDLE_MS,
  SIGN_UP_INTERVAL_MS,
} from "./gate.ts";
import { Lobby } from "./lobby.ts";
import type { ClientMessage, ServerMessage } from "./protocol.ts";
import { GUILD_COUNT, PROTOCOL_VERSION, RANKING_PAGE_ROWS } from "./protocol.ts";

const PASSWORD = "pass1";
const defaults = { character: "bobo", items: [12], pairs: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9] };

function lobby(name: string, now: () => number): Lobby {
  return new Lobby({
    maps: [{ id: "arena", title: "아레나", layout: { ...layoutFromAscii(["1...2"]), id: "arena" } }],
    music: [],
    characters: ["bobo", "doona"],
    rules: VERSUS,
    maxRooms: 2,
    channel: name,
    friends: new FriendBook(),
    now,
    roomCode: () => "ABCD",
  });
}

async function makeGate(
  ids: readonly string[] = ["tester", "other"],
  channelOverrides: Partial<Channel>[] = [{}],
  extra: Pick<GateConfig, "notice" | "statusNotice"> = {},
) {
  const clock = { now: 1_000_000 };
  const accounts = new AccountBook(undefined, defaults);
  for (const id of ids) await accounts.register(id, `${id}닉`, PASSWORD, 0);
  let tokens = 0;
  const channels: Channel[] = channelOverrides.map((override, i) => ({
    row: { name: `채널${i}`, colour: "#ffffff" },
    lobby: lobby(`채널${i}`, () => clock.now),
    maxUsers: 10,
    ...override,
  }));
  const gate = new Gate({ accounts, channels, characters: ["bobo", "doona"], now: () => clock.now, token: () => `token${++tokens}`, ...extra });
  const inbox = new Map<number, ServerMessage[]>();
  const closed = new Set<number>();
  const connect = (id: number, address = "203.0.113.1") => {
    inbox.set(id, []);
    gate.connect({ id, address, send: (m) => inbox.get(id)?.push(m), close: () => closed.add(id) });
  };
  const all = <T extends ServerMessage["type"]>(id: number, type: T) =>
    (inbox.get(id) ?? []).filter((m): m is Extract<ServerMessage, { type: T }> => m.type === type);
  const last = <T extends ServerMessage["type"]>(id: number, type: T) => all(id, type).at(-1);
  /** Sends and waits for the answer of the given type (the hashing is asynchronous). */
  const ask = async <T extends ServerMessage["type"]>(id: number, message: ClientMessage, type: T) => {
    const before = all(id, type).length;
    gate.handle(id, message);
    for (let i = 0; i < 200 && all(id, type).length === before; i++) await new Promise((r) => setTimeout(r, 5));
    return all(id, type).length > before ? last(id, type) : undefined;
  };
  const login = async (id: number, account: string, password = PASSWORD) => ask(id, { type: "login", id: account, password }, "login");
  const enter = async (id: number, account: string, channel = 0) => {
    const reply = await login(id, account);
    if (!reply?.ok) throw new Error("login failed");
    gate.handle(id, { type: "version", version: PROTOCOL_VERSION, channel });
    gate.handle(id, { type: "hello", token: reply.token });
  };
  return { gate, accounts, channels, clock, inbox, closed, connect, last, all, ask, login, enter };
}

describe("the gate's login (the auth server, C->S / S->C 0x0a)", () => {
  it("answers the right password with the account, a session and the rows, and a wrong one with 로그인 실패", async () => {
    const t = await makeGate();
    t.connect(1);
    expect(await t.login(1, "tester", "wrong")).toEqual({ type: "login", ok: false });
    t.clock.now += LOGIN_RETRY_MS;
    t.gate.tick();
    const reply = await t.login(1, "TESTER");
    expect(reply).toMatchObject({ ok: true, token: "token1", channels: [{ name: "채널0", colour: "#ffffff" }] });
    expect(reply?.ok && reply.account).toMatchObject({ id: "tester", nick: "tester닉", level: 12, rank: 0, guild: -1, gender: 0 });
  });

  it("holds an address's next login back longer after each wrong one, and not another address's", async () => {
    const t = await makeGate();
    t.connect(1);
    t.connect(2);
    t.connect(3, "198.51.100.7");
    await t.login(1, "tester", "wrong1");
    expect(await t.ask(2, { type: "login", id: "tester", password: PASSWORD }, "login")).toBeUndefined();
    expect(await t.login(3, "other")).toMatchObject({ ok: true });
    t.clock.now += LOGIN_RETRY_MS - 1;
    t.gate.tick();
    expect(t.last(2, "login")).toBeUndefined();
    t.clock.now += 1;
    t.gate.tick();
    for (let i = 0; i < 200 && !t.last(2, "login"); i++) await new Promise((r) => setTimeout(r, 5));
    expect(t.last(2, "login")).toMatchObject({ ok: true });

    // The waits double up to LOGIN_RETRY_MAX_MS.
    for (let n = 2; n <= 8; n++) {
      t.clock.now += LOGIN_RETRY_MAX_MS;
      t.gate.tick();
      await t.login(1, "tester", `wrong${n}`);
    }
    const before = t.all(1, "login").length;
    t.gate.handle(1, { type: "login", id: "tester", password: PASSWORD });
    t.clock.now += LOGIN_RETRY_MAX_MS - 1;
    t.gate.tick();
    await new Promise((r) => setTimeout(r, 20));
    expect(t.all(1, "login")).toHaveLength(before);
  });

  it("takes one request of a connection at a time", async () => {
    const t = await makeGate();
    t.connect(1);
    t.gate.handle(1, { type: "login", id: "tester", password: PASSWORD });
    t.gate.handle(1, { type: "login", id: "tester", password: PASSWORD });
    for (let i = 0; i < 200 && !t.last(1, "login"); i++) await new Promise((r) => setTimeout(r, 5));
    await new Promise((r) => setTimeout(r, 100));
    expect(t.all(1, "login")).toHaveLength(1);
  });

  it("signs up once per address in SIGN_UP_INTERVAL_MS and answers the checks at most every CHECK_INTERVAL_MS", async () => {
    const t = await makeGate();
    t.connect(1);
    // A refused sign-up does not wait out the interval: the window's fields can be fixed and sent again.
    expect(await t.ask(1, { type: "register", id: "tester", nick: "새내기", password: PASSWORD }, "registered")).toMatchObject({ rcode: ID_TAKEN });
    expect(await t.ask(1, { type: "register", id: "newbie", nick: "새내기", password: PASSWORD }, "registered")).toEqual({
      type: "registered",
      rcode: REGISTERED,
    });
    expect(await t.ask(1, { type: "register", id: "newbie2", nick: "둘째", password: PASSWORD }, "registered")).toBeUndefined();
    t.clock.now += SIGN_UP_INTERVAL_MS;
    t.gate.tick();
    for (let i = 0; i < 200 && t.all(1, "registered").length < 3; i++) await new Promise((r) => setTimeout(r, 5));
    expect(t.last(1, "registered")?.rcode).toBe(REGISTERED);
    t.clock.now += SIGN_UP_INTERVAL_MS;
    t.gate.tick();
    expect(await t.ask(1, { type: "register", id: "NEWBIE", nick: "셋째", password: PASSWORD }, "registered")).toMatchObject({ rcode: ID_TAKEN });

    t.clock.now += SIGN_UP_INTERVAL_MS;
    t.gate.tick();
    expect(await t.ask(1, { type: "check-id", id: "newbie" }, "checked")).toEqual({ type: "checked", kind: "id", rcode: 1 });
    expect(await t.ask(1, { type: "check-nick", nick: "없는닉" }, "checked")).toBeUndefined();
    t.clock.now += CHECK_INTERVAL_MS;
    t.gate.tick();
    expect(t.last(1, "checked")).toEqual({ type: "checked", kind: "nick", rcode: 0 });
  });
});

describe("the gate's game servers (C->S 0x47 and 0x0a)", () => {
  it("answers the version and lets a session into the row's lobby with its account", async () => {
    const t = await makeGate();
    t.connect(1);
    await t.enter(1, "tester");
    expect(t.last(1, "version")).toEqual({ type: "version", version: PROTOCOL_VERSION });
    expect(t.last(1, "welcome")?.account).toMatchObject({ id: "tester", character: "bobo" });
    expect(t.last(1, "lobby")?.users).toMatchObject([{ id: 1, name: "tester", card: { nick: "tester닉", level: 12, guild: -1 } }]);
    expect(t.gate.onlineCount).toBe(1);
    t.gate.handle(1, { type: "create-room", title: "" });
    expect(t.channels[0].lobby.roomCount).toBe(1);
    t.gate.disconnect(1);
    expect(t.gate.onlineCount).toBe(0);
    expect(t.channels[0].lobby.userCount).toBe(0);
  });

  it("answers no login that was still being checked when its connection went into a channel", async () => {
    const t = await makeGate();
    t.connect(1);
    const reply = await t.login(1, "tester");
    if (!reply?.ok) throw new Error("login failed");
    t.connect(2, "203.0.113.2");
    t.gate.handle(2, { type: "login", id: "other", password: PASSWORD });
    t.gate.handle(2, { type: "version", version: PROTOCOL_VERSION, channel: 0 });
    t.gate.handle(2, { type: "hello", token: reply.token });
    expect(t.gate.onlineCount).toBe(1);
    // An address's checks run in turn: once another connection's is answered, the login has been checked too.
    t.connect(4, "203.0.113.2");
    expect(await t.ask(4, { type: "check-id", id: "newbie" }, "checked")).toBeDefined();
    expect(t.all(2, "login")).toEqual([]);
    // The account that went in is the one that comes out.
    t.gate.disconnect(2);
    expect(t.gate.onlineCount).toBe(0);
    t.connect(3, "203.0.113.3");
    await t.enter(3, "tester");
    expect(t.last(3, "refused")).toBeUndefined();
    expect(t.last(3, "welcome")?.account).toMatchObject({ id: "tester" });
  });

  it("refuses an unknown or stale session (0), an account already in (2), and a level the row does not take (3)", async () => {
    const t = await makeGate(["tester", "other"], [{}, { levels: [1, 3] }]);
    t.connect(1);
    t.gate.handle(1, { type: "version", version: PROTOCOL_VERSION, channel: 0 });
    t.gate.handle(1, { type: "hello", token: "made-up" });
    expect(t.last(1, "refused")).toEqual({ type: "refused", code: REFUSED_LOGIN });

    t.connect(2);
    await t.enter(2, "tester");
    t.connect(3);
    await t.enter(3, "tester");
    expect(t.last(3, "refused")?.code).toBe(REFUSED_DUPLICATE);
    // The second login took the session over: the first one's token is no longer good.
    t.gate.disconnect(2);
    t.connect(4);
    t.gate.handle(4, { type: "version", version: PROTOCOL_VERSION, channel: 0 });
    t.gate.handle(4, { type: "hello", token: "token1" });
    expect(t.last(4, "refused")?.code).toBe(REFUSED_LOGIN);

    t.connect(5, "198.51.100.7");
    await t.enter(5, "other", 1);
    expect(t.last(5, "refused")?.code).toBe(REFUSED_LEVEL);

    const reply = t.all(3, "login").at(-1);
    t.clock.now += SESSION_IDLE_MS;
    t.connect(6);
    t.gate.handle(6, { type: "version", version: PROTOCOL_VERSION, channel: 0 });
    t.gate.handle(6, { type: "hello", token: reply?.ok ? reply.token : "" });
    expect(t.last(6, "refused")?.code).toBe(REFUSED_LOGIN);
  });

  it("keeps the session of an account in a channel past SESSION_IDLE_MS, whoever logs in meanwhile", async () => {
    const t = await makeGate();
    t.connect(1);
    await t.enter(1, "tester");
    const reply = t.last(1, "login");
    t.clock.now += SESSION_IDLE_MS + 60 * 60 * 1000;
    t.connect(2, "198.51.100.7");
    await t.login(2, "other");
    // 채널변경: the lobby connection closes and the client comes back with its session.
    t.gate.disconnect(1);
    t.connect(3);
    t.gate.handle(3, { type: "version", version: PROTOCOL_VERSION, channel: 0 });
    t.gate.handle(3, { type: "hello", token: reply?.ok ? reply.token : "" });
    expect(t.last(3, "refused")).toBeUndefined();
    expect(t.last(3, "welcome")).toBeDefined();
  });

  it("closes on a full row before the version reply, and gives another version its answer but no hello", async () => {
    const t = await makeGate(["tester", "other"], [{ maxUsers: 1 }]);
    t.connect(1);
    await t.enter(1, "tester");
    t.connect(2, "198.51.100.7");
    t.gate.handle(2, { type: "version", version: PROTOCOL_VERSION, channel: 0 });
    expect(t.closed.has(2)).toBe(true);
    expect(t.last(2, "version")).toBeUndefined();
    t.gate.handle(2, { type: "version", version: PROTOCOL_VERSION, channel: 7 });
    expect(t.last(2, "version")).toBeUndefined();

    t.gate.disconnect(1);
    t.connect(3, "198.51.100.7");
    const reply = await t.login(3, "other");
    t.gate.handle(3, { type: "version", version: PROTOCOL_VERSION - 1, channel: 0 });
    expect(t.last(3, "version")?.version).toBe(PROTOCOL_VERSION);
    t.gate.handle(3, { type: "hello", token: reply?.ok ? reply.token : "" });
    expect(t.last(3, "welcome")).toBeUndefined();
  });

  it("gives each row's load as its users over its capacity (S->C 0x4c)", async () => {
    const t = await makeGate(["tester", "other"], [{ maxUsers: 4 }]);
    t.connect(1);
    t.gate.handle(1, { type: "server-info", channel: 0 });
    expect(t.last(1, "server-info")).toEqual({ type: "server-info", channel: 0, name: "채널0", load: 0 });
    await t.enter(1, "tester");
    t.gate.handle(1, { type: "server-info", channel: 0 });
    expect(t.last(1, "server-info")?.load).toBe(25);
    t.gate.handle(1, { type: "server-info", channel: 3 });
    expect(t.all(1, "server-info")).toHaveLength(2);
  });

  it("sends the operator's notice line (S->C 0x50) to a session let in, before its welcome, and none without one", async () => {
    const t = await makeGate(["tester", "other"], [{}], { notice: "점검 안내" });
    t.connect(1);
    await t.enter(1, "tester");
    const types = (t.inbox.get(1) ?? []).map((m) => m.type);
    expect(t.last(1, "notice")).toEqual({ type: "notice", text: "점검 안내" });
    expect(types.indexOf("notice")).toBeLessThan(types.indexOf("welcome"));
    t.connect(2);
    t.gate.handle(2, { type: "version", version: PROTOCOL_VERSION, channel: 0 });
    t.gate.handle(2, { type: "hello", token: "nobody" });
    expect(t.all(2, "notice")).toEqual([]);
    const plain = await makeGate();
    plain.connect(1);
    await plain.enter(1, "tester");
    expect(plain.all(1, "notice")).toEqual([]);
  });

  it("sends scene 5's notices (S->C 0x101) with a login that worked, before its answer, and none with one that did not", async () => {
    const t = await makeGate(["tester"], [{}], { statusNotice: "첫 줄\n둘째 줄\n" });
    t.connect(1);
    await t.login(1, "tester", "wrong");
    expect(t.all(1, "status-notice")).toEqual([]);
    t.clock.now += LOGIN_RETRY_MS;
    t.gate.tick();
    await t.login(1, "tester");
    const types = (t.inbox.get(1) ?? []).map((m) => m.type);
    expect(t.last(1, "status-notice")).toEqual({ type: "status-notice", text: "첫 줄\n둘째 줄\n" });
    expect(types.lastIndexOf("status-notice")).toBe(types.lastIndexOf("login") - 1);
  });

  it("wants a login before anything else", async () => {
    const t = await makeGate();
    t.connect(1);
    t.gate.handle(1, { type: "create-room", title: "" });
    expect(t.last(1, "error")?.message).toBe("먼저 로그인해야 합니다.");
  });
});

describe("the gate's saves over the auth connection (scene 5)", () => {
  it("takes 확인's nick by the nickname popup's rules: the item, once a day, nobody else's (0xfc..0xfe)", async () => {
    const t = await makeGate();
    t.connect(1);
    await t.login(1, "tester");
    t.gate.handle(1, { type: "set-status", nick: "tester닉", greeting: "안녕", useId: false });
    expect(t.last(1, "saved")?.account).toMatchObject({ nick: "tester닉", greeting: "안녕", useId: false });
    t.gate.handle(1, { type: "set-status", nick: "other닉", greeting: "", useId: true });
    expect(t.last(1, "nick-refused")?.code).toBe(NICK_TAKEN_CODE);
    t.gate.handle(1, { type: "set-status", nick: "a b", greeting: "", useId: true });
    expect(t.last(1, "nick-refused")?.code).toBe(NICK_FAILED);
    t.gate.handle(1, { type: "set-status", nick: "새이름", greeting: "", useId: true });
    expect(t.last(1, "saved")?.account.nick).toBe("새이름");
    expect(t.accounts.byNickname("새이름")?.id).toBe("tester");
    t.clock.now += NICK_CHANGE_INTERVAL_MS - 1;
    t.gate.handle(1, { type: "set-status", nick: "또바꿈", greeting: "", useId: true });
    expect(t.last(1, "nick-refused")?.code).toBe(NICK_ONCE);
    t.clock.now += 1;
    t.gate.handle(1, { type: "set-status", nick: "또바꿈", greeting: "", useId: true });
    expect(t.last(1, "saved")?.account.nick).toBe("또바꿈");

    t.accounts.update("tester", { items: [2], nickChangedAt: 0 });
    t.gate.handle(1, { type: "set-status", nick: "아이템없음", greeting: "", useId: true });
    expect(t.last(1, "nick-refused")?.code).toBe(NICK_FAILED);
  });

  it("keeps Go's character, hue and use-ID flag and 확인's greeting, cut to 35 bytes", async () => {
    const t = await makeGate();
    t.connect(1);
    t.gate.handle(1, { type: "set-greeting", greeting: "안녕" });
    expect(t.last(1, "saved")).toBeUndefined();
    await t.login(1, "tester");
    t.gate.handle(1, { type: "set-character", character: "doona", hue: -30, useId: false });
    expect(t.last(1, "saved")?.account).toMatchObject({ character: "doona", hue: -30, useId: false });
    t.gate.handle(1, { type: "set-character", character: "nobody", hue: 0, useId: true });
    expect(t.last(1, "error")?.message).toBe("알 수 없는 캐릭터입니다.");
    t.gate.handle(1, { type: "set-greeting", greeting: `  ${"가".repeat(20)}  ` });
    expect(t.last(1, "saved")?.account.greeting).toBe("가".repeat(17));
    expect(t.accounts.get("tester")).toMatchObject({ character: "doona", hue: -30, useId: false, greeting: "가".repeat(17) });

    // In the lobby the character goes through the lobby, which answers with profile.
    t.gate.handle(1, { type: "version", version: PROTOCOL_VERSION, channel: 0 });
    t.gate.handle(1, { type: "hello", token: "token1" });
    expect(t.last(1, "welcome")?.account.character).toBe("doona");
    t.gate.handle(1, { type: "set-character", character: "bobo", hue: 5, useId: true });
    expect(t.last(1, "profile")).toEqual({ type: "profile", character: "bobo", hue: 5, useId: true });
  });

  it("takes scene 5's guild (the old C->S 0x4a) as a guild.dat line, −1 to leave, and refuses the rest", async () => {
    const t = await makeGate();
    t.connect(1);
    t.gate.handle(1, { type: "set-guild", guild: 4 });
    expect(t.last(1, "saved")).toBeUndefined();
    await t.login(1, "tester");
    t.gate.handle(1, { type: "set-guild", guild: 4 });
    expect(t.last(1, "saved")?.account.guild).toBe(4);
    expect(t.accounts.get("tester")?.guild).toBe(4);
    t.gate.handle(1, { type: "set-guild", guild: -1 });
    expect(t.last(1, "saved")?.account.guild).toBe(-1);
    // Line 0 is guild.dat's "없음", which is no guild to join; past the last line there is none.
    for (const guild of [0, GUILD_COUNT, -2]) {
      t.inbox.set(1, []);
      t.gate.handle(1, { type: "set-guild", guild });
      expect(t.last(1, "error")?.message).toBe(GUILD_FAILED);
      expect(t.last(1, "saved")).toBeUndefined();
    }
    expect(t.accounts.get("tester")?.guild).toBe(-1);
  });

  it("answers ranking pages of 15 and an ID's page to a connection logged in or in a lobby (ranklist_2.asp)", async () => {
    const ids = [..."abcdefghijklmnopq"].map((letter) => `rank${letter}`);
    const t = await makeGate([...ids, "tester"]);
    ids.forEach((id, i) => t.accounts.update(id, { cell: 1000 - 10 * i, wins: i + 1, guild: i === 0 ? 7 : -1 }));
    t.connect(1);
    t.gate.handle(1, { type: "ranking", page: 1 });
    expect(t.last(1, "ranking")).toBeUndefined();

    await t.login(1, "tester");
    t.gate.handle(1, { type: "ranking", page: 1 });
    const first = t.last(1, "ranking");
    expect(first?.page).toBe(1);
    expect(first?.rows).toHaveLength(RANKING_PAGE_ROWS);
    expect(first?.rows[0]).toEqual({ rank: 1, id: "ranka", cell: 1000, wins: 1, level: 1, guild: 7, gender: 0 });
    expect(first?.rows[14]).toMatchObject({ rank: 15, id: "ranko", level: levelFor(15, ids.length) });
    t.gate.handle(1, { type: "ranking", page: 2 });
    expect(t.last(1, "ranking")?.rows.map((row) => [row.rank, row.id])).toEqual([[16, "rankp"], [17, "rankq"]]);
    // Past the last page no rows come; "tester" has no match and is on none.
    t.gate.handle(1, { type: "ranking", page: 3 });
    expect(t.last(1, "ranking")).toEqual({ type: "ranking", page: 3, rows: [] });

    t.gate.handle(1, { type: "ranking-search", id: "RANKQ" });
    expect(t.last(1, "ranking-search")).toMatchObject({ page: 2, rows: [{ rank: 16 }, { rank: 17 }] });
    for (const id of ["tester", "nobody"]) {
      t.gate.handle(1, { type: "ranking-search", id });
      expect(t.last(1, "ranking-search")).toEqual({ type: "ranking-search", page: null, rows: [] });
    }

    t.connect(2, "203.0.113.2");
    await t.enter(2, "ranka");
    t.gate.handle(2, { type: "ranking", page: 1 });
    expect(t.last(2, "ranking")?.rows).toHaveLength(RANKING_PAGE_ROWS);
  });

  it("shows a new guild by the name in the lobby the account is in", async () => {
    const t = await makeGate();
    t.connect(1);
    t.connect(2, "203.0.113.2");
    await t.enter(2, "tester");
    await t.login(1, "tester");
    t.gate.handle(1, { type: "set-guild", guild: 13 });
    t.channels[0].lobby.tick();
    expect(t.last(2, "lobby")?.users[0]?.card.guild).toBe(13);
  });

  it("shows a save over the auth connection in the lobby the account is in", async () => {
    const t = await makeGate();
    t.connect(1);
    t.connect(2, "203.0.113.2");
    await t.enter(2, "tester");
    await t.login(1, "tester");
    t.gate.handle(1, { type: "set-greeting", greeting: "로비에서 인사" });
    t.channels[0].lobby.tick();
    expect(t.last(2, "lobby")?.users[0]?.card.greeting).toBe("로비에서 인사");
  });

  it("keeps the lobby card's record as at login when it shows a save: results show from the next login", async () => {
    const t = await makeGate();
    t.connect(1);
    t.connect(2, "203.0.113.2");
    await t.enter(2, "tester");
    await t.login(1, "tester");
    t.accounts.recordMatch("tester", { cell: -200, won: false, lost: true, candy: 0 });
    t.gate.handle(1, { type: "set-greeting", greeting: "진 뒤에" });
    t.channels[0].lobby.tick();
    expect(t.last(2, "lobby")?.users[0]?.card).toMatchObject({ greeting: "진 뒤에", wins: 0, losses: 0, cell: 0, rank: 0, level: 12 });
  });

  it("takes the lobby's nickname popup (C->S 0x57) as set-status on the lobby connection, and shows the nick", async () => {
    const t = await makeGate();
    t.connect(1);
    await t.enter(1, "tester");
    t.gate.handle(1, { type: "set-status", nick: "로비닉", greeting: "", useId: true });
    expect(t.last(1, "saved")?.account.nick).toBe("로비닉");
    t.channels[0].lobby.tick();
    expect(t.last(1, "lobby")?.users[0]?.card.nick).toBe("로비닉");
    t.gate.handle(1, { type: "set-status", nick: "또로비닉", greeting: "", useId: true });
    expect(t.last(1, "nick-refused")?.code).toBe(NICK_ONCE);
  });
});
