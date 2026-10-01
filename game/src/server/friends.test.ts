import { describe, expect, it } from "vitest";

import { FriendBook, MAX_KNOWN_NAMES, parseFriendData } from "./friends.ts";

function bookOf(...names: string[]) {
  let changes = 0;
  const book = new FriendBook(undefined, () => {
    changes += 1;
  });
  for (const name of names) book.meet(name);
  return { book, changes: () => changes };
}

describe("the friend book (S->C 0x64, 0x65 results, R)", () => {
  it("adds known names in order, twelve at most, and refuses as the table at 0x44c19c words it", () => {
    const friends = Array.from({ length: 13 }, (_, i) => `f${i}`);
    const { book } = bookOf("me", ...friends);
    expect(book.add("me", "")).toBe(-4);
    expect(book.add("me", "nobody")).toBe(-4);
    expect(book.add("me", "me")).toBe(-5);
    for (const id of friends.slice(0, 12)) expect(book.add("me", id)).toBe(1);
    expect(book.add("me", "f0")).toBe(-2);
    expect(book.add("me", "f12")).toBe(-3);
    expect(book.list("me")).toEqual(friends.slice(0, 12));
    expect(book.list("f0")).toEqual([]);
  });

  it("deletes a listed ID and answers 0 for one not listed", () => {
    const { book } = bookOf("me", "a", "b");
    book.add("me", "a");
    book.add("me", "b");
    expect(book.remove("me", "a")).toBe(1);
    expect(book.remove("me", "a")).toBe(0);
    expect(book.remove("me", "zz")).toBe(0);
    expect(book.list("me")).toEqual(["b"]);
  });

  it("tells of a change only when there is something to save", () => {
    const { book, changes } = bookOf("me", "a");
    expect(changes()).toBe(2);
    book.meet("a");
    book.add("me", "zz");
    book.remove("me", "a");
    expect(changes()).toBe(2);
    book.add("me", "a");
    book.remove("me", "a");
    expect(changes()).toBe(4);
  });

  it("tells of a change when a name met again moves to the end, so the file keeps the book's order", () => {
    const { book, changes } = bookOf("a", "b");
    book.meet("a");
    expect(changes()).toBe(3);
    expect(book.data().known).toEqual(["b", "a"]);
  });

  it("forgets the least recently seen name no list holds, and never one a list holds or has", () => {
    const names = Array.from({ length: MAX_KNOWN_NAMES }, (_, i) => `n${i}`);
    const { book } = bookOf(...names);
    book.add("n0", "n1");
    book.meet("n2");
    book.meet("new1");
    book.meet("new2");
    const known = book.data().known;
    expect(known).toHaveLength(MAX_KNOWN_NAMES);
    expect(known.slice(0, 2)).toEqual(["n0", "n1"]);
    expect(known).not.toContain("n3");
    expect(known).not.toContain("n4");
    expect(known).toContain("n2");
    expect(book.add("n0", "n3")).toBe(-4);
  });

  it("keeps no list for a name it could not keep (-1)", () => {
    const names = Array.from({ length: MAX_KNOWN_NAMES }, (_, i) => `n${i}`);
    const { book } = bookOf(...names);
    for (let i = 0; i < MAX_KNOWN_NAMES; i += 2) book.add(`n${i}`, `n${i + 1}`);
    book.meet("late");
    expect(book.data().known).not.toContain("late");
    expect(book.add("late", "n1")).toBe(-1);
  });

  it("reads back what it saved, and drops what a hello or an add could not have made", () => {
    const { book } = bookOf("me", "a", "__proto__");
    book.add("me", "a");
    book.add("__proto__", "me");
    const saved = parseFriendData(JSON.stringify(book.data()));
    expect(saved).toEqual(book.data());
    const again = new FriendBook(saved!);
    expect(again.list("me")).toEqual(["a"]);
    expect(again.list("__proto__")).toEqual(["me"]);

    const odd = parseFriendData(
      JSON.stringify({ known: ["me", "a", "", 5, "x\u0007", "가".repeat(13)], lists: { me: ["a", "a", "me", "gone", 7, "가나다라마바"], gone: ["a"], x: "a" } }),
    );
    expect(odd?.known).toEqual(["me", "a"]);
    expect(new FriendBook(odd!).list("me")).toEqual(["a"]);
    expect(new FriendBook(odd!).list("gone")).toEqual([]);
  });

  it.each([["not json", "{"], ["an array", "[]"], ["no lists", '{"known":[]}'], ["lists as an array", '{"known":[],"lists":[]}']])(
    "reads %s as no book",
    (_label, text) => {
      expect(parseFriendData(text)).toBeNull();
    },
  );
});
