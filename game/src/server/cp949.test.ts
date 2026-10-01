import { describe, expect, it } from "vitest";

import { typeable } from "./cp949.ts";

describe("cp949's characters (typeable)", () => {
  it("keeps the same set on the server as in the browser: KS X 1001 with € and ®, and every Hangul syllable", () => {
    let all = "";
    for (let code = 0; code < 0x10000; code++) if (code < 0xd800 || code > 0xdfff) all += String.fromCharCode(code);
    // 95 printable ASCII; 8,226 KS X 1001 characters, 2,350 of them syllables among the 11,172.
    expect(typeable(all).length).toBe(95 + 17_048);
  });

  it("keeps 0xA2E6 € and 0xA2E7 ®, which Node's euc-kr decoder lacks", () => {
    expect(typeable("5€ ®")).toBe("5€ ®");
  });

  it("drops the user-defined rows 0xC9 and 0xFE, which Node's decoder gives as private use", () => {
    expect(typeable("ab")).toBe("ab");
  });
});
