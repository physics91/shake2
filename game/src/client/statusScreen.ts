// Scene 5, the old "My Status" menu, as the start screen's page between the login and the server
// list (AGENTS.md; findings_scene5.md). StartScreen keeps the frame, the fades, the quit box, the
// message box and the cursor; this draws the page (0x41cf30) and takes its input (0x41dfc0).
// Geometry: statusLayout.ts; the option page's rules: statusOption.ts. The account's rows come from
// the login record; what needs the ranking server stays blank, or does what 0311 does when no answer comes.
import { cp949Bytes } from "../server/cp949.ts";
import type { OwnAccount } from "../server/protocol.ts";
import { animDue } from "../sim/constants.ts";
import type { Sheet } from "./assets.ts";
import { loadCp949, loadImage, loadSheet } from "./assets.ts";
import type { SoundBank } from "./audio.ts";
import { guildLines, guildMark, guildName, levelBadge, levelTitle } from "./badge.ts";
import { CaretBlink } from "./chat.ts";
import { ChatLine } from "./chatLine.ts";
import { INSTALLED_VERSION, VERSION_TEXT } from "./hudLayout.ts";
import { codeToDik, SCAN_FIRST, SCAN_LAST } from "./dik.ts";
import { connectedPad } from "./gamepad.ts";
import { CHARACTER_IDS, characterIndex } from "./myInfoLayout.ts";
import { MENU_SOUNDS } from "./presentation.ts";
import type { Point } from "./roomLayout.ts";
import { inside } from "./roomLayout.ts";
import { portraitSheetName } from "./scene.ts";
import type { Control, Keys, SettingsStore } from "./settings.ts";
import { blit } from "./sprite.ts";
import type { GuildScroll, HoverButton, StatusButton } from "./statusLayout.ts";
import {
  ACCOUNT_ROWS,
  BANNER,
  CARET,
  caretX,
  CHECK_MARK,
  clampKnob,
  dragKnob,
  FACE_AT,
  faceCell,
  FIELDS,
  GUILD_BAR,
  GUILD_LIST,
  GUILD_TRACK,
  guildOfRow,
  guildRowAt,
  hueBox,
  hueFromKnob,
  ID_TEXT,
  KNOB,
  levelTitleAt,
  LIGHT_BLUE,
  MAIN_BUTTONS,
  newGuildScroll,
  OPTION_PAGE,
  ORANGE,
  padNumber,
  PORTRAIT_AT,
  RANKING,
  scrollDown,
  scrollUp,
  showGuildRow,
  STATUS_BUTTONS,
  STATUS_TEXT,
  statusKeyName,
  stepStatusCharacter,
  USE_ID_BOX,
  USE_NICK_BOX,
} from "./statusLayout.ts";
import { StatusOption } from "./statusOption.ts";
import { FONT_12, FONT_13, outlinedText, plainText, YELLOW } from "./text.ts";
import { clampHue } from "./tint.ts";
import { loadTintedSheet, workSurface } from "./tintArt.ts";

export interface StatusAssets {
  /** Shake1's status.shk (R: 0311 has none), opaque. */
  background: HTMLImageElement;
  /** Shake1's option.shk, the option page's panel (R: 0311 never makes one). */
  option: HTMLImageElement;
  images: HTMLImageElement;
  ranking: HTMLImageElement;
  faces: HTMLImageElement;
  guildIcons: HTMLImageElement;
  /** mark.shk, the level badges. */
  marks: HTMLImageElement;
  banner: Sheet;
  /** guild.dat's lines. */
  guilds: string[];
}

export async function loadStatusAssets(): Promise<StatusAssets> {
  const image = (name: string) => loadImage(`image/${name}.png`);
  const [background, option, images, ranking, faces, guildIcons, marks, banner, guilds] = await Promise.all([
    image("shake1_status"),
    image("shake1_option"),
    image("images"),
    image("ranking"),
    image("Wg_char"),
    image("guild"),
    image("mark"),
    loadSheet("misc", "banner1"),
    loadCp949("guild.dat").then(guildLines),
  ]);
  return { background, option, images, ranking, faces, guildIcons, marks, banner, guilds };
}

/** What scene 5 keeps between its visits, as 0311 keeps it in memory: the character, the check, the list's place. */
export interface StatusState {
  /** [0x49442c] = [0x48c1dc]: an index of CHARACTER_IDS. */
  character: number;
  /** [0x494438]: the hue ± and knob's, −180..180; practice's sprite takes it ([0x492770]). */
  hue: number;
  /** [0x4699e8]: show the ID rather than the nick; 1 at start in 0311, the account's here (as Shake1 fills it at login). */
  useId: boolean;
  guild: GuildScroll;
}

export function newStatusState(savedCharacter: string | null): StatusState {
  return { character: Math.max(0, characterIndex(savedCharacter ?? "")), hue: 0, useId: true, guild: newGuildScroll() };
}

export type StatusAction = "go" | "practice" | "exit";

/** Which page covers the main one: [0x494450] ranking, [0x494440] option; at most one is open. */
export type StatusPageName = "main" | "ranking" | "option";

export interface StatusPageOptions {
  stage: HTMLElement;
  assets: StatusAssets;
  sounds: SoundBank;
  /** The option object (0x48acd0), which the option page saves. */
  settings: SettingsStore;
  state: StatusState;
  announce(text: string): void;
  /** The message box (0x443700). */
  message(text: string): void;
  /** The login record's account, or none without the account server. */
  account(): OwnAccount | null;
  /** 확인 (C->S 0x48, 0x4480c0): the ID check, the nick and the greeting; busy until the answer. */
  save(profile: { nick: string; greeting: string; useId: boolean }): void;
  /** pw ▶ (the old C->S 0x4a, 0x448290): the guild.dat line to join, −1 to leave; busy until the answer. */
  joinGuild(guild: number): void;
  /** ▲ and ▼: the character practice and the lobby use (0x48c1dc). */
  characterChanged(id: string): void;
}

/** The key boxes' labels on option.shk, for a screen reader. */
const KEY_LABELS = ["폭탄 내려놓기", "아이템 사용 1", "아이템 사용 2"];

const BLACK = "#000000";
const WHITE = "#ffffff";

export class StatusPage {
  private readonly options: StatusPageOptions;
  private readonly fields: ChatLine[];
  private readonly search: ChatLine;
  /** The editor as the option page's macro line (limit 0x1a). */
  private readonly macroLine: ChatLine;
  private readonly caret = new CaretBlink();
  private page: StatusPageName = "main";
  private option: StatusOption | null = null;
  /** [0x4699ac]: the live keys, which the option page changes at once. */
  private readonly keys: Keys;
  /** [0x4714c0], [0x4714ec], [0x484724]: taken on opening the option page and by its 확인; Go, Practice and Ranking put them back. */
  private keySnapshot: Keys;
  /** The account's nick and greeting (0x48c150, 0x48c168), which the option page's 취소 puts back. */
  private account = { nick: "", greeting: "" };
  /** Keys held now, by code, for the key-change poll (DirectInput's GetDeviceState). */
  private readonly held = new Set<string>();
  private readonly detachKeys: () => void;
  /** [0x494430]: the field the editor is on; [0x494428] the caret shown. */
  private focus = 0;
  private editing = false;
  /** [0x494330], [0x4942a8]: the nick's and the ID's colours, set after the text is drawn, so a frame late; black at first. */
  private nickColour = BLACK;
  private idColour = BLACK;
  private banner = { frame: 0, lastMs: Number.NEGATIVE_INFINITY };
  private portrait: { id: string; hue: number; sheet: Sheet | null; frame: number; lastMs: number } | null = null;
  /** [0x48c32b]: the press was on the hue knob, so the held button drags it. */
  private knobHeld = false;

  constructor(options: StatusPageOptions) {
    this.options = options;
    this.fields = FIELDS.map((field) => {
      const line = new ChatLine(options.stage, { limit: field.limit, at: field.text, trapFocus: false });
      line.element.setAttribute("aria-label", { nick: "닉네임", greeting: "인사말", password: "길드 비밀번호" }[field.name]);
      if (field.name === "password") line.element.type = "password";
      return line;
    });
    this.search = new ChatLine(options.stage, { limit: RANKING.field.limit, at: RANKING.field.text, trapFocus: false });
    this.search.element.setAttribute("aria-label", "찾을 아이디");
    this.macroLine = new ChatLine(options.stage, { limit: OPTION_PAGE.macros.limit, at: macroAt(0), trapFocus: false });
    this.macroLine.element.setAttribute("aria-label", "단축 메시지");
    this.keys = [...options.settings.current.keys];
    this.keySnapshot = [...this.keys];
    this.detachKeys = this.attachKeys();
  }

  /** The held keys for the key change; text typed into the page's own form outside the canvas is not one. */
  private attachKeys(): () => void {
    const down = (event: KeyboardEvent) => {
      const active = document.activeElement;
      if (active instanceof HTMLInputElement && !this.options.stage.contains(active)) return;
      this.held.add(event.code);
      // A key being taken does only that: F5 does not reload, Tab and Enter do not move or press a control.
      const dik = codeToDik(event.code);
      if (this.option && this.option.changing >= 0 && dik !== null && dik >= SCAN_FIRST && dik <= SCAN_LAST) event.preventDefault();
    };
    const up = (event: KeyboardEvent) => this.held.delete(event.code);
    const blur = () => this.held.clear();
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", blur);
    };
  }

  /** Whether the page's own editors hold the focus (StartScreen's key filter). */
  owns(element: Element | null): boolean {
    return [...this.fields, this.search, this.macroLine].some((line) => line.element === element);
  }

  get pageName(): StatusPageName {
    return this.page;
  }

  get character(): string {
    return CHARACTER_IDS[this.options.state.character];
  }

  /** 0x41f030: the nick and greeting from the account, the password cleared, the editor on the nick. */
  enter(nick: string, greeting: string): void {
    this.account = { nick, greeting };
    for (const line of this.fields) line.open();
    this.editing = true;
    this.resetFields();
    this.loadPortrait();
    this.options.announce(
      `내 정보 화면. ${this.accountText()}캐릭터 ${this.character}. 아래 버튼: Go game(서버 목록), Practice(혼자 연습), Ranking, Option, Exit. ` +
        "닉네임·인사말 칸은 Tab으로 바꿉니다. 길드는 목록에서 고른 뒤 ▶로 가입합니다.",
    );
  }

  /** The account's rows, read out. */
  private accountText(): string {
    const account = this.options.account();
    if (!account) return "";
    return `아이디 ${account.id}, 길드 ${this.guildName(account.guild)}, 레벨 ${levelTitle(account.level).replace(/\s+/g, "") || "없음"}, ` +
      `순위 ${account.rank}, 셀 포인트 ${account.cell}, 승 ${account.wins}. `;
  }

  /** −1's name is guild.dat's first line, "없음" (0x4419e0), as S->C 0x4a names it. */
  private guildName(guild: number): string {
    const { guilds } = this.options.assets;
    return guild < 0 ? (guilds[0] ?? "") : guildName(guilds, guild);
  }

  /** The fields from the account, the password cleared, the editor on the nick (0x41f030, 0x41e7f8). */
  private resetFields(): void {
    const [nickLine, greetingLine, passwordLine] = this.fields;
    nickLine.text = this.account.nick;
    greetingLine.text = this.account.greeting;
    passwordLine.text = "";
    this.setFocus(0);
  }

  /** 확인's answer (S->C 0x48): the account's nick and greeting are the server's copy now. */
  saved(nick: string, greeting: string): void {
    this.account = { nick, greeting };
    const [nickLine, greetingLine] = this.fields;
    nickLine.text = nick;
    greetingLine.text = greeting;
  }

  /** Leaving the scene: the editors let go of the keyboard. */
  leave(): void {
    for (const line of [...this.fields, this.search, this.macroLine]) line.close();
    this.editing = false;
  }

  dispose(): void {
    for (const line of [...this.fields, this.search, this.macroLine]) line.dispose();
    this.detachKeys();
  }

  /** The hand cursor over the banner (0x43f0d0). */
  overBanner(x: number, y: number): boolean {
    return inside(BANNER.hit, x, y);
  }

  // Input

  /** A release, the bottom row first (0x45a8d3), then the page (0x41dfc0). */
  release(x: number, y: number): StatusAction | null {
    const { sounds } = this.options;
    const button = (Object.keys(STATUS_BUTTONS) as StatusButton[]).find((name) => inside(STATUS_BUTTONS[name].hit, x, y));
    switch (button) {
      case "go":
      case "practice":
        this.closePages();
        sounds.play(MENU_SOUNDS.primary);
        return button;
      case "ranking":
        this.openRanking();
        return null;
      case "option":
        this.openOption();
        return null;
      case "exit":
        sounds.play(MENU_SOUNDS.primary);
        return "exit";
    }
    // The banner opens hanpanthe.net (ShellExecute): a page does not open another site on its own.
    if (inside(BANNER.hit, x, y)) return null;
    if (this.page === "ranking") this.rankingRelease(x, y);
    else if (this.page === "option") this.optionRelease(x, y);
    else this.mainRelease(x, y);
    return null;
  }

  /** Each 30 fps frame: the option page's key change (0x402090). */
  step(): void {
    this.option?.poll(this.held);
  }

  /** The press (0x45ae58): whether it is on the hue knob. */
  press(x: number, y: number): void {
    this.knobHeld = this.page === "main" && inside(hueBox(this.options.state.hue).hit, x, y);
  }

  /** Each 30 fps frame with the button held (0x458e22): the knob's drag, ▲ and ▼ of the list, the hue knob. */
  hold(x: number, y: number): void {
    const scroll = this.options.state.guild;
    if (this.knobHeld) this.options.state.hue = hueFromKnob(y);
    if (this.page !== "main") {
      scroll.dragging = false;
      return;
    }
    const count = this.options.assets.guilds.length;
    const onTrack = inside(GUILD_TRACK, x, y);
    if (onTrack && scroll.dragging) dragKnob(scroll, count, y);
    scroll.dragging = onTrack;
    if (inside(MAIN_BUTTONS.guildUp.hit, x, y)) scrollUp(scroll, count, 2);
    else if (inside(MAIN_BUTTONS.guildDown.hit, x, y)) scrollDown(scroll, count, 2);
  }

  /** The wheel (0x420370): 5 px a notch on the main page. */
  wheel(up: boolean): void {
    if (this.page !== "main") return;
    const count = this.options.assets.guilds.length;
    if (up) scrollUp(this.options.state.guild, count, 5);
    else scrollDown(this.options.state.guild, count, 5);
  }

  /** Tab: the next of the three fields on the main page (0x41f110), the next macro line on the option page (0x41f3f0). */
  tab(): void {
    if (this.option) {
      this.syncMacro();
      this.option.tab();
    }
    else if (this.page === "main" && this.editing) this.setFocus((this.focus + 1) % this.fields.length);
  }

  /** Keep the keyboard on the line being edited after a click elsewhere; none while a key changes. */
  refocus(): void {
    if (this.page === "ranking") this.search.focus();
    else if (this.page === "option") {
      if (this.option?.changing === -1) this.macroLine.focus();
    } else if (this.editing) this.fields[this.focus].focus();
  }

  /** Go and Practice: the keys put back and both pages closed (findings_scene5.md §6.1, §6.2). */
  private closePages(): void {
    this.restoreKeys();
    if (this.page === "ranking") this.search.close();
    if (this.page === "option") this.endOption();
    this.page = "main";
  }

  private restoreKeys(): void {
    for (let i = 0; i < this.keys.length; i++) this.keys[i] = this.keySnapshot[i];
  }

  /** Ranking (0x41de70): refused while open; 0311 then asks the dead ranking server and gets no rows. */
  private openRanking(): void {
    if (this.page === "ranking") return;
    this.restoreKeys();
    if (this.page === "option") this.endOption();
    this.options.sounds.play(MENU_SOUNDS.primary);
    this.page = "ranking";
    this.search.open();
    this.options.announce("랭킹 화면. 랭킹 서버가 없어 목록이 비어 있습니다. 찾을 아이디를 넣고 찾기 버튼을 누릅니다.");
  }

  /** Option (0x41df00 → 0x41f2c0): refused while open; the ranking page closes; the live keys are snapshot. */
  private openOption(): void {
    if (this.page === "option") return;
    const { sounds, settings } = this.options;
    if (this.page === "ranking") this.search.close();
    this.page = "option";
    this.keySnapshot = [...this.keys];
    this.macroLine.open();
    this.option = new StatusOption(
      {
        current: () => settings.current,
        save: (next) => settings.save(next),
        useControl: (control) => useControl(settings, control),
        message: (text) => this.options.message(text),
        click: () => sounds.play(MENU_SOUNDS.primary),
        edit: (line, text) => {
          this.macroLine.place(macroAt(line));
          this.macroLine.text = text;
        },
      },
      this.keys,
    );
    sounds.play(MENU_SOUNDS.primary);
    this.options.announce(
      `옵션 쪽. 단축 메시지 F1부터 F10, 지금 F1. Tab으로 다음 줄. 키: ${this.keyNames()}. ` +
        "음악·효과음 켬과 끔, 키보드·조이스틱, 키 칸, 확인, 취소가 있습니다.",
    );
  }

  private endOption(): void {
    this.option = null;
    this.macroLine.close();
  }

  private keyNames(): string {
    return this.keys.map((dik, i) => `${KEY_LABELS[i]} ${statusKeyName(dik) || "없음"}`).join(", ");
  }

  private optionRelease(x: number, y: number): void {
    const option = this.option;
    if (!option) return;
    this.syncMacro();
    const before = { joystick: option.joystick, music: option.music, effects: option.effects, line: option.line, changing: option.changing };
    const result = option.click(x, y);
    if (result === "close") {
      // 취소 (0x41e73d): back to the main page with its fields from the account; the keys stay as they are.
      this.endOption();
      this.page = "main";
      this.resetFields();
      this.options.announce("내 정보 화면.");
      return;
    }
    if (result === "saved") this.keySnapshot = [...this.keys];
    if (option.changing >= 0 && inside(OPTION_PAGE.keys[option.changing].hit, x, y)) {
      // A key held at the click is not taken; typing goes to the key, not the macro line.
      this.held.clear();
      this.macroLine.element.blur();
      this.options.announce(`${KEY_LABELS[option.changing]} 키: 새 키를 누르세요.`);
    } else if (option.joystick !== before.joystick) this.options.announce(option.joystick ? "조이스틱" : "키보드");
    else if (option.music !== before.music) this.options.announce(option.music ? "음악 켬" : "음악 끔");
    else if (option.effects !== before.effects) this.options.announce(option.effects ? "효과음 켬" : "효과음 끔");
    else if (option.line !== before.line) this.options.announce(`F${option.line + 1}`);
    // 확인 and 취소 speak through their message box or page instead.
    else if (before.changing >= 0 && option.changing === -1 && result === null && !inside(OPTION_PAGE.ok.hit, x, y)) {
      this.options.announce(`키: ${this.keyNames()}`);
    }
    this.refocus();
  }

  /** The editor's text goes to its line before the line or the page changes, not only each frame. */
  private syncMacro(): void {
    this.option?.editorText(this.macroLine.view().text);
  }

  private rankingRelease(x: number, y: number): void {
    const { sounds } = this.options;
    // ▲ on page 1 asks again only when its first row ranks below 1: with no rows, nothing.
    if (inside(RANKING.up.hit, x, y)) return;
    if (inside(RANKING.down.hit, x, y)) {
      // The next page is asked for and does not come: the page stays.
      sounds.play(MENU_SOUNDS.primary);
      return;
    }
    if (inside(RANKING.search.hit, x, y)) {
      sounds.play(MENU_SOUNDS.primary);
      this.options.message(STATUS_TEXT.notFound);
      return;
    }
    this.search.focus();
  }

  private mainRelease(x: number, y: number): void {
    const { sounds, state } = this.options;
    const knobWasHeld = this.knobHeld;
    this.knobHeld = false;
    if (inside(USE_ID_BOX, x, y)) {
      state.useId = true;
      this.options.announce("아이디 사용");
    } else if (inside(USE_NICK_BOX, x, y)) {
      state.useId = false;
      this.options.announce("닉네임 사용");
    } else if (inside(MAIN_BUTTONS.characterUp.hit, x, y) || inside(MAIN_BUTTONS.characterDown.hit, x, y)) {
      sounds.play(MENU_SOUNDS.secondary);
      state.character = stepStatusCharacter(state.character, inside(MAIN_BUTTONS.characterUp.hit, x, y) ? -1 : 1);
      state.hue = 0;
      this.loadPortrait();
      this.options.characterChanged(this.character);
      this.options.announce(`캐릭터 ${this.character}`);
    } else if (inside(MAIN_BUTTONS.ok.hit, x, y)) {
      const [nick, greeting] = this.fields.map((line) => line.view().text);
      this.options.save({ nick, greeting, useId: state.useId });
    } else if (inside(MAIN_BUTTONS.hueDown.hit, x, y) || inside(MAIN_BUTTONS.hueUp.hit, x, y)) {
      sounds.play(MENU_SOUNDS.secondary);
      state.hue = clampHue(state.hue + (inside(MAIN_BUTTONS.hueUp.hit, x, y) ? 1 : -1));
      this.loadPortrait();
      this.options.announce(`색조 ${state.hue}`);
    } else if (knobWasHeld && inside(hueBox(state.hue).hit, x, y)) {
      // The knob let go on itself (0x41efc8): the portrait is read again with the hue.
      this.loadPortrait();
      this.options.announce(`색조 ${state.hue}`);
    } else if (inside(MAIN_BUTTONS.guildPassword.hit, x, y)) {
      sounds.play(MENU_SOUNDS.secondary);
      // The remake's guilds have no passwords, so none is asked for (R: 0311 wants one past "없음").
      if (state.guild.selected < 0) this.options.message(STATUS_TEXT.chooseGuild);
      else this.options.joinGuild(guildOfRow(state.guild.selected));
    } else {
      const row = guildRowAt(x, y, state.guild.top, this.options.assets.guilds.length);
      const field = FIELDS.findIndex((f) => inside(f.hit, x, y));
      if (row !== null) this.chooseGuild(row);
      else if (field >= 0) this.setFocus(field);
    }
    this.refocus();
  }

  /** A row clicked (0x41ec80): chosen, with SND 0x26. */
  private chooseGuild(row: number): void {
    const { assets, sounds, state } = this.options;
    state.guild.selected = row;
    sounds.play(MENU_SOUNDS.secondary);
    this.options.announce(`길드 목록 ${row + 1}/${assets.guilds.length}: ${assets.guilds[row]}. ▶로 ${row === 0 ? "탈퇴" : "가입"}합니다.`);
  }

  /** The keyboard's step through the list (R): the next or previous row chosen as its click does, and shown. */
  stepGuild(step: 1 | -1): void {
    if (this.page !== "main") return;
    const { assets, state } = this.options;
    const count = assets.guilds.length;
    if (count === 0) return;
    const row = Math.max(0, Math.min(count - 1, state.guild.selected + step));
    showGuildRow(state.guild, row, count);
    this.chooseGuild(row);
  }

  private setFocus(field: number): void {
    this.focus = field;
    this.fields[field].focus();
  }

  /** 0x413d30(6, character, hue): `_p.spr` read again, turned by the hue, from frame 0. */
  private loadPortrait(): void {
    const id = this.character;
    const { hue } = this.options.state;
    if (this.portrait?.id === id && this.portrait.hue === hue) return;
    const portrait = { id, hue, sheet: null as Sheet | null, frame: 0, lastMs: Number.NEGATIVE_INFINITY };
    this.portrait = portrait;
    loadTintedSheet("character", portraitSheetName(id), hue).then(
      (sheet) => {
        portrait.sheet = sheet;
      },
      () => undefined,
    );
  }

  // Frames

  /** 0x41cf30: background, banner, the page, the bottom row's hover and the version. `held`: the left button is down. */
  draw(ctx: CanvasRenderingContext2D, now: number, mouse: Point | null, held: boolean): void {
    const { assets } = this.options;
    ctx.drawImage(assets.background, 0, 0);
    this.drawBanner(ctx, now);
    if (this.page === "ranking") this.drawRanking(ctx, now, mouse);
    else if (this.option) this.drawOption(ctx, this.option, now, mouse);
    else this.drawMain(ctx, now, mouse, held);
    // Notices come only from the server (S->C 0x101): none. Option's hover only while its page is closed.
    const bottom = (Object.keys(STATUS_BUTTONS) as StatusButton[]).filter((name) => name !== "option" || !this.option);
    if (mouse) this.drawHover(ctx, bottom.map((name) => STATUS_BUTTONS[name]), mouse);
    outlinedText(ctx, `ver. ${INSTALLED_VERSION}`, VERSION_TEXT.x, VERSION_TEXT.y, YELLOW, FONT_13);
  }

  private drawBanner(ctx: CanvasRenderingContext2D, now: number): void {
    const { banner } = this.options.assets;
    const anim = banner.meta.animations[0];
    if (!anim || anim.frames.length === 0) return;
    blit(ctx, banner.image, anim.frames[this.banner.frame].rect, BANNER.at.x, BANNER.at.y);
    if (animDue(now, this.banner.lastMs, anim.unknown_u16)) {
      this.banner = { frame: (this.banner.frame + 1) % anim.frames.length, lastMs: now };
    }
  }

  private drawHover(ctx: CanvasRenderingContext2D, buttons: readonly HoverButton[], mouse: Point): void {
    for (const button of buttons) {
      if (inside(button.hit, mouse.x, mouse.y)) blit(ctx, this.options.assets.images, button.hover, button.at.x, button.at.y);
    }
  }

  /** 0x41d320, then its hover art (0x41f8a0), the check and colours (0x41da90) and the caret. */
  private drawMain(ctx: CanvasRenderingContext2D, now: number, mouse: Point | null, held: boolean): void {
    const { assets, state } = this.options;
    this.drawGuilds(ctx);
    this.drawCharacter(ctx, now, held);
    const [nick, greeting, password] = this.fields.map((line) => line.view());
    this.drawAccount(ctx);
    if (nick.text) plainText(ctx, nick.text, FIELDS[0].text.x, FIELDS[0].text.y, this.nickColour, FONT_13);
    if (greeting.text) plainText(ctx, greeting.text, FIELDS[1].text.x, FIELDS[1].text.y, ORANGE, FONT_13);
    if (password.text) plainText(ctx, "*".repeat(cp949Bytes(password.text)), FIELDS[2].text.x, FIELDS[2].text.y, ORANGE, FONT_13);
    const knob = clampKnob(state.guild);
    blit(ctx, assets.images, state.guild.dragging ? KNOB.dragging : KNOB.idle, GUILD_TRACK[0], knob - 5);
    if (mouse) this.drawHover(ctx, Object.values(MAIN_BUTTONS), mouse);
    const mark = state.useId ? CHECK_MARK.useId : CHECK_MARK.useNick;
    blit(ctx, assets.images, CHECK_MARK.src, mark.x, mark.y);
    this.nickColour = state.useId ? WHITE : ORANGE;
    this.idColour = state.useId ? ORANGE : WHITE;
    if (this.editing && this.caret.shown(now)) {
      const line = [nick, greeting, password][this.focus];
      ctx.fillStyle = CARET.colour;
      ctx.fillRect(caretX(CARET.x, line.caret), FIELDS[this.focus].caretY, 1, CARET.height);
    }
  }

  /**
   * The account's rows (0x41d320; no writer in 0311, the login record's here, R): the ID, the guild's
   * mark and name, the level's badge and title, rank, cell point and wins. No last login: the
   * remake keeps none. Nothing without the account server.
   */
  private drawAccount(ctx: CanvasRenderingContext2D): void {
    const account = this.options.account();
    if (!account) return;
    const { assets } = this.options;
    plainText(ctx, account.id, ID_TEXT.x, ID_TEXT.y, this.idColour, FONT_13);
    const { guild, rank, cell, wins } = ACCOUNT_ROWS;
    const mark = guildMark(account.guild);
    if (mark) blit(ctx, assets.guildIcons, mark, guild.mark.x, guild.mark.y);
    plainText(ctx, this.guildName(account.guild), guild.name.x, guild.name.y, ORANGE, FONT_13);
    // 0311 crashes on a level outside 1..12 (0x41d5ac); the remake draws none (R).
    const badge = levelBadge(account.level);
    if (badge) {
      const title = levelTitle(account.level);
      const at = levelTitleAt(title);
      blit(ctx, assets.marks, badge, at.badge.x, at.badge.y);
      plainText(ctx, title, at.title.x, at.title.y, ORANGE, FONT_13);
    }
    plainText(ctx, padNumber(account.rank, rank.width), rank.x, rank.y, ORANGE, FONT_13);
    plainText(ctx, padNumber(account.cell, cell.width), cell.x, cell.y, ORANGE, FONT_13);
    plainText(ctx, padNumber(account.wins, wins.width), wins.x, wins.y, ORANGE, FONT_13);
  }

  /**
   * Ten rows from the list's top (0x41d387): the mark, the chosen row's bar, the name. Each row's mark
   * is the one its guild shows by the name (R: 0311 draws line k with cell k − 1, guildOfRow).
   */
  private drawGuilds(ctx: CanvasRenderingContext2D): void {
    const { assets, state } = this.options;
    for (let row = 0; row < GUILD_LIST.rows; row++) {
      const line = state.guild.top + row;
      const name = assets.guilds[line];
      if (name === undefined) break;
      const y = GUILD_LIST.firstY + GUILD_LIST.step * row;
      const mark = guildMark(guildOfRow(line));
      if (mark) blit(ctx, assets.guildIcons, mark, GUILD_LIST.iconX, y);
      if (line === state.guild.selected) {
        ctx.fillStyle = GUILD_BAR.fill;
        ctx.fillRect(GUILD_BAR.x, y, GUILD_BAR.width, GUILD_BAR.height);
      }
      plainText(ctx, name, GUILD_LIST.nameX, y, LIGHT_BLUE, FONT_13);
    }
  }

  /**
   * The face (Wg_char, keyed), `_p.spr` under it and the hue box (0x41d7c0). The name label cells
   * of 0311's Wg_char hold head icons, not names, so the label is left out (R). With a hue the face
   * goes through work surface 6, turned again only while the button is held (0x41d8d6), so after a
   * ± it shows the hue before the click until the next press.
   */
  private drawCharacter(ctx: CanvasRenderingContext2D, now: number, held: boolean): void {
    const { assets, state } = this.options;
    if (state.hue === 0) blit(ctx, assets.faces, faceCell(state.character), FACE_AT.x, FACE_AT.y);
    else {
      const surface = workSurface(6);
      if (held) surface.recolour(assets.faces, faceCell(state.character), state.hue);
      surface.draw(ctx, FACE_AT.x, FACE_AT.y);
    }
    const portrait = this.portrait;
    const anim = portrait?.sheet?.meta.animations[0];
    if (portrait?.sheet && anim && anim.frames.length > 0) {
      blit(ctx, portrait.sheet.image, anim.frames[portrait.frame % anim.frames.length].rect, PORTRAIT_AT.x, PORTRAIT_AT.y);
      if (animDue(now, portrait.lastMs, anim.unknown_u16)) {
        portrait.frame = (portrait.frame + 1) % anim.frames.length;
        portrait.lastMs = now;
      }
    }
    const box = hueBox(state.hue);
    const [x, y, w, h] = box.fill;
    ctx.fillStyle = WHITE;
    ctx.fillRect(x, y, w, h);
    // Drawn in the DC's default font (System), which the remake has not got: 굴림체 12 (R).
    plainText(ctx, String(state.hue), box.text.x, box.text.y, BLACK, FONT_12);
  }

  /**
   * 0x41d062: option.shk at (18,7), the blue bar under the key being changed (0x4129b0), the art
   * (0x41fea0), CM1..CM10, the key names and the caret, which a key change hides.
   */
  private drawOption(ctx: CanvasRenderingContext2D, option: StatusOption, now: number, mouse: Point | null): void {
    const { assets } = this.options;
    const page = OPTION_PAGE;
    this.syncMacro();
    ctx.drawImage(assets.option, page.panel.x, page.panel.y);
    if (option.changing >= 0) {
      const at = page.keys[option.changing].name;
      ctx.fillStyle = page.changing.fill;
      ctx.fillRect(at.x, at.y, page.changing.width, page.changing.height);
    }
    if (mouse) this.drawHover(ctx, [page.ok, page.cancel], mouse);
    const mark = option.joystick ? page.mark.joystick : page.mark.keyboard;
    blit(ctx, assets.images, page.mark.src, mark.x, mark.y);
    const music = option.music ? page.music.on : page.music.off;
    blit(ctx, assets.images, music.art, music.at.x, music.at.y);
    const sound = option.effects ? page.sound.on : page.sound.off;
    blit(ctx, assets.images, sound.art, sound.at.x, sound.at.y);
    option.macros.forEach((text, i) => {
      const at = macroAt(i);
      if (text) plainText(ctx, text, at.x, at.y, LIGHT_BLUE, FONT_13);
    });
    page.keys.forEach((box, i) => {
      const name = statusKeyName(this.keys[i]);
      if (name) plainText(ctx, name, box.name.x, box.name.y, LIGHT_BLUE, FONT_13);
    });
    if (option.changing === -1 && this.caret.shown(now)) {
      const line = this.macroLine.view();
      const at = macroAt(option.line);
      ctx.fillStyle = CARET.colour;
      ctx.fillRect(caretX(at.x, line.caret), at.y, 1, CARET.height);
    }
  }

  /** ranking.shk at (18,7), no rows, the search ID and its caret, and the page's hover art. */
  private drawRanking(ctx: CanvasRenderingContext2D, now: number, mouse: Point | null): void {
    const { assets } = this.options;
    ctx.drawImage(assets.ranking, RANKING.panel.x, RANKING.panel.y);
    const line = this.search.view();
    if (line.text) plainText(ctx, line.text, RANKING.field.text.x, RANKING.field.text.y, LIGHT_BLUE, FONT_13);
    if (this.caret.shown(now)) {
      ctx.fillStyle = CARET.colour;
      ctx.fillRect(caretX(RANKING.field.text.x, line.caret), RANKING.field.text.y, 1, CARET.height);
    }
    if (mouse) this.drawHover(ctx, [RANKING.up, RANKING.down, RANKING.search], mouse);
  }
}

/** Where CM(line + 1) is drawn and its caret stands. */
function macroAt(line: number): Point {
  return { x: OPTION_PAGE.macros.x, y: OPTION_PAGE.macros.firstY + OPTION_PAGE.macros.step * line };
}

/** 0x402520, as the lobby's option window does it (optionScreen.ts). */
function useControl(settings: SettingsStore, control: Control): boolean {
  // The browser shows a pad only after one of its buttons was pressed on the page.
  if (control === 1 && !connectedPad()) return false;
  settings.setControl(control);
  return true;
}
