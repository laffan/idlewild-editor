/**
 * Strokes → a boundary.
 *
 * The spec's second bridge out of the drawing layer: "any stroke can be
 * selected and turned into a boundary", a boundary being a psd-to-phaser
 * zone with no PSD behind it. So the polygon is the outline the user
 * actually drew, not a box around it — you loop a wall, you get that wall.
 *
 * Two things happen to it on the way. Strokes are taken oldest first and
 * concatenated, so a shape drawn in several passes closes in the order it
 * was drawn rather than the order the lasso happened to catch it. And the
 * path is simplified: a drawn line carries a sample every pixel or two, and
 * every vertex kept is one more edge play mode's point-in-zone test walks
 * for every cell of the navigation grid.
 */

import type { Point, Stroke } from "../lib/types";
import { simplify, toPoints, type InkPoint } from "./geometry";

/**
 * How far a vertex may be dropped from the line it sits on, as a fraction of
 * the grid. A boundary only has to be accurate to the cell it blocks, and at
 * a twentieth of a tile the simplification is invisible against the grid it
 * is drawn over.
 */
const TOLERANCE_FRAC = 0.05;

/** The fewest vertices worth calling a region. */
const MIN_POINTS = 3;

export function strokesToZonePoints(
  strokes: readonly Stroke[],
  gridSize: number,
): Point[] {
  const ordered = [...strokes].sort((a, b) => a.createdAt - b.createdAt);

  const path: InkPoint[] = [];
  for (const stroke of ordered) path.push(...toPoints(stroke.points));
  return zonePoints(path, gridSize);
}

/**
 * The same simplification, for an outline that was never a stroke.
 *
 * The boundary *tool* sweeps its polygon on the drawing surface and hands it
 * straight out — no stroke is ever stored — so it arrives here as points
 * rather than as ink. What happens to it afterwards has to be identical, or a
 * boundary swept with the tool would block differently from one converted
 * from a sketch of the same shape.
 */
export function zonePoints(
  path: readonly { x: number; y: number }[],
  gridSize: number,
): Point[] {
  if (path.length < MIN_POINTS) return [];

  const tolerance = Math.max(1, gridSize * TOLERANCE_FRAC);
  const kept = simplify(
    path.map((p) => ({ x: p.x, y: p.y, pressure: 1 })),
    tolerance,
  );
  if (kept.length < MIN_POINTS) return [];

  return kept.map((p) => ({ x: p.x, y: p.y }));
}
