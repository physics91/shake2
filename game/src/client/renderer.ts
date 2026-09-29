// The in-game screen, drawn in shake.exe's order (0x405fb0 scene 8, original/FIDELITY.md §6):
// no depth sorting, shadows under every bomb, the local player last, then the HUD.
import type { AnimationMeta, LevelMeta } from "../assets/types.ts";
import { animDue, nowMs } from "../sim/constants.ts";
import { countdownValue } from "../sim/match.ts";
import { isTeamMode } from "../sim/modes.ts";
import type { MatchState, PlayerState } from "../sim/types.ts";
import { BombKind, CellKind } from "../sim/types.ts";
import { suddenDeathOrder } from "../sim/world.ts";
import type { PanelBar } from "../server/protocol.ts";
import { START_BARS } from "../server/protocol.ts";
import type { Sheet } from "./assets.ts";
import {
  BAR_BLOCKS,
  BOTTOM_MESSAGE,
  CANDY_COUNT,
  CANDY_POS,
  CLOCK_POS,
  countdownBlit,
  guildRect,
  HELP_COLOR,
  HELP_TEXT,
  HURRY_MS,
  HURRY_POS,
  candyCountX,
  countBlits,
  itemGrid,
  itemIconRect,
  PANEL,
  panelTop,
  rankRect,
  SCREEN_H,
  SCREEN_W,
  teamColor,
  TEXTBOX_POS,
  timerGlyphs,
} from "./hudLayout.ts";
import type { BlindWindow } from "./blind.ts";
import { blindWindow, drawBlindFilter } from "./blind.ts";
import { bubbleLines, CHAT_BUBBLE, CHAT_LINE, TYPING_MARK } from "./chat.ts";
import { balloonAt, NET_TYPING_MARK } from "./matchChat.ts";
import type { SceneAssets } from "./scene.ts";
import { renderFinalResult, renderRoundResult, renderWait } from "./screens.ts";
import { blit, blitBlended, drawFrame, drawFrameOrHalf, timedFrame } from "./sprite.ts";
import { practiceHelp } from "./practiceHelp.ts";
import { fpsBlocks, pingBlocks } from "./panelBars.ts";
import { drawHelpScreen } from "./screenKit.ts";
import { FONT_12, FONT_13, FONT_COURIER_15, outlinedText, plainText, YELLOW } from "./text.ts";

/** The weight the screen under keeps in the blends of shadows (0x40914f) and the candy box (0x40bc82). */
const SHADOW_WEIGHT = 100;
const CANDY_WEIGHT = 70;

export { SCREEN_H, SCREEN_W };

export interface RenderView {
  /** Players controlled on this screen. */
  localPlayerIds: readonly number[];
  /** Shown as 방장 on the result screens. */
  hostId: number | null;
  /** Tick the HURRY UP sprite appeared, or null. */
  hurryTick: number | null;
  /** Whether the last round result was a draw; its DRAW stays on the wait screen. */
  lastRoundDraw: boolean;
  faces: PanelFaces;
  /**
   * The message box (0x443c50), drawn in its place in the order: practice's end and Esc boxes
   * (while one is up the textbox is not), a network guest's exit box after the countdown (0x40ca15).
   */
  overlay?: (ctx: CanvasRenderingContext2D) => void;
  /** The mouse in screen pixels, for practice's textbox help. */
  mouse?: { x: number; y: number };
  /** The game's own mouse cursor while the mouse is over the screen: its point and cursor.spr frame. */
  cursor?: { x: number; y: number; frame: number };
  /** The F1 help screen is up. */
  help?: boolean;
  /** The chat of practice or of a network match. */
  chat?: ChatDraw;
  /** Network: each player's panel bars by id; one without them shows A 30 and B 0. */
  bars?: ReadonlyMap<number, Omit<PanelBar, "id">>;
}

export interface ChatDraw {
  /** Each slot's last line while its balloon lasts (practice: the own player's, slot 3). */
  balloons: readonly { slot: number; text: string }[];
  /** The own open chat line: its text, and the caret's byte column while the blink shows it. */
  line: { text: string; caret: number | null } | null;
  /** Network: the other players whose "chat" mark shows (state packet +0x2c). */
  typing?: readonly number[];
}

/**
 * Draw whichever screen the match phase shows into the composition: practice's frame (scene 9) or
 * the network's (scene 8). Returns the blind window when the present shows only that (0x412e20).
 */
export function renderScreen(ctx: CanvasRenderingContext2D, assets: SceneAssets, state: MatchState, view: RenderView): BlindWindow | null {
  ctx.imageSmoothingEnabled = false;
  return state.rules.practice ? renderPracticeScreen(ctx, assets, state, view) : renderNetworkScreen(ctx, assets, state, view);
}

/**
 * The network frame (0x408e37). The wait and result screens draw only themselves and the MSGBOX:
 * no box, no help, no cursor (0x408e40-0x408ea3). On the field the blind filter is part of the
 * frame (0x40c188); the cursor is drawn only over the exit box (0x40ca5c) or the F1 help
 * (0x408e2a). The blind window it returns is all the present shows (0x412e20). This remake's two
 * players on one keyboard follow the same frame.
 */
function renderNetworkScreen(ctx: CanvasRenderingContext2D, assets: SceneAssets, state: MatchState, view: RenderView): BlindWindow | null {
  switch (state.phase) {
    case "waiting":
      renderWait(ctx, assets, state, view);
      return null;
    case "round-over":
      renderRoundResult(ctx, assets, state, view);
      return null;
    case "match-over":
      renderFinalResult(ctx, assets, state);
      return null;
  }
  renderField(ctx, assets, state, view);
  if (view.overlay) {
    view.overlay(ctx);
    if (view.cursor) drawCursor(ctx, assets, view.cursor);
  }
  if (view.help) {
    drawHelpScreen(ctx, assets.hud.help);
    if (view.cursor) drawCursor(ctx, assets, view.cursor);
  }
  return blindView(assets, state, view);
}

/**
 * Practice's frame (0x405fb0). On the field the cursor comes after the Object_C pass; a blind
 * player's filter follows it (0x408d8b-0x408de5), then the F1 help and the cursor again. The
 * blind window it returns is all the present shows (0x412e20).
 */
function renderPracticeScreen(ctx: CanvasRenderingContext2D, assets: SceneAssets, state: MatchState, view: RenderView): BlindWindow | null {
  let blind: BlindWindow | null = null;
  switch (state.phase) {
    case "waiting":
      renderWait(ctx, assets, state, view);
      break;
    case "round-over":
      renderRoundResult(ctx, assets, state, view);
      break;
    case "match-over":
      renderFinalResult(ctx, assets, state);
      break;
    default:
      renderField(ctx, assets, state, view);
      blind = blindView(assets, state, view);
  }
  if (blind) {
    if (view.cursor) drawCursor(ctx, assets, view.cursor);
    drawBlindFilter(ctx, assets.hud.blindFilter, blind);
  }
  // Practice's F1 help (0x432f90), last in the frame.
  if (view.help) drawHelpScreen(ctx, assets.hud.help);
  if (view.cursor && (view.help || !blind)) drawCursor(ctx, assets, view.cursor);
  return blind;
}

/**
 * The screen's own player (0x469948) when blind: the window follows its point (0x406100). Its
 * timer runs out only in the alive player's update, so it outlasts a death (0x452f8c).
 */
function blindView(assets: SceneAssets, state: MatchState, view: RenderView): BlindWindow | null {
  const own = ownPlayer(state, view);
  if (own?.status.blind == null) return null;
  const at = screenPos(assets, own);
  return blindWindow(at.x, at.y);
}

function ownPlayer(state: MatchState, view: RenderView): PlayerState | undefined {
  if (view.localPlayerIds.length !== 1) return undefined;
  return state.players.find((p) => p.id === view.localPlayerIds[0]);
}

/** The screen's own team ([0x4929d0], cached each frame) in the team modes, dead or alive. */
function ownTeam(state: MatchState, view: RenderView): number | null {
  if (!isTeamMode(state.rules.mode)) return null;
  return ownPlayer(state, view)?.team ?? null;
}

/** The game's cursor (0x43f070): cursor.spr anim 0 with its anchor at the mouse, over everything. */
function drawCursor(ctx: CanvasRenderingContext2D, assets: SceneAssets, cursor: { x: number; y: number; frame: number }): void {
  const anim = assets.cursor.meta.animations[0];
  drawFrame(ctx, assets.cursor, anim, cursor.frame % anim.frames.length, cursor.x, cursor.y);
}

export function renderField(ctx: CanvasRenderingContext2D, assets: SceneAssets, state: MatchState, view: RenderView): void {
  ctx.imageSmoothingEnabled = false;
  // Blind, the map goes down only in the window (practice 0x4060e6, network 0x408f2c): the rest of
  // the composition keeps what earlier frames left there, under this frame's sprites.
  const blind = blindView(assets, state, view);
  if (blind) {
    const { left, top, width, height } = blind;
    ctx.drawImage(assets.level.background, left, top, width, height, left, top, width, height);
  } else {
    ctx.drawImage(assets.level.background, 0, 0, SCREEN_W, SCREEN_H);
  }
  drawFixedBlocks(ctx, assets, state);
  drawTimer(ctx, assets, state);
  drawObjects(ctx, assets, state, 0);
  drawSuddenDeath(ctx, assets, state);
  drawBricks(ctx, assets, state);
  drawObjects(ctx, assets, state, 1);
  drawShadows(ctx, assets, state);
  drawItems(ctx, assets, state);
  drawBombs(ctx, assets, state, view);
  const marked = markedPlayer(state, view);
  const locals = state.players.filter((p) => view.localPlayerIds.includes(p.id));
  const practice = state.rules.practice;
  const team = ownTeam(state, view);
  const typing = view.chat?.typing ?? [];
  // The other players' loop (0x40a964) skips the screen's own player.
  for (const player of state.players) {
    if (locals.includes(player)) continue;
    const mate = team !== null && player.team === team;
    // 0x40a9f1: the yellow 우리편 arrow over a teammate, before the body, through its death
    // animation and while it is invisible; not once the death has ended (+0x200).
    if (mate && !player.gone) drawMarker(ctx, assets, assets.teamMarker, state, player);
    // 0x40ab74: an invisible teammate is still drawn, through the half blend; an invisible enemy is not.
    if (player.status.invisible === null || mate) drawPlayer(ctx, assets, player);
    // 0x40ac1f: a typing player's "chat" mark right after the body, an invisible enemy's too.
    if (player.alive && typing.includes(player.id)) drawTypingMark(ctx, assets, player);
    // Practice's dummy loop draws no stars (0x407c65-0x407f98).
    if (!practice) drawBadState(ctx, assets, state, player);
  }
  for (const player of locals) drawPlayer(ctx, assets, player);
  // Practice leaves the item grid out while its player is blind (0x40842c).
  if (locals[0] && !(practice && locals[0].status.blind !== null)) drawItemGrid(ctx, assets, locals[0], practice);
  for (const player of locals) drawBadState(ctx, assets, state, player);
  if (marked) drawMarker(ctx, assets, assets.marker, state, marked);
  if (state.rules.practice) {
    renderPracticeHud(ctx, assets, state, view);
    return;
  }
  drawCandy(ctx, assets, locals[0]?.candy ?? 0);
  drawEffects(ctx, assets, state);
  drawPanel(ctx, assets, state, view.bars);
  // The panel's last part (0x40fb81): the others' names while the own chat line is open.
  if (view.chat?.line) drawChatNameTags(ctx, assets, state, view);
  drawFaces(ctx, assets, state, view);
  drawObjects(ctx, assets, state, 2);
  if (blind) drawBlindFilter(ctx, assets.hud.blindFilter, blind);
  drawBottomBar(ctx);
  if (view.localPlayerIds.length > 1) drawNameTags(ctx, assets, state);
  if (view.chat) drawNetworkChat(ctx, assets, state, view, view.chat);
  drawHurry(ctx, assets, state, view.hurryTick);
  if (state.phase === "countdown") {
    const glyph = countdownBlit(countdownValue(state));
    blit(ctx, assets.hud.sd, glyph.src, glyph.x, glyph.y);
  }
}

/**
 * Practice's HUD (0x4089b0-0x408d72): no candy, right panel, bottom message, HURRY or countdown
 * (those calls are only in the network branch). After the effects come the faces, left out while
 * the player is blind (0x4089d4), then either the box, or the chat bubble and then the chat line
 * or the textbox (43,557) (0x408b96-0x408d5e), then the Object_C pass.
 */
function renderPracticeHud(ctx: CanvasRenderingContext2D, assets: SceneAssets, state: MatchState, view: RenderView): void {
  drawEffects(ctx, assets, state);
  const own = ownPlayer(state, view);
  if (own?.status.blind == null) drawFaces(ctx, assets, state, view);
  if (view.overlay) {
    view.overlay(ctx);
  } else {
    for (const balloon of view.chat?.balloons ?? []) drawChatBubble(ctx, assets, balloon.slot, balloon.text);
    if (view.chat?.line) {
      drawChatLine(ctx, view.chat.line);
      // Practice's thought balloon over the own player while it is alive (0x408c88-0x408d0a).
      if (own?.alive && !own.gone) drawMark(ctx, assets.hud.images, TYPING_MARK, screenPos(assets, own));
    } else drawPracticeHelp(ctx, assets, state, view.mouse ?? { x: 0, y: 0 });
  }
  drawObjects(ctx, assets, state, 2);
}

/** 0x418940: mark.shk's frame beside slot's face and up to three lines of 굴림체 12 in it. */
function drawChatBubble(ctx: CanvasRenderingContext2D, assets: SceneAssets, slot: number, text: string): void {
  const at = balloonAt(slot);
  blit(ctx, assets.hud.mark, CHAT_BUBBLE.src, at.x, at.y);
  bubbleLines(text).forEach((line, i) => {
    outlinedText(ctx, line, at.textX, at.textY + CHAT_BUBBLE.lineStep * i, "#ffffff", FONT_12);
  });
}

/**
 * The open line (0x418550): its text in white 굴림체 13, the caret written straight into the
 * surface as white, black and white columns.
 */
function drawChatLine(ctx: CanvasRenderingContext2D, line: NonNullable<ChatDraw["line"]>): void {
  if (line.text) outlinedText(ctx, line.text, CHAT_LINE.x, CHAT_LINE.y, "#ffffff", FONT_13);
  if (line.caret !== null) {
    const x = CHAT_LINE.x + CHAT_LINE.byteWidth * line.caret;
    ["#ffffff", "#000000", "#ffffff"].forEach((colour, i) => {
      ctx.fillStyle = colour;
      ctx.fillRect(x + i, CHAT_LINE.y, 1, CHAT_LINE.caretHeight);
    });
  }
}

/** A typing mark at (x + 20, y - 50) of the player's point. */
function drawMark(ctx: CanvasRenderingContext2D, image: CanvasImageSource, mark: typeof TYPING_MARK, at: { x: number; y: number }): void {
  blit(ctx, image, mark.src, at.x + mark.dx, at.y + mark.dy);
}

function drawTypingMark(ctx: CanvasRenderingContext2D, assets: SceneAssets, player: PlayerState): void {
  drawMark(ctx, assets.hud.mark, NET_TYPING_MARK, screenPos(assets, player));
}

/**
 * The network chat after the bottom message: the balloons (0x40c254), then the open line and the
 * own "chat" mark while the own player is alive (0x40c33c-0x40c421).
 */
function drawNetworkChat(ctx: CanvasRenderingContext2D, assets: SceneAssets, state: MatchState, view: RenderView, chat: ChatDraw): void {
  for (const balloon of chat.balloons) drawChatBubble(ctx, assets, balloon.slot, balloon.text);
  if (!chat.line) return;
  drawChatLine(ctx, chat.line);
  const own = ownPlayer(state, view);
  if (own?.alive && !own.gone) drawTypingMark(ctx, assets, own);
}

/**
 * The names under the other players while the own chat line is open (0x40fb81-0x40fce0): alive,
 * visible players only; 굴림체 12 without an outline, centred at (x - w/2, y + 5), a black copy
 * one pixel down and right under the name in white, or the team's colour in the team modes.
 */
function drawChatNameTags(ctx: CanvasRenderingContext2D, assets: SceneAssets, state: MatchState, view: RenderView): void {
  const teams = isTeamMode(state.rules.mode);
  for (const player of state.players) {
    if (view.localPlayerIds.includes(player.id) || !player.alive || player.gone || player.status.invisible !== null) continue;
    const at = screenPos(assets, player);
    plainText(ctx, player.name, at.x + 1, at.y + 6, "#000000", FONT_12, "center");
    plainText(ctx, player.name, at.x, at.y + 5, teams ? teamColor(player.team) : "#ffffff", FONT_12, "center");
  }
}

/** The textbox (0x441a10) and the help for what is under the mouse (0x4557f0), 굴림체 13 in 0x9bffff. */
function drawPracticeHelp(ctx: CanvasRenderingContext2D, assets: SceneAssets, state: MatchState, mouse: { x: number; y: number }): void {
  ctx.drawImage(assets.hud.textbox, TEXTBOX_POS.x, TEXTBOX_POS.y);
  const help = practiceHelp(state, area(assets), mouse.x, mouse.y);
  if (!help) return;
  plainText(ctx, help.title, HELP_TEXT.titleX, HELP_TEXT.y, HELP_COLOR, FONT_13);
  help.lines.forEach((line, i) => plainText(ctx, line, HELP_TEXT.lineX, HELP_TEXT.y + HELP_TEXT.lineStep * i, HELP_COLOR, FONT_13));
}

/**
 * The original has one player per screen: it gets the diff1 marker and no name tag.
 * With two players on one keyboard (this remake's addition) nobody is marked.
 */
function markedPlayer(state: MatchState, view: RenderView): PlayerState | undefined {
  if (view.localPlayerIds.length !== 1) return undefined;
  return state.players.find((p) => p.id === view.localPlayerIds[0] && !p.gone);
}

function area(assets: SceneAssets): { left: number; top: number } {
  const [left, top] = assets.level.meta.area;
  return { left, top };
}

function cellTopLeft(assets: SceneAssets, state: MatchState, cell: number): { x: number; y: number } {
  const { left, top } = area(assets);
  const { width, cellW, cellH } = state.layout;
  return { x: left + (cell % width) * cellW, y: top + Math.floor(cell / width) * cellH };
}

function playAreaPos(assets: SceneAssets, x: number, y: number): { x: number; y: number } {
  const { left, top } = area(assets);
  return { x: left + x, y: top + y };
}

function screenPos(assets: SceneAssets, player: PlayerState): { x: number; y: number } {
  return playAreaPos(assets, player.x, player.y);
}

/** The map surface has its walls baked in at load (0x401a80): anim 0 of each wall's sheet. */
function drawFixedBlocks(ctx: CanvasRenderingContext2D, assets: SceneAssets, state: MatchState): void {
  for (const wall of assets.level.meta.fixed) {
    const sheet = assets.level.bricks[wall.sprite];
    if (!sheet) continue;
    const at = cellTopLeft(assets, state, wall.cell);
    drawFrame(ctx, sheet, sheet.meta.animations[0], 0, at.x, at.y);
  }
}

/**
 * One sheet's pass of map objects (0x411700) in file order, on the frames the simulation keeps.
 * Object_A only draws anims 14-26 here (the rest would be baked into the background; no map
 * has any), and objects a sudden-death block took are gone.
 */
function drawObjects(ctx: CanvasRenderingContext2D, assets: SceneAssets, state: MatchState, sheet: number): void {
  const records = assets.level.meta.objects;
  state.layout.objects.forEach((object, i) => {
    const obj = state.objects[i];
    if (object.sheet !== sheet || !obj || obj.cell < 0 || !records[i]) return;
    if (sheet === 0 && (object.anim < 14 || object.anim > 26)) return;
    drawMapObject(ctx, assets.objectSheets, records[i], obj.frame);
  });
}

/**
 * 0x462b90 by sheet type: an Object_A frame's top-left is the record's (left, top); Object_B and
 * Object_C frames keep frame 0's anchor there, so animated frames of other sizes stay in place.
 */
export function drawMapObject(
  ctx: CanvasRenderingContext2D,
  sheets: readonly Sheet[],
  record: LevelMeta["objects"][number],
  frame: number,
): void {
  const sheet = sheets[record.unknown_a];
  const anim = sheet?.meta.animations[record.anim];
  if (!sheet || !anim || frame >= anim.frames.length) return;
  const [ax, ay] = anim.frames[record.unknown_a === 0 ? frame : 0].anchor;
  drawFrame(ctx, sheet, anim, frame, record.rect[0] + ax, record.rect[1] + ay);
}

/** Timer digits (0x457350) and the clock (4 frames at 8 fps). */
function drawTimer(ctx: CanvasRenderingContext2D, assets: SceneAssets, state: MatchState): void {
  const [digits, colon] = assets.digits.meta.animations;
  for (const glyph of timerGlyphs(state.timerSeconds)) {
    const anim = glyph.digit === null ? colon : digits;
    drawFrame(ctx, assets.digits, anim, glyph.digit ?? 0, glyph.x, glyph.y);
  }
  const clock = assets.clock.meta.animations[0];
  drawFrame(ctx, assets.clock, clock, timedFrame(state.tick, clock.unknown_u16, clock.frames.length), CLOCK_POS.x, CLOCK_POS.y);
}

/** Closed cells (0x4014c0): anim 0 of the map's first brick sheet, original walls left alone. */
function drawSuddenDeath(ctx: CanvasRenderingContext2D, assets: SceneAssets, state: MatchState): void {
  const sheet = assets.level.bricks[0];
  if (!sheet || state.suddenDeath.placed === 0) return;
  const order = suddenDeathOrder(state.layout.width);
  for (let i = 0; i < state.suddenDeath.placed; i++) {
    const cell = order[i];
    if (cell >= state.layout.kinds.length || state.layout.kinds[cell] === CellKind.Fixed) continue;
    const at = cellTopLeft(assets, state, cell);
    drawFrame(ctx, sheet, sheet.meta.animations[0], 0, at.x, at.y);
  }
}

/** 0x401890: every brick is anim 1 of its sheet, intact at frame 0. */
function drawBricks(ctx: CanvasRenderingContext2D, assets: SceneAssets, state: MatchState): void {
  for (const brick of assets.level.meta.bricks) {
    const crumbling = state.breaking.find((b) => b.cell === brick.cell);
    if (!crumbling && state.grid[brick.cell] !== CellKind.Brick) continue;
    const sheet = assets.level.bricks[brick.sprite];
    const anim = sheet?.meta.animations[1];
    if (!sheet || !anim) continue;
    const at = cellTopLeft(assets, state, brick.cell);
    drawFrame(ctx, sheet, anim, crumbling ? Math.min(crumbling.frame, anim.frames.length - 1) : 0, at.x, at.y);
  }
}

/** The item list (0x409285) at the cells' foot, over the Object_B pass and the shadows. */
function drawItems(ctx: CanvasRenderingContext2D, assets: SceneAssets, state: MatchState): void {
  for (const item of state.items) {
    const anim = assets.items.meta.animations[item.kind];
    const at = cellTopLeft(assets, state, item.cell);
    // Dropped items stand one pixel higher (0x453690).
    const frame = timedFrame(state.tick - item.tick, anim.unknown_u16, anim.frames.length);
    drawFrame(ctx, assets.items, anim, frame, at.x + 20, at.y + (item.dropped ? 31 : 32));
  }
}

/**
 * Shadows (0x40914f): the weighted blend (0x413620) with w 100, (dst·100 + src·156) >> 8 on each
 * 16-bit field. None for an invisible player, the local one included.
 */
function drawShadows(ctx: CanvasRenderingContext2D, assets: SceneAssets, state: MatchState): void {
  for (const player of state.players) {
    if (player.gone || player.status.invisible !== null) continue;
    const at = screenPos(assets, player);
    blitBlended(ctx, assets.shadow, at.x - 14, at.y - 7, SHADOW_WEIGHT);
  }
}

/**
 * What the bomb loop drew this update, in list order (0x406508): a bomb at its anchor with its
 * kind's animation (the owner's colour), or a fire's frame on each of its cells in its own
 * animation (기본화염, or 특수화염 for the water family). A mine is drawn for its owner only
 * (0x40662f); the goggles that would show it to others at alpha 150 cannot be had.
 */
function drawBombs(ctx: CanvasRenderingContext2D, assets: SceneAssets, state: MatchState, view: RenderView): void {
  for (const sprite of state.bombSprites) {
    if (sprite.type === "fire") {
      const fire = assets.fire.meta.animations[sprite.anim];
      for (const cell of sprite.cells) {
        const at = cellTopLeft(assets, state, cell);
        drawFrame(ctx, assets.fire, fire, Math.min(sprite.frame, fire.frames.length - 1), at.x + 20, at.y + 28);
      }
      continue;
    }
    if (isMine(sprite.anim) && !view.localPlayerIds.includes(sprite.owner)) continue;
    const owner = state.players.find((p) => p.id === sprite.owner) ?? state.players[0];
    const sheet = owner && assets.characters.get(owner.character)?.bomb;
    const anim = sheet?.meta.animations[sprite.anim];
    if (!sheet || !anim) continue;
    const at = playAreaPos(assets, sprite.x, sprite.y);
    drawFrame(ctx, sheet, anim, Math.min(sprite.frame, anim.frames.length - 1), at.x, at.y);
  }
}

function bodyAnim(assets: SceneAssets, player: PlayerState): { sheet: Sheet; anim: AnimationMeta; frame: number } | null {
  const sheet = assets.characters.get(player.character)?.body;
  const anim = sheet?.meta.animations[player.anim];
  if (!sheet || !anim) return null;
  return { sheet, anim, frame: Math.min(player.frame, anim.frames.length - 1) };
}

/** An invisible player that is drawn at all (the local one) goes through the (dst | src) >> 1 blend (0x462c70). */
function drawPlayer(ctx: CanvasRenderingContext2D, assets: SceneAssets, player: PlayerState): void {
  if (player.gone) return;
  const body = bodyAnim(assets, player);
  if (!body) return;
  const at = screenPos(assets, player);
  const draw = player.status.invisible === null ? drawFrame : drawFrameOrHalf;
  draw(ctx, body.sheet, body.anim, body.frame, at.x, at.y);
}

function isMine(anim: number): boolean {
  return anim === BombKind.Mine || anim === BombKind.Mine + 1;
}

/** Own items (0x4430a0): 22x22 icons with a small count. */
function drawItemGrid(ctx: CanvasRenderingContext2D, assets: SceneAssets, player: PlayerState, practice: boolean): void {
  for (const cell of itemGrid(player, practice)) {
    blit(ctx, assets.hud.item, itemIconRect(cell.icon), cell.x, cell.y);
    for (const glyph of countBlits(cell)) blit(ctx, assets.hud.mark, glyph.src, glyph.x, glyph.y);
  }
}

/** The top of the body frame: the player's y less the frame's anchor (0x40d5a0). */
function headTop(assets: SceneAssets, player: PlayerState): { x: number; y: number } | null {
  const body = bodyAnim(assets, player);
  if (!body) return null;
  const at = screenPos(assets, player);
  return { x: at.x, y: at.y - (body.anim.frames[body.frame]?.anchor[1] ?? 0) };
}

/** The diff1 "me" (0x40bc6a) or diff2 teammate (0x40aa3a) arrow, 8 px above the top of the body frame. */
function drawMarker(ctx: CanvasRenderingContext2D, assets: SceneAssets, sheet: Sheet, state: MatchState, player: PlayerState): void {
  const top = headTop(assets, player);
  if (!top) return;
  const anim = sheet.meta.animations[0];
  drawFrame(ctx, sheet, anim, timedFrame(state.tick, anim.unknown_u16, anim.frames.length), top.x, top.y - 8);
}

/**
 * Dizzy stars (bad_state.spr, +0x2a8) anchored on the top of the body frame: after the body for
 * other players, even an invisible one (0x40ac62); after the item grid for the local player
 * (0x40bc26). One shared sprite object, so every player's stars blink together.
 */
function drawBadState(ctx: CanvasRenderingContext2D, assets: SceneAssets, state: MatchState, player: PlayerState): void {
  if (player.gone || !player.badState) return;
  const top = headTop(assets, player);
  if (!top) return;
  const anim = assets.badState.meta.animations[0];
  drawFrame(ctx, assets.badState, anim, timedFrame(state.tick, anim.unknown_u16, anim.frames.length), top.x, top.y);
}

/**
 * The effect list (0x40bdfd), after the candy box: a burrow's dust and the egg of a shield, each
 * with the frame it had before this update advanced it. Blend levels 1 and 4 both come out as
 * the per-channel maximum (0x404020), so the black backgrounds vanish.
 */
function drawEffects(ctx: CanvasRenderingContext2D, assets: SceneAssets, state: MatchState): void {
  ctx.save();
  ctx.globalCompositeOperation = "lighten";
  for (const sprite of state.effectSprites) {
    const sheet = assets.effects[sprite.kind];
    const anim = sheet.meta.animations[0];
    const at = playAreaPos(assets, sprite.x, sprite.y);
    drawFrame(ctx, sheet, anim, Math.min(sprite.frame, anim.frames.length - 1), at.x, at.y);
  }
  ctx.restore();
}

/**
 * Candy box (0x40bc82), alpha 70: (dst·70 + src·186) >> 8, and the candy count in "Courier New" 15
 * (굴림 15 by the font mapper) right-aligned by digit count. The original adds the local player's
 * pickups (0x410827) to the account's total; there are no accounts here, so it counts this match's
 * pickups from 0.
 */
function drawCandy(ctx: CanvasRenderingContext2D, assets: SceneAssets, count: number): void {
  blitBlended(ctx, assets.hud.candy, CANDY_POS.x, CANDY_POS.y, CANDY_WEIGHT);
  const text = String(count);
  outlinedText(ctx, text, candyCountX(text.length), CANDY_COUNT.y, YELLOW, FONT_COURIER_15);
}

/** Right panel (0x40f9a0) per room slot: SP label, two bars, medals, guild, rank and name. */
function drawPanel(ctx: CanvasRenderingContext2D, assets: SceneAssets, state: MatchState, bars: RenderView["bars"]): void {
  const { mark, guild } = assets.hud;
  const teams = isTeamMode(state.rules.mode);
  for (const player of state.players) {
    // The name in the team's colour in the team modes (0x404206, 0x40fb04), with its black outline.
    const nameColor = teams ? teamColor(player.team) : "#ffffff";
    const y0 = panelTop(player.slot);
    blit(ctx, mark, PANEL.spLabel.src, PANEL.spLabel.x, y0 + PANEL.spLabel.dy);
    // Bars A (0x4432e0: frames per second) and B (0x4433c0: ping), up from the bottom block. Two
    // players on one keyboard have none to show, so theirs stay at the world load's 30 and 0.
    const bar = bars?.get(player.id) ?? START_BARS;
    const a = fpsBlocks(bar.fps);
    for (let i = 0; i < a.count; i++) {
      blit(ctx, mark, a.yellow ? BAR_BLOCKS.yellow : BAR_BLOCKS.red, PANEL.barX[0], y0 + PANEL.barBottomDy - 4 * i);
    }
    const b = pingBlocks(bar.ping);
    for (let i = 0; i < b.count; i++) {
      blit(ctx, mark, b.green ? BAR_BLOCKS.green : BAR_BLOCKS.red, PANEL.barX[1], y0 + PANEL.barBottomDy - 4 * i);
    }
    for (let k = 0; k < player.medals; k++) {
      blit(ctx, mark, PANEL.medal.src, PANEL.medal.x + PANEL.medal.step * k, y0 + PANEL.medal.dy);
    }
    blit(ctx, guild, guildRect(0), PANEL.guild.x, y0 + PANEL.guild.dy);
    blit(ctx, mark, rankRect(1), PANEL.rank.x, y0 + PANEL.rank.dy);
    outlinedText(ctx, player.name, PANEL.name.x, y0 + PANEL.name.dy, nameColor, FONT_12);
  }
}

/**
 * Panel faces (0x40c079), one per slot at (688, 44 + 63·slot). A network death hides the face
 * with its player (0x444854, 0x45eae3); practice never hides one, so a gone dummy stays grey.
 */
function drawFaces(ctx: CanvasRenderingContext2D, assets: SceneAssets, state: MatchState, view: RenderView): void {
  const now = nowMs(state.tick);
  const { practice } = state.rules;
  for (const player of state.players) {
    if (player.gone && !practice) continue;
    const sheet = assets.characters.get(player.character)?.face;
    if (!sheet) continue;
    const deadAnim = practice && view.localPlayerIds.includes(player.id) ? 1 : 0;
    const face = view.faces.update(player, sheet, now, deadAnim);
    drawFrame(ctx, sheet, sheet.meta.animations[face.anim], face.frame, PANEL.faceX, panelTop(player.slot));
  }
}

/** The bottom message (0x4142d0 via 0x40c211), network only. */
function drawBottomBar(ctx: CanvasRenderingContext2D): void {
  outlinedText(ctx, BOTTOM_MESSAGE.text, BOTTOM_MESSAGE.x, BOTTOM_MESSAGE.y, YELLOW, FONT_12);
}

/**
 * Name tags centred at (x, y + 5) under each player, only for this remake's two players on one
 * keyboard, who have no diff1 marker. The original's game screen draws no name under players:
 * its only text calls there are the candy count, notices and the bottom message.
 */
function drawNameTags(ctx: CanvasRenderingContext2D, assets: SceneAssets, state: MatchState): void {
  for (const player of state.players) {
    if (player.gone) continue;
    const at = screenPos(assets, player);
    outlinedText(ctx, player.name, at.x, at.y + 5, "#ffffff", FONT_12, "center");
  }
}

/** HURRY UP (0x40c7b0) for 3000 ms; its 5 fps frames alternate with a 4x4 dummy, so it blinks. */
function drawHurry(ctx: CanvasRenderingContext2D, assets: SceneAssets, state: MatchState, hurryTick: number | null): void {
  if (hurryTick === null || nowMs(state.tick) - nowMs(hurryTick) >= HURRY_MS) return;
  const anim = assets.hurry.meta.animations[0];
  drawFrame(ctx, assets.hurry, anim, timedFrame(state.tick - hurryTick, anim.unknown_u16, anim.frames.length), HURRY_POS.x, HURRY_POS.y);
}

/**
 * Panel face animation (W_character). Faces are rebuilt with each round's map (0x44de9b; practice
 * 0x4548bc) on anim 1. Each game frame draws a face, advances it (0x4620e0), then, while it is on
 * frame 0 of any anim but 0, picks rand % count (0 becomes 1). setState resets only the frame
 * (the face's draw type +0x16c is 6), so the pick repeats every frame until frame 1 is due
 * (0x40c0f4-0x40c14c; practice 0x408a23-0x408b19). Death sets anim 0, the grey face, which is
 * never re-picked.
 */
export class PanelFaces {
  private readonly faces = new Map<number, Face>();
  private readonly random: () => number;

  constructor(random: () => number = Math.random) {
    this.random = random;
  }

  /** A new round rebuilds the faces. */
  reset(): void {
    this.faces.clear();
  }

  /**
   * The face to draw for game time `now`; repeated calls in one game frame draw the same face.
   * `deadAnim` is the anim death sets: 0, except 1 for practice's own player (0x408304), whose
   * face keeps idling.
   */
  update(player: PlayerState, sheet: Sheet, now: number, deadAnim = 0): { anim: number; frame: number } {
    let face = this.faces.get(player.id);
    if (!face) {
      face = { anim: 1, frame: 0, lastMs: -Infinity, alive: true, drawnAt: Number.NaN, drawn: { anim: 1, frame: 0 } };
      this.faces.set(player.id, face);
    }
    if (face.drawnAt === now) return face.drawn;
    if (player.alive !== face.alive) {
      face.alive = player.alive;
      face.anim = player.alive ? 1 : deadAnim;
      face.frame = 0;
    }
    face.drawnAt = now;
    face.drawn = { anim: face.anim, frame: face.frame };
    const anim = sheet.meta.animations[face.anim];
    if (animDue(now, face.lastMs, anim.unknown_u16)) {
      face.lastMs = now;
      face.frame = face.frame + 1 >= anim.frames.length ? 0 : face.frame + 1;
    }
    if (face.anim !== 0 && face.frame === 0) face.anim = Math.floor(this.random() * sheet.meta.animations.length) || 1;
    return face.drawn;
  }
}

interface Face {
  anim: number;
  frame: number;
  lastMs: number;
  alive: boolean;
  drawnAt: number;
  drawn: { anim: number; frame: number };
}
