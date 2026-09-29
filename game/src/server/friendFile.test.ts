import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { openFriendFile } from "./friendFile.ts";

const folders: string[] = [];

function folder(): string {
  const path = mkdtempSync(join(tmpdir(), "shake2-friends-"));
  folders.push(path);
  return path;
}

afterEach(() => {
  vi.useRealTimers();
  for (const path of folders.splice(0)) rmSync(path, { recursive: true, force: true });
});

describe("the friend file (FRIENDS_FILE)", () => {
  it("starts empty without a file, writes a second after a change, and reads it back", () => {
    vi.useFakeTimers();
    const path = join(folder(), "data", "friends.json");
    const file = openFriendFile(path);
    file.book.meet("me");
    file.book.meet("a");
    expect(file.book.add("me", "a")).toBe(1);
    expect(() => statSync(path)).toThrow();
    vi.advanceTimersByTime(1000);
    expect(JSON.parse(readFileSync(path, "utf-8"))).toEqual({ known: ["me", "a"], lists: { me: ["a"] } });
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(openFriendFile(path).book.list("me")).toEqual(["a"]);
  });

  it("writes what is pending on flush, and leaves no temporary file", () => {
    const dir = folder();
    const path = join(dir, "friends.json");
    const file = openFriendFile(path, undefined, 60_000);
    file.book.meet("me");
    file.flush();
    expect(readdirSync(dir)).toEqual(["friends.json"]);
    expect(openFriendFile(path).book.data().known).toEqual(["me"]);
  });

  it("moves a file it cannot read aside and starts empty", () => {
    const dir = folder();
    const path = join(dir, "friends.json");
    writeFileSync(path, "{not json");
    const lines: string[] = [];
    const file = openFriendFile(path, (line) => lines.push(line));
    expect(file.book.data()).toEqual({ known: [], lists: {} });
    const aside = readdirSync(dir).filter((name) => name.startsWith("friends.json.broken-"));
    expect(aside).toHaveLength(1);
    expect(readFileSync(join(dir, aside[0]), "utf-8")).toBe("{not json");
    expect(lines[0]).toContain("could not be read");
  });

  it("keeps the book in memory and says so when the file cannot be written", () => {
    const dir = folder();
    const lines: string[] = [];
    const file = openFriendFile(join(dir, "sub", "friends.json"), (line) => lines.push(line));
    // A file where the folder should be.
    writeFileSync(join(dir, "sub"), "");
    file.book.meet("me");
    file.flush();
    expect(lines.some((line) => line.includes("not saved"))).toBe(true);
    expect(file.book.data().known).toEqual(["me"]);
  });
});
