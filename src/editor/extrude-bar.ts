/**
 * The bar along the bottom of the canvas while extrude mode is up.
 *
 * It says which mode the canvas is in on the left and offers the two ways out
 * on the right. A bar rather than a sheet because the canvas underneath is
 * the thing being worked on — a modal over it would hide the shape the two
 * buttons are about — and it is the counterpart to the dim: chrome that says
 * the rules have changed, and one place to change them back.
 *
 * Apply is the accent button, as the first item of the floating action bar
 * is: it is what the mode is for, and Cancel is the way out of a mistake.
 */

import { h } from "../lib/dom";

export interface ExtrudeBarCallbacks {
  onApply: () => void;
  onCancel: () => void;
}

export class ExtrudeBar {
  readonly root: HTMLElement;
  private readonly size: HTMLElement;
  private readonly apply: HTMLButtonElement;

  constructor(callbacks: ExtrudeBarCallbacks) {
    this.size = h("div", { class: "extrude-size" });
    this.apply = h("button", {
      class: "extrude-apply",
      text: "Apply",
      onClick: callbacks.onApply,
    });
    this.root = h(
      "div",
      { class: "extrude-bar hidden" },
      h("div", { class: "extrude-title", text: "Extrude Mode" }),
      this.size,
      h("div", { class: "extrude-spacer" }),
      h("button", { text: "Cancel", onClick: callbacks.onCancel }),
      this.apply,
    );
  }

  /**
   * Show or hide the bar, and say what is under it.
   *
   * Apply is disabled until there is a solid to apply: the mode is entered
   * over a plate that has not been pulled yet, and a button that wrote an
   * empty PSD would be a button that did nothing twice.
   */
  update(active: boolean, summary: string, canApply: boolean): void {
    this.root.classList.toggle("hidden", !active);
    if (!active) return;
    this.size.textContent = summary;
    this.apply.disabled = !canApply;
  }

  destroy(): void {
    this.root.remove();
  }
}
