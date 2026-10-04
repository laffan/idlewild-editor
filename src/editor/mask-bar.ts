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

import { h, icon, ICONS } from "../lib/dom";
import type { MaskGesture, MaskTool } from "../game/mask-mode";

export interface MaskBarCallbacks {
  onApply: () => void;
  onCancel: () => void;
  onTool: (tool: MaskTool) => void;
  onGesture: (gesture: MaskGesture) => void;
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
  /** A rectangle across the grid, or a loop swept freehand. */
  gesture: MaskGesture;
  /** Whether anything has moved since the mode opened — Reset's own state. */
  isOriginal: boolean;
  /** Whether there is a shape to write. */
  canApply: boolean;
}

export class MaskBar {
  readonly root: HTMLElement;
  private readonly title: HTMLElement;
  private readonly size: HTMLElement;
  private readonly grid: HTMLButtonElement;
  private readonly sweep: HTMLButtonElement;
  private readonly add: HTMLButtonElement;
  private readonly remove: HTMLButtonElement;
  private readonly clear: HTMLButtonElement;
  private readonly reset: HTMLButtonElement;
  private readonly apply: HTMLButtonElement;

  constructor(callbacks: MaskBarCallbacks) {
    this.title = h("div", { class: "mode-title", text: "Pattern Mask" });
    this.size = h("div", { class: "mode-size" });
    // How the spaces are picked: the Fill tool's sweep is kept in reach here,
    // since the drawing toolbar goes down while the mode is up.
    this.grid = h(
      "button",
      {
        class: "bar-toggle",
        title: "Grid: sweep a rectangle of spaces",
        "aria-pressed": "true",
        onClick: () => callbacks.onGesture("grid"),
      },
      icon(ICONS.select, 15),
      " Grid",
    );
    this.sweep = h(
      "button",
      {
        class: "bar-toggle",
        title: "Sweep fill: draw a loop freehand — every space inside it",
        "aria-pressed": "false",
        onClick: () => callbacks.onGesture("sweep"),
      },
      icon(ICONS.fill, 15),
      " Sweep fill",
    );
    this.add = h("button", {
      class: "bar-toggle",
      text: "Add",
      title: "Let the pattern into the spaces you sweep",
      "aria-pressed": "true",
      onClick: () => callbacks.onTool("add"),
    });
    this.remove = h("button", {
      class: "bar-toggle",
      text: "Remove",
      title: "Take the spaces you sweep back out",
      "aria-pressed": "false",
      onClick: () => callbacks.onTool("remove"),
    });
    this.clear = h("button", {
      class: "bar-toggle",
      text: "Clear",
      title: "Empty the mask and start it again",
      onClick: callbacks.onClear,
    });
    this.reset = h("button", {
      class: "bar-toggle",
      text: "Reset",
      title: "Back to the mask as it was when this opened",
      onClick: callbacks.onReset,
    });
    this.apply = h("button", {
      class: "mode-apply",
      text: "Apply",
      onClick: callbacks.onApply,
    });

    // Two rows: what this is and the two ways out on top, and the tools
    // under them — eight buttons on one row crowded the name off the bar.
    this.root = h(
      "div",
      { class: "mode-bar mask-bar hidden" },
      h(
        "div",
        { class: "mask-bar-row" },
        this.title,
        this.size,
        h("div", { class: "mode-spacer" }),
        h("button", { text: "Cancel", onClick: callbacks.onCancel }),
        this.apply,
      ),
      h(
        "div",
        { class: "mask-bar-row tools" },
        this.grid,
        this.sweep,
        h("div", { class: "mask-bar-gap" }),
        this.add,
        this.remove,
        h("div", { class: "mode-spacer" }),
        this.clear,
        this.reset,
      ),
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
    this.title.textContent = `Pattern Mask · ${state.name}`;
    this.grid.setAttribute("aria-pressed", String(state.gesture === "grid"));
    this.sweep.setAttribute("aria-pressed", String(state.gesture === "sweep"));
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
