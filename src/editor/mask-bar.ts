/**
 * The bar along the bottom of the canvas while a pattern layer's shape is
 * being swept.
 *
 * The fourth of the same row, and the collider's layout rather than the pen's:
 * a name on the left, what is in hand beside it, the toggles that say what a
 * sweep does, then the two ways out. Learning one is learning all four.
 *
 * Add and Remove are buttons rather than a held modifier, for collider mode's
 * reason: this editor is driven with a finger on an iPad as often as with a
 * keyboard, and a gesture that needs a key held down is a gesture half the
 * users cannot make.
 */

import { h } from "../lib/dom";
import type { MaskTool } from "../game/mask-mode";

export interface MaskBarCallbacks {
  onApply: () => void;
  onCancel: () => void;
  onTool: (tool: MaskTool) => void;
  onReset: () => void;
  onClear: () => void;
}

/** Everything the bar shows, as the session currently stands. */
export interface MaskBarState {
  active: boolean;
  /** The shape being drawn, so the bar says which one this is about. */
  name: string;
  /** And the layer it confines. */
  layer: string;
  /** How many spaces it holds. */
  summary: string;
  tool: MaskTool;
  /** Whether anything has moved since the mode opened — Reset's own state. */
  isOriginal: boolean;
  /** Whether there is a shape to write. */
  canApply: boolean;
}

export class MaskBar {
  readonly root: HTMLElement;
  private readonly title: HTMLElement;
  private readonly size: HTMLElement;
  private readonly add: HTMLButtonElement;
  private readonly remove: HTMLButtonElement;
  private readonly clear: HTMLButtonElement;
  private readonly reset: HTMLButtonElement;
  private readonly apply: HTMLButtonElement;

  constructor(callbacks: MaskBarCallbacks) {
    this.title = h("div", { class: "mode-title", text: "Pattern Shape" });
    this.size = h("div", { class: "mode-size" });
    this.add = h("button", {
      class: "bar-toggle",
      text: "Add",
      title: "Sweep a rectangle to let the pattern into those spaces",
      "aria-pressed": "true",
      onClick: () => callbacks.onTool("add"),
    });
    this.remove = h("button", {
      class: "bar-toggle",
      text: "Remove",
      title: "Sweep a rectangle to take those spaces back out",
      "aria-pressed": "false",
      onClick: () => callbacks.onTool("remove"),
    });
    this.clear = h("button", {
      class: "bar-toggle",
      text: "Clear",
      title: "Empty the shape and start it again",
      onClick: callbacks.onClear,
    });
    this.reset = h("button", {
      class: "bar-toggle",
      text: "Reset",
      title: "Back to the shape as it was when this opened",
      onClick: callbacks.onReset,
    });
    this.apply = h("button", {
      class: "mode-apply",
      text: "Apply",
      onClick: callbacks.onApply,
    });

    this.root = h(
      "div",
      { class: "mode-bar mask-bar hidden" },
      this.title,
      this.size,
      h("div", { class: "mode-spacer" }),
      this.add,
      this.remove,
      this.clear,
      this.reset,
      h("button", { text: "Cancel", onClick: callbacks.onCancel }),
      this.apply,
    );
  }

  /**
   * Show or hide the bar, and put the session's state in it.
   *
   * Apply is disabled on an empty shape, and that is a rule rather than a
   * nicety. An empty shape *list* means everywhere — it is the whole of what
   * makes a fresh pattern layer infinite — so a shape holding no spaces is a
   * boundary confining the pattern to nothing, which is the one answer nobody
   * ever means. Clear is there for when emptying is the point: empty it, then
   * Cancel, and the layer keeps the shapes it had.
   */
  update(state: MaskBarState): void {
    this.root.classList.toggle("hidden", !state.active);
    if (!state.active) return;
    this.title.textContent = `Pattern Shape · ${state.name}`;
    this.size.textContent = `${state.layer} · ${state.summary}`;
    this.add.setAttribute("aria-pressed", String(state.tool === "add"));
    this.remove.setAttribute("aria-pressed", String(state.tool === "remove"));
    this.reset.disabled = state.isOriginal;
    this.apply.disabled = !state.canApply;
  }

  destroy(): void {
    this.root.remove();
  }
}
