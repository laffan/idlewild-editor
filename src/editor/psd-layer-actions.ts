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
 * **Reset Layer Position** is the other exception, and it is not part of that
 * row either: it is a correction rather than a standing action, it is drawn
 * only while a layer of this PSD is standing somewhere the file does not put
 * it, and its being there at all is the only thing that says so. It goes
 * directly over the list.
 *
 * Nothing here holds state. The editor owns what these do; the list owns when
 * to draw them.
 */

import { h } from "../lib/dom";

/**
 * What the canvas and the document have made of the placement a layer list
 * belongs to.
 *
 * Neither fact is about the file, which is why the list is *told* them rather
 * than reading them: `members` and `adjusting` are how many layers of it stand
 * on the canvas as one thing and whether it has been opened up, and
 * `displaced` is how many of them have been moved off the space the file puts
 * them on — `game/layer-home.ts`. Between them they decide which of the two
 * rows below are drawn at all.
 */
export interface PlacedState {
  members: number;
  adjusting: boolean;
  displaced: number;
}

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
  /** And bringing it back, which is a re-parse on both — see `psd-actions.ts`. */
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
 * **Reset Layer Position**, directly above the list, and only when there is
 * something to put back.
 *
 * A row of its own rather than a fourth button beside the three above it. It
 * is not one of that set — those three are always there and are about the
 * file, and this is a correction that is usually absent and is about the
 * *document* — and its appearing is the only thing on screen that says a layer
 * of this PSD has been moved off the space the file puts it on. The canvas
 * cannot say it: a roof dragged half a space sideways looks exactly like a
 * roof drawn half a space sideways.
 *
 * `displaced` is how many layers are out of place — `game/layer-home.ts` — so
 * the label names one layer or several, the way *Remove PSD from layer* names
 * what it takes.
 *
 * Returns null when nothing has moved, so the caller appends whatever it gets
 * rather than asking the question twice.
 */
export function resetPositionsRow(
  displaced: number,
  onReset: () => void,
): HTMLElement | null {
  if (displaced <= 0) return null;
  const one = displaced === 1;
  return h(
    "div",
    { class: "psd-layers-reset" },
    h("button", {
      class: "panel-btn warn",
      text: one ? "Reset Layer Position" : "Reset Layer Positions",
      title:
        `${one ? "One layer of" : `${displaced} layers of`} this PSD ` +
        `${one ? "is" : "are"} not standing where the file puts ` +
        `${one ? "it" : "them"}. This puts ${one ? "it" : "them"} back, and ` +
        `throws away the ${one ? "move" : "moves"}.`,
      onClick: onReset,
    }),
  );
}

/**
 * New layer, under the list.
 *
 * It writes straight away rather than joining the pending edits above it: the
 * row it makes is somewhere to draw, and PSD Edit mode needs a layer that is
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
