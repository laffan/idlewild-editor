/**
 * The buttons around a PSD's layer list.
 *
 * The PSD section reads top to bottom as the file's name and size, then
 * **Edit Layers** — the stack, New layer, and Adjust layers — then what is
 * done to the file as a whole: send it out (Open PSD, with what goes with it
 * in its own dropdown) and bring it back (Re-parse).
 *
 * Adjust layers is in the fold with the stack because it is about the layers:
 * it opens the PSD up on the canvas so they move one at a time. It sits under
 * New layer, which sits under the list, where the thing it makes appears.
 *
 * **Reset Layer Position** is a correction rather than a standing action: it
 * is drawn only while a layer of this PSD is standing somewhere the file does
 * not put it, and its being there at all is the only thing that says so. It
 * stays outside the fold, which starts closed, so it is never hidden in one.
 *
 * Nothing here holds state. The editor owns what these do; the list owns when
 * to draw them.
 */

import { h, ICONS } from "../lib/dom";
import { withOptionsButton } from "../lib/with-options-button";
import { EDIT_LAYERS, sectionTitle } from "./inspect-collapse";

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

/** What the file's own buttons say. */
export interface PsdHeadState {
  /** What sending the file out is called here — it differs by platform. */
  openLabel: string;
  /** And bringing it back, which is a re-parse on both — see `psd-actions.ts`. */
  refreshLabel: string;
}

export interface PsdHeadCallbacks {
  onOpen: () => void;
  onRefresh: () => void;
}

/**
 * The two boxes inside the Open / Share control: what goes into the file with
 * it. Optional, so a list built with no opinion about them shows the plain
 * button. See `psd-send.ts`.
 */
export interface PsdIncludeCallbacks {
  /** The file's two answers as they stand. */
  include?: () => { palette: boolean; context: boolean };
  /** Tick or untick one — the layer it controls follows at once. */
  onInclude?: (patch: { palette?: boolean; context?: boolean }) => void;
}

/**
 * The file's own actions, after Edit Layers: Open PSD (or Share PSD) with its
 * options, and Re-parse under it — out, and back.
 */
export function psdHeadRow(
  state: PsdHeadState,
  callbacks: PsdHeadCallbacks,
  include: PsdIncludeCallbacks = {},
): HTMLElement {
  return h(
    "div",
    { class: "psd-layers-head-block" },
    openControl(state, callbacks, include),
    h("button", {
      class: "panel-btn",
      text: state.refreshLabel,
      onClick: callbacks.onRefresh,
    }),
  );
}

/**
 * Open PSD (or Share PSD), with what goes out with it in its own dropdown.
 *
 * **Include palette** puts the palette strip in the file and **Include
 * context** a picture of the canvas around it, each written fresh every time
 * the file goes out; unticking one takes its layer out. They are about *this*
 * send, so they are the button's options rather than two checkboxes laid out
 * under it — see `lib/with-options-button.ts`, which also puts a mark beside
 * the options glyph for each one that is on.
 */
function openControl(
  state: PsdHeadState,
  callbacks: PsdHeadCallbacks,
  include: PsdIncludeCallbacks,
): HTMLElement {
  const choice = include.include?.();
  if (!choice || !include.onInclude) {
    return h("button", {
      class: "panel-btn psd-open-btn",
      text: state.openLabel,
      onClick: callbacks.onOpen,
    });
  }
  const onInclude = include.onInclude;
  return withOptionsButton({
    label: state.openLabel,
    onClick: callbacks.onOpen,
    optionsLabel: "What goes into the PSD with it",
    options: [
      {
        label: "Include palette",
        glyph: ICONS.swatches,
        on: choice.palette,
        title:
          "Put your palette into this PSD as a strip of swatches on top, so " +
          "the other app's eyedropper has it. Untick to take it out.",
        onChange: (on) => onInclude({ palette: on }),
      },
      {
        label: "Include context",
        glyph: ICONS.frame,
        on: choice.context,
        title:
          "Put what is around this PSD on the canvas into it, as a layer " +
          "called context at 50% opacity under the artwork — refreshed each " +
          "time it goes out. Untick to take it out.",
        onChange: (on) => onInclude({ context: on }),
      },
    ],
  });
}

/**
 * **Adjust layers**, the last thing in Edit Layers: a switch, pressed while
 * the canvas has this PSD open layer by layer.
 *
 * `members` is how many of its layers are placed as one thing. Zero for a file
 * that is not placed and one for a single-layer document — in both there is
 * nothing to open up, so the button is left out rather than offered and
 * refused, and this returns null.
 */
export function adjustLayersButton(
  members: number,
  adjusting: boolean,
  onToggle: () => void,
): HTMLElement | null {
  if (members <= 1) return null;
  return h("button", {
    class: adjusting ? "panel-btn pressed" : "panel-btn",
    text: adjusting ? "Done adjusting" : "Adjust layers",
    title: adjusting
      ? `Move this PSD as one thing again — ${members} layers`
      : `Move one layer of this PSD at a time — ${members} in it`,
    "aria-pressed": String(adjusting),
    onClick: onToggle,
  });
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

/**
 * Edit Layers: the file's stack, New layer and Adjust layers, as a fold of
 * their own at the head of the PSD section, closed until somebody opens it.
 *
 * What stays outside is about the file rather than its stack — its size, the
 * actions on the whole file, what the list could not do — and so does Apply,
 * because a staged edit is still waiting on it after the fold is closed. A
 * nested `.inspect-section` so the inspector's one fold pass reaches it; it
 * starts closed because `EDIT_LAYERS` is in `FOLDED_FIRST`.
 */
export function editLayersSection(
  list: HTMLElement,
  newRow: HTMLElement,
  adjustRow: HTMLElement,
): HTMLElement {
  return h(
    "div",
    { class: "inspect-section psd-edit-layers" },
    sectionTitle(EDIT_LAYERS),
    list,
    newRow,
    adjustRow,
  );
}
