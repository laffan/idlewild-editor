/**
 * The controls that sit at the end of an options row.
 *
 * `options-list.ts` builds the rows; this builds the things a row is *for*.
 * Split because they are two jobs and one file would be over the line limit
 * long before either was finished — and because a page that only lists things
 * (the Logins sheet) needs the first and none of this.
 *
 * **Every one of these is uncontrolled.** It is created from a value, reports
 * changes and never re-reads its own state from anywhere. That is the same
 * deliberate omission `options-list.ts` makes and for the same reason: a page
 * that needs to redraw builds its rows again, and a control that owned state
 * would be the thing every page then had to work around. The two that can be
 * driven from outside — the segmented control's `select` and `setEnabled` —
 * are there because one choice genuinely disables another, and that is a fact
 * about the sheet rather than about the control.
 */

import { h } from "./dom";

export interface SegmentedOption {
  value: string;
  label: string;
}

export interface SegmentedControl {
  root: HTMLElement;
  /** Choose from outside, without firing `onPick`. */
  select: (value: string) => void;
  /** Grey one out. Does not move off it — the caller decides what instead. */
  setEnabled: (value: string, enabled: boolean) => void;
}

/**
 * A row of mutually exclusive choices, sized for a row rather than for a form.
 *
 * `aria-pressed` rather than a radio group: these are buttons that look
 * pressed, they are styled as such everywhere else in the app, and a radio
 * group inside a row the whole width of which is sometimes itself a button is
 * a nesting nobody wants to reason about.
 */
export function optionSegmented(
  options: SegmentedOption[],
  initial: string,
  onPick: (value: string) => void,
): SegmentedControl {
  const buttons = new Map<string, HTMLButtonElement>();
  const root = h("div", { class: "opt-seg", role: "group" });

  for (const option of options) {
    const button = h("button", {
      class: "opt-seg-btn",
      type: "button",
      text: option.label,
      "aria-pressed": String(option.value === initial),
      onClick: (event: Event) => {
        // The row around it may be tappable. A press on a choice is about the
        // choice.
        event.stopPropagation();
        for (const other of buttons.values()) {
          other.setAttribute("aria-pressed", "false");
        }
        button.setAttribute("aria-pressed", "true");
        onPick(option.value);
      },
    }) as HTMLButtonElement;
    buttons.set(option.value, button);
    root.appendChild(button);
  }

  return {
    root,
    select: (value) => {
      for (const [key, button] of buttons) {
        button.setAttribute("aria-pressed", String(key === value));
      }
    },
    setEnabled: (value, enabled) => {
      const button = buttons.get(value);
      if (button) button.disabled = !enabled;
    },
  };
}

export interface SwitchControl {
  root: HTMLElement;
  set: (on: boolean) => void;
  get: () => boolean;
}

/**
 * A two-state switch, for a row whose subject is on or off.
 *
 * A switch rather than a checkbox because a settings row's answer takes effect
 * as it is changed — there is no Save on these sheets — and a checkbox is the
 * shape of something that will be submitted. `role="switch"` says exactly
 * that to anything reading the page.
 */
export function optionSwitch(
  initial: boolean,
  onChange: (on: boolean) => void,
  label?: string,
): SwitchControl {
  let on = initial;

  const root = h("button", {
    class: "opt-switch",
    type: "button",
    role: "switch",
    "aria-checked": String(on),
    ...(label ? { "aria-label": label } : {}),
    onClick: (event: Event) => {
      event.stopPropagation();
      on = !on;
      root.setAttribute("aria-checked", String(on));
      onChange(on);
    },
  }, h("span", { class: "opt-switch-knob" })) as HTMLButtonElement;

  return {
    root,
    set: (next) => {
      on = next;
      root.setAttribute("aria-checked", String(on));
    },
    get: () => on,
  };
}

export interface SwitchRow {
  root: HTMLElement;
  /** Move the switch without firing `onChange` — see the note at the top. */
  set: (on: boolean) => void;
}

export interface SwitchRowOptions {
  label: string;
  value: boolean;
  onChange: (on: boolean) => void;
  /** The sentence the row carries. It may say something different when on. */
  title?: string;
}

/**
 * A switch with its label, for a **panel** rather than for a settings sheet.
 *
 * `optionRow` is the sheet's version and it is a 58px row inside a bordered
 * card, which is the right shape for a page of settings and the wrong one for
 * a 300px sidebar where everything else is thirty pixels tall. This is the
 * same switch at the column's scale: the words on the left, the switch on the
 * right, and nothing drawn around them.
 *
 * **The whole row is the hit target**, not just the switch. Forty-four pixels
 * is a small thing to aim a finger at when there are words beside it doing
 * nothing, and `optionSwitch` already stops its own click from propagating —
 * which is what lets a sheet's row be a button around one, and what keeps a
 * press here from arriving twice.
 */
export function optionSwitchRow(options: SwitchRowOptions): SwitchRow {
  const control = optionSwitch(options.value, options.onChange, options.label);
  const root = h(
    "div",
    {
      class: "opt-switch-row",
      ...(options.title ? { title: options.title } : {}),
      onClick: () => {
        const next = !control.get();
        control.set(next);
        options.onChange(next);
      },
    },
    h("span", { class: "opt-switch-label", text: options.label }),
    control.root,
  );
  return { root, set: (on) => control.set(on) };
}

export interface NumberControl {
  root: HTMLElement;
  input: HTMLInputElement;
  set: (value: number) => void;
}

export interface NumberOptions {
  value: number;
  min: number;
  max: number;
  step?: number;
  /** Printed after the box — `px`, `×`. Not part of the value. */
  unit?: string;
  label: string;
  onChange: (value: number) => void;
}

/**
 * A number, with its unit beside it.
 *
 * **Clamped on the way out, never on the way in.** Rewriting the box while
 * somebody is typing is how a field becomes impossible to use: clearing it to
 * type `120` passes through empty, and a control that snapped that to the
 * minimum would fight every edit. So `input` reports whatever currently parses
 * and is in range, and the box is only corrected on `blur` — by which point
 * the person has finished saying what they meant.
 *
 * A text box rather than `type="number"`: the spinners are useless at this
 * size, and WKWebView's numeric keypad on iPadOS is the right keyboard, which
 * is what `inputmode` asks for directly.
 */
export function optionNumber(options: NumberOptions): NumberControl {
  const { min, max, step = 1, unit, label, onChange } = options;

  const clamp = (value: number) =>
    Math.min(max, Math.max(min, Math.round(value / step) * step));

  const input = h("input", {
    class: "opt-number",
    type: "text",
    inputmode: "numeric",
    value: String(options.value),
    spellcheck: "false",
    autocomplete: "off",
    "aria-label": label,
    onClick: (event: Event) => event.stopPropagation(),
  }) as HTMLInputElement;

  input.addEventListener("input", () => {
    const parsed = Number(input.value.trim());
    if (!Number.isFinite(parsed)) return;
    if (parsed < min || parsed > max) return;
    onChange(clamp(parsed));
  });

  input.addEventListener("blur", () => {
    const parsed = Number(input.value.trim());
    const settled = Number.isFinite(parsed) ? clamp(parsed) : options.value;
    input.value = String(settled);
    onChange(settled);
  });

  return {
    root: h(
      "div",
      { class: "opt-number-wrap" },
      input,
      unit ? h("span", { class: "opt-number-unit", text: unit }) : null,
    ),
    input,
    set: (value) => {
      input.value = String(value);
    },
  };
}

export interface SwatchControl {
  root: HTMLElement;
  set: (hex: string) => void;
}

/**
 * A colour, as the colour itself with its hex beside it.
 *
 * The press is handed on rather than handled: this app's colour picker is a
 * panel, and where it opens — a popover, a sheet, the inspector's own column —
 * is the caller's question. What belongs here is what the answer looks like
 * once it is given.
 */
export function optionSwatch(
  initial: string,
  onSelect: () => void,
  label: string,
): SwatchControl {
  const chip = h("span", { class: "opt-swatch-chip" });
  chip.style.background = initial;
  const text = h("span", { class: "opt-swatch-hex", text: initial.toUpperCase() });

  const root = h(
    "button",
    {
      class: "opt-swatch",
      type: "button",
      "aria-label": label,
      onClick: (event: Event) => {
        event.stopPropagation();
        onSelect();
      },
    },
    chip,
    text,
  );

  return {
    root,
    set: (hex) => {
      chip.style.background = hex;
      text.textContent = hex.toUpperCase();
    },
  };
}

/** A plain text box at the end of a row — a name, a title. */
export function optionText(
  value: string,
  onInput: (value: string) => void,
  attrs: { placeholder?: string; maxlength?: string; label: string },
): HTMLInputElement {
  const input = h("input", {
    class: "opt-text",
    type: "text",
    value,
    placeholder: attrs.placeholder ?? "",
    maxlength: attrs.maxlength ?? "60",
    "aria-label": attrs.label,
    onClick: (event: Event) => event.stopPropagation(),
  }) as HTMLInputElement;

  input.addEventListener("input", () => onInput(input.value));
  return input;
}
