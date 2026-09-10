/**
 * Turning a filled run of grid spaces into a placed PSD.
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
 */

import type { DocStore } from "../lib/doc-store";
import { Grid } from "../lib/grid";
import { psd } from "../lib/ipc";
import type { AnchorMarks } from "../lib/ipc";
import type { Cell, FillPatch, Selection } from "../lib/types";
import * as log from "../lib/log";
import type { WorldScene } from "../game/world-scene";
import { anchorCell } from "./import-anchor";

type FillSelection = Extract<Selection, { kind: "fill" }>;

/** Rendered at world scale, so one canvas pixel is one world pixel. */
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
  if (!fill || fill.cells.length === 0) {
    log.warn("That fill has no spaces to convert");
    return;
  }

  const raster = rasteriseFill(grid, fill);
  if (!raster) return;

  try {
    const name = `fill-${Date.now().toString(36)}`;
    const anchor = anchorCell(cellRange(fill.cells).from, cellRange(fill.cells).to);
    const anchorWorld = grid.cellToWorld(anchor);

    const result = await psd.fromRgba(
      projectId,
      name,
      raster.width,
      raster.height,
      toBase64(raster.rgba),
      marksForFill(grid, fill, anchor, {
        x: raster.x - anchorWorld.x,
        y: raster.y - anchorWorld.y,
      }),
    );

    await scene.placePsd(result.key, result.manifest, anchor);
    store.removeFill(selection.layerId, selection.fillId);
    log.info(
      `${fill.cells.length} filled spaces → ${result.key}.psd ` +
        `(${result.width}×${result.height})`,
    );
  } catch (err) {
    log.error("Could not turn the fill into a PSD:", err);
  }
}

/** Paint the fill's spaces onto a transparent ground, cropped to them. */
function rasteriseFill(
  grid: Grid,
  fill: FillPatch,
): { rgba: Uint8ClampedArray; width: number; height: number; x: number; y: number } | null {
  const { from, to } = cellRange(fill.cells);
  const bounds = grid.rangeBounds(from, to);
  const width = Math.max(1, Math.ceil(bounds.width) + PADDING * 2);
  const height = Math.max(1, Math.ceil(bounds.height) + PADDING * 2);

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;

  ctx.translate(PADDING - bounds.x, PADDING - bounds.y);
  ctx.fillStyle = fill.color ?? "#ec3013";
  for (const cell of fill.cells) {
    const points = grid.cellPolygon(cell);
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
  anchor: Cell,
  art: { x: number; y: number },
): AnchorMarks {
  const world = grid.cellToWorld(anchor);
  const relative = (p: { x: number; y: number }) => ({
    x: p.x - world.x,
    y: p.y - world.y,
  });
  const { from, to } = cellRange(fill.cells);

  const lines: AnchorMarks["lines"] = [];
  for (const cell of fill.cells) {
    const poly = grid.cellPolygon(cell).map(relative);
    for (let i = 0; i < poly.length; i++) {
      lines.push({ a: poly[i], b: poly[(i + 1) % poly.length] });
    }
  }

  return {
    outline: grid.rangePolygon(from, to).map(relative),
    lines,
    art,
    cols: Math.abs(to.cx - from.cx) + 1,
    rows: Math.abs(to.cy - from.cy) + 1,
  };
}

function cellRange(cells: readonly Cell[]): { from: Cell; to: Cell } {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const cell of cells) {
    minX = Math.min(minX, cell.cx);
    minY = Math.min(minY, cell.cy);
    maxX = Math.max(maxX, cell.cx);
    maxY = Math.max(maxY, cell.cy);
  }
  return { from: { cx: minX, cy: minY }, to: { cx: maxX, cy: maxY } };
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
