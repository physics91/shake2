import { describe, expect, it } from "vitest";

import { PeerButtons } from "./buttons.ts";

describe("PeerButtons", () => {
  it("reports held buttons and keeps a press released before the tick for that one tick", () => {
    const buttons = new PeerButtons();
    buttons.set({ bomb: false, attack: true, evade: true });
    buttons.set({ bomb: false, attack: true, evade: false });

    expect(buttons.take()).toEqual({ bomb: false, attack: true, evade: true });
    expect(buttons.take()).toEqual({ bomb: false, attack: true, evade: false });
  });

  it("forgets everything on clear", () => {
    const buttons = new PeerButtons();
    buttons.set({ bomb: true, attack: false, evade: false });
    buttons.clear();

    expect(buttons.take()).toEqual({ bomb: false, attack: false, evade: false });
  });
});
