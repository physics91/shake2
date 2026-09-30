// A book of the server's (friend lists, accounts) in one JSON file on its disk. Changes are written
// at most once a second, to a temporary file renamed over the old one, so a crash leaves the last
// whole save; the file is the server's alone (0600).
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

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
 * The book kept in `path`. A missing file starts empty; one that cannot be read is moved aside
 * (`<path>.broken-<time>`) and the book starts empty.
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
    const aside = `${path}.broken-${Date.now()}`;
    renameSync(path, aside);
    log(`${kind.what} ${path} could not be read; moved to ${aside}`);
  }

  let dirty = false;
  let timer: NodeJS.Timeout | null = null;
  const save = () => {
    if (timer) clearTimeout(timer);
    timer = null;
    const temporary = `${path}.tmp`;
    try {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(temporary, JSON.stringify(kind.data(book)), { mode: 0o600 });
      renameSync(temporary, path);
      dirty = false;
    } catch (error) {
      // Kept in memory; the next change tries again.
      log(`${kind.what} not saved to ${path}: ${(error as Error).message}`);
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
