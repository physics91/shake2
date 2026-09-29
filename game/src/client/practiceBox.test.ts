import { describe, expect, it } from "vitest";

import { boxClick, boxKey, boxKeyCursor, boxPointer, openBox } from "./practiceBox.ts";

describe("practice box (0x484698)", () => {
  it("the end box restarts on YES and leaves on NO; the Esc box the other way round", () => {
    expect(boxClick(openBox("end"), 360, 320)).toBe("restart");
    expect(boxClick(openBox("end"), 440, 320)).toBe("exit");
    expect(boxClick(openBox("esc"), 330, 350)).toBe("exit");
    expect(boxClick(openBox("esc"), 420, 350)).toBe("restart");
  });

  it("uses each variant's own hit rects and ignores clicks elsewhere", () => {
    // The end box's YES rect (354,311)-(400,331) lies outside the Esc box's (322,338)-(390,360).
    expect(boxClick(openBox("esc"), 360, 320)).toBeNull();
    expect(boxClick(openBox("end"), 330, 350)).toBeNull();
    expect(boxClick(openBox("end"), 401, 320)).toBeNull();
  });

  it("includes the right and bottom edges (0x443fc0 compares with jl/jg)", () => {
    expect(boxClick(openBox("end"), 400, 331)).toBe("restart");
    expect(boxClick(openBox("esc"), 482, 360)).toBe("restart");
  });

  it("moves the Esc box's selection to the button under the mouse, but not the end box's (0x443e50)", () => {
    const esc = openBox("esc");
    expect(boxPointer(esc, 420, 350)).toBe(2);
    expect(esc.selection).toBe(2);
    expect(boxPointer(esc, 10, 10)).toBe(0);
    expect(esc.selection).toBe(2);
    const end = openBox("end");
    expect(boxPointer(end, 440, 320)).toBe(2);
    expect(end.selection).toBe(1);
  });

  it("Enter takes the selection, YES by default; left and right move it", () => {
    const box = openBox("end");
    expect(boxKey(box, "Enter")).toBe("restart");
    expect(boxKey(box, "ArrowRight")).toBeNull();
    expect(box.selection).toBe(2);
    expect(boxKey(box, "Enter")).toBe("exit");
    boxKey(box, "ArrowLeft");
    expect(boxKey(box, "Enter")).toBe("restart");
  });

  it("y and n choose at once, lower case only, and Esc does not close it", () => {
    expect(boxKey(openBox("end"), "n")).toBe("exit");
    expect(boxKey(openBox("esc"), "y")).toBe("exit");
    expect(boxKey(openBox("end"), "N")).toBeNull();
    expect(boxKey(openBox("end"), "Escape")).toBeNull();
  });

  it("left and right put the cursor on the selected button (0x443d00; Shake1 0x423690)", () => {
    const esc = openBox("esc");
    boxKey(esc, "ArrowRight");
    expect(boxKeyCursor(esc)).toBe(2);
    const end = openBox("end");
    boxKey(end, "ArrowRight");
    expect(boxKeyCursor(end)).toBe(2);
    boxKey(end, "ArrowLeft");
    expect(boxKeyCursor(end)).toBe(1);
  });
});
