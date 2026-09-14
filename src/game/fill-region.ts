/**
 * Filling a selected region, as a change to the document.
 *
 * Split out of the scene because it is the one thing in its content section
 * that is *about the document* rather than a face on `PsdPlacements` — and
 * because the shape a fill takes is the one place the two kinds of project
 * genuinely disagree, which is worth a file that says so.
 */

import type { DocStore } from "../lib/doc-store";
import type { Grid } from "../lib/grid";
import { cellsInRange } from "../lib/grid";
import type { FillPatch, Selection } from "../lib/types";
import type { Paint } from "../lib/paint";
import * as log from "../lib/log";

/**
 * Fill a region on a layer, and hand back the selection to move to.
 *
 * `paint` is what the spaces are made of — a flat colour, a pixel pattern
 * revealed on the world's own lattice, or a library shape in every space it
 * covers. See `lib/paint.ts`.
 *
 * Null when there was nothing to fill or nowhere to put it: a locked layer
 * says so rather than silently doing nothing, because "I pressed fill and
 * nothing happened" is the complaint that follows.
 */
export function fillRegion(
  store: DocStore,
  grid: Grid,
  layerId: string,
  region: Extract<Selection, { kind: "region" }>,
  paint: Paint,
  walkable: boolean,
): Selection | null {
  const layer = store.layer(layerId);
  if (!layer || layer.locked) {
    log.warn("The active layer is locked");
    return null;
  }

  // A snapping project fills the spaces it covers, so an irregular run of
  // them stays irregular. A blank one fills the rectangle that was dragged:
  // its cells are single pixels, and one record per covered pixel would put a
  // hundred thousand of them in a document that means "this box".
  const shape: Pick<FillPatch, "cells" | "rect"> = grid.snaps
    ? { cells: [...cellsInRange(region.from, region.to)] }
    : { cells: [], rect: grid.rangeBounds(region.from, region.to) };

  // The colour is always written, whatever the paint is made of: a pattern
  // and a shape are both *drawn in* a colour, and it is what the fill falls
  // back to on a machine whose library does not have that row.
  const { color, ...spec } = paint;
  const fill = store.addFill(layer.id, {
    ...shape,
    kind: "color",
    color,
    ...(spec.kind === "color" ? {} : { paint: spec }),
    walkable,
  });
  return { kind: "fill", layerId: layer.id, fillId: fill.id };
}
