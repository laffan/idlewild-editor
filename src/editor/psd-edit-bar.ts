/**
 * The bar along the bottom of the canvas while a PSD layer is being drawn
 * into.
 *
 * The third of the same row: a mode says its name on the left, what is in
 * hand beside it, the tools that change what the pointer means, then the two
 * ways out. Learning one is learning all four.
 *
 * **One toggle in the middle, and only one.** The brush, the size, the
 * smoothing and the colour are in the inspector's TOOL section, where they
 * are while drawing anywhere else in this editor, and a second copy of them
 * here would be a second place they could disagree. Rub is the exception
 * because it is not a setting: it is the pencil with the paint taken out, and
 * what it rubs out is *this session's* ink — which makes it the one thing in
 * hand that means nothing outside this mode, and so the one thing that
 * belongs on this mode's own bar rather than on the drawing toolbar with the
 * tools that work everywhere.
 *
 * It replaces a second tool rail that used to appear under the first while
 * this mode was up. Fill and Pixels were on it too, and they were the reason
 * it had to go: both work anywhere, so both are on the drawing toolbar now,
 * and a column that grew and shrank under your hand was carrying one button
 * that actually belonged to the mode.
 */

import { h } from "../lib/dom";

export interface PsdEditBarCallbacks {
  onApply: () => void;
  onCancel: () => void;
  /** Rub pressed, or pressed again — true is on, and the pencil is off. */
  onRub: (rubbing: boolean) => void;
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
  /** Whether the pointer is currently the rubber rather than the pencil. */
  rubbing: boolean;
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
  private readonly rub: HTMLButtonElement;
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
    this.rub = h("button", {
      class: "bar-toggle",
      text: "Rub",
      title: "Rub out ink drawn in this session",
      "aria-pressed": "false",
      // Pressing the one that is down goes back to the pencil, which is the
      // way out of it and saves a second button saying "the pencil again".
      onClick: () =>
        callbacks.onRub(this.rub.getAttribute("aria-pressed") !== "true"),
    });
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
      this.rub,
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
   * Both ways out go quiet while a write is in flight, and so does Rub.
   * Cancel as well as Apply: the strokes it would throw away are the ones
   * being written, and the mode is only still up because the write can be
   * refused.
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
    this.rub.setAttribute("aria-pressed", String(state.rubbing));
    this.rub.disabled = state.busy;
    this.apply.disabled = state.busy || !state.canApply;
    this.cancel.disabled = state.busy;
    this.progress.hidden = !state.busy;
  }

  destroy(): void {
    this.root.remove();
  }
}
