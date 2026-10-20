/**
 * A button that carries its own settings: the action on the left, and on the
 * right a smaller half that opens a dropdown of checkboxes about it.
 *
 * Open PSD is the first: Include palette and Include context are about *this*
 * send, and as two checkboxes laid out under the button they read as settings
 * of the panel rather than of the press. Here they are one control. The
 * options half shows a mark for every option that is on, beside its own
 * sliders glyph, so what the press will do is on the button without opening
 * anything — and the marks are inside the half that opens the dropdown,
 * because a tap on what is set is how you go to change it.
 *
 * The two halves are separate buttons, not one button with a hot corner: a
 * control inside a button is not one a finger or a screen reader can reach.
 */

import { h, ICONS, icon } from "./dom";
import { openMenu, type MenuHandle } from "./menu";

export interface ButtonOption {
  label: string;
  /** The mark shown beside the options glyph while this option is on. */
  glyph: string | readonly string[];
  /** The explanation, on hover in the dropdown and on the mark. */
  title?: string;
  on: boolean;
  /** Told the new answer at once; the dropdown stays open. */
  onChange: (on: boolean) => void;
}

export interface WithOptionsButton {
  label: string;
  title?: string;
  onClick: () => void;
  /** What the options half is called, for a screen reader and on hover. */
  optionsLabel: string;
  options: ButtonOption[];
}

/** The options that are on, in the order the dropdown lists them. */
export function optionsShown(options: readonly ButtonOption[]): ButtonOption[] {
  return options.filter((option) => option.on);
}

export function withOptionsButton(spec: WithOptionsButton): HTMLElement {
  // A copy, so the marks can follow a tick without the caller re-rendering.
  const options = spec.options.map((option) => ({ ...option }));
  const marks = h("span", { class: "with-options-marks" });
  let menu: MenuHandle | null = null;

  const renderMarks = () => {
    marks.replaceChildren(
      ...optionsShown(options).map((option) =>
        h("span", { class: "with-options-mark", title: option.label }, icon(option.glyph, 14)),
      ),
    );
  };

  const more = h(
    "button",
    {
      class: "panel-btn with-options-more",
      title: spec.optionsLabel,
      "aria-label": spec.optionsLabel,
      "aria-haspopup": "menu",
      "aria-expanded": "false",
      onClick: () => {
        if (menu) {
          menu.close();
          return;
        }
        more.setAttribute("aria-expanded", "true");
        menu = openMenu(
          more,
          options.map((option) => ({
            label: option.label,
            glyph: option.glyph,
            title: option.title,
            checked: option.on,
            onSelect: () => {
              option.on = !option.on;
              renderMarks();
              option.onChange(option.on);
            },
          })),
          () => {
            menu = null;
            more.setAttribute("aria-expanded", "false");
          },
        );
      },
    },
    marks,
    h("span", { class: "with-options-glyph" }, icon(ICONS.sliders, 15)),
  );
  renderMarks();

  return h(
    "div",
    { class: "with-options" },
    h("button", {
      class: "panel-btn with-options-main",
      text: spec.label,
      title: spec.title ?? null,
      onClick: spec.onClick,
    }),
    more,
  );
}
