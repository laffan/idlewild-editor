/**
 * The buttons around a PSD's layer list: the row above it, and the one thing
 * below it.
 *
 * They were spread across the inspector — Adjust layers up near the top of
 * the panel as a note beside the file's name, Open PSD and Re-parse right
 * down at the bottom under the stack. Three buttons about the same file, in
 * three places, with the list they are all about in between. They are one row
 * now, directly over the list, because every one of them is an answer to
 * *what do I want to do with this file*: open it up on the canvas, send it
 * out, bring it back.
 *
 * New layer is the exception and sits under the list, where the thing it
 * makes will appear — which is at the top, because a new layer goes on top of
 * a stack the way it does in Photoshop.
 *
 * Nothing here holds state. The editor owns what these do; the list owns when
 * to draw them.
 */

import { h } from "../lib/dom";

/** What the row above the list currently has to say. */
export interface PsdHeadState {
  /**
   * How many of this PSD's layers are placed as one thing on the canvas.
   *
   * Zero for a file that is not placed at all, and one for a single-layer
   * document — in both of those Adjust layers has nothing to open up, so it
   * is left out rather than offered and refused.
   */
  members: number;
  /** Whether the canvas already has it open, layer by layer. */
  adjusting: boolean;
  /** What sending the file out is called here — it differs by platform. */
  openLabel: string;
  /** And bringing it back: a re-parse on desktop, a re-import on iPadOS. */
  refreshLabel: string;
}

export interface PsdHeadCallbacks {
  onToggleAdjust: () => void;
  onOpen: () => void;
  onRefresh: () => void;
}

/**
 * The row above the list.
 *
 * Adjust layers first, because it is the one that changes the canvas rather
 * than the file, and it reads as a switch: pressed while the PSD is open.
 */
export function psdHeadRow(
  state: PsdHeadState,
  callbacks: PsdHeadCallbacks,
): HTMLElement {
  const row = h("div", { class: "panel-btn-row psd-layers-head" });
  if (state.members > 1) {
    row.appendChild(
      h("button", {
        class: state.adjusting ? "panel-btn pressed" : "panel-btn",
        text: state.adjusting ? "Done adjusting" : "Adjust layers",
        title: state.adjusting
          ? `Move this PSD as one thing again — ${state.members} layers`
          : `Move one layer of this PSD at a time — ${state.members} in it`,
        "aria-pressed": String(state.adjusting),
        onClick: callbacks.onToggleAdjust,
      }),
    );
  }
  row.append(
    h("button", {
      class: "panel-btn",
      text: state.openLabel,
      onClick: callbacks.onOpen,
    }),
    h("button", {
      class: "panel-btn",
      text: state.refreshLabel,
      onClick: callbacks.onRefresh,
    }),
  );
  return row;
}

/**
 * New layer, under the list.
 *
 * It writes straight away rather than joining the pending edits above it: the
 * row it makes is somewhere to draw, and pen mode needs a layer that is
 * really in the file before it can put ink in one. Disabled while a write is
 * already in flight, because two rebuilds of the same file racing each other
 * is how one of them gets lost.
 */
export function newLayerButton(busy: boolean, onAdd: () => void): HTMLElement {
  return h(
    "div",
    { class: "psd-layers-new" },
    h("button", {
      class: "panel-btn",
      text: "New layer",
      title: "Add an empty sprite layer to the top of this PSD",
      disabled: busy ? "true" : null,
      onClick: onAdd,
    }),
  );
}
