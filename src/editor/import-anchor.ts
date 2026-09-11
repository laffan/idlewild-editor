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
import type { Cell, Rect } from "../lib/types";
import {
  cellsBounds,
  cellsInRange,
  cellsUnderBox,
  pointsBounds,
  rangeSize,
} from "../lib/grid";

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
 * How many PSD pixels a *conversion* draws per world pixel.
 *
 * An import arrives at 2× and is placed at `IMPORT_SCALE`, because everything
 * drawn on a retina machine comes out at 2×. A fill or a sketch rasterised at
 * world scale would arrive at 1× instead and sit in the same project at half
 * the resolution of everything beside it — which shows the moment anyone
 * opens both to paint over them. So a conversion draws at this and is placed
 * at `IMPORT_SCALE`: the world geometry is exactly where it was, and the file
 * has twice the pixels.
 */
export const EXPORT_SCALE = 1 / IMPORT_SCALE;

/**
 * Room to leave around a generated PSD's contents, in world pixels.
 *
 * One grid space, in the grid's own shape: a diamond template gets a tile's
 * width across and a tile's height down, a square one gets its cell either
 * way. A canvas cropped exactly to a block-out is a file with nowhere to draw
 * the eaves that hang past the wall, and resizing a canvas in Photoshop
 * without moving the anchor dot off its space is fiddlier than it sounds.
 *
 * It is the *canvas* that grows and nothing else — see `margin` on
 * `AnchorMarks`. The artwork keeps its size and its offset from the anchor,
 * so the thing on the grid does not move, and its collider, which is derived
 * from what the artwork covers, does not change either.
 *
 * A blank project's cell is one pixel, which is no margin at all, so it takes
 * the nominal unit the New Game sheet set instead — the same fallback `size`
 * serves everywhere else nothing rounds to it.
 */
export function psdMargin(grid: Grid): { x: number; y: number } {
  if (!grid.snaps) return { x: grid.size, y: grid.size };
  return { x: grid.tileWidth, y: grid.tileHeight };
}

/**
 * Take marks from world pixels into a PSD's own pixels.
 *
 * Rust lays the artwork out against the marks in the file's own pixel space,
 * so a conversion drawing at `EXPORT_SCALE` has to scale its marks by the
 * same factor — otherwise the grid footprint comes out half the size of the
 * artwork it is meant to sit under.
 */
export function scaleMarks(marks: AnchorMarks, factor: number): AnchorMarks {
  const at = (p: { x: number; y: number }) => ({
    x: p.x * factor,
    y: p.y * factor,
  });
  return {
    ...marks,
    outline: marks.outline.map(at),
    lines: marks.lines.map((line) => ({ a: at(line.a), b: at(line.b) })),
    art: marks.art ? at(marks.art) : undefined,
    margin: marks.margin ? at(marks.margin) : undefined,
  };
}

/**
 * The spaces a world-space box was drawn over, and the space it hangs from.
 *
 * `cellsUnderBox` rather than the cell range enclosing the box: under an
 * isometric template those are very different sets, and only the first is
 * true. See `marksForCells`.
 */
export function footprintForBox(
  grid: Grid,
  box: Rect,
): { cells: Cell[]; anchor: Cell } {
  const cells = cellsUnderBox(grid, box);
  const { from, to } = cellsBounds(cells);
  return { cells, anchor: anchorCell(from, to) };
}

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

  const outline = grid.rangePolygon(from, to).map(relative);

  // A blank selection is one space of an arbitrary size, not a run of them,
  // so there is nothing between its spaces to divide — and its cells are
  // single pixels, which would otherwise put six hundred one-pixel lines
  // into the PSD as a footprint nobody can read.
  if (!grid.snaps) return { outline, lines: [], cols: 1, rows: 1 };

  return {
    outline,
    lines: internalLines(grid, from, to).map((line) => ({
      a: relative(line.a),
      b: relative(line.b),
    })),
    cols: w,
    rows: h,
  };
}

/**
 * Describe the *spaces something covers* for the PSD writer, rather than the
 * range enclosing them.
 *
 * The difference matters under an isometric projection, and it is the whole
 * reason this exists beside `marksForSelection`. A marquee genuinely is its
 * range — the user dragged out a diamond and that diamond is the footprint.
 * A conversion is not: a sketch or a fill covers particular spaces, and the
 * axis-aligned range around those spaces is a far bigger diamond. Marking
 * that range put a 132 × 136 sketch into an 832 × 416 PSD, six times the area
 * it needed, because `psd_marks::layout` grows the canvas to hold the
 * footprint.
 *
 * So the outline is the box around the covered spaces — which is what gives
 * the canvas its size and the zone its bounds — and the divisions draw the
 * spaces themselves, irregular shape and all.
 */
export function marksForCells(
  grid: Grid,
  cells: readonly Cell[],
  anchor: Cell,
  art?: { x: number; y: number },
): AnchorMarks {
  const world = grid.cellToWorld(anchor);
  const relative = (p: { x: number; y: number }) => ({
    x: p.x - world.x,
    y: p.y - world.y,
  });

  const polygons = cells.map((cell) => grid.cellPolygon(cell));
  const bounds = pointsBounds(polygons.flat());
  const outline = [
    { x: bounds.x, y: bounds.y },
    { x: bounds.x + bounds.width, y: bounds.y },
    { x: bounds.x + bounds.width, y: bounds.y + bounds.height },
    { x: bounds.x, y: bounds.y + bounds.height },
  ].map(relative);

  const lines: AnchorMarks["lines"] = [];
  for (const polygon of polygons) {
    if (lines.length >= MAX_LINES) break;
    const points = polygon.map(relative);
    for (let i = 0; i < points.length; i++) {
      lines.push({ a: points[i], b: points[(i + 1) % points.length] });
    }
  }

  const { from, to } = cellsBounds(cells);
  return {
    outline,
    lines,
    art,
    cols: Math.abs(to.cx - from.cx) + 1,
    rows: Math.abs(to.cy - from.cy) + 1,
  };
}

/**
 * The footprint of a box on a grid that does not snap.
 *
 * A blank project's spaces are single world pixels, so "the spaces under this
 * box" is a hundred thousand of them for anything the size of a screenshot,
 * and the footprint that means something is the box itself — one space of
 * exactly the size that landed, which is what every selection in a blank
 * project already is. There is nothing to divide, so no lines.
 */
export function marksForBox(grid: Grid, box: Rect, anchor: Cell): AnchorMarks {
  const world = grid.cellToWorld(anchor);
  const corners = [
    { x: box.x, y: box.y },
    { x: box.x + box.width, y: box.y },
    { x: box.x + box.width, y: box.y + box.height },
    { x: box.x, y: box.y + box.height },
  ];
  return {
    outline: corners.map((p) => ({ x: p.x - world.x, y: p.y - world.y })),
    lines: [],
    art: { x: box.x - world.x, y: box.y - world.y },
    cols: 1,
    rows: 1,
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
