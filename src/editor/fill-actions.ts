/**
 * Turning a fill into a placed PSD.
 *
 * The third bridge into the PSD pipeline, after an image import and a
 * lassoed sketch. A fill is a fast way to block a shape out on the grid; this
 * is what turns that block-out into something an artist can open and paint.
 *
 * Unlike an import, a fill knows exactly which pixels belong over which grid
 * spaces — it was drawn on them — so the PSD is marked with the spaces it
 * came from *and* with where the artwork sits relative to the anchor, rather
 * than being centred on it. Placed back, it lands exactly over the fill it
 * replaced.
 *
 * A blank project's fill is one rectangle rather than a run of spaces, and
 * the difference stops at its outline: it marks a footprint of exactly its
 * own size with nothing inside it to divide, and comes back the same way.
 */

import type { DocStore } from "../lib/doc-store";
import { Grid, cellsBounds as cellsRange, fillShape } from "../lib/grid";
import { psd } from "../lib/ipc";
import type { AnchorMarks } from "../lib/ipc";
import type { FillPatch, Point, Rect, Selection } from "../lib/types";
import * as log from "../lib/log";
import type { WorldScene } from "../game/world-scene";
import { anchorCell, EXPORT_SCALE, IMPORT_SCALE, scaleMarks } from "./import-anchor";

type FillSelection = Extract<Selection, { kind: "fill" }>;

/** No margin: the fill's own spaces are exactly what it covers. */
const PADDING = 0;

export async function convertFillToPsd(
  projectId: string,
  store: DocStore,
  grid: Grid,
  scene: WorldScene,
  selection: FillSelection,
): Promise<void> {
  const fill = store
    .layer(selection.layerId)
    ?.fills.find((f) => f.id === selection.fillId);
  const shape = fill ? fillShape(grid, fill) : null;
  if (!fill || !shape) {
    log.warn("That fill has nothing to convert");
    return;
  }

  const raster = rasteriseFill(shape, fill.color ?? "#ec3013");
  if (!raster) return;

  try {
    const name = `fill-${Date.now().toString(36)}`;
    // The space the artwork hangs from. A run of grid spaces anchors on its
    // lowest corner in cell space; a rectangle on a project that does not
    // snap anchors on the pixel its top-left corner falls in, which is the
    // same rule read through a one-pixel cell.
    const corner = grid.worldToCell({ x: shape.bounds.x, y: shape.bounds.y });
    const anchor = fill.rect
      ? corner
      : anchorCell(cellsRange(fill.cells).from, cellsRange(fill.cells).to);
    const anchorWorld = grid.cellToWorld(anchor);

    const result = await psd.fromRgba(
      projectId,
      name,
      raster.width,
      raster.height,
      toBase64(raster.rgba),
      // Marks and pixels are both in the file's own space, so both are taken
      // up together — and the placement scales back down by the same factor.
      scaleMarks(
        marksForFill(grid, fill, shape.bounds, anchorWorld, {
          x: raster.x - anchorWorld.x,
          y: raster.y - anchorWorld.y,
        }),
        EXPORT_SCALE,
      ),
    );

    await scene.placePsd(result.key, result.manifest, anchor, IMPORT_SCALE);
    store.removeFill(selection.layerId, selection.fillId);
    log.info(
      `${describe(fill)} → ${result.key}.psd (${result.width}×${result.height})`,
    );
  } catch (err) {
    log.error("Could not turn the fill into a PSD:", err);
  }
}

function describe(fill: FillPatch): string {
  if (fill.rect) {
    return `a ${Math.round(fill.rect.width)}×${Math.round(fill.rect.height)} fill`;
  }
  return `${fill.cells.length} filled spaces`;
}

/**
 * Paint the fill's spaces onto a transparent ground, cropped to them.
 *
 * Drawn at `EXPORT_SCALE` pixels per world pixel — see the note there. The
 * returned `x`/`y` stay in *world* units, because what they position is the
 * artwork against the grid rather than a pixel against a canvas.
 */
function rasteriseFill(
  shape: { polygons: Point[][]; bounds: Rect },
  colour: string,
): { rgba: Uint8ClampedArray; width: number; height: number; x: number; y: number } | null {
  const { bounds } = shape;
  const width = Math.max(1, Math.ceil((bounds.width + PADDING * 2) * EXPORT_SCALE));
  const height = Math.max(1, Math.ceil((bounds.height + PADDING * 2) * EXPORT_SCALE));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;

  ctx.scale(EXPORT_SCALE, EXPORT_SCALE);
  ctx.translate(PADDING - bounds.x, PADDING - bounds.y);
  ctx.fillStyle = colour;
  for (const points of shape.polygons) {
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
    ctx.closePath();
    ctx.fill();
  }

  return {
    rgba: ctx.getImageData(0, 0, width, height).data,
    width,
    height,
    x: bounds.x - PADDING,
    y: bounds.y - PADDING,
  };
}

/**
 * The marks for a fill: the spaces it actually covers, not a box around
 * them. A fill is often an irregular shape, and an outline that enclosed
 * spaces it never touched would tell the artist something untrue — so each
 * covered space is drawn in full, and the outline is only there to give the
 * zone its bounds.
 */
function marksForFill(
  grid: Grid,
  fill: FillPatch,
  bounds: Rect,
  anchorWorld: Point,
  art: { x: number; y: number },
): AnchorMarks {
  const relative = (p: Point) => ({
    x: p.x - anchorWorld.x,
    y: p.y - anchorWorld.y,
  });

  const outline = [
    { x: bounds.x, y: bounds.y },
    { x: bounds.x + bounds.width, y: bounds.y },
    { x: bounds.x + bounds.width, y: bounds.y + bounds.height },
    { x: bounds.x, y: bounds.y + bounds.height },
  ].map(relative);

  // A rectangle covers one space of its own size, so its outline is the whole
  // of its footprint and there is nothing inside it to divide.
  if (fill.rect) return { outline, lines: [], art, cols: 1, rows: 1 };

  const lines: AnchorMarks["lines"] = [];
  for (const cell of fill.cells) {
    const poly = grid.cellPolygon(cell).map(relative);
    for (let i = 0; i < poly.length; i++) {
      lines.push({ a: poly[i], b: poly[(i + 1) % poly.length] });
    }
  }

  const { from, to } = cellsRange(fill.cells);
  return {
    outline: grid.rangePolygon(from, to).map(relative),
    lines,
    art,
    cols: Math.abs(to.cx - from.cx) + 1,
    rows: Math.abs(to.cy - from.cy) + 1,
  };
}

function toBase64(bytes: Uint8ClampedArray): string {
  let binary = "";
  const chunk = 0x8000;
  const view = new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let i = 0; i < view.length; i += chunk) {
    binary += String.fromCharCode(...view.subarray(i, i + chunk));
  }
  return btoa(binary);
}
