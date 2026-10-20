/**
 * Where a selection is on the canvas — the point the camera goes to when a
 * row in the left sidebar is picked.
 *
 * Picking a placed PSD or a run of strokes out of the list selected it, and
 * if it was off screen nothing visible happened: the outline went up
 * somewhere nobody was looking. So the sidebar's picks also bring the canvas
 * round to the thing, and this says where that is — the middle of the same
 * box `game/selection-overlay.ts` outlines for each kind.
 *
 * Null for the kinds with nowhere to go: no selection, a whole layer, and a
 * backdrop, which is camera-locked and fills the view wherever it stands.
 */

import { Grid, fillShape } from "../lib/grid";
import type { DocStore } from "../lib/doc-store";
import type { Point, Selection } from "../lib/types";
import { strokesBox } from "../drawing/geometry";
import { textById } from "../lib/text-items";
import { unitMembers, unitOf, unionRect } from "../game/unit";

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function selectionCentre(
  selection: Selection,
  store: DocStore,
  grid: Grid,
): Point | null {
  const box = selectionBox(selection, store, grid);
  return box ? { x: box.x + box.width / 2, y: box.y + box.height / 2 } : null;
}

function selectionBox(selection: Selection, store: DocStore, grid: Grid): Box | null {
  switch (selection.kind) {
    case "region":
      return around(grid.rangePolygon(selection.from, selection.to));
    case "tiles":
      return around(selection.cells.flatMap((cell) => grid.cellPolygon(cell)));
    case "point": {
      const point = store.layer(selection.layerId)?.points.find((p) => p.id === selection.pointId);
      if (!point) return null;
      const at = grid.cellCentre(point.cell);
      return { x: at.x, y: at.y, width: 0, height: 0 };
    }
    case "fill": {
      const fill = store.layer(selection.layerId)?.fills.find((f) => f.id === selection.fillId);
      const shape = fill ? fillShape(grid, fill) : null;
      return shape ? around(shape.polygons.flat()) : null;
    }
    case "zone": {
      const zone = store.layer(selection.layerId)?.zones.find((z) => z.id === selection.zoneId);
      return zone ? around(zone.points) : null;
    }
    case "placement": {
      // The whole placed PSD, as the outline is: one layer of a file is
      // picked from the list as the file.
      const placement = store
        .layer(selection.layerId)
        ?.placements.find((p) => p.id === selection.placementId);
      if (!placement) return null;
      return unionRect(unitMembers(store.layers, selection.layerId, unitOf(placement)));
    }
    case "placements": {
      const chosen = new Set(selection.ids);
      const members = store.layer(selection.layerId)?.placements.filter((p) => chosen.has(p.id));
      return members ? unionRect(members) : null;
    }
    case "text":
      return textById(store.layer(selection.layerId), selection.textId) ?? null;
    case "strokes": {
      const chosen = new Set(selection.ids);
      const strokes = store.layer(selection.layerId)?.strokes.filter((s) => chosen.has(s.id));
      return strokes ? strokesBox(strokes) : null;
    }
    case "background":
    case "layer":
    case "none":
      return null;
  }
}

/** The box round a set of points, or null for none. */
function around(points: readonly Point[]): Box | null {
  if (points.length === 0) return null;
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  for (const p of points) {
    left = Math.min(left, p.x);
    top = Math.min(top, p.y);
    right = Math.max(right, p.x);
    bottom = Math.max(bottom, p.y);
  }
  return { x: left, y: top, width: right - left, height: bottom - top };
}
