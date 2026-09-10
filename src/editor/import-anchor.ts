/**
 * What an import knows about the grid space it landed on.
 *
 * Two things travel with an image on its way into the project. The grid
 * selection it was dropped into, which Rust writes into the PSD as a pair of
 * orienting marks — see `src-tauri/src/psd_marks.rs` — and the scale it is
 * displayed at once it gets there.
 */

import { Grid } from "../lib/grid";
import type { AnchorMarks } from "../lib/ipc";
import type { Cell } from "../lib/types";
import { cellsInRange, rangeSize } from "../lib/grid";

/**
 * A ceiling on the internal lines a footprint draws.
 *
 * A selection of a few hundred spaces would otherwise ship thousands of
 * segments into a PSD layer nobody can read at that density anyway. Past
 * this the footprint keeps its outline and drops the divisions.
 */
const MAX_LINES = 600;

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

  const relative = (p: { x: number; y: number }) => ({
    x: p.x - anchor.x,
    y: p.y - anchor.y,
  });

  return {
    outline: grid.rangePolygon(from, to).map(relative),
    lines: internalLines(grid, from, to).map((line) => ({
      a: relative(line.a),
      b: relative(line.b),
    })),
    cols: w,
    rows: h,
  };
}

/**
 * The divisions between the spaces a selection covers.
 *
 * A footprint that is only an outline says how much room the artwork has;
 * the divisions say where each space in it begins, which is what you draw
 * against when the artwork spans several. Only the edges a cell shares with
 * its `+cx` and `+cy` neighbours are emitted, so no line is drawn twice.
 *
 * Both projections put those two edges at the same two indices of
 * `cellPolygon` — right→bottom and bottom→left for a diamond, right→bottom
 * and bottom→left for a square — so the walk is written once.
 */
function internalLines(
  grid: Grid,
  from: Cell,
  to: Cell,
): Array<{ a: { x: number; y: number }; b: { x: number; y: number } }> {
  const x1 = Math.max(from.cx, to.cx);
  const y1 = Math.max(from.cy, to.cy);
  const out: Array<{ a: { x: number; y: number }; b: { x: number; y: number } }> = [];

  for (const cell of cellsInRange(from, to)) {
    if (out.length >= MAX_LINES) break;
    const poly = grid.cellPolygon(cell);
    if (cell.cx < x1) out.push({ a: poly[1], b: poly[2] });
    if (cell.cy < y1) out.push({ a: poly[2], b: poly[3] });
  }
  return out;
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
