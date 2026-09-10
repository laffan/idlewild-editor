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
    // The layer's own atlas, so the export carries the brush textures that
    // have already decoded rather than the procedural stand-in.
    const result = await strokesToPsd(projectId, name, strokes, drawing.atlas);
    if (!result) return;

    // `placePsd` centres a PSD on the anchor cell, so anchoring on the cell
    // under the middle of the sketch lands the image where the ink was.
    const anchor = grid.worldToCell({
      x: box.x + box.width / 2,
      y: box.y + box.height / 2,
    });
    await scene.placePsd(result.key, result.manifest, anchor);
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
