/**
 * The bar along the bottom of the canvas while extrude mode is up.
 *
 * It says which mode the canvas is in on the left, carries the two things
 * that change what the pointer means, and offers the two ways out on the
 * right. A bar rather than a sheet because the canvas underneath is the thing
 * being worked on — a modal over it would hide the shape the buttons are
 * about — and it is the counterpart to the dim: chrome that says the rules
 * have changed, and one place to change them back.
 *
 * Apply is the accent button, as the first item of the floating action bar
 * is: it is what the mode is for, and Cancel is the way out of a mistake. The
 * two toggles sit between, pressed-state styled, because they describe the
 * canvas rather than doing anything to it.
 */

import { h } from "../lib/dom";

export interface ExtrudeBarCallbacks {
  onApply: () => void;
  onCancel: () => void;
  onToggleBackfaces: () => void;
  onToggleErase: () => void;
}

/** Everything the bar shows, as the mode currently has it. */
export interface ExtrudeBarState {
  active: boolean;
  summary: string;
  canApply: boolean;
  backfaces: boolean;
  erasing: boolean;
  /** Whether this projection has a far side to see at all. */
  hasBackfaces: boolean;
}

export class ExtrudeBar {
  readonly root: HTMLElement;
  private readonly size: HTMLElement;
  private readonly backfaces: HTMLButtonElement;
  private readonly erase: HTMLButtonElement;
  private readonly apply: HTMLButtonElement;

  constructor(callbacks: ExtrudeBarCallbacks) {
    this.size = h("div", { class: "mode-size" });
    this.backfaces = h("button", {
      class: "bar-toggle",
      text: "Backfaces",
      title: "See through the shape and pick its far side — or hold ⌘",
      "aria-pressed": "false",
      onClick: callbacks.onToggleBackfaces,
    });
    this.erase = h("button", {
      class: "bar-toggle",
      text: "Erase",
      title: "Rub out spaces one at a time",
      "aria-pressed": "false",
      onClick: callbacks.onToggleErase,
    });
    this.apply = h("button", {
      class: "mode-apply",
      text: "Apply",
      onClick: callbacks.onApply,
    });
    this.root = h(
      "div",
      { class: "mode-bar hidden" },
      h("div", { class: "mode-title", text: "Extrude Mode" }),
      this.size,
      h("div", { class: "mode-spacer" }),
      this.backfaces,
      this.erase,
      h("button", { text: "Cancel", onClick: callbacks.onCancel }),
      this.apply,
    );
  }

  /**
   * Show or hide the bar, and put the mode's state in it.
   *
   * Apply is disabled until there is a solid to apply: the mode is entered
   * over a plate that has not been pulled yet, and a button that wrote an
   * empty PSD would be a button that did nothing twice. Backfaces is hidden
   * rather than disabled where the projection is flat — a toggle for
   * something that does not exist there is worse than no toggle.
   */
  update(state: ExtrudeBarState): void {
    this.root.classList.toggle("hidden", !state.active);
    if (!state.active) return;
    this.size.textContent = state.summary;
    this.apply.disabled = !state.canApply;
    this.backfaces.hidden = !state.hasBackfaces;
    this.backfaces.setAttribute("aria-pressed", String(state.backfaces));
    this.erase.setAttribute("aria-pressed", String(state.erasing));
  }

  destroy(): void {
    this.root.remove();
  }
}
