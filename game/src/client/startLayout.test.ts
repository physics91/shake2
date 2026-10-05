import { describe, expect, it } from "vitest";

import {
  fadeInDarkness,
  fadeOutDarkness,
  gaugeLevel,
  loadingBarWidth,
  loadingCount,
  loginButtonAt,
  loginCaret,
  newSlide,
  percentText,
  ROW_NAME_WIDTH,
  rowBarTop,
  rowClickAt,
  rowHoverAt,
  rowOrigin,
  rowsShown,
  rowTexts,
  slideBlits,
  stepSlide,
  toggleSlide,
  visibleBars,
} from "./startLayout.ts";

describe("fade (0x4130f0, 0x413c20)", () => {
  it("darkens the frozen scene over 11 frames, then lightens the new one over 11", () => {
    const out = Array.from({ length: 11 }, (_, i) => fadeOutDarkness(i));
    const into = Array.from({ length: 11 }, (_, i) => fadeInDarkness(i));
    expect(out.map((d) => Math.round(d * 10))).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 10]);
    expect(into.map((d) => Math.round(d * 10))).toEqual([9, 8, 7, 6, 5, 4, 3, 2, 1, 0, 0]);
    expect(fadeInDarkness(30)).toBe(0);
  });
});

describe("loading (0x418fd0)", () => {
  it("grows the fuse 16 px a step over 33 steps, counting the files loaded", () => {
    expect(loadingBarWidth(0)).toBe(0);
    expect(loadingBarWidth(33)).toBe(528);
    expect(loadingBarWidth(40)).toBe(528);
    expect(loadingCount(0, 10)).toBe(0);
    expect(loadingCount(5, 10)).toBe(16);
    expect(loadingCount(10, 10)).toBe(33);
    expect(loadingCount(0, 0)).toBe(33);
  });
});

describe("login (0x419a10, 0x459069)", () => {
  it("puts the caret 7 px a byte from 406, at y 278 for the ID and 304 for the password", () => {
    expect(loginCaret("id", 0)).toEqual({ x: 406, y: 278 });
    expect(loginCaret("pw", 3)).toEqual({ x: 427, y: 304 });
  });

  it("finds the buttons and the two fields, edges included", () => {
    expect(loginButtonAt(261, 360)).toBe("ok");
    expect(loginButtonAt(292, 391)).toBe("ok");
    expect(loginButtonAt(353, 361)).toBe("newId");
    expect(loginButtonAt(539, 391)).toBe("exit");
    expect(loginButtonAt(401, 274)).toBe("id");
    expect(loginButtonAt(516, 318)).toBe("pw");
    expect(loginButtonAt(400, 280)).toBeNull();
  });
});

describe("server list (0x433750, 0x433b10, 0x4343f0)", () => {
  it("slides open in 14 frames: the left half done on frame 13, the right on 14", () => {
    const slide = newSlide();
    let frames = 0;
    while (!rowsShown(slide)) {
      stepSlide(slide);
      frames += 1;
      if (frames === 13) expect(slide.leftDone && !slide.rightDone).toBe(true);
    }
    expect(frames).toBe(14);
    expect(slideBlits(slide)).toEqual([
      { src: [1, 1, 254, 393], x: 60, y: 126 },
      { src: [254, 1, 505, 393], x: 491, y: 126 },
    ]);
  });

  it("draws the first opening frame 20 px in, its right edge at 313", () => {
    const slide = newSlide();
    stepSlide(slide);
    expect(slideBlits(slide)[0]).toEqual({ src: [1, 1, 34, 393], x: 280, y: 126 });
  });

  it("closes in 10 frames, 9 of them drawn, and opens again from the start", () => {
    const slide = newSlide();
    for (let i = 0; i < 14; i++) stepSlide(slide);
    toggleSlide(slide);
    let drawn = 0;
    for (let i = 0; i < 10; i++) {
      stepSlide(slide);
      if (slideBlits(slide).length > 0) drawn += 1;
    }
    expect(drawn).toBe(9);
    expect(slide.closing).toBe(false);
    expect(slideBlits(slide)).toEqual([]);
    toggleSlide(slide);
    stepSlide(slide);
    expect(slideBlits(slide)[0].x).toBe(280);
    expect(rowsShown(slide)).toBe(false);
  });

  it("lights a row under the mouse in its narrower band and takes a click in the wider one", () => {
    expect(rowHoverAt(80, 142, 1)).toBe(0);
    expect(rowHoverAt(80, 157, 1)).toBe(0);
    expect(rowHoverAt(80, 158, 1)).toBe(-1);
    expect(rowHoverAt(270, 150, 1)).toBe(-1);
    expect(rowClickAt(270, 150, 1)).toBe(0);
    expect(rowClickAt(289, 150, 1)).toBe(-1);
    expect(rowHoverAt(80, 160, 1)).toBe(-1);
    expect(rowHoverAt(80, 160, 2)).toBe(1);
    expect(rowHoverAt(520, 142, 21)).toBe(20);
  });

  it("takes the displayed page's row without overlapping the earlier channels", () => {
    for (const count of [39, 40, 41, 80, 81]) {
      const reached: number[] = [];
      for (let page = 0; page < Math.ceil(count / 40); page++) {
        for (let slot = 0; slot < 40; slot++) {
          const x = slot < 20 ? 80 : 520, y = 142 + 18 * (slot % 20);
          const index = page * 40 + slot;
          expect(rowClickAt(x, y, count, page)).toBe(index < count ? index : -1);
          expect(rowHoverAt(x, y, count, page)).toBe(index < count ? index : -1);
          if (index < count) reached.push(rowClickAt(x, y, count, page));
        }
      }
      expect(reached).toEqual(Array.from({ length: count }, (_, i) => i));
    }
  });

  it("resets the original row Y only when crossing into the second column", () => {
    expect(rowOrigin(19)).toEqual({ x: 76, y: 484 });
    expect(rowOrigin(20)).toEqual({ x: 516, y: 142 });
    expect(rowOrigin(39)).toEqual({ x: 516, y: 484 });
    expect(rowOrigin(40)).toEqual({ x: 516, y: 502 });
  });

  it("picks each row's bar from the original's table", () => {
    expect([0, 1, 5, 10, 15, 19, 20, 21, 25, 38, 45, 49].map(rowBarTop)).toEqual([
      297, 312, 327, 312, 327, 342, 357, 372, 387, 387, 387, 402,
    ]);
  });

  it("cuts a name to what fits before the left gauge", () => {
    const at = rowTexts(0);
    expect(at.nameShadow.x + ROW_NAME_WIDTH).toBeLessThanOrEqual(at.gauge.x);
  });

  it("shows the load as %3d%%, anything outside 0..100 as 100", () => {
    expect(percentText(7)).toBe("  7%");
    expect(percentText(100)).toBe("100%");
    expect(percentText(-1)).toBe("100%");
    expect(percentText(1000)).toBe("100%");
  });

  it("turns the ping into green or red bars, the sixth one invisible", () => {
    expect(gaugeLevel(0)).toEqual({ n: 5, red: false });
    expect(gaugeLevel(-1)).toEqual({ n: 5, red: false });
    expect(gaugeLevel(150)).toEqual({ n: 4, red: false });
    expect(gaugeLevel(450)).toEqual({ n: 1, red: false });
    expect(gaugeLevel(550)).toEqual({ n: 1, red: true });
    expect(gaugeLevel(950)).toEqual({ n: 5, red: true });
    expect([0, 150, 250, 350, 450, 550, 650, 750, 850].map((ping) => visibleBars(gaugeLevel(ping)))).toEqual([
      5, 5, 4, 3, 2, 2, 3, 4, 5,
    ]);
  });
});
