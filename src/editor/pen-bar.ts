/**
 * The bar along the bottom of the canvas while a PSD layer is being drawn
 * into.
 *
 * The third of the same row: a mode says its name on the left, what is in
 * hand beside it, then the two ways out. Learning one is learning all three.
 *
 * There is nothing in the middle. Extrude's toggles change what a drag means
 * and the collider's change what a press adds or takes away, but here the
 * pointer is a pencil and everything about it — the brush, the size, the
 * smoothing, the colour — is already in the inspector, where it is while
 * drawing anywhere else in this editor. A second copy of those controls on
 * this bar would be a second place they could disagree.
 */

import { h } from "../lib/dom";

export interface PenBarCallbacks {
  onApply: () => void;
  onCancel: () => void;
}

/** Everything the bar shows, as the session currently stands. */
export interface PenBarState {
  active: boolean;
  /** The file being drawn into, so the bar says which one this is about. */
  key: string;
  /** And which layer of it, as the file spells the name. */
  layer: string;
  /** How much ink is waiting to go in, and whether any of it is in frame. */
  summary: string;
  canApply: boolean;
  /**
   * Whether the write Apply started is still in flight.
   *
   * It takes seconds — the file is rebuilt and the whole psd-to-json pipeline
   * runs over it — and a bar that looked ready that whole time invited a
   * second press. See `apply` in pen.ts for what the second one did.
   */
  busy: boolean;
}

export class PenBar {
  readonly root: HTMLElement;
  private readonly title: HTMLElement;
  private readonly size: HTMLElement;
  private readonly cancel: HTMLButtonElement;
  private readonly apply: HTMLButtonElement;

  constructor(callbacks: PenBarCallbacks) {
    this.title = h("div", { class: "mode-title", text: "Pen Mode" });
    this.size = h("div", { class: "mode-size" });
    this.cancel = h("button", {
      text: "Cancel",
      onClick: callbacks.onCancel,
    });
    this.apply = h("button", {
      class: "mode-apply",
      text: "Apply",
      onClick: callbacks.onApply,
    });
    this.root = h(
      "div",
      { class: "mode-bar pen-bar hidden" },
      this.title,
      this.size,
      h("div", { class: "mode-spacer" }),
      this.cancel,
      this.apply,
    );
  }

  /**
   * Show or hide the bar, and put the session's state in it.
   *
   * Apply is disabled until there is ink inside the frame. Not merely until
   * there is ink: a stroke drawn entirely outside the PSD's canvas is trimmed
   * away on the way in, so a button that wrote it would rebuild the file and
   * re-run the whole pipeline to change nothing at all.
   *
   * Both ways out go quiet while a write is in flight. Cancel as well as
   * Apply: the strokes it would throw away are the ones being written, and
   * the mode is only still up because the write can be refused.
   */
  update(state: PenBarState): void {
    this.root.classList.toggle("hidden", !state.active);
    if (!state.active) return;
    this.title.textContent = `Pen Mode · ${state.key}.psd`;
    this.size.textContent = state.layer
      ? `${state.layer} · ${state.summary}`
      : state.summary;
    this.apply.disabled = state.busy || !state.canApply;
    this.cancel.disabled = state.busy;
  }

  destroy(): void {
    this.root.remove();
  }
}
