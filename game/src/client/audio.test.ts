import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { SoundBank as Bank } from "./audio.ts";

interface FakeSource {
  started: boolean;
  stopped: boolean;
}

const sources: FakeSource[] = [];

class FakeAudioContext {
  state = "running";
  currentTime = 0;
  destination = {};
  resume = () => Promise.resolve();
  decodeAudioData = () => Promise.resolve({});
  createBufferSource() {
    const source = {
      buffer: null,
      onended: null,
      started: false,
      stopped: false,
      connect() {},
      start() {
        source.started = true;
      },
      stop() {
        source.stopped = true;
      },
    };
    sources.push(source);
    return source;
  }
}

let SoundBank: typeof Bank;

beforeAll(async () => {
  vi.stubGlobal("AudioContext", FakeAudioContext);
  vi.stubGlobal("fetch", async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) }));
  ({ SoundBank } = await import("./audio.ts"));
});

afterAll(() => {
  vi.unstubAllGlobals();
});

beforeEach(() => {
  sources.length = 0;
});

async function playing(bank: Bank, name: string, gate?: "effects" | "music"): Promise<FakeSource> {
  const before = sources.length;
  bank.play(name, gate);
  await vi.waitFor(() => expect(sources[before]?.started).toBe(true));
  return sources[before];
}

describe("SoundBank switches", () => {
  it("cuts the effects when the effects switch goes off, but not a cue that follows the music switch", async () => {
    const bank = new SoundBank();
    bank.unlock();
    const end = await playing(bank, "end", "music");
    const bomb = await playing(bank, "bomb6");

    bank.setEffects(false);

    expect(bomb.stopped).toBe(true);
    expect(end.stopped).toBe(false);
  });
});

describe("SoundBank.stop", () => {
  it("wins over a play still loading its file: the cue does not start after it", async () => {
    const bank = new SoundBank();
    bank.unlock();
    bank.play("end", "music");
    bank.stop("end");
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(sources.filter((source) => source.started && !source.stopped)).toHaveLength(0);
    // The next play sounds as usual.
    await playing(bank, "end", "music");
  });
});
