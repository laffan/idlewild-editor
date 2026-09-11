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
 * It is walked three times, though, because an extrusion is not one picture.
 * The **shape** is every face in the one flat tone: the silhouette. The
 * **shading** is the walls in their own tones over it, which is what makes it
 * read as a solid. The **lines** are the edges between spaces. Stacked in
 * that order they composite to exactly what the canvas drew — and taken
 * apart, they are three things worth having separately in Photoshop:
 * recolour the shape, drop the lines, repaint the shading by hand.
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
import { psd, toBase64, type PsdPart } from "../lib/ipc";
import {
  EXTRUSION_PARTS,
  extrusionPartName,
  type ExtrusionPart,
} from "../lib/manifest";
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
  psdMargin,
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
 *        placement drawing it changes together and no second copy appears —
 *        and only the layers this editor generated are rewritten, so anything
 *        painted into the file since survives.
 * @returns whether the file was written. False leaves the document untouched,
 *        which is what lets the caller keep the session open rather than
 *        losing a shape to a write that was refused.
 */
export async function applyExtrusion(
  projectId: string,
  store: DocStore,
  grid: Grid,
  scene: WorldScene,
  shape: VoxelSet,
  target: ExtrudeTarget | null = null,
): Promise<boolean> {
  const bounds = shapeBounds(grid, shape);
  if (!bounds) {
    log.warn("There is nothing extruded to apply");
    return false;
  }

  const width = Math.max(1, Math.ceil(bounds.width * EXPORT_SCALE));
  const height = Math.max(1, Math.ceil(bounds.height * EXPORT_SCALE));
  if (width * height > MAX_PIXELS) {
    log.warn(
      `That shape is ${width}×${height} pixels — too big to apply. ` +
        "Build it smaller, or in pieces.",
    );
    return false;
  }

  // The key names the parts, so it is settled before they are drawn. Rust
  // sanitises what it is handed, and this is already only lowercase letters,
  // digits and a hyphen, so what comes back is what went in.
  const key = target ? target.key : `extrude-${Date.now().toString(36)}`;
  const parts: PsdPart[] = [];
  for (const part of EXTRUSION_PARTS) {
    const rgba = rasterise(grid, shape, bounds, width, height, part);
    if (!rgba) {
      log.error("Could not rasterise the extrusion");
      return false;
    }
    parts.push({
      name: extrusionPartName(key, part),
      rgbaBase64: toBase64(
        new Uint8Array(rgba.buffer, rgba.byteOffset, rgba.byteLength),
      ),
    });
  }

  try {
    const cells = shapeCells(shape);
    // The space the artwork hangs from: the footprint's lowest corner in cell
    // space, the same one a fill conversion anchors on.
    const range = cellsBounds(cells);
    const anchor = anchorCell(range.from, range.to);
    const anchorWorld = grid.cellToWorld(anchor);
    const art: Point = { x: bounds.x - anchorWorld.x, y: bounds.y - anchorWorld.y };

    // The footprint marks the spaces the solid *stands on*, not the ones its
    // walls reach across on screen: a tall block is anchored to the ground it
    // was built from, which is where it has to come back down.
    //
    // The margin is a space of clear canvas around the lot. A greybox is
    // exactly its own silhouette, and painting over one means painting past
    // it — an overhanging roof, a rim of grass — with nowhere to put the
    // pixels. It grows the canvas alone: the artwork keeps its size and its
    // offset from the anchor, so nothing on the grid moves and the collider,
    // which comes from the voxels, never sees it.
    const marks = scaleMarks(
      { ...marksForCells(grid, cells, anchor, art), margin: psdMargin(grid) },
      EXPORT_SCALE,
    );

    // Carrying one on **rewrites** the file rather than replacing it. Both
    // regenerate the group and both marks; only the rewrite keeps the rest of
    // the stack, which is the difference between carrying a shape on and
    // quietly throwing away an afternoon in Photoshop.
    const result = target
      ? await psd.rewriteParts(projectId, key, width, height, parts, marks)
      : await psd.fromParts(projectId, key, width, height, parts, marks);

    // Written before the artwork is placed, not after: placing selects the
    // new PSD, and the inspector builds its layer list from that selection —
    // so a record written afterwards would arrive too late for the row that
    // offers the way back in.
    store.setExtrusion(result.key, { voxels: [...shape], anchor });

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
    log.info(
      `${describeShape(grid, shape)} → ${result.key}.psd ` +
        `(${result.width}×${result.height})`,
    );
    return true;
  } catch (err) {
    log.error("Could not turn the extrusion into a PSD:", err);
    return false;
  }
}

/**
 * Point every placement on a key at the space its artwork now hangs from.
 *
 * Every scene's, because the file is the project's: an extrusion re-applied
 * moves the artwork under every placement of it, wherever that placement is.
 */
function reanchor(store: DocStore, key: string, anchor: Cell): void {
  store.updatePlacementsEverywhere((placement) =>
    placement.psdKey === key ? { anchor } : null,
  );
}

/**
 * One layer of the drawing the canvas made, on a transparent ground.
 *
 * All three are the same size and the same offset, which is what lets them be
 * stacked without arithmetic — and, once they are a group on the canvas, what
 * makes resizing that group exact.
 *
 * The three differ in more than which faces they paint, because two of them
 * have to reproduce on their own something the composite gets for free.
 *
 * **The shape** is stroked as well as filled, in its own tone. A silhouette
 * assembled out of dozens of separately filled quads is not a solid shape:
 * every shared edge is two antialiased boundaries that come to about 75%
 * between them, so the shape came out with the whole lattice ghosted into it
 * — the lines layer's own drawing, printed into the layer that is meant to be
 * the flat silhouette under it. And its outer edge stopped half a line short
 * of the drawing, because on the canvas the stroke straddles the boundary.
 * One stroke in the fill colour answers both: the seams close, and the
 * silhouette reaches exactly as far as the composite does.
 *
 * **The lines** rub out before they draw. On the canvas each face is filled
 * opaque and then stroked, so a face in front hides the edges of whatever is
 * behind it — an arch's near pier hides the lines of the span behind it, and
 * so does any overhang. A layer with no fills in it has nothing to hide them
 * with, so every occluded edge came through and the lines read as a wireframe
 * of the whole solid. Each face therefore clears its own polygon out of what
 * is already there before stroking its edges, which is the painter's
 * algorithm done in alpha: same order, same result, nothing opaque left
 * behind.
 */
function rasterise(
  grid: Grid,
  shape: VoxelSet,
  bounds: Rect,
  width: number,
  height: number,
  part: ExtrusionPart,
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
    trace(ctx, face.points);
    if (part === "lines") {
      erase(ctx);
      ctx.stroke();
    } else if (part === "shape") {
      // The silhouette, in the one tone the top faces take: the shading
      // below paints the walls over it, so the two together are the drawing.
      // Stroked in the fill's own colour, which is what closes the seams
      // between separately filled quads and carries the silhouette out to
      // where the composite's own edges reach.
      ctx.fillStyle = SHADE_COLORS.top;
      ctx.strokeStyle = SHADE_COLORS.top;
      ctx.fill();
      ctx.stroke();
    } else if (face.shade !== "top") {
      ctx.fillStyle = SHADE_COLORS[face.shade];
      ctx.fill();
    }
  }

  return ctx.getImageData(0, 0, width, height).data;
}

/**
 * Clear the current path out of what has been drawn so far.
 *
 * What an opaque fill does to the layers under it on the canvas, done to a
 * layer that has to stay transparent. The colour is irrelevant under
 * `destination-out` — only the coverage is read — and the mode is put back
 * immediately, because everything else here draws normally.
 */
function erase(ctx: CanvasRenderingContext2D): void {
  ctx.globalCompositeOperation = "destination-out";
  ctx.fillStyle = "#000";
  ctx.fill();
  ctx.globalCompositeOperation = "source-over";
}

function trace(ctx: CanvasRenderingContext2D, points: readonly Point[]): void {
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
  ctx.closePath();
}
