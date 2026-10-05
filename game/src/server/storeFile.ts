// A book of the server's (friend lists, accounts) in one JSON file on its disk. Changes are written
// at most once a second, to a temporary file renamed over the old one, so a crash leaves the last
// whole save; the file is the server's alone (0600).
import { constants, copyFileSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const SAVE_DELAY_MS = 1000;

export interface StoreFile<B> {
  book: B;
  /** Write what is not written yet: on shutdown. */
  flush(): void;
}

export interface StoreKind<D, B> {
  /** How the log names it: "friend list", "account book". */
  what: string;
  /** The saved data, checked: null when the text is not one. */
  parse(text: string): D | null;
  /** The book over `data` (undefined: a new, empty one), calling `changed` after each change. */
  open(data: D | undefined, changed: () => void): B;
  data(book: B): unknown;
}

/**
 * The book kept in `path`. A missing file starts empty; one whose text is not a book is moved aside
 * (`<path>.broken-<time>`, with a numeric suffix if occupied) and the book starts empty.
 * Any other read error (no permission, say) is thrown, so the server does not start over a file
 * it could not look at.
 */
export function openStoreFile<D, B>(
  path: string,
  kind: StoreKind<D, B>,
  log: (line: string) => void = () => undefined,
  delayMs = SAVE_DELAY_MS,
): StoreFile<B> {
  let text: string | null = null;
  try {
    text = readFileSync(path, "utf-8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const data = text === null ? undefined : kind.parse(text);
  if (data === null) {
    const base = `${path}.broken-${Date.now()}`;
    let aside = base;
    // A millisecond can hold several recoveries. Reserve the backup without replacing an old
    // one, and remove the damaged source only after the whole copy succeeded.
    for (let suffix = 1; ; suffix += 1) {
      try {
        copyFileSync(path, aside, constants.COPYFILE_EXCL);
        break;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        aside = `${base}-${suffix}`;
      }
    }
    unlinkSync(path);
    log(`${kind.what} ${path} could not be read; moved to ${aside}`);
  }

  let dirty = false;
  let timer: NodeJS.Timeout | null = null;
  const save = () => {
    if (timer) clearTimeout(timer);
    timer = null;
    let temporaryDir: string | undefined;
    try {
      mkdirSync(dirname(path), { recursive: true });
      // Each save owns a fresh, private directory: an old .tmp file must not supply permissions
      // or redirect the write through a link. It is on the same filesystem as the final file.
      temporaryDir = mkdtempSync(`${path}.tmp-`);
      const temporary = join(temporaryDir, "data.json");
      writeFileSync(temporary, JSON.stringify(kind.data(book)), { mode: 0o600 });
      renameSync(temporary, path);
      dirty = false;
    } catch (error) {
      // Kept in memory; the next change tries again.
      log(`${kind.what} not saved to ${path}: ${(error as Error).message}`);
    } finally {
      if (temporaryDir) rmSync(temporaryDir, { recursive: true, force: true });
    }
  };
  const book = kind.open(data ?? undefined, () => {
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
