/**
 * ⌘G and ⇧⌘G: tying placed PSDs together, and letting them go.
 *
 * The model is `lib/groups.ts` — what a group is, why it is in the document
 * and why the game is never told about it. This is the half that knows what is
 * selected: turning a selection into the units it covers, saying so in the
 * console, and leaving the right thing selected afterwards.
 *
 * **Which units a selection means** is the only interesting part. A
 * `placements` selection is the ordinary way in — several files picked in the
 * sidebar or caught by a marquee — and a `placement` selection is one file,
 * which is not enough to group but is plenty to *ungroup*: tapping any member
 * of a group selects the whole group, so the one case where a single file is
 * selected and grouped is a file whose group has been reached into from the
 * panel, and ⇧⌘G there means "take this one out".
 */

import { group, groupOfUnit, liveGroups, ungroup } from "../lib/groups";
import type { DocStore } from "../lib/doc-store";
import type { Selection } from "../lib/types";
import { unitKey } from "../lib/units";
import * as log from "../lib/log";

/** What the two shortcuts need from the shell around them. */
export interface GroupDeps {
  store: DocStore;
  /** What is selected, or null when the canvas is not up. */
  selection: () => Selection | null;
  setSelection: (selection: Selection) => void;
  /** Redraw the left panel: a group is a row in it. */
  redrawLayers: () => void;
}

/** The layer a selection is about, and the units it covers, or null. */
export function selectedUnits(
  store: DocStore,
  selection: Selection | null,
): { layerId: string; units: string[] } | null {
  if (!selection) return null;
  if (selection.kind !== "placement" && selection.kind !== "placements") {
    return null;
  }
  const ids =
    selection.kind === "placements" ? selection.ids : [selection.placementId];
  const layerId = selection.layerId;
  const layer = store.layer(layerId);
  if (!layer) return null;
  const held = new Set(ids);
  const units: string[] = [];
  for (const placement of layer.placements) {
    if (!held.has(placement.id)) continue;
    const unit = unitKey(placement);
    if (!units.includes(unit)) units.push(unit);
  }
  return units.length ? { layerId, units } : null;
}

/**
 * Put what is selected together.
 *
 * Says what happened rather than doing it silently: a group makes no mark on
 * the canvas — the outline round a multi-selection is the same outline a
 * marquee leaves — so without a line in the console the only evidence is a row
 * in a panel that may be folded.
 */
export function groupSelection(deps: GroupDeps): void {
  const chosen = selectedUnits(deps.store, deps.selection());
  if (!chosen) {
    log.warn("Group needs some placed PSDs selected");
    return;
  }
  if (chosen.units.length < 2) {
    log.warn("Group needs two or more placed PSDs — a group of one says nothing");
    return;
  }

  const made = group(deps.store, chosen.layerId, chosen.units);
  if (!made) return;
  deps.redrawLayers();
  // The group, which is what a tap on any of its members would now select.
  const layer = deps.store.layer(chosen.layerId);
  const ids = (layer?.placements ?? [])
    .filter((p) => made.units.includes(unitKey(p)))
    .map((p) => p.id);
  deps.setSelection({ kind: "placements", layerId: chosen.layerId, ids });
  log.info(`${made.name} — ${made.units.length} placed PSDs grouped`);
}

/**
 * Take what is selected out of whatever groups it is in.
 *
 * The selection is left where it is: the same files are still the subject,
 * they are simply no longer one thing. What does change is what a tap on one
 * of them would mean next time, which is the point.
 */
export function ungroupSelection(deps: GroupDeps): void {
  const chosen = selectedUnits(deps.store, deps.selection());
  if (!chosen) {
    log.warn("Ungroup needs some placed PSDs selected");
    return;
  }
  const layer = deps.store.layer(chosen.layerId);
  const names = new Set(
    chosen.units
      .map((unit) => groupOfUnit(layer, unit)?.name)
      .filter((name): name is string => !!name),
  );
  if (!ungroup(deps.store, chosen.layerId, chosen.units)) {
    log.warn("Nothing selected is in a group");
    return;
  }
  deps.redrawLayers();
  log.info(
    names.size === 1
      ? `${[...names][0]} — ungrouped`
      : `${names.size} groups — ungrouped`,
  );
}

/**
 * Whether ⇧⌘G would do anything, which is what greys the inspector's button.
 *
 * Asked of the *selection* rather than of the layer, because a selection can
 * cover several groups at once and none of them at all.
 */
export function selectionIsGrouped(
  store: DocStore,
  selection: Selection | null,
): boolean {
  const chosen = selectedUnits(store, selection);
  if (!chosen) return false;
  const layer = store.layer(chosen.layerId);
  if (liveGroups(layer).length === 0) return false;
  return chosen.units.some((unit) => !!groupOfUnit(layer, unit));
}
