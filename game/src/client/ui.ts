type Child = Node | string | null | undefined | false;
type Props = Record<string, string | number | boolean | EventListener | undefined>;

/** Tiny DOM builder: attributes by name, `on<event>` props become listeners. */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Props = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === false) continue;
    if (key.startsWith("on") && typeof value === "function") {
      element.addEventListener(key.slice(2), value);
    } else if (key === "class") {
      element.className = String(value);
    } else if (value === true) {
      element.setAttribute(key, "");
    } else {
      element.setAttribute(key, String(value));
    }
  }
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    element.append(child);
  }
  return element;
}

/** A server-updated roster keeps the keyboard on the same action, if that target still exists. */
export function replaceChildrenKeepingFocus(parent: HTMLElement, ...children: Node[]): void {
  const active = document.activeElement;
  const key = parent.contains(active) ? active?.getAttribute("data-focus-key") : null;
  parent.replaceChildren(...children);
  if (!key) return;
  const next = [...parent.querySelectorAll<HTMLElement>("[data-focus-key]")]
    .find((element) => element.getAttribute("data-focus-key") === key);
  next?.focus({ preventScroll: true });
}

export function readPreference(key: string): string | null {
  try {
    return localStorage.getItem(`shake2.${key}`);
  } catch {
    return null;
  }
}

export function writePreference(key: string, value: string): void {
  try {
    localStorage.setItem(`shake2.${key}`, value);
  } catch {
    // Preferences are a convenience only.
  }
}

export interface Choice {
  value: string;
  label: string;
  image?: HTMLElement;
}

/** A radio group rendered as cards; native radios keep arrow-key navigation. */
export function choiceGroup(
  legend: string,
  name: string,
  choices: readonly Choice[],
  selected: string,
  onChange: (value: string) => void,
): HTMLFieldSetElement {
  return h(
    "fieldset",
    { class: "choices" },
    h("legend", {}, legend),
    h(
      "div",
      { class: "choice-grid" },
      ...choices.map((choice) =>
        h(
          "label",
          { class: "choice" },
          h("input", {
            type: "radio",
            name,
            value: choice.value,
            checked: choice.value === selected,
            onchange: () => onChange(choice.value),
          }),
          choice.image ?? null,
          h("span", { class: "choice-label" }, choice.label),
        ),
      ),
    ),
  );
}
