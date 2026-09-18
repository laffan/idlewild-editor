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
import { groupOfPlacement, groupPlacements } from "../lib/groups";
import { pickUnit } from "../lib/unit-select";
import { unitsOf } from "../lib/units";
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

/**
 * A tap on a grouped file means the group.
 *
 * The same rule a placed PSD already keeps, one level out: a file is one thing
 * until a double tap says otherwise, and a group is one thing until you reach
 * into it. Tapping a wall that has been grouped with a roof and a door selects
 * the building, which is the whole of what grouping is for — see
 * `lib/groups.ts`.
 *
 * **The way in is the sidebar, not a second double tap.** Double tap is
 * already taken: it opens a file up into its own layers, and a gesture that
 * meant two different things at two different depths would be a gesture nobody
 * could aim. So the layer panel lists a group's members under it and picking
 * one there picks that file alone — which is also where you already go to
 * reach something standing behind something else.
 *
 * A unit that has been opened up keeps its own selection, because the
 * adjustment is about that file's layers and widening to the group would take
 * the thing being adjusted out of the panel describing it.
 */
export function widenToGroup(
  store: DocStore,
  selection: Selection,
  adjusting: string | null,
): Selection {
  if (selection.kind !== "placement") return selection;
  const layer = store.layer(selection.layerId);
  const placement = layer?.placements.find(
    (p) => p.id === selection.placementId,
  );
  if (!placement || unitOf(placement) === adjusting) return selection;
  const group = groupOfPlacement(layer, placement);
  if (!group) return selection;
  const ids = groupPlacements(layer, group).map((p) => p.id);
  // One member left is not a group; `liveGroups` has already dropped that
  // case, so this is the floor rather than the usual path.
  if (ids.length < 2) return selection;
  return { kind: "placements", layerId: selection.layerId, ids };
}

/**
 * A tap that was meant to *add to* what is already selected.
 *
 * ⌘ or ⇧ on the canvas, which is the same gesture as ⌘-clicking a row in the
 * layer panel and goes through the same arithmetic — `lib/unit-select.ts` — so
 * the two surfaces cannot disagree about what a toggle leaves behind.
 *
 * **Only placed PSDs.** A `placements` selection is the one multi-selection
 * the document has, so ⌘-tapping a fill, a boundary, a point or a note is read
 * as a plain tap: it selects that thing, because there is nothing it could be
 * added to. A tap on bare ground with ⌘ down keeps the selection rather than
 * clearing it, which is what every editor does — the modifier says *as well
 * as*, and a miss is not a request to throw the rest away.
 *
 * Handed the hit rather than doing the picking, because what is under the
 * pointer is the renderer's question and this is only what to make of it.
 */
export function addToSelection(
  store: DocStore,
  current: Selection,
  hit: Selection,
): Selection {
  if (hit.kind === "none") return current;
  if (hit.kind !== "placement") return hit;

  const layer = store.layer(hit.layerId);
  if (!layer) return hit;
  const units = unitsOf(layer.placements).map((unit) => ({
    members: unit.map((p) => p.id),
  }));
  const index = units.findIndex((unit) => unit.members.includes(hit.placementId));
  if (index < 0) return hit;

  return pickUnit({
    current,
    layerId: hit.layerId,
    units,
    index,
    // Always a toggle, and there is no branch to write: a canvas has no order
    // for a range to run along, so ⇧ and ⌘ are one gesture here — `pickMode`
    // is where that is decided. The anchor is a list's idea and goes with it.
    anchor: null,
    mode: "toggle",
  }).selection;
}
