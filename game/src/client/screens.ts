// Full-screen result and wait screens: the field is not drawn while they are up (0x408e40).
import { isTeamMode } from "../sim/modes.ts";
import type { MatchState, PlayerState } from "../sim/types.ts";
import {
  DRAW_BLIT,
  FINAL_ROW,
  finalRowTop,
  portraitRect,
  RESULT_ROW,
  resultRowBase,
  roundDigitBlits,
  STATUS_TEXT,
  teambarRect,
} from "./hudLayout.ts";
import type { Badge } from "../server/protocol.ts";
import { drawBadge } from "./badge.ts";
import type { RenderView } from "./renderer.ts";
import type { SceneAssets } from "./scene.ts";
import { blit } from "./sprite.ts";
import { FONT_12, FONT_13, outlinedText, YELLOW } from "./text.ts";

const MEDAL = [82, 32, 100, 59] as const;

/**
 * The name every match screen draws (the panel, the chat name tags, the wait, round and final
 * results): the ID or the nick as the room slot's +0x68 says (0x40fabf, 0x40fbb2, 0x41002f,
 * 0x410240, 0x410773); the match name for a player the view does not know.
 */
export function personName(people: RenderView["people"], player: PlayerState): string {
  return people?.get(player.id)?.name ?? player.name;
}

/**
 * Round result (0x40fd50, 1500 ms): the number of the round about to start, and per room
 * slot the portrait, name, status and medals; DRAW on a time-out.
 */
export function renderRoundResult(ctx: CanvasRenderingContext2D, assets: SceneAssets, state: MatchState, view: RenderView): void {
  drawRoundScreen(ctx, assets, state, view, state.round + 1, state.draw, STATUS_TEXT.waiting);
}

/**
 * Wait screen before the countdown (0x4100e0). Round 1 shows new_load with the state column;
 * later rounds draw no background, so the round result stays up with the rows redrawn and a
 * guest's 준 비 완 료 goes over the 준 비 중 .. the result left at the same point: both show.
 * The original turns a guest ready when that guest has loaded (packets B and C, 0x447fa0,
 * 0x444654); the server here loads for everyone, so every guest is ready from the start.
 */
export function renderWait(ctx: CanvasRenderingContext2D, assets: SceneAssets, state: MatchState, view: RenderView): void {
  if (state.round > 1) {
    if (!view.waitRetained) {
      // A late asset load may skip drawing the result; supply its backdrop once in that case.
      drawRoundScreen(ctx, assets, state, view, state.round, view.lastRoundDraw, STATUS_TEXT.waiting, STATUS_TEXT.ready);
      return;
    }
    for (const player of state.players) {
      const base = resultRowBase(player.slot);
      drawIdentity(ctx, assets, state, player, base, view);
      outlinedText(ctx, statusOf(player, view, STATUS_TEXT.ready), RESULT_ROW.status.x, base + RESULT_ROW.status.dy, YELLOW, FONT_12);
      for (let k = 0; k < player.medals; k++) {
        blit(ctx, assets.hud.mark, MEDAL, RESULT_ROW.medal.x + RESULT_ROW.medal.step * k, base + RESULT_ROW.medal.dy);
      }
    }
    if (view.lastRoundDraw) blit(ctx, assets.hud.sd, DRAW_BLIT.src, DRAW_BLIT.x, DRAW_BLIT.y);
    return;
  }
  ctx.drawImage(assets.hud.load, 0, 0);
  for (const player of state.players) {
    const base = resultRowBase(player.slot);
    drawIdentity(ctx, assets, state, player, base, view);
    const status = statusOf(player, view, STATUS_TEXT.ready);
    outlinedText(ctx, status, RESULT_ROW.loadStatus.x, base + RESULT_ROW.loadStatus.dy, YELLOW, FONT_12);
  }
}

/**
 * Final result (0x410560, 5000 ms): portraits, team bars in the team modes, names, medals and
 * WIN! on every row with three wins, so a whole team gets it and a match that ended because one
 * team was left in the room shows none; the EXP column stays empty.
 */
export function renderFinalResult(ctx: CanvasRenderingContext2D, assets: SceneAssets, state: MatchState, view: RenderView): void {
  ctx.drawImage(assets.hud.gameResult, 0, 0);
  for (const player of state.players) {
    const top = finalRowTop(player.slot);
    drawHead(ctx, assets, player, FINAL_ROW.portrait.x, top + FINAL_ROW.portrait.dy);
    drawTeambar(ctx, assets, state, player, FINAL_ROW, top);
    drawBadges(ctx, assets, FINAL_ROW, top, view.people?.get(player.id)?.badge);
    outlinedText(ctx, personName(view.people, player), FINAL_ROW.name.x, top + FINAL_ROW.name.dy, "#ffffff", FONT_13);
    for (let k = 0; k < player.medals; k++) {
      blit(ctx, assets.hud.mark, MEDAL, FINAL_ROW.medal.x + FINAL_ROW.medal.step * k, top + FINAL_ROW.medal.dy);
    }
    if (player.medals >= state.rules.medalsToWin) {
      blit(ctx, assets.hud.teambar, FINAL_ROW.win.src, FINAL_ROW.win.x, top + FINAL_ROW.win.dy);
    }
  }
}

function drawRoundScreen(
  ctx: CanvasRenderingContext2D,
  assets: SceneAssets,
  state: MatchState,
  view: RenderView,
  round: number,
  draw: boolean,
  status: string,
  /** The wait screen's status, stamped over the result's in the row's own order (0x4100e0). */
  over?: string,
): void {
  ctx.drawImage(assets.hud.roundResult, 0, 0);
  for (const glyph of roundDigitBlits(round)) blit(ctx, assets.hud.mark, glyph.src, glyph.x, glyph.y);
  for (const player of state.players) {
    const base = resultRowBase(player.slot);
    drawIdentity(ctx, assets, state, player, base, view);
    outlinedText(ctx, statusOf(player, view, status), RESULT_ROW.status.x, base + RESULT_ROW.status.dy, YELLOW, FONT_12);
    if (over) outlinedText(ctx, statusOf(player, view, over), RESULT_ROW.status.x, base + RESULT_ROW.status.dy, YELLOW, FONT_12);
    for (let k = 0; k < player.medals; k++) {
      blit(ctx, assets.hud.mark, MEDAL, RESULT_ROW.medal.x + RESULT_ROW.medal.step * k, base + RESULT_ROW.medal.dy);
    }
  }
  if (draw) blit(ctx, assets.hud.sd, DRAW_BLIT.src, DRAW_BLIT.x, DRAW_BLIT.y);
}

/** A head: its slot's work surface in a network room (0x40ff21, 0x4106f1), else Wg_char's cell. */
function drawHead(ctx: CanvasRenderingContext2D, assets: SceneAssets, player: PlayerState, x: number, y: number): void {
  const head = assets.heads.get(player.id);
  if (head) head.draw(ctx, x, y);
  else blit(ctx, assets.hud.portraits, portraitRect(player.character), x, y);
}

function drawIdentity(ctx: CanvasRenderingContext2D, assets: SceneAssets, state: MatchState, player: PlayerState, base: number, view: RenderView): void {
  drawHead(ctx, assets, player, RESULT_ROW.portrait.x, base + RESULT_ROW.portrait.dy);
  drawTeambar(ctx, assets, state, player, RESULT_ROW, base);
  drawBadges(ctx, assets, RESULT_ROW, base, view.people?.get(player.id)?.badge);
  outlinedText(ctx, personName(view.people, player), RESULT_ROW.name.x, base + RESULT_ROW.name.dy, "#ffffff", FONT_13);
}

/** Team modes: the team's new_teambar row (0x442580), rows staying in slot order (0x41009f). */
function drawTeambar(
  ctx: CanvasRenderingContext2D,
  assets: SceneAssets,
  state: MatchState,
  player: PlayerState,
  row: { teambar: { x: number; dy: number } },
  y: number,
): void {
  if (!isTeamMode(state.rules.mode)) return;
  blit(ctx, assets.hud.teambar, teambarRect(player.team), row.teambar.x, y + row.teambar.dy);
}

/** Guild mark and level badge; the gender icon before them is drawn for no remake account (all 0). */
function drawBadges(
  ctx: CanvasRenderingContext2D,
  assets: SceneAssets,
  row: { guild: { x: number; dy: number }; rank: { x: number; dy: number } },
  y: number,
  badge: Badge | undefined,
): void {
  drawBadge(ctx, assets.hud, badge, { x: row.guild.x, y: y + row.guild.dy }, { x: row.rank.x, y: y + row.rank.dy });
}

function statusOf(player: PlayerState, view: RenderView, other: string): string {
  return player.id === view.hostId ? STATUS_TEXT.host : other;
}
