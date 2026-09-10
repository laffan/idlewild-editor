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
  if (path.length < MIN_POINTS) return [];

  const tolerance = Math.max(1, gridSize * TOLERANCE_FRAC);
  const kept = simplify(path, tolerance);
  if (kept.length < MIN_POINTS) return [];

  return kept.map((p) => ({ x: p.x, y: p.y }));
}
