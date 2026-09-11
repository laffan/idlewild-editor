/**
 * Applying an extrusion: the solid becomes a placed PSD.
 *
 * The fourth bridge into the PSD pipeline, beside an image import, a lassoed
 * sketch and a fill. It is the fill conversion's shape exactly — rasterise
 * what is on the canvas, mark the spaces it was built over, place it back
 * where it stood — and it is written against the same helpers so a block-out
 * pulled out of the grid arrives at the same resolution as everything else in
 * the project.
 *
 * The pixels are drawn by walking the same face list the canvas drew, in the
 * same order, with the same palette. That is deliberate: the point of Apply
 * is to keep what the user is looking at, and a second renderer that agreed
 * with the first only most of the time would be worse than no preview.
 *
 * The solid itself is written into the document beside the placement, keyed
 * by the PSD it became. Pixels cannot say where the columns were, so without
 * that record Apply is a one-way door; with it, the same shape can be opened
 * back up and carried on with, and a second Apply rewrites the file it came
 * from rather than leaving a second copy of it on the canvas.
 */

import type { DocStore } from "../lib/doc-store";
import type { Grid } from "../lib/grid";
import { cellsBounds } from "../lib/grid";
import { psd, toBase64 } from "../lib/ipc";
import type { Cell, Point, Rect } from "../lib/types";
import * as log from "../lib/log";
import {
  describeShape,
  EDGE_COLOR,
  SHADE_COLORS,
  shapeBounds,
  shapeCells,
  shapeFaces,
  type VoxelSet,
} from "../lib/extrude";
import type { ExtrudeTarget } from "../game/extrude-mode";
import type { WorldScene } from "../game/world-scene";
import {
  anchorCell,
  EXPORT_SCALE,
  IMPORT_SCALE,
  marksForCells,
  scaleMarks,
} from "./import-anchor";

/**
 * A ceiling on the PSD an extrusion may ask for, in pixels.
 *
 * The same cap Generate PSD carries and for the same reason: the solid is
 * drawn at `EXPORT_SCALE`, so a tall pull over a wide plate asks for a buffer
 * measured in hundreds of megabytes and the webview simply dies.
 */
const MAX_PIXELS = 4096 * 4096;

/**
 * Write the solid out as a PSD and put it on the canvas.
 *
 * @param target the placed PSD this carries on from, when it is not a new
 *        one. Its file is rewritten under the key it already has, so every
 *        placement drawing it changes together and no second copy appears.
 */
export async function applyExtrusion(
  projectId: string,
  store: DocStore,
  grid: Grid,
  scene: WorldScene,
  shape: VoxelSet,
  target: ExtrudeTarget | null = null,
): Promise<void> {
  const bounds = shapeBounds(grid, shape);
  if (!bounds) {
    log.warn("There is nothing extruded to apply");
    return;
  }

  const width = Math.max(1, Math.ceil(bounds.width * EXPORT_SCALE));
  const height = Math.max(1, Math.ceil(bounds.height * EXPORT_SCALE));
  if (width * height > MAX_PIXELS) {
    log.warn(
      `That shape is ${width}×${height} pixels — too big to apply. ` +
        "Build it smaller, or in pieces.",
    );
    return;
  }

  const rgba = rasterise(grid, shape, bounds, width, height);
  if (!rgba) {
    log.error("Could not rasterise the extrusion");
    return;
  }

  try {
    const cells = shapeCells(shape);
    // The space the artwork hangs from: the footprint's lowest corner in cell
    // space, the same one a fill conversion anchors on.
    const range = cellsBounds(cells);
    const anchor = anchorCell(range.from, range.to);
    const anchorWorld = grid.cellToWorld(anchor);
    const art: Point = { x: bounds.x - anchorWorld.x, y: bounds.y - anchorWorld.y };

    const result = await psd.fromRgba(
      projectId,
      // Carrying one on writes back to the key it already has, which
      // overwrites `<key>.psd` and runs the pipeline over it again: the
      // artwork layer and both marks come out freshly generated, and every
      // placement on that key redraws from the new file.
      target ? target.key : `extrude-${Date.now().toString(36)}`,
      width,
      height,
      toBase64(new Uint8Array(rgba.buffer, rgba.byteOffset, rgba.byteLength)),
      // The footprint marks the spaces the solid *stands on*, not the ones its
      // walls reach across on screen: a tall block is anchored to the ground
      // it was built from, which is where it has to come back down.
      scaleMarks(marksForCells(grid, cells, anchor, art), EXPORT_SCALE),
    );

    if (target && result.key === target.key) {
      // The footprint may have grown past where it started, which moves the
      // space the artwork hangs from. Reconciliation positions each placement
      // from the anchor the document holds for it, so that has to say where
      // the artwork is *now* before the new manifest is read.
      reanchor(store, result.key, anchor);
      await scene.reloadPsd(result.key, result.manifest);
    } else {
      await scene.placePsd(result.key, result.manifest, anchor, IMPORT_SCALE);
    }

    store.setExtrusion(result.key, { voxels: [...shape], anchor });
    log.info(
      `${describeShape(grid, shape)} → ${result.key}.psd ` +
        `(${result.width}×${result.height})`,
    );
  } catch (err) {
    log.error("Could not turn the extrusion into a PSD:", err);
  }
}

/** Point every placement on a key at the space its artwork now hangs from. */
function reanchor(store: DocStore, key: string, anchor: Cell): void {
  for (const layer of store.layers) {
    for (const placement of layer.placements) {
      if (placement.psdKey !== key) continue;
      store.updatePlacement(layer.id, placement.id, { anchor });
    }
  }
}

/** The exact drawing the canvas made, on a transparent ground, cropped to it. */
function rasterise(
  grid: Grid,
  shape: VoxelSet,
  bounds: Rect,
  width: number,
  height: number,
): Uint8ClampedArray | null {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;

  ctx.scale(EXPORT_SCALE, EXPORT_SCALE);
  ctx.translate(-bounds.x, -bounds.y);
  // One world pixel, which is the weight the hairline has on the canvas at
  // zoom 1 — the size the artwork is placed back at.
  ctx.lineWidth = 1;
  ctx.strokeStyle = EDGE_COLOR;
  ctx.lineJoin = "round";

  for (const face of shapeFaces(grid, shape)) {
    ctx.fillStyle = SHADE_COLORS[face.shade];
    trace(ctx, face.points);
    ctx.fill();
    ctx.stroke();
  }

  return ctx.getImageData(0, 0, width, height).data;
}

function trace(ctx: CanvasRenderingContext2D, points: readonly Point[]): void {
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
  ctx.closePath();
}
