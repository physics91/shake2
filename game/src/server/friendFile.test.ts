import { lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
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
  vi.restoreAllMocks();
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

  it("keeps the saved book private when an old temporary file is readable by others", () => {
    const path = join(folder(), "friends.json");
    writeFileSync(`${path}.tmp`, "leftover", { mode: 0o644 });
    const file = openFriendFile(path, undefined, 60_000);
    file.book.meet("me");
    file.flush();
    expect(openFriendFile(path).book.data().known).toEqual(["me"]);
    expect(statSync(path).mode & 0o777).toBe(0o600);
  });

  it("saves without following a link at the old temporary path", () => {
    const dir = folder();
    const path = join(dir, "friends.json");
    const other = join(dir, "other.json");
    writeFileSync(other, "original");
    symlinkSync(other, `${path}.tmp`);
    const file = openFriendFile(path, undefined, 60_000);
    file.book.meet("me");
    file.flush();
    expect(readFileSync(other, "utf-8")).toBe("original");
    expect(openFriendFile(path).book.data().known).toEqual(["me"]);
    expect(lstatSync(path).isSymbolicLink()).toBe(false);
  });

  it("cleans up a failed save and can flush the pending book again", () => {
    const dir = folder();
    const path = join(dir, "friends.json");
    const lines: string[] = [];
    const file = openFriendFile(path, (line) => lines.push(line), 60_000);
    // A directory at the final path makes the rename fail after the temporary file was written.
    mkdirSync(path);
    file.book.meet("me");
    file.flush();
    expect(lines.some((line) => line.includes("not saved"))).toBe(true);
    expect(readdirSync(dir)).toEqual(["friends.json"]);
    rmSync(path, { recursive: true });
    file.flush();
    expect(openFriendFile(path).book.data().known).toEqual(["me"]);
    expect(readdirSync(dir)).toEqual(["friends.json"]);
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

  it("preserves each damaged file when several recoveries have the same timestamp", () => {
    vi.spyOn(Date, "now").mockReturnValue(1000);
    const dir = folder();
    const path = join(dir, "friends.json");
    const damaged = ["{first damaged book", "{second damaged book", "{third damaged book"];
    const lines: string[] = [];
    for (const text of damaged) {
      writeFileSync(path, text, { mode: 0o600 });
      expect(openFriendFile(path, (line) => lines.push(line)).book.data()).toEqual({ known: [], lists: {} });
    }
    const backups = readdirSync(dir).filter((name) => name.startsWith("friends.json.broken-"));
    expect(backups).toHaveLength(3);
    expect(backups.map((name) => readFileSync(join(dir, name), "utf8")).sort()).toEqual([...damaged].sort());
    for (const name of backups) {
      expect(statSync(join(dir, name)).mode & 0o777).toBe(0o600);
      expect(lines.some((line) => line.endsWith(join(dir, name)))).toBe(true);
    }
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
