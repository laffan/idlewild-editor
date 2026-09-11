/**
 * The bar along the bottom of the canvas while a collider is being drawn.
 *
 * The same row extrude mode puts there, and deliberately so: a canvas mode
 * says its name on the left, what is in hand beside it, then the things that
 * change what the pointer means, then the two ways out. Learning one is
 * learning both.
 *
 * What differs is what sits in the middle. Extrude mode's toggles describe
 * the *view* — see through the shape, rub spaces out — while these describe
 * the *edit*: the pointer is adding spaces or taking them away, and Reset
 * puts back the shape the file would have been given on import. Add and
 * Remove are a pair with a pressed state, because one of them is always true;
 * Reset is a plain button, because it happens once and is over.
 */

import { h } from "../lib/dom";
import type { ColliderTool } from "../game/collider-mode";

export interface ColliderBarCallbacks {
  onApply: () => void;
  onCancel: () => void;
  onTool: (tool: ColliderTool) => void;
  onReset: () => void;
}

/** Everything the bar shows, as the mode currently has it. */
export interface ColliderBarState {
  active: boolean;
  /** The PSD being worked on, so the bar says which file this is about. */
  key: string;
  summary: string;
  tool: ColliderTool;
  /** Whether the shape is still the default, which is what Reset undoes. */
  isDefault: boolean;
}

export class ColliderBar {
  readonly root: HTMLElement;
  private readonly title: HTMLElement;
  private readonly size: HTMLElement;
  private readonly add: HTMLButtonElement;
  private readonly remove: HTMLButtonElement;
  private readonly reset: HTMLButtonElement;

  constructor(callbacks: ColliderBarCallbacks) {
    this.title = h("div", { class: "mode-title", text: "Collider" });
    this.size = h("div", { class: "mode-size" });
    this.add = h("button", {
      class: "bar-toggle",
      text: "Add",
      title: "Press or drag to block more spaces",
      "aria-pressed": "true",
      onClick: () => callbacks.onTool("add"),
    });
    this.remove = h("button", {
      class: "bar-toggle",
      text: "Remove",
      title: "Press or drag to clear spaces",
      "aria-pressed": "false",
      onClick: () => callbacks.onTool("remove"),
    });
    this.reset = h("button", {
      class: "bar-toggle",
      text: "Reset",
      title: "Back to the spaces this file blocks by default",
      onClick: callbacks.onReset,
    });

    this.root = h(
      "div",
      { class: "mode-bar collider-bar hidden" },
      this.title,
      this.size,
      h("div", { class: "mode-spacer" }),
      this.add,
      this.remove,
      this.reset,
      h("button", { text: "Cancel", onClick: callbacks.onCancel }),
      h("button", { class: "mode-apply", text: "Apply", onClick: callbacks.onApply }),
    );
  }

  /**
   * Show or hide the bar, and put the mode's state in it.
   *
   * Apply is never disabled. Unlike an extrusion there is always something to
   * write — a collider of no spaces is a file that blocks nothing, which is a
   * real answer and one somebody may well have meant. Reset is disabled while
   * the shape *is* the default, because there is nothing for it to undo.
   */
  update(state: ColliderBarState): void {
    this.root.classList.toggle("hidden", !state.active);
    if (!state.active) return;
    this.title.textContent = `Collider · ${state.key}.psd`;
    this.size.textContent = state.summary;
    this.add.setAttribute("aria-pressed", String(state.tool === "add"));
    this.remove.setAttribute("aria-pressed", String(state.tool === "remove"));
    this.reset.disabled = state.isDefault;
  }

  destroy(): void {
    this.root.remove();
  }
}
