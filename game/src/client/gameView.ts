import { animDue, TICK_RATE } from "../sim/constants.ts";
import { teamName } from "../sim/modes.ts";
import type { MatchState, Phase, SimEvent } from "../sim/types.ts";
import type { MusicTrack, SoundBank } from "./audio.ts";
import { GAME_REPEATS } from "./music.ts";
import type { Presentation } from "./presentation.ts";
import { initialPresentation, MUSIC_GATED, phaseFades, present } from "./presentation.ts";
import { presentBlind } from "./blind.ts";
import type { RenderView } from "./renderer.ts";
import { PanelFaces, renderScreen, SCREEN_H, SCREEN_W } from "./renderer.ts";
import type { SceneAssets } from "./scene.ts";
import { drawDarkness, Fade, freezeCanvas } from "./screenKit.ts";
import { FRAME_MS } from "./startLayout.ts";

export interface GameViewOptions {
  localPlayerIds: readonly number[];
  /** Shown as 방장 on the result screens. */
  hostId: number | null;
  /** This match's game music, or null when no rendered music is installed. */
  music: MusicTrack | null;
  /** Leave the playing tune alone: practice makes no music calls (0x40609b-0x408e37). */
  keepMusic?: boolean;
  /** Called with a short text for screen readers. */
  announce?: (text: string) => void;
  /** The last frame before this view, to fade out first: practice starting over (0x458a32, 0x458b5e). */
  fadeFrom?: HTMLCanvasElement;
  /** The players' panel names and badges by id, from the room; none for players with no account. */
  people?: RenderView["people"];
}

/** Draws a match and plays its sounds and music. Used by local and online play. */
export class GameView {
  private readonly presentation: Presentation = initialPresentation();
  private readonly faces = new PanelFaces();
  private lastRoundDraw = false;
  private readonly ctx: CanvasRenderingContext2D;
  /**
   * The composition ([0x493798]): every draw of the frame goes here, and it outlives the frame.
   * The present copies it to the screen, only the blind window of it while blind (0x412e20); a
   * fade copies all of it (0x4130f0), and F12 saves it (0x413300 → 0x412c00).
   */
  private readonly surface: CanvasRenderingContext2D;
  private readonly assets: SceneAssets;
  private readonly sounds: SoundBank;
  private readonly options: GameViewOptions;
  private hostId: number | null;
  /** The mouse in screen pixels: its last position, and whether it is over the canvas. */
  private mouse = { x: 0, y: 0 };
  private mouseInside = false;
  /** cursor.spr anim 0, advanced by wall-clock time like the original's GetTickCount (0x43f079). */
  private cursor = { frame: 0, lastMs: Number.NEGATIVE_INFINITY };
  /** The phase last drawn, and a fade under way: out over a frozen frame, then in over the live one. */
  private shownPhase: Phase | null = null;
  private fade: { fade: Fade; picture: HTMLCanvasElement | null } | null = null;
  private readonly onPointer = (event: PointerEvent) => {
    const rect = this.ctx.canvas.getBoundingClientRect();
    this.mouse = {
      x: Math.floor(((event.clientX - rect.left) * SCREEN_W) / rect.width),
      y: Math.floor(((event.clientY - rect.top) * SCREEN_H) / rect.height),
    };
    this.mouseInside = event.type !== "pointerleave";
  };

  constructor(ctx: CanvasRenderingContext2D, assets: SceneAssets, sounds: SoundBank, options: GameViewOptions) {
    this.ctx = ctx;
    this.surface = compositionSurface();
    this.assets = assets;
    this.sounds = sounds;
    this.options = options;
    this.hostId = options.hostId;
    if (options.fadeFrom) this.fade = { fade: new Fade("out", performance.now(), FRAME_MS), picture: options.fadeFrom };
    // The lobby or room tune stops when the game screen opens; game music starts at the end of the countdown.
    if (!options.keepMusic) sounds.stopMusic();
    for (const type of ["pointermove", "pointerdown", "pointerleave"] as const) ctx.canvas.addEventListener(type, this.onPointer);
  }

  /** The room's host changed during the match; the result screens show the new one as 방장. */
  setHost(hostId: number): void {
    this.hostId = hostId;
  }

  /** The composition, for a fade to freeze and for F12 to save. */
  get composition(): HTMLCanvasElement {
    return this.surface.canvas;
  }

  /** The mouse in screen pixels, where it was last seen over the canvas. */
  get pointer(): { x: number; y: number } {
    return this.mouse;
  }

  /** The old frame is still darkening: the original runs no scene logic until it is black (0x405e08). */
  get fadingOut(): boolean {
    return this.fade?.picture != null;
  }

  ingest(state: MatchState, events: readonly SimEvent[]): void {
    const cues = present(this.presentation, state, events, this.options.localPlayerIds);
    for (const name of cues.stop) this.sounds.stop(name);
    for (const name of cues.play) this.sounds.play(name, MUSIC_GATED.has(name) ? "music" : "effects");
    if (cues.music === "start" && this.options.music) this.sounds.playMusic(this.options.music, GAME_REPEATS, true);
    if (cues.music === "stop") this.sounds.stopMusic();
    for (const event of events) {
      if (event.type === "round-over") this.lastRoundDraw = state.draw;
      if (event.type === "round-start") this.faces.reset();
      const text = announcement(state, event);
      if (text) this.options.announce?.(text);
    }
  }

  /**
   * The frame, under a fade when one runs. The fade out shows the frame drawn last and darkens it;
   * the original does not run the scene meanwhile (0x405e08). The server's clock goes on, as the
   * original's timers do from the fade call, so the new screen shows ~11 frames into its time.
   */
  render(state: MatchState, extra: Pick<RenderView, "overlay" | "help" | "chat" | "bars"> = {}): void {
    const anim = this.assets.cursor.meta.animations[0];
    const now = performance.now();
    if (animDue(now, this.cursor.lastMs, anim.unknown_u16)) {
      this.cursor = { frame: (this.cursor.frame + 1) % anim.frames.length, lastMs: now };
    }
    if (this.shownPhase !== null && this.shownPhase !== state.phase && phaseFades(this.shownPhase, state.phase)) {
      this.fade = { fade: new Fade("out", now, FRAME_MS), picture: freezeCanvas(this.surface.canvas) };
    }
    this.shownPhase = state.phase;
    const fade = this.fade;
    if (fade?.picture) {
      this.ctx.drawImage(fade.picture, 0, 0);
      drawDarkness(this.ctx, fade.fade.darkness(now));
      if (fade.fade.done(now)) {
        // The last step of the fade out fills the composition with black (0x4130f0).
        this.surface.fillStyle = "#000";
        this.surface.fillRect(0, 0, SCREEN_W, SCREEN_H);
        this.fade = { fade: new Fade("in", now, FRAME_MS), picture: null };
      }
      return;
    }
    const blind = renderScreen(this.surface, this.assets, state, {
      localPlayerIds: this.options.localPlayerIds,
      hostId: this.hostId,
      people: this.options.people,
      hurryTick: this.presentation.hurryTick,
      lastRoundDraw: this.lastRoundDraw,
      faces: this.faces,
      mouse: this.mouse,
      cursor: this.mouseInside ? { ...this.mouse, frame: this.cursor.frame } : undefined,
      ...extra,
    });
    // A fade in shows the whole composition, blind or not (0x4130f0(0)).
    if (blind && !fade) presentBlind(this.ctx, this.surface, this.assets.hud.apple, blind);
    else this.ctx.drawImage(this.surface.canvas, 0, 0);
    if (fade) {
      drawDarkness(this.ctx, fade.fade.darkness(now));
      if (fade.fade.done(now)) this.fade = null;
    }
  }

  /** Leaving the game: the music and the round result cue stop, unless the way out keeps the tune. */
  dispose(keepMusic = false): void {
    for (const type of ["pointermove", "pointerdown", "pointerleave"] as const) this.ctx.canvas.removeEventListener(type, this.onPointer);
    if (!this.options.keepMusic && !keepMusic) this.sounds.stopMusic();
    this.sounds.stop("end");
  }
}

/**
 * An 800x600 composition, black like the one a fade out leaves (0x4130f0 fills it with 0). Shadows
 * and blends read it back each frame.
 */
function compositionSurface(): CanvasRenderingContext2D {
  const canvas = document.createElement("canvas");
  canvas.width = SCREEN_W;
  canvas.height = SCREEN_H;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("canvas 2d context unavailable");
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, SCREEN_W, SCREEN_H);
  return ctx;
}

function announcement(state: MatchState, event: SimEvent): string | null {
  const nameOf = (id: number | null) => state.players.find((p) => p.id === id)?.name ?? "";
  switch (event.type) {
    case "round-start":
      return `라운드 ${event.round}`;
    case "start-shown":
      return "START";
    case "hurry":
      return "HURRY UP";
    case "round-over":
      if (event.winnerTeam !== null) return `${teamName(event.winnerTeam)} 라운드 승리`;
      return event.winnerId === null ? (state.draw ? "DRAW" : "라운드 종료") : `${nameOf(event.winnerId)} 라운드 승리`;
    case "match-over":
      return `${event.winnerTeam !== null ? teamName(event.winnerTeam) : nameOf(event.winnerId)} 최종 우승`;
    case "revived":
      return `${nameOf(event.playerId)} 부활`;
    default:
      return null;
  }
}

/** Run `onTick` at a fixed TICK_RATE from requestAnimationFrame and `onFrame` once per frame. */
export function runFixedLoop(onTick: () => void, onFrame: () => void): () => void {
  const stepMs = 1000 / TICK_RATE;
  const maxSteps = 8;
  let last = performance.now();
  let pending = 0;
  let handle = 0;
  let running = true;
  const frame = (now: number) => {
    if (!running) return;
    pending += Math.min(250, now - last);
    last = now;
    let steps = 0;
    while (pending >= stepMs && steps < maxSteps) {
      onTick();
      pending -= stepMs;
      steps += 1;
    }
    if (steps === maxSteps) pending = 0;
    onFrame();
    handle = requestAnimationFrame(frame);
  };
  handle = requestAnimationFrame(frame);
  return () => {
    running = false;
    cancelAnimationFrame(handle);
  };
}
