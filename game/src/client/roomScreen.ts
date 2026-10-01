// The waiting room (scene 7, "GAME ROOM") on a canvas, from the original's art and layout. It is
// a mouse screen like the original; the page's controls under it (online.ts) stay as the keyboard
// and screen reader path. Geometry and rules: roomLayout.ts and original/FIDELITY.md §13.
import type { Rect } from "../assets/types.ts";
import { chatLine as sendableChat, RANDOM_MAP, shownName } from "../server/protocol.ts";
import type { ClientMessage, LobbyPlayer, RoomInfo } from "../server/protocol.ts";
import { hasItem, ITEM_KICK, ITEM_MASK, ITEM_WHISPER } from "../server/items.ts";
import { animDue } from "../sim/constants.ts";
import { isTeamMode, MODE_NAMES } from "../sim/modes.ts";
import type { GameMode } from "../sim/types.ts";
import type { Sheet } from "./assets.ts";
import { loadImage, loadImageSheet } from "./assets.ts";
import type { SoundBank } from "./audio.ts";
import { CaretBlink, chatRecall, commandCycle } from "./chat.ts";
import { ChatLine } from "./chatLine.ts";
import { drawBadge } from "./badge.ts";
import { INSTALLED_VERSION, VERSION_TEXT } from "./hudLayout.ts";
import { MESSAGE_BOX, MESSAGE_HELP, messageLines } from "./lobbyLayout.ts";
import type { BoxImages, PracticeBox } from "./practiceBox.ts";
import { boxClick, boxKey, boxKeyCursor, boxPointer, drawPracticeBox, openBox } from "./practiceBox.ts";
import { macroOpens, macroSlot } from "./macro.ts";
import { MENU_SOUNDS } from "./presentation.ts";
import type { SettingsStore } from "./settings.ts";
import { attachCapture } from "./screenCapture.ts";
import type { Button, ListKind, SlotIcon } from "./roomLayout.ts";
import {
  CHAT_INPUT,
  CHAT_LOG,
  ChatScroll,
  DROPDOWN_COLOURS,
  dropdownPanel,
  dropdownRowAt,
  dropdownTextAt,
  endsBusy,
  EXIT,
  helpAt,
  inside,
  KICKED_TEXT,
  LISTS,
  MAP_NAME_AT,
  MAP_PREVIEW_AT,
  mapPreviewRect,
  MODE_NAME_AT,
  MUSIC_NAME_AT,
  NOTICE,
  OUTLINE,
  ROOM_EDITOR_LIMIT,
  ROOM_NUMBER_AT,
  ROOM_TITLE_AT,
  ROOM_ITEM_ICONS,
  roomNumberText,
  SCROLL_DOWN,
  SCROLL_TRACK,
  SCROLL_UP,
  SHOP,
  shownMapName,
  SLOT_ART,
  SLOT_ICONS,
  SLOT_ORIGINS,
  slotAt,
  slotIconAt,
  START,
  stepList,
  TEAM_BUTTONS,
  TEAM_ROW,
  teamAt,
  teamPanelRect,
  THUMB,
  wrapChat,
} from "./roomLayout.ts";
import type { NoticeLine } from "./noticeLine.ts";
import { portraitSheetName } from "./scene.ts";
import { CursorAnim, drawBalloon, drawCaret, drawChatLines, drawHelpScreen, drawThumb, Pointer } from "./screenKit.ts";
import { blit } from "./sprite.ts";
import { FONT_12, FONT_13, FONT_COURIER_15, outlinedText, plainText, YELLOW } from "./text.ts";
import { loadTintedSheet } from "./tintArt.ts";

export interface RoomScreenAssets {
  background: HTMLImageElement;
  object1: HTMLImageElement;
  object2: HTMLImageElement;
  button: HTMLImageElement;
  mapimage: HTMLImageElement;
  guild: HTMLImageElement;
  mark: HTMLImageElement;
  cursor: Sheet;
  box: BoxImages;
  /** shake_help: the F1 help screen. */
  help: HTMLImageElement;
  /** images2: the message box (MSGBOX 0x443770), the lobby's. */
  messageBox: HTMLImageElement;
}

export async function loadRoomAssets(): Promise<RoomScreenAssets> {
  const image = (name: string) => loadImage(`image/${name}.png`);
  const [background, object1, object2, button, mapimage, guild, mark, cursor, panel, quitBox, buttons, help, messageBox] = await Promise.all([
    image("new_readyroom"),
    image("new_pReadyobject1"),
    image("new_pReadyobject2"),
    image("new_button"),
    image("mapimage"),
    image("guild"),
    image("mark"),
    loadImageSheet("cursor"),
    image("images"),
    image("new_messagebox"),
    image("new_button2"),
    image("shake_help"),
    image("images2"),
  ]);
  return { background, object1, object2, button, mapimage, guild, mark, cursor, box: { panel, messageBox: quitBox, buttons }, help, messageBox };
}

export interface RoomScreenOptions {
  canvas: HTMLCanvasElement;
  /** The canvas's positioned parent, for the chat line's hidden input. */
  stage: HTMLElement;
  assets: RoomScreenAssets;
  playerId: number;
  /** The server's lists, RANDOM left out. */
  maps: readonly { id: string; title: string }[];
  music: readonly string[];
  sounds: SoundBank;
  /** The option object: the balloons (PHELP) and F2..F10's macros. */
  settings: SettingsStore;
  send(message: ClientMessage): void;
  /** A chat line to send; the session drops repeats and lines too soon, like 0x43f7a0. */
  say(text: string): void;
  /** The EXIT box's YES (C->S 0x05). */
  leave(): void;
  /** The kick notice's button or Esc (0x4588f3, 0x461686): the lobby. */
  kickedOut(): void;
  /** Two players on one PC only: a seated player's slot clicked picks their next character (R). */
  pickCharacter?(slot: number): void;
  /** The account's items (0x45f140), which light the slot and bottom icons; none without an account. */
  items?(): readonly number[];
  /** The session's notice line (52,515); the local room has none. */
  notice?: NoticeLine;
  /** A slot's whisper icon ([0x4927c8]): that ID gets every later chat line as a whisper too. */
  whisperTo?(id: string): void;
}

/** The overlays that stop the hover and pressed art, the caret and the dropdowns (0x426d10). */
type Overlay = { kind: "box"; box: PracticeBox; hover: 0 | 1 | 2 } | { kind: "dropdown"; list: ListKind; row: number } | null;

export class RoomScreen {
  private readonly options: RoomScreenOptions;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly chat: ChatLine;
  private readonly scroll = new ChatScroll();
  private readonly caret = new CaretBlink();
  private readonly startBlink = new CaretBlink();
  /** The slots' `_p.spr`, by character and hue (portraitKey). */
  private readonly portraits = new Map<string, Sheet | null>();
  private readonly faces = new Map<number, { frame: number; lastMs: number }>();
  private room: RoomInfo;
  private log: string[] = [];
  private readonly pointer = new Pointer();
  private overlay: Overlay = null;
  /** The F1 help screen ([0x492856]). */
  private helpScreen = false;
  /** The message box with "강퇴 당했습니다." is up; scene 7 never lets it close by itself (0x443786). */
  private kicked = false;
  private readonly cursor = new CursorAnim();
  private frame = 0;
  private stopped = false;
  private readonly detach: () => void;
  /** Tells a screen reader what the canvas alone shows: the EXIT box. */
  private readonly status = document.createElement("p");

  constructor(options: RoomScreenOptions, room: RoomInfo) {
    this.options = options;
    this.room = room;
    const ctx = options.canvas.getContext("2d");
    if (!ctx) throw new Error("canvas 2d context unavailable");
    this.ctx = ctx;
    this.status.className = "sr-only";
    this.status.setAttribute("role", "status");
    options.stage.append(this.status);
    this.chat = new ChatLine(options.stage, { limit: ROOM_EDITOR_LIMIT, at: CHAT_INPUT, trapFocus: false });
    // Entering the room opens the chat (0x425510).
    this.chat.open();
    this.detach = this.attach();
    this.loadPortraits();
    const draw = () => {
      if (this.stopped) return;
      this.holdFrame();
      this.render(performance.now());
      this.frame = requestAnimationFrame(draw);
    };
    this.frame = requestAnimationFrame(draw);
  }

  update(room: RoomInfo): void {
    if (endsBusy(this.room, room)) this.cursor.set(false);
    this.room = room;
    this.loadPortraits();
  }

  /** The server turned a request down; for a slot that is the original's failed S->C 0x45, which ends the wait too. */
  refused(): void {
    if (this.cursor.busy) this.cursor.set(false);
  }

  /** /ban went out (0x4465ae): the busy cursor until S->C 0x44. */
  waitForKick(): void {
    this.cursor.set(true);
  }

  /** S->C 0x44 for the own slot (0x44a1c8): the EXIT box goes and the message box stays up. */
  showKicked(): void {
    if (this.overlay?.kind === "box") this.overlay = null;
    this.kicked = true;
    this.status.textContent = `${KICKED_TEXT} 확인 단추나 Esc로 로비에 갑니다.`;
  }

  /** The log as the session keeps it; each line is wrapped at 70 bytes when it is added. */
  setLog(lines: readonly string[]): void {
    this.log = lines.flatMap(wrapChat);
  }

  addLine(line: string): void {
    this.log.push(...wrapChat(line));
  }

  dispose(): void {
    this.stopped = true;
    cancelAnimationFrame(this.frame);
    this.chat.dispose();
    this.status.remove();
    this.detach();
  }

  // State

  /** The help screen, the EXIT box, a dropdown or the kick's box: a release reaches none of the room's controls. */
  get dropsClicks(): boolean {
    return this.helpScreen || this.kicked || this.overlay !== null;
  }

  /** The EXIT box: every key is its own (0x460097), so the chat line sends nothing under it. */
  get boxUp(): boolean {
    return this.overlay?.kind === "box";
  }

  private get me(): LobbyPlayer | undefined {
    return this.room.players.find((p) => p.id === this.options.playerId);
  }

  private get isHost(): boolean {
    return this.room.hostId === this.options.playerId;
  }

  private playerAt(slot: number): LobbyPlayer | undefined {
    return this.room.players.find((p) => p.slot === slot);
  }

  private listIndex(kind: ListKind): number {
    if (kind === "map") {
      const i = this.options.maps.findIndex((m) => m.id === this.room.mapId);
      return i < 0 ? 0 : i + 1;
    }
    return kind === "music" ? this.room.music : this.room.mode;
  }

  private listEntries(kind: ListKind): string[] {
    if (kind === "map") return [RANDOM_MAP, ...this.options.maps.map((m) => shownMapName(m.title))];
    if (kind === "music") return [RANDOM_MAP, ...this.options.music];
    return [...MODE_NAMES];
  }

  private choose(kind: ListKind, index: number): void {
    if (kind === "map") this.options.send({ type: "set-map", mapId: index === 0 ? RANDOM_MAP : this.options.maps[index - 1].id });
    else if (kind === "music") this.options.send({ type: "set-music", music: index });
    else this.options.send({ type: "set-mode", mode: index as GameMode });
  }

  /** SELECTTEAM sends only when the player is not ready, and the host only while someone else is not (0x428108). */
  private mayChangeTeam(): boolean {
    const me = this.me;
    if (!me || me.ready || !isTeamMode(this.room.mode)) return false;
    return !this.isHost || this.room.players.some((p) => p.id !== me.id && !p.ready);
  }

  /** Each slot's portrait turned by its hue as it is read (0x4406db: 0x413d30 with the slot's +0x90). */
  private loadPortraits(): void {
    for (const player of this.room.players) {
      const key = portraitKey(player);
      if (this.portraits.has(key)) continue;
      this.portraits.set(key, null);
      loadTintedSheet("character", portraitSheetName(player.character), player.hue).then(
        (sheet) => this.portraits.set(key, sheet),
        () => undefined,
      );
    }
  }

  // Input

  private attach(): () => void {
    const detachPointer = this.pointer.attach(this.options.canvas, {
      moved: () => this.pointerMoved(),
      released: (x, y) => this.release(x, y),
    });
    const onKey = (event: KeyboardEvent) => this.key(event);
    window.addEventListener("keydown", onKey);
    // F12 goes unread with the EXIT box up, as every key does (0x460097).
    const detachCapture = attachCapture(this.options.canvas, () => this.overlay?.kind === "box");
    return () => {
      detachPointer();
      detachCapture();
      window.removeEventListener("keydown", onKey);
    };
  }

  private pointerMoved(): void {
    const overlay = this.overlay;
    if (overlay?.kind === "box") overlay.hover = boxPointer(overlay.box, this.pointer.mouse.x, this.pointer.mouse.y);
    else if (overlay?.kind === "dropdown") {
      overlay.row = dropdownRowAt(overlay.list, this.listEntries(overlay.list).length, this.pointer.mouse.x, this.pointer.mouse.y);
    }
  }

  /** Each frame the button is held (0x458fbe): a host's press on a name strip opens its dropdown, the track drags. */
  private holdFrame(): void {
    // While the help screen shows, the mouse is dropped every frame (0x458750).
    if (this.helpScreen) this.pointer.held = null;
    const held = this.pointer.held;
    // The box and the message box stop the drag too (0x427e90).
    if (!held || this.overlay || this.kicked) return;
    if (this.isHost) {
      const list = (Object.keys(LISTS) as ListKind[]).find((kind) => inside(LISTS[kind].strip, held.x, held.y));
      if (list) {
        // 0x4286c0 closes the chat line; closing the dropdown opens it again, empty (0x4286d0).
        this.chat.close();
        this.overlay = { kind: "dropdown", list, row: -1 };
        return;
      }
    }
    if (inside(SCROLL_TRACK, held.x, held.y)) this.scroll.hold(this.log.length, held.y);
    else this.scroll.dragging = false;
  }

  /** A release (0x45a412), in the original's order. */
  private release(x: number, y: number): void {
    if (this.helpScreen) return;
    if (this.kicked) {
      // The message box takes every release (0x4587ee); on its button, off to the lobby (0x4588f3).
      this.scroll.release();
      if (inside(MESSAGE_BOX.button.hit, x, y)) this.options.kickedOut();
      return;
    }
    const count = this.log.length;
    const overlay = this.overlay;
    const { send, sounds } = this.options;
    if (overlay?.kind === "box") {
      const result = boxClick(overlay.box, x, y);
      if (result) {
        // A click on the box's buttons sounds menu2 (0x4589a9); its keys are silent.
        sounds.play(MENU_SOUNDS.primary);
        this.answerBox(result === "exit");
      }
      this.scroll.release();
      return;
    }
    if (overlay?.kind === "dropdown") {
      const row = dropdownRowAt(overlay.list, this.listEntries(overlay.list).length, x, y);
      if (row >= 0) this.choose(overlay.list, row);
      this.closeDropdown();
      this.scroll.release();
      return;
    }
    this.scroll.release();
    const me = this.me;
    // The 2인 대전 room picks either seated player's character, 1P's own slot too (R).
    const slot = slotAt(x, y, this.options.pickCharacter ? -1 : (me?.slot ?? -1));
    if (slot >= 0) {
      if (this.isHost && !this.playerAt(slot)) {
        send({ type: "set-slot", slot, open: this.room.closed[slot] });
        // 0x45a591: the busy cursor until a reply; the mouse and keys still work.
        this.cursor.set(true);
      } else {
        const player = this.playerAt(slot);
        if (!player) return;
        // 0x428b40 then the item's gate (0x45a5c3); the 2P pick (R) takes the rest of the slot.
        const icon = slotIconAt(slot, x, y);
        if (icon && this.iconLit(icon)) this.useSlotIcon(icon, player);
        else this.options.pickCharacter?.(slot);
      }
      return;
    }
    if (inside(EXIT.hit, x, y)) {
      sounds.play(MENU_SOUNDS.primary);
      this.openExitBox();
      return;
    }
    if (inside(START.hit, x, y)) {
      if (this.isHost) send({ type: "start" });
      else if (me) send({ type: "set-ready", ready: !me.ready });
      return;
    }
    if (inside(SCROLL_UP.hit, x, y)) this.scroll.up(count);
    else if (inside(SCROLL_DOWN.hit, x, y)) this.scroll.down(count);
    else if (inside(SCROLL_TRACK, x, y)) this.scroll.trackClick(count, y);
    const team = teamAt(x, y);
    if (team && this.mayChangeTeam()) send({ type: "set-team", team });
    if (!this.isHost) return;
    for (const kind of Object.keys(LISTS) as ListKind[]) {
      const { prev, next } = LISTS[kind];
      const dir = inside(prev.hit, x, y) ? -1 : inside(next.hit, x, y) ? 1 : 0;
      if (dir !== 0) this.choose(kind, stepList(kind, this.listIndex(kind), this.listEntries(kind).length - 1, dir));
    }
  }

  /** Whether the local account's items light a slot icon: the kick only for the host (0x425560). */
  private iconLit(icon: SlotIcon): boolean {
    const items = this.options.items?.() ?? [];
    if (icon === "kick") return this.isHost && hasItem(items, ITEM_KICK);
    return hasItem(items, icon === "mask" ? ITEM_MASK : ITEM_WHISPER);
  }

  /**
   * A lit icon on another's slot (0x45a5c3): the kick is C->S 0x44 with the busy cursor, as /ban;
   * the whisper icon makes that ID the whisper target. The mask's C->S 0x5e is not sent: its server
   * rule is lost and was not in service then (R).
   */
  private useSlotIcon(icon: SlotIcon, player: LobbyPlayer): void {
    if (icon === "kick") {
      this.options.send({ type: "kick", slot: player.slot });
      this.cursor.set(true);
    } else if (icon === "whisper") {
      this.options.whisperTo?.(player.name);
      this.status.textContent = `귓말 대상: ${player.name}. 이제 채팅 줄이 ${player.name}에게 귓말로도 갑니다.`;
    } else {
      this.status.textContent = "마스크는 지원하지 않습니다.";
    }
  }

  /** The page's mirror of a slot icon: a release in the middle of it, with the canvas's gates. */
  slotIcon(slot: number, icon: SlotIcon): void {
    const { x, y } = SLOT_ORIGINS[slot];
    const [from, to] = SLOT_ICONS[icon].hit;
    this.release(x + Math.floor((from + to) / 2), y + 54);
  }

  /** 0x4286d0: the dropdown closes and the chat line opens again, empty. */
  private closeDropdown(): void {
    this.overlay = null;
    this.chat.open();
  }

  private openExitBox(): void {
    this.overlay = { kind: "box", box: openBox("esc"), hover: 0 };
    this.status.textContent = "종료하시겠습니까? Y는 예, N은 아니오. ←·→로 고르고 Enter로 정할 수도 있습니다(처음 선택은 예).";
  }

  private answerBox(leave: boolean): void {
    this.overlay = null;
    this.status.textContent = "";
    if (leave) this.options.leave();
  }

  /** Keys (0x45fa70): Enter sends, Esc asks to leave, F1 shows the help screen, Up recalls the last line, Down cycles the commands. */
  private key(event: KeyboardEvent): void {
    const active = document.activeElement;
    const ours = active === this.chat.element || active === this.options.canvas || active === document.body || active === null;
    // Tab always moves on to the page's controls, which do everything the canvas does.
    if (!ours || event.key === "Tab") return;
    const overlay = this.overlay;
    const slot = macroSlot(event.code);
    if (slot !== null) {
      // 0x461a50: the macro goes into a fresh chat line unless the list is open; the box takes F2..F9 first.
      event.preventDefault();
      if (macroOpens(slot, { box: overlay?.kind === "box", blocked: overlay?.kind === "dropdown" })) {
        this.chat.open();
        this.chat.text = this.options.settings.current.macros[slot];
        return;
      }
      if (overlay?.kind !== "box") return;
    }
    if (overlay?.kind === "box") {
      event.preventDefault();
      this.helpScreen = false;
      const result = boxKey(overlay.box, event.key);
      overlay.hover = boxKeyCursor(overlay.box);
      if (result) this.answerBox(result === "exit");
      return;
    }
    if (event.code === "F1") {
      event.preventDefault();
      if (!this.helpScreen && overlay?.kind === "dropdown") this.closeDropdown();
      this.helpScreen = !this.helpScreen;
      return;
    }
    if (event.code === "Escape") {
      event.preventDefault();
      // Esc turns the help screen off first (0x46159f), then takes the message box (0x461681).
      if (this.helpScreen) this.helpScreen = false;
      else if (this.kicked) this.options.kickedOut();
      else if (!overlay) this.openExitBox();
      return;
    }
    const dropdown = overlay?.kind === "dropdown";
    if (dropdown && !this.chat.isOpen && (event.key === "ArrowUp" || event.key === "ArrowDown")) {
      // The room's closed line (0x4600ff, 0x4601d1): Up and Down open it with the last line or the
      // command, and the list stays open.
      event.preventDefault();
      this.chat.open();
      this.chat.text = event.key === "ArrowUp" ? chatRecall.line : commandCycle.current();
      return;
    }
    // A line opened over the list takes Enter, Up and Down as the open line does (0x45fb47, 0x460161).
    if (overlay && !(dropdown && this.chat.isOpen)) return;
    if (event.key === "Enter" && active === this.chat.element) {
      event.preventDefault();
      const text = this.chat.close();
      // Over the list the line stays closed until the list closes and opens it (0x45fb7e, 0x4286d0).
      if (!dropdown) this.chat.open();
      if (sendableChat(text) !== null) {
        chatRecall.line = text;
        this.options.say(text);
      }
      return;
    }
    if (event.key === "ArrowUp" && active === this.chat.element) {
      event.preventDefault();
      this.chat.text = chatRecall.line;
      return;
    }
    if (event.key === "ArrowDown" && active === this.chat.element) {
      event.preventDefault();
      this.chat.text = commandCycle.next();
      return;
    }
    // Any other key goes to the chat line (0x418cd0), which the page may have taken the focus from.
    if (active !== this.chat.element && event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      this.chat.focus();
    }
  }

  // Drawing (0x425560)

  private render(now: number): void {
    const { ctx } = this;
    const { assets } = this.options;
    ctx.imageSmoothingEnabled = false;
    if (this.helpScreen) {
      // 0x40ca70: the help screen instead of the room; the message box still shows over it.
      drawHelpScreen(ctx, assets.help);
      this.drawMessage();
      this.drawCursor(now);
      return;
    }
    ctx.drawImage(assets.background, 0, 0);
    outlinedText(ctx, roomNumberText(this.room.number), ROOM_NUMBER_AT.x, ROOM_NUMBER_AT.y, "#ffffff", FONT_COURIER_15, "left", OUTLINE.blue);
    outlinedText(ctx, this.room.title, ROOM_TITLE_AT.x, ROOM_TITLE_AT.y, "#ffffff", FONT_COURIER_15, "left", OUTLINE.blue);
    const items = this.options.items?.() ?? [];
    if (hasItem(items, ITEM_MASK)) this.button(ROOM_ITEM_ICONS.mask.lit, ROOM_ITEM_ICONS.mask.at);
    if (hasItem(items, ITEM_WHISPER)) this.button(ROOM_ITEM_ICONS.whisper.lit, ROOM_ITEM_ICONS.whisper.at);
    for (let slot = 0; slot < SLOT_ORIGINS.length; slot++) this.drawSlot(slot, now);
    const me = this.me;
    if (this.startBlink.shown(now) && me && (this.isHost || !me.ready)) this.button(START.blink, START.at);
    this.drawLists();
    if (isTeamMode(this.room.mode)) {
      for (const b of TEAM_BUTTONS) this.button([b.src[0], TEAM_ROW.src, b.src[1], TEAM_ROW.src + TEAM_ROW.height], { x: b.x, y: TEAM_ROW.y });
    }
    this.drawChat(now);
    this.options.notice?.draw(ctx, now, NOTICE);
    // Both the EXIT box and the message box stop the hover art and the balloons (0x425ef8, 0x426586).
    if (!this.overlay && !this.kicked) this.drawHoverArt();
    if (!this.overlay && !this.kicked) this.drawHelp();
    if (this.overlay?.kind === "dropdown") this.drawDropdown(this.overlay.list, this.overlay.row);
    outlinedText(ctx, `ver. ${INSTALLED_VERSION}`, VERSION_TEXT.x, VERSION_TEXT.y, YELLOW, FONT_13);
    if (this.overlay?.kind === "box") drawPracticeBox(ctx, assets.box, this.overlay.box, this.overlay.hover, this.pointer.held !== null);
    // The frame's tail (0x40cd56): the message box over everything, the cursor again over it.
    this.drawMessage();
    this.drawCursor(now);
  }

  /** MSGBOX (0x443770): images2, the line, the button's pressed art and its own balloon. */
  private drawMessage(): void {
    if (!this.kicked) return;
    const { ctx } = this;
    blit(ctx, this.options.assets.messageBox, MESSAGE_BOX.src, MESSAGE_BOX.at.x, MESSAGE_BOX.at.y);
    for (const line of messageLines(KICKED_TEXT)) {
      outlinedText(ctx, line.text, line.x, line.y, MESSAGE_BOX.colour, FONT_12, "left", MESSAGE_BOX.outline);
    }
    const button = MESSAGE_BOX.button;
    const held = this.pointer.held;
    if (held && inside(button.hit, held.x, held.y)) this.button(button.pressed, button.at);
    const { x, y } = this.pointer.mouse;
    if (this.options.settings.current.balloons && this.pointer.inside && inside(button.hit, x, y)) drawBalloon(ctx, MESSAGE_HELP, x, y);
  }

  private button(src: Rect, at: { x: number; y: number }): void {
    blit(this.ctx, this.options.assets.button, src, at.x, at.y);
  }

  private drawSlot(slot: number, now: number): void {
    const { ctx } = this;
    const { assets } = this.options;
    const { x, y } = SLOT_ORIGINS[slot];
    const player = this.playerAt(slot);
    if (!player) {
      if (this.room.closed[slot]) blit(ctx, assets.object1, SLOT_ART.closed, x, y);
      return;
    }
    blit(ctx, assets.object1, SLOT_ART.panel, x, y);
    if (isTeamMode(this.room.mode)) blit(ctx, assets.object1, teamPanelRect(player.team), x + SLOT_ART.teamPanel.x, y + SLOT_ART.teamPanel.y);
    const host = player.id === this.room.hostId;
    if (host || player.ready) blit(ctx, assets.object1, host ? SLOT_ART.host : SLOT_ART.ready, x + SLOT_ART.square.x, y + SLOT_ART.square.y);
    // The ID or the nick, as the slot's +0x68 says (0x425560).
    outlinedText(ctx, shownName(player), x + SLOT_ART.name.x, y + SLOT_ART.name.y, "#ffffff", FONT_12, "left", OUTLINE.name);
    this.drawPortrait(player, x + SLOT_ART.portrait.x, y + SLOT_ART.portrait.y, now);
    // No gender icon: every remake account's is 0.
    drawBadge(ctx, assets, player.badge, { x: x + SLOT_ART.guild.x, y: y + SLOT_ART.guild.y }, { x: x + SLOT_ART.rank.x, y: y + SLOT_ART.rank.y });
    for (const icon of ["kick", "mask", "whisper"] as const) {
      if (this.iconLit(icon)) this.button(SLOT_ICONS[icon].lit, { x: x + SLOT_ICONS[icon].at.x, y: y + SLOT_ICONS[icon].at.y });
    }
    outlinedText(ctx, "100", x + SLOT_ART.points.x, y + SLOT_ART.points.y, "#ffffff", FONT_13);
  }

  /** `<character>_p.spr` with the slot's hue from its top-left, frames 0,1,2,1 at 5 fps. */
  private drawPortrait(player: LobbyPlayer, x: number, y: number, now: number): void {
    const sheet = this.portraits.get(portraitKey(player));
    const anim = sheet?.meta.animations[0];
    if (!sheet || !anim || anim.frames.length === 0) return;
    let face = this.faces.get(player.id);
    if (!face) {
      face = { frame: 0, lastMs: now };
      this.faces.set(player.id, face);
    } else if (animDue(now, face.lastMs, anim.unknown_u16)) {
      face.frame = (face.frame + 1) % anim.frames.length;
      face.lastMs = now;
    }
    const rect = anim.frames[face.frame].rect;
    blit(this.ctx, sheet.image, rect, x, y);
  }

  private drawLists(): void {
    const { ctx } = this;
    const { assets, maps, music } = this.options;
    const mapIndex = maps.findIndex((m) => m.id === this.room.mapId);
    if (this.room.mapId !== RANDOM_MAP && mapIndex >= 0) blit(ctx, assets.mapimage, mapPreviewRect(mapIndex), MAP_PREVIEW_AT.x, MAP_PREVIEW_AT.y);
    const mapName = mapIndex >= 0 ? shownMapName(maps[mapIndex].title) : RANDOM_MAP;
    const musicName = this.room.music === 0 ? RANDOM_MAP : (music[this.room.music - 1] ?? RANDOM_MAP);
    const white = "#ffffff";
    outlinedText(ctx, mapName, MAP_NAME_AT.x, MAP_NAME_AT.y, white, FONT_12, "left", OUTLINE.blue);
    outlinedText(ctx, musicName, MUSIC_NAME_AT.x, MUSIC_NAME_AT.y, white, FONT_12, "left", OUTLINE.blue);
    outlinedText(ctx, MODE_NAMES[this.room.mode], MODE_NAME_AT.x, MODE_NAME_AT.y, white, FONT_12, "left", OUTLINE.blue);
  }

  private drawChat(now: number): void {
    const { ctx } = this;
    const first = this.scroll.first(this.log.length);
    const view = { first, count: CHAT_LOG.lines, x: CHAT_LOG.x, y: CHAT_LOG.y, step: CHAT_LOG.lineStep };
    drawChatLines(ctx, this.log, view, this.me ? shownName(this.me) : "");
    const thumb = this.scroll.drawnThumb(this.log.length);
    if (thumb !== null) drawThumb(ctx, this.options.assets.button, this.scroll.dragging ? THUMB.dragging : THUMB.normal, THUMB.x, thumb);
    // The line and its caret go under either box (0x427ba0).
    if (this.overlay?.kind === "box" || this.kicked) return;
    const line = this.chat.isOpen ? this.chat.view() : { text: "", caret: 0 };
    if (line.text) outlinedText(ctx, line.text, CHAT_INPUT.x, CHAT_INPUT.y, "#ffffff", FONT_13, "left", OUTLINE.blue);
    if (this.overlay?.kind === "dropdown" || !this.caret.shown(now)) return;
    drawCaret(ctx, CHAT_INPUT.x + 7 * line.caret, CHAT_INPUT.y);
  }

  /** Hover and pressed art (0x426d10): hover while the mouse is over, pressed while the button is held there. */
  private drawHoverArt(): void {
    if (!this.pointer.inside) return;
    const { x, y } = this.pointer.mouse;
    const held = this.pointer.held !== null;
    const { assets } = this.options;
    const art = (button: Button) => {
      if (!inside(button.hit, x, y)) return;
      if (held) this.button(button.pressed, button.at);
      else if (button.hover) this.button(button.hover, button.at);
    };
    art(START);
    art(SHOP);
    art(EXIT);
    if (!held) return;
    art(SCROLL_UP);
    art(SCROLL_DOWN);
    if (this.isHost) for (const list of Object.values(LISTS)) [list.prev, list.next].forEach(art);
    const team = teamAt(x, y);
    if (team && isTeamMode(this.room.mode)) {
      const b = TEAM_BUTTONS[team - 1];
      this.button([b.src[0], TEAM_ROW.pressedSrc, b.src[1], TEAM_ROW.pressedSrc + TEAM_ROW.height], { x: b.x, y: TEAM_ROW.y });
    }
    const slot = slotAt(x, y, this.me?.slot ?? -1);
    const origin = SLOT_ORIGINS[slot];
    if (slot >= 0 && this.isHost && !this.playerAt(slot)) {
      blit(this.ctx, assets.object1, this.room.closed[slot] ? SLOT_ART.pressClosed : SLOT_ART.pressOpen, origin.x, origin.y);
    } else if (slot >= 0) {
      const icon = slotIconAt(slot, x, y);
      if (icon && this.iconLit(icon)) this.button(SLOT_ICONS[icon].pressed, { x: origin.x + SLOT_ICONS[icon].pressedAt.x, y: origin.y + SLOT_ICONS[icon].pressedAt.y });
    }
    const items = this.options.items?.() ?? [];
    const { mask, whisper } = ROOM_ITEM_ICONS;
    if (hasItem(items, ITEM_MASK) && inside(mask.hit, x, y)) this.button(mask.pressed, mask.at);
    else if (hasItem(items, ITEM_WHISPER) && inside(whisper.hit, x, y)) this.button(whisper.pressed, whisper.at);
  }

  /** The balloon (0x44d5d0): a 565 #6b71d6 box, the text in black then white 1 px down and right. */
  private drawHelp(): void {
    // PHELP (+0x20b): the 풍선 도움말 option, on by default (0x44cc60).
    if (!this.options.settings.current.balloons || !this.pointer.inside) return;
    const slots = SLOT_ORIGINS.map((_, slot) => {
      const player = this.playerAt(slot);
      return player ? { host: player.id === this.room.hostId } : null;
    });
    const balloon = helpAt(this.pointer.mouse.x, this.pointer.mouse.y, { isHost: this.isHost, slots, closed: this.room.closed });
    if (balloon) drawBalloon(this.ctx, balloon.text, balloon.x, balloon.y);
  }

  private drawDropdown(list: ListKind, row: number): void {
    const entries = this.listEntries(list);
    const panel = dropdownPanel(list, entries.length);
    blit(this.ctx, this.options.assets.object2, panel.src, panel.at.x, panel.at.y);
    entries.forEach((text, i) => {
      const at = dropdownTextAt(list, i);
      plainText(this.ctx, text, at.x, at.y, i === row ? DROPDOWN_COLOURS.hover : DROPDOWN_COLOURS.normal, FONT_12);
    });
  }

  private drawCursor(now: number): void {
    if (this.pointer.inside) this.cursor.draw(this.ctx, this.options.assets.cursor, now, this.pointer.mouse);
  }
}

function portraitKey(player: LobbyPlayer): string {
  return `${player.character}@${player.hue}`;
}
