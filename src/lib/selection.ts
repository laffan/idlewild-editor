/**
 * Whether what the editor says is selected is still in the document.
 *
 * Almost nothing needs to ask: a selection is normally made by picking
 * something that is there, and the thing that removes it clears it on the way
 * out. Undo is the exception — it can take away the object under a selection
 * that was made after it, or bring back an object the selection was cleared
 * for — so the one caller is `editor/history.ts`, which drops a selection
 * naming something that has gone rather than leaving the inspector describing
 * a placement nobody can see.
 *
 * A `region` is a rectangle of grid rather than an object, so it survives
 * anything; `none` has nothing to lose. Everything else has to be found.
 */

import type { DocStore } from "./doc-store";
import type { Selection } from "./types";

export function selectionAlive(store: DocStore, selection: Selection): boolean {
  if (selection.kind === "none" || selection.kind === "region") return true;

  const layer = store.layer(selection.layerId);
  if (!layer) return false;

  switch (selection.kind) {
    case "layer":
      return true;
    case "fill":
      return has(layer.fills, selection.fillId);
    case "placement":
      return has(layer.placements, selection.placementId);
    case "point":
      return has(layer.points, selection.pointId);
    case "zone":
      return has(layer.zones, selection.zoneId);
    // Every member, not any: a drag moves them together and the inspector
    // counts them, so a list half of which has gone is a lie either way.
    case "placements":
      return selection.ids.every((id) => has(layer.placements, id));
    case "strokes":
      return selection.ids.every((id) => has(layer.strokes, id));
  }
}

function has(items: ReadonlyArray<{ id: string }>, id: string): boolean {
  return items.some((item) => item.id === id);
}
