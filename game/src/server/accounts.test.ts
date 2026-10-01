import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import { openAccountFile } from "./accountFile.ts";
import {
  AccountBook,
  ID_DIGIT_FIRST,
  ID_NOT_ALNUM,
  ID_TAKEN,
  ID_UNUSABLE,
  idProblem,
  isNick,
  isPassword,
  levelFor,
  NICK_TAKEN,
  parseAccountData,
  REGISTER_FAILED,
  REGISTERED,
} from "./accounts.ts";
import { hasItem } from "./items.ts";
import { checkPassword, hashPassword } from "./passwords.ts";

const defaults = { character: "rookie", items: [12], pairs: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9] };
const folders: string[] = [];

afterAll(() => {
  for (const path of folders) rmSync(path, { recursive: true, force: true });
});

describe("sign-up rules (0x45f280, Regist_UP_shake2.asp)", () => {
  it("takes 4..10 letters and digits, not starting with a digit", () => {
    expect(idProblem("abcd")).toBeNull();
    expect(idProblem("Abc123xyz9")).toBeNull();
    expect(idProblem("abc")).toBe(REGISTER_FAILED);
    expect(idProblem("abcdefghijk")).toBe(REGISTER_FAILED);
    expect(idProblem("ab_cd")).toBe(ID_NOT_ALNUM);
    expect(idProblem("한글아이디")).toBe(ID_NOT_ALNUM);
    expect(idProblem("한글")).toBe(ID_NOT_ALNUM); // 4 cp949 bytes, as the client counts them
    expect(idProblem("한글한글한글")).toBe(REGISTER_FAILED); // 6 characters, 12 bytes
    expect(idProblem("1abcd")).toBe(ID_DIGIT_FIRST);
    expect(idProblem("Admin")).toBe(ID_UNUSABLE);
    expect(idProblem("sysman")).toBe(ID_UNUSABLE);
  });

  it("takes a nick of 1..10 cp949 bytes without blanks, and a password of 4..10", () => {
    expect(isNick("쉐이크왕")).toBe(true);
    expect(isNick("가나다라마바")).toBe(false); // 12 bytes
    expect(isNick("a b")).toBe(false);
    expect(isNick("")).toBe(false);
    expect(isPassword("abcd")).toBe(true);
    expect(isPassword("abc")).toBe(false);
    expect(isPassword("12345678901")).toBe(false);
    expect(isPassword("pass word")).toBe(false);
  });
});

describe("the account book", () => {
  it("signs up once per ID and nick, whatever their case, and answers the checks", async () => {
    let changes = 0;
    const book = new AccountBook(undefined, defaults, () => changes++);
    expect(await book.register("Tester", "테스터", "pass1", 1000)).toBe(REGISTERED);
    expect(changes).toBe(1);
    expect(await book.register("tester", "다른닉", "pass1", 1000)).toBe(ID_TAKEN);
    expect(await book.register("other", "테스터", "pass1", 1000)).toBe(NICK_TAKEN);
    expect(await book.register("other", "닉", "abc", 1000)).toBe(REGISTER_FAILED);
    expect(book.checkId("TESTER")).toBe(1);
    expect(book.checkId("fresh")).toBe(0);
    expect(book.checkId("1bad")).toBe(1);
    expect(book.checkNick("테스터")).toBe(1);
    expect(book.checkNick("새닉")).toBe(0);
    const account = book.get("TESTER")!;
    expect(account).toMatchObject({ id: "Tester", nick: "테스터", character: "rookie", hue: 0, guild: -1, cell: 0, items: [12] });
    expect(account.password).not.toContain("pass1");
  });

  it("authenticates only the right password", async () => {
    const book = new AccountBook(undefined, defaults);
    await book.register("tester", "테스터", "pass1", 0);
    expect((await book.authenticate("TESTER", "pass1"))?.id).toBe("tester");
    expect(await book.authenticate("tester", "pass2")).toBeNull();
    expect(await book.authenticate("nobody", "pass1")).toBeNull();
  });

  it("changes a nick only to a free one", async () => {
    const book = new AccountBook(undefined, defaults);
    await book.register("aaaa", "에이", "pass1", 0);
    await book.register("bbbb", "비", "pass1", 0);
    expect(book.update("aaaa", { nick: "비" })).toBe(false);
    expect(book.update("aaaa", { nick: "새이름" })).toBe(true);
    expect(book.byNickname("새이름")?.id).toBe("aaaa");
    expect(book.checkNick("에이")).toBe(0);
  });

  it("ranks the accounts that finished a match by cell points and gives their levels", async () => {
    const book = new AccountBook(undefined, defaults);
    for (const id of ["aaaa", "bbbb", "cccc", "dddd"]) await book.register(id, id, "pass1", 0);
    book.update("aaaa", { cell: 300, wins: 1 });
    book.update("bbbb", { cell: 500, losses: 1 });
    book.update("cccc", { cell: 300, wins: 2 });
    expect(book.ranking().map((a) => a.id)).toEqual(["bbbb", "cccc", "aaaa"]);
    expect(book.standing("bbbb")).toEqual({ rank: 1, level: 1 });
    expect(book.standing("aaaa")).toEqual({ rank: 3, level: 2 });
    expect(book.standing("dddd")).toEqual({ rank: 0, level: 12 });
  });

  it("adds a match's result to the account and ranks it again", async () => {
    let changes = 0;
    const book = new AccountBook(undefined, defaults, () => changes++);
    for (const id of ["aaaa", "bbbb"]) await book.register(id, id, "pass1", 0);
    book.update("aaaa", { cell: 100, wins: 1 });
    expect(book.ranking().map((a) => a.id)).toEqual(["aaaa"]);
    changes = 0;
    book.recordMatch("BBBB", { cell: 240, won: true, lost: false, candy: 2 });
    book.recordMatch("aaaa", { cell: -200, won: false, lost: true, candy: 0 });
    expect(changes).toBe(2);
    expect(book.get("bbbb")).toMatchObject({ cell: 240, wins: 1, losses: 0, candy: 2 });
    expect(book.get("aaaa")).toMatchObject({ cell: -100, wins: 1, losses: 1 });
    expect(book.ranking().map((a) => a.id)).toEqual(["bbbb", "aaaa"]);
    book.recordMatch("nobody", { cell: 1, won: true, lost: false, candy: 1 });
    expect(changes).toBe(2);
  });

  it("keeps cell points within the login record's 32 bits", async () => {
    const book = new AccountBook(undefined, defaults);
    await book.register("aaaa", "aaaa", "pass1", 0);
    book.update("aaaa", { cell: 0x7fffff00 });
    book.recordMatch("aaaa", { cell: 0x1000, won: true, lost: false, candy: 0 });
    expect(book.get("aaaa")?.cell).toBe(0x7fffffff);
    book.update("aaaa", { cell: -0x7fffff00 });
    book.recordMatch("aaaa", { cell: -0x1000, won: false, lost: true, candy: 0 });
    expect(book.get("aaaa")?.cell).toBe(-0x80000000);
  });
});

describe("the level table (ranking.html)", () => {
  it("gives 1위, 8위까지 and 85위까지, then the percentages, then 루키", () => {
    expect(levelFor(1, 10_000)).toBe(1);
    expect(levelFor(8, 10_000)).toBe(2);
    expect(levelFor(85, 10_000)).toBe(3);
    expect(levelFor(100, 10_000)).toBe(4);
    expect(levelFor(300, 10_000)).toBe(5);
    expect(levelFor(500, 10_000)).toBe(6);
    expect(levelFor(1000, 10_000)).toBe(7);
    expect(levelFor(2000, 10_000)).toBe(8);
    expect(levelFor(4000, 10_000)).toBe(9);
    expect(levelFor(6000, 10_000)).toBe(10);
    expect(levelFor(8000, 10_000)).toBe(11);
    expect(levelFor(8001, 10_000)).toBe(12);
    expect(levelFor(0, 10)).toBe(12);
  });
});

describe("items (hasItem 0x45f140)", () => {
  it("counts an item owned or held by a pack", () => {
    expect(hasItem([2], 2)).toBe(true);
    expect(hasItem([2], 3)).toBe(false);
    expect(hasItem([12], 20)).toBe(true);
    expect(hasItem([10], 6)).toBe(true);
    expect(hasItem([10], 9)).toBe(false);
    expect(hasItem([11], 9)).toBe(true);
    expect(hasItem([11], 20)).toBe(false);
  });
});

describe("passwords", () => {
  it("keeps a salted scrypt hash that only the password matches", async () => {
    const a = await hashPassword("비밀1234");
    const b = await hashPassword("비밀1234");
    expect(a).not.toBe(b);
    expect(a.startsWith("scrypt$16384$8$1$")).toBe(true);
    expect(await checkPassword("비밀1234", a)).toBe(true);
    expect(await checkPassword("비밀1235", a)).toBe(false);
    expect(await checkPassword("x", "scrypt$1$1$1$aa$bb")).toBe(false);
    expect(await checkPassword("x", "plain")).toBe(false);
  });

  it("matches nothing with a hash whose cost scrypt refuses to run", async () => {
    const salt = Buffer.alloc(16).toString("base64");
    const key = Buffer.alloc(32).toString("base64");
    // 128·N·r is 64 MiB here, over derive's memory bound: scrypt throws instead of answering.
    await expect(checkPassword("x", `scrypt$65536$8$1$${salt}$${key}`)).resolves.toBe(false);
  });
});

describe("the account file (ACCOUNTS_FILE)", () => {
  it("keeps hashes, not passwords, in a 0600 file it reads back", async () => {
    const dir = mkdtempSync(join(tmpdir(), "shake2-accounts-"));
    folders.push(dir);
    const path = join(dir, "data", "accounts.json");
    const file = openAccountFile(path, defaults, undefined, 60_000);
    await file.book.register("tester", "테스터", "secret1", 5);
    file.flush();
    const text = readFileSync(path, "utf-8");
    expect(text).not.toContain("secret1");
    expect(statSync(path).mode & 0o777).toBe(0o600);
    const again = openAccountFile(path, defaults);
    expect((await again.book.authenticate("tester", "secret1"))?.nick).toBe("테스터");
  });

  it("drops records this server could not have written", () => {
    const good = { id: "good1", nick: "굿", password: "scrypt$16384$8$1$c2FsdA==$a2V5", greeting: "", character: "bobo", hue: 0, useId: true, guild: -1, wins: 0, losses: 0, cell: 0, candy: 0, items: [], pairs: [0], nickChangedAt: 0, createdAt: 0 };
    const data = parseAccountData(JSON.stringify({ accounts: [good, { ...good, id: "1bad" }, { ...good, id: "hue1", hue: 999 }, "x"] }));
    expect(data?.accounts.map((a) => a.id)).toEqual(["good1"]);
    expect(parseAccountData("{")).toBeNull();
    expect(parseAccountData("[]")).toBeNull();
  });
});
