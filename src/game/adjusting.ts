/**
 * A placed PSD is one thing, until you say otherwise.
 *
 * Normally a file placed on the canvas moves, resizes and deletes as a unit —
 * tapping its roof selects the building. A double tap **opens it up**: from
 * then until the selection leaves it, each of its layers is its own object.
 * The scene holds which unit is open, in one nullable field; what that field
 * *means* at each of the four places it is read is here.
 *
 * Split out of `world-scene.ts` because it is a rule rather than a piece of
 * scene state: none of it touches Phaser, the camera or the display list, and
 * all of it is a question about the document and what is selected in it. The
 * scene keeps the field and the four one-line methods that delegate here,
 * which is what keeps its own file about the canvas.
 */

import type { DocStore } from "../lib/doc-store";
import type { Placement, Selection } from "../lib/types";
import type { PickResult } from "./picking";
import { unitMembers, unitOf } from "./unit";

/** The placement a `placement` selection names, if it is still there. */
export function selectedPlacement(
  store: DocStore,
  selection: Selection,
): Placement | undefined {
  if (selection.kind !== "placement") return undefined;
  return store
    .layer(selection.layerId)
    ?.placements.find((p) => p.id === selection.placementId);
}

/**
 * Whether a selection names a member of the unit that is currently open.
 *
 * What the scene asks before it keeps that unit open: a selection landing
 * anywhere else is the user having moved on, and a PSD left open behind them
 * would go on splitting under the next double tap.
 */
export function inAdjustedInstance(
  store: DocStore,
  selection: Selection,
  adjusting: string | null,
): boolean {
  const placement = selectedPlacement(store, selection);
  return !!placement && unitOf(placement) === adjusting;
}

/** What a double tap on a placed file leaves behind. */
export interface UnitToggle {
  /** The unit now open, or null for one that has just been closed. */
  adjusting: string | null;
  /** What the tap selected, which is the thing it landed on either way. */
  selection: Selection;
  /** The one line the console gets, which is the only feedback there is. */
  message: string;
}

/**
 * Open the file under the finger up, or close it.
 *
 * The first tap of the double has already selected something, so this only
 * decides what that selection *means* from here on — which is why it hands
 * back a selection as well as a unit: closing a file has to leave the file
 * selected, or a double tap to finish would also clear the panel describing
 * what was just finished.
 */
export function toggleUnit(hit: PickResult, adjusting: string | null): UnitToggle {
  const instance = unitOf(hit.placement);
  const next = adjusting === instance ? null : instance;
  return {
    adjusting: next,
    selection: {
      kind: "placement",
      layerId: hit.layerId,
      placementId: hit.placement.id,
    },
    message: next
      ? `${hit.placement.psdKey}.psd — adjusting layers; tap away to finish`
      : `${hit.placement.psdKey}.psd — moving as one again`,
  };
}

/**
 * What "Remove from layer" takes, given what is open.
 *
 * The whole unit, unless it has been opened up. Deleting one layer of a PSD
 * that moves as one thing would leave the rest of it standing there looking
 * broken, and an outline drawn around a whole file promises that removing it
 * removes what the outline is around.
 */
export function doomedPlacements(
  store: DocStore,
  selection: Selection,
  adjusting: string | null,
): Placement[] {
  const placement = selectedPlacement(store, selection);
  if (!placement || selection.kind !== "placement") return [];
  return adjusting === unitOf(placement)
    ? [placement]
    : unitMembers(store.layers, selection.layerId, unitOf(placement));
}
