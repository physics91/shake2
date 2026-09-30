// The account book in one JSON file on the server's disk (ACCOUNTS_FILE), kept as storeFile.ts keeps
// it: 0600, written through a temporary file. It holds password hashes, never passwords.
import type { AccountData, AccountDefaults } from "./accounts.ts";
import { AccountBook, parseAccountData } from "./accounts.ts";
import type { StoreFile } from "./storeFile.ts";
import { openStoreFile } from "./storeFile.ts";

export type AccountFile = StoreFile<AccountBook>;

export function openAccountFile(path: string, defaults: AccountDefaults, log?: (line: string) => void, delayMs?: number): AccountFile {
  return openStoreFile<AccountData, AccountBook>(
    path,
    {
      what: "account book",
      parse: parseAccountData,
      open: (data, changed) => new AccountBook(data, defaults, changed),
      data: (book) => book.data(),
    },
    log,
    delayMs,
  );
}
