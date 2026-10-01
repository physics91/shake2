// The option window (scene 13) as page controls, this remake's addition like the lobby's other
// forms: the same option object and the same key and friend rules, for the keyboard and screen
// readers. The canvas window stays the original's; either one's save shows in the other.
import { cutBytes, typeable } from "../server/cp949.ts";
import type { ClientMessage } from "../server/protocol.ts";
import { bindableKeys, dikToCode } from "./dik.ts";
import type { FriendReply } from "./friends.ts";
import { connectedPad } from "./gamepad.ts";
import { keyLabel } from "./input.ts";
import { FRIEND_ID_LIMIT, OFFLINE } from "./optionLayout.ts";
import type { FriendRecord } from "./optionWindow.ts";
import { DEVICE_ERRORS } from "./optionWindow.ts";
import type { Control, Keys, SettingsStore } from "./settings.ts";
import { assignKey, cloneSettings, MACRO_LIMIT, MACRO_SLOTS, resetSettings } from "./settings.ts";
import { h } from "./ui.ts";

export interface OptionPanelHost {
  settings: SettingsStore;
  send(message: ClientMessage): void;
  /** An add or delete result: the window's message box and the page's alert line. */
  message(text: string): void;
  /** The canvas waits for a reply ([0x496ca0]) or shows the help; its clicks are dropped, so this section's are too. */
  busy(): boolean;
}

const KEY_SLOTS = ["폭탄 (BOMB)", "공격용 아이템 (ITEM 1)", "회피용 아이템 (ITEM 2)"];

/** A key as the page's key help names it; the canvas window keeps the original's names. */
function keyChoice(dik: number): string {
  return keyLabel(dikToCode(dik) ?? "");
}

/** Keep what the window's editors take: cp949 text under `limit` bytes. */
function fitBytes(input: HTMLInputElement, limit: number): void {
  const kept = cutBytes(typeable(input.value), limit - 1);
  if (kept !== input.value) input.value = kept;
}

export class OptionPanel {
  readonly root: HTMLDetailsElement;
  private readonly host: OptionPanelHost;
  private readonly checks = {
    music: h("input", { type: "checkbox", id: "option-music" }),
    effects: h("input", { type: "checkbox", id: "option-effects" }),
    balloons: h("input", { type: "checkbox", id: "option-balloons" }),
  };
  private readonly devices = [0, 1].map((control) => h("input", { type: "radio", name: "option-control", value: control, id: `option-control-${control}` }));
  private readonly keySelects = KEY_SLOTS.map((_, slot) =>
    h("select", { id: `option-key-${slot}` }, ...bindableKeys().map((dik) => h("option", { value: dik }, keyChoice(dik)))),
  );
  /** F2..F10: CM2..CM10. */
  private readonly macroInputs = Array.from({ length: MACRO_SLOTS - 1 }, (_, i) =>
    h("input", { id: `option-macro-${i + 1}`, autocomplete: "off" }),
  );
  private readonly friendList = h("ul", { class: "roster", "aria-label": "친구 목록" });
  private readonly friendInput = h("input", { id: "option-friend", autocomplete: "off" });
  private readonly status = h("p", { role: "status" });
  private keys: Keys;
  /** The server's last list (S->C 0x63); null until the first comes. */
  private friends: FriendRecord[] | null = null;
  /** An add or delete was sent and its answer has not come. */
  private asked = false;
  private readonly stopListening: () => void;
  /** Set while this panel saves, so its own save leaves unsaved fields alone. */
  private saving = false;

  constructor(host: OptionPanelHost) {
    this.host = host;
    this.keys = [...host.settings.current.keys];
    for (const input of this.macroInputs) input.addEventListener("input", () => fitBytes(input, MACRO_LIMIT));
    this.friendInput.addEventListener("input", () => fitBytes(this.friendInput, FRIEND_ID_LIMIT));
    this.keySelects.forEach((select, slot) => select.addEventListener("change", () => this.chooseKey(slot, Number(select.value))));
    this.devices.forEach((radio, control) => radio.addEventListener("change", () => this.chooseDevice(control as Control)));

    const check = (input: HTMLInputElement, text: string) => h("label", { class: "check" }, input, text);
    this.root = h(
      "details",
      { class: "option-panel" },
      h("summary", {}, "옵션 (리모컨의 OPTION 창과 같은 설정)"),
      h(
        "form",
        { onsubmit: (event: Event) => this.save(event) },
        h(
          "fieldset",
          { class: "choices" },
          h("legend", {}, "소리와 도움말"),
          check(this.checks.music, "배경음악"),
          check(this.checks.effects, "효과음"),
          check(this.checks.balloons, "풍선 도움말"),
        ),
        h(
          "fieldset",
          { class: "choices" },
          h("legend", {}, "조작 장치 (바로 바뀌고, 저장하면 다음에도 유지)"),
          check(this.devices[0], "키보드"),
          check(this.devices[1], "조이스틱"),
        ),
        h(
          "fieldset",
          { class: "choices option-grid" },
          h("legend", {}, "게임 키 (다른 칸의 키를 고르면 두 칸이 서로 바뀜, D는 제스처 키)"),
          ...this.keySelects.map((select, slot) => h("div", { class: "field" }, h("label", { for: select.id }, KEY_SLOTS[slot]), select)),
        ),
        h(
          "fieldset",
          { class: "choices option-grid" },
          h("legend", {}, `단축 메시지 (F2~F10, 최대 ${MACRO_LIMIT - 1}바이트)`),
          ...this.macroInputs.map((input, i) => h("div", { class: "field" }, h("label", { for: input.id }, `F${i + 2}`), input)),
        ),
        h(
          "div",
          { class: "row" },
          h("button", { class: "btn primary", type: "submit" }, "저장"),
          h("button", { class: "btn", type: "button", onclick: () => this.reset() }, "초기화"),
        ),
      ),
      this.status,
      h("h3", {}, "친구 목록"),
      this.friendList,
      h(
        "form",
        { onsubmit: (event: Event) => this.addFriend(event) },
        h("div", { class: "field" }, h("label", { for: "option-friend" }, `친구 아이디 (최대 ${FRIEND_ID_LIMIT - 1}바이트)`), this.friendInput),
        h("button", { class: "btn", type: "submit" }, "추가"),
        h("button", { class: "btn", type: "button", onclick: () => this.refreshFriends() }, "위치 새로 고침"),
      ),
    );
    // Opening the section asks where the friends are, as opening the window does (C->S 0x63), which
    // the remote's 옵션 does only when the lobby takes clicks.
    this.root.addEventListener("toggle", () => {
      if (this.root.open && !this.host.busy()) this.requestFriends();
    });
    this.stopListening = host.settings.listen(() => {
      if (!this.saving) this.refresh();
    });
    this.refresh();
    this.renderFriends();
  }

  /** S->C 0x63: the list and where each friend is. */
  friendsAnswered(list: readonly FriendRecord[]): void {
    this.friends = list.map((friend) => ({ ...friend }));
    this.renderFriends();
  }

  /** S->C 0x64 or 0x65 to this section's add or delete; a change asks for the list again. */
  friendReplied(reply: FriendReply): void {
    if (!this.asked) return;
    this.asked = false;
    if (reply.message) this.host.message(reply.message);
    if (reply.askAgain) {
      this.friendInput.value = "";
      this.requestFriends();
    }
    // A deleted row's button goes with the new list; the add field keeps the keyboard in the section.
    this.friendInput.focus();
  }

  dispose(): void {
    this.stopListening();
  }

  /** The fields from the option object. */
  private refresh(): void {
    const settings = this.host.settings.current;
    this.checks.music.checked = settings.music;
    this.checks.effects.checked = settings.effects;
    this.checks.balloons.checked = settings.balloons;
    this.devices.forEach((radio, control) => (radio.checked = settings.control === control));
    this.keys = [...settings.keys];
    this.showKeys();
    this.macroInputs.forEach((input, i) => (input.value = settings.macros[i + 1]));
  }

  private showKeys(): void {
    this.keySelects.forEach((select, slot) => (select.value = String(this.keys[slot])));
  }

  private chooseKey(slot: number, dik: number): void {
    const other = this.keys.findIndex((key, i) => i !== slot && key === dik);
    const old = this.keys[slot];
    this.keys = assignKey(this.keys, slot, dik);
    this.showKeys();
    this.status.textContent = other >= 0 ? `${KEY_SLOTS[other]} 키는 ${keyChoice(old)}(으)로 바뀌었습니다. 저장해야 적용됩니다.` : "";
  }

  /** As the window's 1P and 조이스틱 checks: set up at once and saved by 저장, or the error and the old mark. */
  private chooseDevice(control: Control): void {
    if (this.host.busy()) {
      this.devices.forEach((radio, i) => (radio.checked = this.host.settings.current.control === i));
      return;
    }
    if (control === 1 && !connectedPad()) {
      this.host.message(DEVICE_ERRORS.joystick);
      this.devices.forEach((radio, i) => (radio.checked = this.host.settings.current.control === i));
      return;
    }
    this.saveQuietly(() => this.host.settings.setControl(control));
    this.status.textContent = `${control === 1 ? "조이스틱으로" : "키보드로"} 바꿨습니다. 저장해야 다음에 열 때도 유지됩니다.`;
  }

  private save(event: Event): void {
    event.preventDefault();
    const next = cloneSettings(this.host.settings.current);
    next.music = this.checks.music.checked;
    next.effects = this.checks.effects.checked;
    next.balloons = this.checks.balloons.checked;
    next.keys = [...this.keys];
    this.macroInputs.forEach((input, i) => (next.macros[i + 1] = input.value));
    this.saveQuietly(() => this.host.settings.save(next));
    this.status.textContent = "옵션을 저장했습니다.";
  }

  /** 초기화: the defaults, the device kept, saved at once; a click, dropped as the window's is. */
  private reset(): void {
    if (this.host.busy()) return;
    this.host.settings.save(resetSettings(this.host.settings.current));
    this.status.textContent = "기본값으로 되돌려 저장했습니다.";
  }

  private saveQuietly(save: () => void): void {
    this.saving = true;
    try {
      save();
    } finally {
      this.saving = false;
    }
  }

  private requestFriends(): void {
    this.host.send({ type: "friends" });
  }

  /** 위치 새로 고침: the list again, a click dropped as the window's are. */
  private refreshFriends(): void {
    if (!this.host.busy()) this.requestFriends();
  }

  private renderFriends(): void {
    const { friends } = this;
    this.friendList.replaceChildren(
      ...(friends === null
        ? [h("li", {}, "친구 목록을 서버에 묻는 중입니다.")]
        : friends.length === 0
          ? [h("li", {}, "등록한 친구가 없습니다.")]
          : friends.map(({ name, location }) =>
              h(
                "li",
                {},
                h("span", {}, `${name} · ${location || OFFLINE}`),
                h("button", { class: "btn small", type: "button", "aria-label": `${name} 삭제`, onclick: () => this.deleteFriend(name) }, "삭제"),
              ),
            )),
    );
  }

  /** C->S 0x64: the server decides (S->C 0x64). One question at a time, as the window's wait allows. */
  private addFriend(event: Event): void {
    event.preventDefault();
    if (this.asked || this.host.busy()) return;
    this.asked = true;
    this.host.send({ type: "add-friend", name: this.friendInput.value });
  }

  /** C->S 0x65. */
  private deleteFriend(name: string): void {
    if (this.asked || this.host.busy()) return;
    this.asked = true;
    this.host.send({ type: "delete-friend", name });
  }
}
