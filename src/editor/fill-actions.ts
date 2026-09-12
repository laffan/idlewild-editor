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
import { Grid, cellsBounds as cellsRange, describeRange, fillShape } from "../lib/grid";
import { psd } from "../lib/ipc";
import type { AnchorMarks } from "../lib/ipc";
import type { Cell, FillPatch, Point, Rect, Selection } from "../lib/types";
import * as log from "../lib/log";
import type { WorldScene } from "../game/world-scene";
import {
  anchorCell,
  EXPORT_SCALE,
  IMPORT_SCALE,
  marksForCells,
  marksForSelection,
  psdMargin,
  scaleMarks,
} from "./import-anchor";

type FillSelection = Extract<Selection, { kind: "fill" }>;

/**
 * A ceiling on a generated PSD, in pixels.
 *
 * The selection is drawn at `EXPORT_SCALE`, so a careless drag over a few
 * hundred spaces asks for a buffer measured in hundreds of megabytes and the
 * webview simply dies. Roughly a 4K canvas, which is more room than anyone
 * paints in one file.
 */
const MAX_GENERATED_PIXELS = 4096 * 4096;

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
        {
          ...marksForFill(grid, fill, shape.bounds, anchor, {
            x: raster.x - anchorWorld.x,
            y: raster.y - anchorWorld.y,
          }),
          // A space of clear canvas around it. The pixels and the footprint
          // are unchanged, so the block-out lands exactly where it was and
          // blocks exactly what it did; what grows is the room to paint in.
          margin: psdMargin(grid),
        },
        EXPORT_SCALE,
      ),
    );

    // The block-out going and the artwork arriving are one thing, so undo
    // takes them back together rather than leaving a fill that is also a PSD.
    store.history.begin();
    try {
      await scene.placePsd(result.key, result.manifest, anchor, IMPORT_SCALE);
      store.removeFill(selection.layerId, selection.fillId);
    } finally {
      store.history.end();
    }
    log.info(
      `${describe(fill)} → ${result.key}.psd (${result.width}×${result.height})`,
    );
  } catch (err) {
    log.error("Could not turn the fill into a PSD:", err);
  }
}

/**
 * An empty PSD the size and shape of a grid selection.
 *
 * The same thing as filling the selection with a transparent colour and
 * converting that fill, with neither step visible — which is all anyone
 * wanted from those two taps. What comes out is a file with the grid drawn
 * on it and nothing else: somewhere to go and paint, already the right size
 * and already anchored where it will sit.
 *
 * Transparent means there is nothing to rasterise, so unlike a fill this
 * writes the buffer straight rather than drawing the shape into a canvas.
 * The artwork is the selection's *bounding box* — a PSD canvas is a
 * rectangle whatever shape the spaces underneath it are — and the marks say
 * which spaces those were.
 */
export async function generatePsdForRegion(
  projectId: string,
  grid: Grid,
  scene: WorldScene,
  from: Cell,
  to: Cell,
): Promise<void> {
  const bounds = grid.rangeBounds(from, to);
  const width = Math.max(1, Math.round(bounds.width * EXPORT_SCALE));
  const height = Math.max(1, Math.round(bounds.height * EXPORT_SCALE));
  if (width * height > MAX_GENERATED_PIXELS) {
    log.warn(
      `That is ${width}×${height} pixels — too big to generate. ` +
        "Select a smaller area.",
    );
    return;
  }

  try {
    const name = `psd-${Date.now().toString(36)}`;
    const anchor = anchorCell(from, to);
    const anchorWorld = grid.cellToWorld(anchor);
    // Every byte zero: transparent, which is what makes this a blank canvas
    // rather than a coloured one.
    const rgba = new Uint8ClampedArray(width * height * 4);

    const result = await psd.fromRgba(
      projectId,
      name,
      width,
      height,
      toBase64(rgba),
      scaleMarks(
        {
          ...marksForSelection(grid, from, to),
          // The artwork covers the footprint exactly, so it says so rather
          // than being centred on the anchor like an imported image.
          art: { x: bounds.x - anchorWorld.x, y: bounds.y - anchorWorld.y },
        },
        EXPORT_SCALE,
      ),
    );

    await scene.placePsd(result.key, result.manifest, anchor, IMPORT_SCALE);
    log.info(
      `${describeRange(grid, from, to)} → ${result.key}.psd ` +
        `(${result.width}×${result.height}) — Open PSD to paint it`,
    );
  } catch (err) {
    log.error("Could not generate a PSD for that selection:", err);
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
  // Cropped to the fill exactly. The room to paint in is the *canvas's*, not
  // the artwork's — see `psdMargin` — so nothing here grows and the pixels
  // that arrive on the grid are the fill and only the fill.
  const width = Math.max(1, Math.ceil(bounds.width * EXPORT_SCALE));
  const height = Math.max(1, Math.ceil(bounds.height * EXPORT_SCALE));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;

  ctx.scale(EXPORT_SCALE, EXPORT_SCALE);
  ctx.translate(-bounds.x, -bounds.y);
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
    x: bounds.x,
    y: bounds.y,
  };
}

/**
 * The marks for a fill: the spaces it actually covers, not a box around
 * them. A fill is often an irregular shape, and an outline that enclosed
 * spaces it never touched would tell the artist something untrue — so each
 * covered space is drawn in full, and the outline is only there to give the
 * zone its bounds. `marksForCells` is that, shared with the sketch
 * conversion, which asks the same question of its ink.
 */
function marksForFill(
  grid: Grid,
  fill: FillPatch,
  bounds: Rect,
  anchor: Cell,
  art: { x: number; y: number },
): AnchorMarks {
  // A rectangle covers one space of its own size, so its outline is the whole
  // of its footprint and there is nothing inside it to divide.
  if (fill.rect) {
    const anchorWorld = grid.cellToWorld(anchor);
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
    return { outline, lines: [], art, cols: 1, rows: 1 };
  }

  return marksForCells(grid, fill.cells, anchor, art);
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
