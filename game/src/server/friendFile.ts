// The friend book in one JSON file on the server's disk (FRIENDS_FILE), kept as storeFile.ts keeps it.
import type { FriendData } from "./friends.ts";
import { FriendBook, parseFriendData } from "./friends.ts";
import type { StoreFile } from "./storeFile.ts";
import { openStoreFile } from "./storeFile.ts";

export type FriendFile = StoreFile<FriendBook>;

/**
 * The book kept in `path`. A missing file starts empty; one that cannot be read as a book is moved
 * aside (`<path>.broken-<time>`, with a numeric suffix if occupied) and the book starts empty.
 */
export function openFriendFile(path: string, log?: (line: string) => void, delayMs?: number): FriendFile {
  return openStoreFile<FriendData, FriendBook>(
    path,
    {
      what: "friend list",
      parse: parseFriendData,
      open: (data, changed) => new FriendBook(data, changed),
      data: (book) => book.data(),
    },
    log,
    delayMs,
  );
}
