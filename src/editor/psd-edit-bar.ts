/**
 * The bar along the bottom of the canvas while a PSD layer is being drawn
 * into.
 *
 * The third of the same row: a mode says its name on the left, what is in
 * hand beside it, the tools that change what the pointer means, then the two
 * ways out. Learning one is learning all four.
 *
 * **Nothing in hand is set from here.** The brush, the size, the smoothing,
 * the colour and whether the tool is turned round to erase are in the
 * inspector's TOOL section, where they are while drawing anywhere else in
 * this editor, and a second copy of any of them here would be a second place
 * they could disagree. So the bar says which file and which layer, counts the
 * ink, and offers the two ways out.
 *
 * Two things have been taken off it. First a second tool rail that appeared
 * under the first while this mode was up, carrying Rub, Fill and Pixels: the
 * last two work anywhere, so they are on the drawing toolbar, and a column
 * that grew and shrank under your hand was carrying one button that actually
 * belonged to the mode. Then Rub itself, which became that one button — the
 * pencil with the paint taken out, rubbing out this session's ink. Every
 * brush can be turned round now (`ERASABLE` in `tool-rail.ts`), which gives
 * this mode four erasers that work the way the rest of the editor's do, so a
 * fifth with a rule of its own was one eraser too many.
 */

import { h } from "../lib/dom";

export interface PsdEditBarCallbacks {
  onApply: () => void;
  onCancel: () => void;
}

/** Everything the bar shows, as the session currently stands. */
export interface PsdEditBarState {
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
   * second press. See `apply` in psd-edit.ts for what the second one did.
   */
  busy: boolean;
}

export class PsdEditBar {
  readonly root: HTMLElement;
  private readonly title: HTMLElement;
  private readonly size: HTMLElement;
  private readonly cancel: HTMLButtonElement;
  private readonly apply: HTMLButtonElement;
  /**
   * The line along the bottom of the bar while a write is in flight.
   *
   * Indeterminate, because the pipeline reports the stage it has reached and
   * not how far through it is, and a bar that filled up at a rate nobody
   * measured would be a guess dressed as a measurement. What it is for is the
   * other question — whether anything is happening at all — and for that,
   * motion is the whole answer.
   */
  private readonly progress: HTMLElement;

  constructor(callbacks: PsdEditBarCallbacks) {
    this.title = h("div", { class: "mode-title", text: "PSD Edit Mode" });
    this.size = h("div", { class: "mode-size" });
    this.progress = h("div", { class: "progress-bar mode-progress", hidden: "true" });
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
      { class: "mode-bar psd-edit-bar hidden" },
      this.title,
      this.size,
      h("div", { class: "mode-spacer" }),
      this.cancel,
      this.apply,
      this.progress,
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
   * Both ways out go quiet while a write is in flight — Cancel as well as
   * Apply: the strokes it would throw away are the ones being written, and
   * the mode is only still up because the write can be refused.
   *
   * The layer's name steps aside while the write runs. What is in that slot
   * then is the pipeline's own line, which names the layer itself — and the
   * room is better spent on the half that is changing.
   */
  update(state: PsdEditBarState): void {
    this.root.classList.toggle("hidden", !state.active);
    if (!state.active) return;
    this.title.textContent = `PSD Edit Mode · ${state.key}.psd`;
    this.size.textContent =
      state.layer && !state.busy
        ? `${state.layer} · ${state.summary}`
        : state.summary;
    this.apply.disabled = state.busy || !state.canApply;
    this.cancel.disabled = state.busy;
    this.progress.hidden = !state.busy;
  }

  destroy(): void {
    this.root.remove();
  }
}
