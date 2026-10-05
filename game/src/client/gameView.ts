import { TICK_RATE } from "../sim/constants.ts";
import { teamName } from "../sim/modes.ts";
import type { MatchState, Phase, SimEvent } from "../sim/types.ts";
import type { MusicTrack, SoundBank } from "./audio.ts";
import { GAME_REPEATS } from "./music.ts";
import type { NoticeLine } from "./noticeLine.ts";
import type { Cues, Presentation } from "./presentation.ts";
import { initialPresentation, MUSIC_GATED, phaseFades, present } from "./presentation.ts";
import { presentBlind } from "./blind.ts";
import type { RenderView } from "./renderer.ts";
import { BadStateAnimation, MarkerAnimations, PanelFaces, renderScreen, SCREEN_H, SCREEN_W } from "./renderer.ts";
import type { SceneAssets } from "./scene.ts";
import { CursorAnim, drawDarkness, Fade, fadeFrame, freezeCanvas, Pointer, registerFadeFrame, takeStageFade } from "./screenKit.ts";
import { FRAME_MS } from "./startLayout.ts";

export interface GameViewOptions {
  /** The session's cursor.spr; the game advances it only when it is drawn. */
  cursor?: CursorAnim;
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
  candyBase?: number;
  /** Network: the session's notice line, drawn in the bottom message's place while it holds a text. */
  notice?: NoticeLine;
}

/** Draws a match and plays its sounds and music. Used by local and online play. */
export class GameView {
  private readonly presentation: Presentation = initialPresentation();
  private readonly faces = new PanelFaces();
  private readonly markers = new MarkerAnimations();
  private readonly badState = new BadStateAnimation();
  private lastRoundDraw = false;
  /** The round whose later wait can draw over the result already on the composition. */
  private resultRound: number | null = null;
  /** Result sounds are requested by snapshots, but the original plays them in the first result frame. */
  private resultCue: { name: string; phase: Phase } | null = null;
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
  /** The same held-pointer ownership as the screens' controls, including mixed input devices. */
  private readonly mousePointer = new Pointer();
  private readonly detachPointer: () => void;
  private readonly cursor: CursorAnim;
  /** The phase last drawn, and a fade under way: out over a frozen frame, then in over the live one. */
  private shownPhase: Phase | null = null;
  private fade: { fade: Fade; picture: HTMLCanvasElement | null } | null = null;
  /** Next in step after the last draw: fade(1) preserves this independent scalar (0x413d10). */
  private fadeInFrame = 0;
  private fadeOutFrame = 0;
  private darkness = 0;
  private revealAt = Number.NEGATIVE_INFINITY;
  private readonly releaseFrames: (() => void)[];
  constructor(ctx: CanvasRenderingContext2D, assets: SceneAssets, sounds: SoundBank, options: GameViewOptions) {
    this.ctx = ctx;
    this.surface = compositionSurface();
    this.assets = assets;
    this.sounds = sounds;
    this.options = options;
    this.cursor = options.cursor ?? new CursorAnim();
    this.hostId = options.hostId;
    if (options.fadeFrom) {
      const carried = fadeFrame(options.fadeFrom);
      this.fadeOutFrame = carried.outFrame;
      this.fadeInFrame = carried.inFrame;
      this.darkness = carried.darkness;
      this.fade = { fade: new Fade("out", performance.now(), FRAME_MS, this.fadeOutFrame), picture: options.fadeFrom };
    }
    const read = () => ({ picture: this.fade?.picture ?? this.surface.canvas,
      outFrame: this.fadeOutFrame, inFrame: this.fadeInFrame, darkness: this.darkness });
    this.releaseFrames = [registerFadeFrame(ctx.canvas, read), registerFadeFrame(this.surface.canvas, read)];
    // The lobby or room tune stops when the game screen opens; game music starts at the end of the countdown.
    if (!options.keepMusic) sounds.stopMusic();
    this.detachPointer = this.mousePointer.attach(ctx.canvas, { moved() {}, released() {} });
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
    return this.mousePointer.mouse;
  }

  /** The old frame is still darkening: the original runs no scene logic until it is black (0x405e08). */
  get fadingOut(): boolean {
    return this.fade?.picture != null;
  }

  ingest(state: MatchState, events: readonly SimEvent[]): void {
    const cues = present(this.presentation, state, events, this.options.localPlayerIds);
    for (const name of cues.stop) this.stopCue(name);
    for (const name of cues.play) {
      if (MUSIC_GATED.has(name)) this.resultCue = { name, phase: state.phase };
      else this.sounds.play(name, "effects");
    }
    if (cues.music === "start" && this.options.music) this.sounds.playMusic(this.options.music, GAME_REPEATS, true);
    if (cues.music === "stop" && !this.resultCue) this.sounds.stopMusic();
    this.follow(state, events);
    for (const event of events) {
      const text = announcement(state, event);
      if (text) this.options.announce?.(text);
    }
  }

  /**
   * The snapshots that came while the pictures loaded (the original's world load blocks instead):
   * what they changed follows on (HURRY UP's time, a round's DRAW, the faces), but their cues are
   * past, so none sounds now. Their stops still apply, such as a wait screen's stop of a last
   * match's end (0x41014e); the game music plays if the last of them left it on.
   */
  catchUp(batches: readonly { state: MatchState; events: readonly SimEvent[] }[]): void {
    let music: Cues["music"] = null;
    for (const { state, events } of batches) {
      const cues = present(this.presentation, state, events, this.options.localPlayerIds);
      for (const name of cues.stop) this.stopCue(name);
      music = cues.music ?? music;
      this.follow(state, events);
    }
    if (music === "start" && this.options.music) this.sounds.playMusic(this.options.music, GAME_REPEATS, true);
  }

  private follow(state: MatchState, events: readonly SimEvent[]): void {
    if (this.resultCue?.phase !== state.phase) this.resultCue = null;
    for (const event of events) {
      if (event.type === "round-over") this.lastRoundDraw = state.draw;
      if (event.type === "round-start") this.faces.reset();
    }
  }

  /**
   * The frame, under a fade when one runs. The fade out shows the frame drawn last and darkens it;
   * the original does not run the scene meanwhile (0x405e08). The server's clock goes on, as the
   * original's timers do from the fade call, so the new screen shows ~11 frames into its time.
   */
  render(state: MatchState, extra: Pick<RenderView, "overlay" | "help" | "chat" | "bars"> = {}): void {
    const now = performance.now();
    this.cursor.startDrawClock(now);
    if (this.shownPhase === null) {
      const entry = takeStageFade(this.ctx.canvas);
      if (entry) {
        this.fadeOutFrame = entry.frame.outFrame;
        this.fadeInFrame = entry.frame.inFrame;
        this.darkness = entry.frame.darkness;
        this.revealAt = entry.revealAt;
        this.surface.drawImage(entry.frame.picture, 0, 0);
        this.fade = { fade: entry.fade ?? new Fade(entry.kind, now, FRAME_MS, entry.kind === "out" ? this.fadeOutFrame : this.fadeInFrame),
          picture: entry.kind === "out" ? entry.frame.picture : null };
      }
    }
    if (this.shownPhase !== null && this.shownPhase !== state.phase && phaseFades(this.shownPhase, state.phase) && !this.fade?.picture) {
      this.fade = { fade: new Fade("out", now, FRAME_MS), picture: freezeCanvas(this.surface.canvas) };
    }
    this.shownPhase = state.phase;
    const fade = this.fade;
    if (fade?.picture) {
      this.ctx.drawImage(fade.picture, 0, 0);
      this.darkness = fade.fade.darkness(now);
      drawDarkness(this.ctx, this.darkness);
      this.fadeOutFrame = fade.fade.frame(now) + 1;
      if (fade.fade.done(now)) {
        // The last step of the fade out fills the composition with black (0x4130f0).
        this.surface.fillStyle = "#000";
        this.surface.fillRect(0, 0, SCREEN_W, SCREEN_H);
        this.resultRound = null;
        this.fadeOutFrame = 0;
        this.revealAt = now + FRAME_MS;
        this.fade = { fade: new Fade("in", now, FRAME_MS, this.fadeInFrame), picture: null };
      }
      return;
    }
    // A completed out step stays black until the next 30 fps scene frame.
    const tolerance = Number.EPSILON * Math.max(Math.abs(now), Number.isFinite(this.revealAt) ? Math.abs(this.revealAt) : 0);
    if (now + tolerance < this.revealAt) {
      this.ctx.drawImage(this.surface.canvas, 0, 0);
      drawDarkness(this.ctx, 1);
      return;
    }
    this.revealAt = Number.NEGATIVE_INFINITY;
    if (this.resultCue?.phase === state.phase) {
      // Round results stop BGM before end; final results play endsig before stopping it.
      if (this.resultCue.name === "end") this.sounds.stopMusic();
      this.sounds.play(this.resultCue.name, "music");
      if (this.resultCue.name === "endsig") this.sounds.stopMusic();
      this.resultCue = null;
    }
    const blind = renderScreen(this.surface, this.assets, state, {
      localPlayerIds: this.options.localPlayerIds,
      hostId: this.hostId,
      people: this.options.people,
      candyBase: this.options.candyBase,
      notice: this.options.notice && { line: this.options.notice, now },
      hurryTick: this.presentation.hurryTick,
      lastRoundDraw: this.lastRoundDraw,
      waitRetained: this.resultRound === state.round,
      faces: this.faces,
      markers: this.markers,
      badState: this.badState,
      mouse: this.mousePointer.mouse,
      // The renderer calls this only where 0x43f070 appears, including both draws around a box.
      cursor: this.mousePointer.inside
        ? { ...this.mousePointer.mouse, draw: (ctx) => this.cursor.draw(ctx, this.assets.cursor, now, this.mousePointer.mouse) }
        : undefined,
      ...extra,
    });
    this.resultRound = state.phase === "round-over" ? state.round + 1
      : state.phase === "waiting" && state.round > 1 ? state.round : null;
    // A fade in shows the whole composition, blind or not (0x4130f0(0)).
    if (blind && !fade) presentBlind(this.ctx, this.surface, this.assets.hud.apple, blind);
    else this.ctx.drawImage(this.surface.canvas, 0, 0);
    this.darkness = fade ? fade.fade.darkness(now) : 0;
    if (fade) {
      drawDarkness(this.ctx, this.darkness);
      this.fadeInFrame = fade.fade.frame(now) + 1;
      if (fade.fade.done(now)) {
        this.fade = null;
        this.fadeInFrame = 0;
      }
    }
  }

  /**
   * Leaving the game: the music stops unless the way out keeps the tune; endsig stops either way
   * (EXITGAME 0x44f6f1, the cleanup 0x44f4e0). A round's end rings on: the original stops it only
   * as the next round is prepared (0x41014e).
   */
  dispose(keepMusic = false): void {
    for (const release of this.releaseFrames) release();
    this.resultCue = null;
    this.detachPointer();
    if (!this.options.keepMusic && !keepMusic) this.sounds.stopMusic();
    this.stopCue("endsig");
  }

  /**
   * Each stop checks the effects switch first, though end and endsig play under the music switch
   * (0x41011c, 0x44f6e2, 0x44f505): with the effects off they ring to their end.
   */
  private stopCue(name: string): void {
    if (this.resultCue?.name === name) this.resultCue = null;
    if (this.sounds.effects) this.sounds.stop(name);
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
    // Rounded RAF timestamps must not defer a tick at its exact 30 fps boundary.
    const tolerance = 2 * Number.EPSILON * Math.max(Math.abs(now), Math.abs(last), stepMs);
    pending += Math.min(250, now - last);
    last = now;
    let steps = 0;
    while (pending + tolerance >= stepMs && steps < maxSteps) {
      onTick();
      if (!running) return;
      pending -= stepMs;
      steps += 1;
    }
    if (steps === maxSteps) pending = 0;
    onFrame();
    if (!running) return;
    handle = requestAnimationFrame(frame);
  };
  handle = requestAnimationFrame(frame);
  return () => {
    running = false;
    cancelAnimationFrame(handle);
  };
}
