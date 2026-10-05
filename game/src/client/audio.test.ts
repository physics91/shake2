import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

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
  decodeAudioData() {
    return Promise.resolve({});
  }
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
  vi.stubGlobal("window", { clearTimeout, setTimeout });
  vi.stubGlobal("fetch", async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) }));
  ({ SoundBank } = await import("./audio.ts"));
});

afterAll(() => {
  vi.unstubAllGlobals();
});

afterEach(() => vi.restoreAllMocks());

beforeEach(() => {
  sources.length = 0;
});

async function playing(bank: Bank, name: string, gate?: "effects" | "music"): Promise<FakeSource> {
  const before = sources.length;
  bank.play(name, gate);
  await vi.waitFor(() => expect(sources[before]?.started).toBe(true));
  return sources[before];
}

function holdFetch() {
  let respond: (response: Response) => void = () => undefined;
  const loading = new Promise<Response>((resolve) => { respond = resolve; });
  const fetch = vi.spyOn(globalThis, "fetch").mockReturnValueOnce(loading);
  return { fetch, release: () => respond(new Response(new Uint8Array(8))) };
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

  it("cancels an effect still loading when muted, even if unmuted before the file arrives", async () => {
    const load = holdFetch();
    const decoded = vi.spyOn(FakeAudioContext.prototype, "decodeAudioData");
    const bank = new SoundBank();
    bank.unlock();
    bank.play("bomb1");
    bank.setEffects(false);
    bank.setEffects(true);

    load.release();
    await vi.waitFor(() => expect(decoded).toHaveBeenCalledOnce());
    expect(sources).toHaveLength(0);

    // A new play reuses the decoded file and starts normally.
    await playing(bank, "bomb1");
    expect(load.fetch).toHaveBeenCalledOnce();
  });

  it("keeps a pending music-gated cue when the effects switch is turned off and on", async () => {
    const load = holdFetch();
    const bank = new SoundBank();
    bank.unlock();
    bank.play("end", "music");
    bank.setEffects(false);
    bank.setEffects(true);

    load.release();
    await vi.waitFor(() => expect(sources[0]?.started).toBe(true));
    expect(sources).toHaveLength(1);
    bank.stop("end");
    expect(sources[0].stopped).toBe(true);
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

describe("SoundBank.stopAll", () => {
  it("silences old effects, result cues and BGM without muting the next program", async () => {
    const bank = new SoundBank();
    bank.unlock();
    await playing(bank, "bomb1");
    await playing(bank, "end", "music");
    bank.playMusic({ file: "old.wav", loopEnd: 0 }, 0);
    await vi.waitFor(() => expect(sources).toHaveLength(3));

    bank.stopAll();

    expect(sources.every((source) => source.stopped)).toBe(true);
    expect(bank.effects).toBe(true);
    expect(bank.musicOn).toBe(true);
    const next = await playing(bank, "end", "music");
    expect(next.stopped).toBe(false);
    bank.stopAll();
  });

  it.each(["effect", "result cue", "BGM"])("cancels an old %s whose file arrives after restart", async (kind) => {
    const load = holdFetch();
    const decoded = vi.spyOn(FakeAudioContext.prototype, "decodeAudioData");
    const bank = new SoundBank();
    bank.unlock();
    if (kind === "effect") bank.play("bomb1");
    else if (kind === "result cue") bank.play("end", "music");
    else bank.playMusic({ file: "old.wav", loopEnd: 0 }, 0);

    bank.stopAll();
    load.release();

    await vi.waitFor(() => expect(decoded).toHaveBeenCalledOnce());
    expect(sources).toHaveLength(0);
  });

  it("drops a previous program's music waiting for the first gesture", async () => {
    const fetch = vi.spyOn(globalThis, "fetch");
    const bank = new SoundBank();
    bank.playMusic({ file: "old.wav", loopEnd: 0 }, 0);

    bank.stopAll();
    bank.unlock();

    expect(fetch).not.toHaveBeenCalled();
    expect(sources).toHaveLength(0);
    await playing(bank, "end", "music");
    bank.stopAll();
  });
});

describe("audio loading after a transient failure", () => {
  it.each(["network", "HTTP", "decode"])("retries an effect after a %s failure, then shares the decoded buffer", async (failure) => {
    const fetch = vi.spyOn(globalThis, "fetch");
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    if (failure === "network") fetch.mockRejectedValueOnce(new TypeError("offline"));
    else if (failure === "HTTP") fetch.mockResolvedValueOnce(new Response("missing", { status: 404 }));
    else vi.spyOn(FakeAudioContext.prototype, "decodeAudioData").mockRejectedValueOnce(new Error("invalid audio"));
    const bank = new SoundBank();
    bank.unlock();
    bank.play("bomb1");
    await vi.waitFor(() => expect(warning).toHaveBeenCalledOnce());
    expect(sources).toHaveLength(0);

    await playing(bank, "bomb1");
    await playing(bank, "bomb1");

    expect(fetch).toHaveBeenCalledTimes(2);
    expect(sources).toHaveLength(2);
  });

  it("retries a music file on the next play after its failed load", async () => {
    const fetch = vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new TypeError("offline"));
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const bank = new SoundBank();
    const track = { file: "retry.wav", loopEnd: 0 };
    bank.unlock();
    bank.playMusic(track, 0);
    await vi.waitFor(() => expect(warning).toHaveBeenCalledOnce());
    expect(sources).toHaveLength(0);

    bank.playMusic(track, 0);
    await vi.waitFor(() => expect(sources[0]?.started).toBe(true));

    expect(fetch).toHaveBeenCalledTimes(2);
    bank.stopMusic();
    expect(sources[0].stopped).toBe(true);
  });
});
