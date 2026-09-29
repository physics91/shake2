// The friend book in one JSON file on the server's disk (FRIENDS_FILE). Changes are written at most
// once a second, to a temporary file renamed over the old one, so a crash leaves the last whole save.
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import { FriendBook, parseFriendData } from "./friends.ts";

const SAVE_DELAY_MS = 1000;

export interface FriendFile {
  book: FriendBook;
  /** Write what is not written yet: on shutdown. */
  flush(): void;
}

/**
 * The book kept in `path`. A missing file starts empty; one that cannot be read as a book is moved
 * aside (`<path>.broken-<time>`) and the book starts empty.
 */
export function openFriendFile(path: string, log: (line: string) => void = () => undefined, delayMs = SAVE_DELAY_MS): FriendFile {
  let text: string | null = null;
  try {
    text = readFileSync(path, "utf-8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const data = text === null ? undefined : parseFriendData(text);
  if (data === null) {
    const aside = `${path}.broken-${Date.now()}`;
    renameSync(path, aside);
    log(`friend list ${path} could not be read; moved to ${aside}`);
  }

  let dirty = false;
  let timer: NodeJS.Timeout | null = null;
  const save = () => {
    if (timer) clearTimeout(timer);
    timer = null;
    const temporary = `${path}.tmp`;
    try {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(temporary, JSON.stringify(book.data()), { mode: 0o600 });
      renameSync(temporary, path);
      dirty = false;
    } catch (error) {
      // Kept in memory; the next change tries again.
      log(`friend list not saved to ${path}: ${(error as Error).message}`);
    }
  };
  const book = new FriendBook(data ?? undefined, () => {
    dirty = true;
    if (timer) return;
    timer = setTimeout(save, delayMs);
    timer.unref();
  });
  return {
    book,
    flush: () => {
      if (dirty) save();
    },
  };
}
