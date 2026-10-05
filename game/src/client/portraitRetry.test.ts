import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Sheet } from "./assets.ts";
import type { LobbyScreen, LobbyScreenAssets, LobbyScreenOptions } from "./lobbyScreen.ts";
import type { RoomScreen, RoomScreenAssets, RoomScreenOptions } from "./roomScreen.ts";
import type { StatusAssets, StatusPage, StatusPageOptions } from "./statusScreen.ts";
import { localRoom } from "./localRoom.ts";
import { MY_INFO } from "./lobbyLayout.ts";
import { MY_INFO_BUTTONS } from "./myInfoLayout.ts";

const { loadTintedSheet, loadSheet } = vi.hoisted(() => ({ loadTintedSheet: vi.fn(), loadSheet: vi.fn() }));
vi.mock("./tintArt.ts", () => ({ loadTintedSheet, workSurface: () => ({ recolour() {}, draw() {} }) }));
vi.mock("./assets.ts", () => ({ loadSheet }));
vi.mock("./screenCapture.ts", () => ({ attachCapture: () => () => undefined }));
vi.mock("./text.ts", async (original) => ({
  ...await original<typeof import("./text.ts")>(),
  outlinedText() {}, plainText() {},
}));
vi.mock("./chatLine.ts", () => ({ ChatLine: class {
  element = new Element();
  isOpen = false;
  open() { this.isOpen = true; }
  close() { this.isOpen = false; return ""; }
  view() { return { text: "", caret: 0 }; }
  reloadRecord() {}
  focus() {}
  dispose() {}
} }));

const drawImage = vi.fn();
const context = { drawImage, fillRect() {}, measureText: () => ({ width: 0 }) };
class Element extends EventTarget {
  style = {};
  textContent = "";
  setAttribute() {}
  append() {}
  remove() {}
  getContext() { return context; }
  getBoundingClientRect() { return { left: 0, top: 0, width: 800, height: 600 }; }
}

const image = {} as HTMLImageElement;
const portrait: Sheet = {
  image,
  meta: { animations: [{ unknown_u16: 5, frames: [{ rect: [0, 0, 70, 70], anchor: [0, 0] }] }] } as Sheet["meta"],
};
const art = {} as HTMLImageElement;
const frames = new Map<number, FrameRequestCallback>();
let nextFrame = 0;
let room: RoomScreen | undefined;
let lobby: LobbyScreen | undefined;
let status: StatusPage | undefined;

beforeEach(() => {
  drawImage.mockClear();
  loadTintedSheet.mockReset();
  loadSheet.mockReset();
  frames.clear();
  nextFrame = 0;
  vi.stubGlobal("window", new EventTarget());
  vi.stubGlobal("HTMLCanvasElement", Element);
  vi.stubGlobal("document", { createElement: () => new Element() });
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    frames.set(++nextFrame, callback);
    return nextFrame;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
});

afterEach(() => {
  room?.dispose();
  lobby?.dispose();
  status?.dispose();
  room = undefined;
  lobby = undefined;
  status = undefined;
  vi.unstubAllGlobals();
});

async function settled() { await Promise.resolve(); await Promise.resolve(); }
function draw() {
  const [id, callback] = frames.entries().next().value!;
  frames.delete(id);
  callback(1000);
}
function click(canvas: Element, [left, top, right, bottom]: readonly number[]) {
  for (const type of ["pointerdown", "pointerup"]) {
    const event = new Event(type);
    Object.assign(event, {
      pointerId: 1, isPrimary: true, button: 0, buttons: type === "pointerdown" ? 1 : 0,
      clientX: (left + right) / 2, clientY: (top + bottom) / 2,
    });
    canvas.dispatchEvent(event);
  }
}

describe("failed canvas portraits", () => {
  it.each(["missing image", "plain RGB fallback"])("reloads a status portrait after %s when its knob is released at the same hue", async (failure) => {
    let ready: (sheet: Sheet) => void = () => undefined;
    if (failure === "missing image") loadTintedSheet.mockRejectedValueOnce(new Error("image unavailable")).mockResolvedValue(portrait);
    else loadTintedSheet.mockResolvedValueOnce({ ...portrait, image: art }).mockImplementation(() => new Promise<Sheet>((resolve) => { ready = resolve; }));
    const { StatusPage, newStatusState } = await import("./statusScreen.ts");
    const state = newStatusState("doona");
    state.hue = failure === "missing image" ? 0 : 100;
    status = new StatusPage({
      stage: new Element(), state, announce() {}, account: () => null,
      settings: { current: { keys: [1, 2, 3] } },
      assets: {
        background: art, option: art, images: art, ranking: art, faces: art,
        guildIcons: art, marks: art, banner: { ...portrait, image: art }, guilds: [],
      } satisfies StatusAssets,
    } as unknown as StatusPageOptions);
    status.enter("tester", "");
    await settled();
    status.draw(context as unknown as CanvasRenderingContext2D, 1000, null, false);
    expect(drawImage.mock.calls.some(([source]) => source === image)).toBe(false);

    const y = 159 + Math.trunc(state.hue / 10);
    status.press(506, y);
    status.hold(506, y);
    status.release(506, y);
    if (failure === "plain RGB fallback") {
      drawImage.mockClear();
      status.draw(context as unknown as CanvasRenderingContext2D, 1050, null, false);
      expect(drawImage).toHaveBeenCalledWith(art, 0, 0, 70, 70, 382, 139, 70, 70);
      ready(portrait);
    }
    await settled();
    status.draw(context as unknown as CanvasRenderingContext2D, 1100, null, false);
    expect(loadTintedSheet).toHaveBeenCalledTimes(2);
    expect(drawImage).toHaveBeenCalledWith(image, 0, 0, 70, 70, 382, 139, 70, 70);
  });

  it.each(["missing image", "plain RGB fallback"])("retries a room portrait after %s on the next room update and then draws it", async (failure) => {
    const recovered = failure === "missing image" ? portrait : { ...portrait, image: new Element() as unknown as HTMLCanvasElement };
    const fallback = { ...portrait, image: {} as HTMLImageElement };
    let ready: (sheet: Sheet) => void = () => undefined;
    if (failure === "missing image") loadTintedSheet.mockRejectedValueOnce(new Error("image unavailable")).mockResolvedValue(recovered);
    else loadTintedSheet.mockResolvedValueOnce(fallback).mockImplementation(() => new Promise<Sheet>((resolve) => { ready = resolve; }));
    const state = localRoom({ maps: [], music: [] }, ["doona", "doona"]);
    if (failure === "plain RGB fallback") for (const player of state.players) player.hue = 100;
    room = new (await import("./roomScreen.ts")).RoomScreen({
      canvas: new Element(), stage: new Element(), playerId: 1, maps: [], music: [],
      assets: {
        background: art, object1: art, object2: art, button: art, mapimage: art,
        guild: art, mark: art, cursor: portrait, help: art, messageBox: art,
        box: { panel: art, messageBox: art, buttons: art },
      } satisfies RoomScreenAssets,
      settings: { current: { balloons: false } },
    } as unknown as RoomScreenOptions, state);
    room.update(structuredClone(state));
    expect(loadTintedSheet).toHaveBeenCalledTimes(1);
    await settled();
    draw();
    expect(drawImage.mock.calls.some(([source]) => source === image)).toBe(false);

    room.update(structuredClone(state));
    room.update(structuredClone(state));
    if (failure === "plain RGB fallback") {
      drawImage.mockClear();
      draw();
      expect(drawImage.mock.calls.some(([source]) => source === fallback.image)).toBe(true);
      ready(recovered);
    }
    await settled();
    draw();
    expect(loadTintedSheet).toHaveBeenCalledTimes(2);
    expect(drawImage.mock.calls.some(([source]) => source === recovered.image)).toBe(true);
    room.update(structuredClone(state));
    expect(loadTintedSheet).toHaveBeenCalledTimes(2);
  });

  it.each(["missing image", "plain RGB fallback"])("retries a lobby portrait after %s when another character is selected and the failed one is selected again", async (failure) => {
    const recovered = failure === "missing image" ? portrait : { ...portrait, image: new Element() as unknown as HTMLCanvasElement };
    if (failure === "missing image") loadTintedSheet.mockRejectedValueOnce(new Error("image unavailable"));
    else loadTintedSheet.mockResolvedValueOnce(portrait);
    loadTintedSheet.mockResolvedValue(recovered);
    const canvas = new Element();
    const { LobbyScreen } = await import("./lobbyScreen.ts");
    lobby = new LobbyScreen({
      canvas, stage: new Element(), playerId: 1, maps: [], waitingOnly: false,
      assets: Object.fromEntries([
        "background", "banner", "button", "button2", "roomButton", "gameInfo", "remote", "messageBox",
        "guild", "mark", "help", "statusWindow", "charChange", "winObject", "faces", "option", "basicWindow", "userInfo", "ranking",
      ].map((name) => [name, art])) as unknown as LobbyScreenAssets,
      profile: { character: "doona", hue: failure === "missing image" ? 0 : 100, useId: true, nick: "tester", greeting: "" },
      account: () => null, settings: { current: { balloons: false } }, notice: { draw() {} },
    } as unknown as LobbyScreenOptions, { channel: "test", rooms: [], users: [] });
    click(canvas, MY_INFO.hit);
    await settled();
    click(canvas, MY_INFO_BUTTONS.next.hit);
    await settled();
    click(canvas, MY_INFO_BUTTONS.prev.hit);
    await settled();
    expect(loadTintedSheet.mock.calls.map(([, name]) => name)).toEqual(["doona_p", "doon_p", "doona_p"]);
    click(canvas, MY_INFO_BUTTONS.next.hit);
    await settled();
    click(canvas, MY_INFO_BUTTONS.prev.hit);
    expect(loadTintedSheet).toHaveBeenCalledTimes(3);
  });
});

it("handles a failed hidden roster portrait and draws a fresh one on the next update", async () => {
  loadSheet.mockRejectedValueOnce(new Error("image unavailable")).mockResolvedValue(portrait);
  const { portraitCanvas } = await import("./menu.ts");
  portraitCanvas("doona", 40);
  // Give a dropped rejection the same event-loop turn it gets in the browser.
  await new Promise<void>((resolve) => setImmediate(resolve));
  portraitCanvas("doona", 40);
  await settled();
  expect(drawImage).toHaveBeenCalledWith(image, 0, 0, 70, 70, 0, 0, 40, 40);
});
