/**
 * What an import knows about the grid space it landed on.
 *
 * Two things travel with an image on its way into the project. The grid
 * selection it was dropped into, which Rust writes into the PSD as a pair of
 * orienting marks — see `src-tauri/src/psd_marks.rs` — and the scale it is
 * displayed at once it gets there.
 */

import type { Grid } from "../lib/grid";
import type { AnchorMarks } from "../lib/ipc";
import type { Cell } from "../lib/types";
import { rangeSize } from "../lib/grid";

/**
 * How big an imported image is displayed against its own pixels.
 *
 * Everything anyone draws on a retina machine comes out at 2×: a screenshot,
 * an export from Photoshop at the default resolution, a photo. Placed at one
 * world pixel per image pixel, all of it arrives twice the size it was meant
 * to be and every import starts with the same manual resize.
 *
 * So an import lands at half, and `naturalWidth` keeps the pixels it really
 * has — the inspector's width and height are still the exported size × this,
 * and a genuinely 1× asset is two taps from full size. It is a default, not
 * a conversion: nothing about the file changes.
 */
export const IMPORT_SCALE = 0.5;

/**
 * Describe a grid selection for the PSD writer, in world pixels relative to
 * the anchor cell.
 *
 * The outline rather than a rectangle, because an isometric selection is a
 * diamond and drawing its bounding box would mark a footprint the game does
 * not use. The projection stays here, where the grid is; Rust only ever sees
 * a polygon.
 */
export function marksForSelection(
  grid: Grid,
  from: Cell,
  to: Cell,
): AnchorMarks {
  const anchor = grid.cellToWorld(anchorCell(from, to));
  const { w, h } = rangeSize(from, to);

  return {
    outline: grid
      .rangePolygon(from, to)
      .map((p) => ({ x: p.x - anchor.x, y: p.y - anchor.y })),
    cols: w,
    rows: h,
  };
}

/**
 * The cell a selection is anchored to: its lowest corner in cell space,
 * which is the top of the diamond under an isometric template and the
 * top-left square under an orthogonal one.
 */
export function anchorCell(from: Cell, to: Cell): Cell {
  return {
    cx: Math.min(from.cx, to.cx),
    cy: Math.min(from.cy, to.cy),
  };
}
