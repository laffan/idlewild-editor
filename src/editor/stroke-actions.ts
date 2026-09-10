/**
 * The two bridges out of the drawing layer.
 *
 * A sketch is not the point; what it becomes is. The spec asks for exactly
 * two exits — hand a group of strokes to a layer as a PSD to flesh out
 * elsewhere, or turn it into a boundary — and both are actions on a lasso
 * selection rather than tools of their own.
 *
 * Both consume the strokes. The PSD and the zone are the same shape in a
 * better form, and leaving the ink behind means every sketch you convert is
 * drawn twice: once as strokes and once as the thing it became, in the same
 * place, at the same size.
 */

import type { DocStore } from "../lib/doc-store";
import type { Grid } from "../lib/grid";
import type { Selection } from "../lib/types";
import * as log from "../lib/log";
import type { DrawingLayer } from "../drawing";
import { strokesBox, strokesToPsd, strokesToZonePoints } from "../drawing";
import type { WorldScene } from "../game/world-scene";
import {
  anchorCell,
  cellRangeForBox,
  EXPORT_SCALE,
  IMPORT_SCALE,
  marksForSelection,
  scaleMarks,
} from "./import-anchor";

type StrokeSelection = Extract<Selection, { kind: "strokes" }>;

export async function convertStrokesToPsd(
  projectId: string,
  grid: Grid,
  drawing: DrawingLayer,
  scene: WorldScene,
  selection: StrokeSelection,
): Promise<void> {
  const strokes = drawing.strokesById(selection.ids);
  const box = strokesBox(strokes);
  if (!box) {
    log.warn("Those strokes have nothing to rasterise");
    return;
  }

  try {
    const name = `sketch-${Date.now().toString(36)}`;
    // A sketch knows exactly which spaces it was drawn over, so it is marked
    // like a fill rather than centred like an import: the footprint is the
    // spaces the ink covers, and `art` says where the ink sits inside them.
    // Whoever opens the PSD to paint over the sketch then has the same grid
    // under it that the drawing was made on.
    const { from, to } = cellRangeForBox(grid, box);
    const anchor = anchorCell(from, to);
    const anchorWorld = grid.cellToWorld(anchor);

    // The layer's own atlas, so the export carries the brush textures that
    // have already decoded rather than the procedural stand-in.
    const result = await strokesToPsd(projectId, name, strokes, {
      atlas: drawing.atlas,
      scale: EXPORT_SCALE,
      marks: (raster) =>
        scaleMarks(
          {
            ...marksForSelection(grid, from, to),
            art: {
              x: raster.bounds.x - anchorWorld.x,
              y: raster.bounds.y - anchorWorld.y,
            },
          },
          EXPORT_SCALE,
        ),
    });
    if (!result) return;

    await scene.placePsd(result.key, result.manifest, anchor, IMPORT_SCALE);
    drawing.removeStrokes(selection.ids);
    log.info(
      `${strokes.length} strokes → ${result.key}.psd ` +
        `(${result.width}×${result.height})`,
    );
  } catch (err) {
    log.error("Could not turn the strokes into a PSD:", err);
  }
}

export function convertStrokesToZone(
  store: DocStore,
  drawing: DrawingLayer,
  selection: StrokeSelection,
): void {
  const strokes = drawing.strokesById(selection.ids);
  const points = strokesToZonePoints(strokes, store.gridSize);
  if (points.length < 3) {
    log.warn("A boundary needs an outline — that selection has no region");
    return;
  }

  const zone = store.addZone(selection.layerId, {
    name: `Boundary ${(store.layer(selection.layerId)?.zones.length ?? 0) + 1}`,
    points,
    // A boundary is drawn to stop something; play mode reads this when it
    // builds the navigation grid.
    blocking: true,
  });
  drawing.removeStrokes(selection.ids);
  log.info(`${strokes.length} strokes → ${zone.name} (${points.length} points)`);
}
