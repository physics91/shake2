// Text as shake.exe holds it: cp949 bytes. Shared by the server and the client, so it stays free of
// DOM and Node APIs (TextDecoder is in both).

export function cp949Bytes(text: string): number {
  let bytes = 0;
  for (const char of text) bytes += char.codePointAt(0)! < 0x80 ? 1 : 2;
  return bytes;
}

let doubleByte: Set<number> | null = null;

/** KS X 1001's user-defined rows: no characters, though Node's decoder gives them as private use. */
const USER_ROWS = [0xc9, 0xfe];
/** 0xA2E6 € and 0xA2E7 ®, which the browser's decoder has and Node's lacks. */
const LATE_SYMBOLS = [0x20ac, 0x00ae];

/**
 * cp949's double-byte characters: KS X 1001 (both bytes 0xa1-0xfe) and every Hangul syllable,
 * the rest of which the UHC extension adds. The browser's euc-kr decoder is cp949; Node's knows
 * only KS X 1001, and not quite the browser's, so the syllables are taken as a range and the
 * two decoders' differences are set here, the server keeping the client's set.
 */
function cp949DoubleBytes(): Set<number> {
  if (doubleByte) return doubleByte;
  doubleByte = new Set(LATE_SYMBOLS);
  const decoder = new TextDecoder("euc-kr");
  for (let lead = 0xa1; lead <= 0xfe; lead++) {
    if (USER_ROWS.includes(lead)) continue;
    for (let trail = 0xa1; trail <= 0xfe; trail++) {
      const char = decoder.decode(new Uint8Array([lead, trail]));
      if (char.length === 1 && char !== "�") doubleByte.add(char.charCodeAt(0));
    }
  }
  for (let syllable = 0xac00; syllable <= 0xd7a3; syllable++) doubleByte.add(syllable);
  return doubleByte;
}

/** What a cp949 line can hold: printable ASCII and cp949's double-byte characters. */
export function typeable(text: string): string {
  let kept = "";
  for (const char of text) {
    const code = char.codePointAt(0)!;
    if ((code >= 0x20 && code < 0x7f) || cp949DoubleBytes().has(code)) kept += char;
  }
  return kept;
}

/** 0x446200: trailing spaces and tabs are cut; a blank line says nothing. */
export function trimChat(text: string): string {
  return text.replace(/[ \t]+$/, "");
}

/** The longest start of `text` that fits in `limit` bytes, never splitting a double-byte character. */
export function cutBytes(text: string, limit: number): string {
  let kept = "";
  let bytes = 0;
  for (const char of text) {
    bytes += cp949Bytes(char);
    if (bytes > limit) break;
    kept += char;
  }
  return kept;
}

/**
 * _stricmp's order, which sorts the map and music lists (0x45f120): A-Z compare as a-z, the rest
 * by value. Non-ASCII text compares by UTF-16 unit rather than cp949 byte; the lists' names differ
 * in ASCII first (the maps' two-digit prefixes), so their order is the same.
 */
export function compareIgnoreCase(a: string, b: string): number {
  const x = a.replace(/[A-Z]/g, (c) => c.toLowerCase());
  const y = b.replace(/[A-Z]/g, (c) => c.toLowerCase());
  return x < y ? -1 : x > y ? 1 : 0;
}
