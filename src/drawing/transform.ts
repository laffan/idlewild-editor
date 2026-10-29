/**
 * Moving, scaling and turning strokes: the arithmetic behind the box a lasso
 * selection wears — see `transform-box.ts`.
 *
 * One affine matrix, `[a, b, c, d, e, f]` mapping `(x, y)` to
 * `(a·x + c·y + e, b·x + d·y + f)`, the way a canvas transform does, so a
 * move, a scale and a turn are the same operation on the same flat list of
 * points. Pressure is left alone: it is how hard the pen was pressed, not
 * where. The width a stroke is drawn at goes with the size of the change —
 * a sketch scaled to twice the size is drawn twice as heavy, the way it
 * would be if it had been drawn at that size — and so does a shape stamp's
 * box. A shape stamp is not turned: it is a grid space, and the grid does
 * not turn.
 */

import type { Stroke } from "../lib/types";
import { STRIDE } from "./geometry";

export type Affine = readonly [number, number, number, number, number, number];

export const IDENTITY: Affine = [1, 0, 0, 1, 0, 0];

/** `first`, then `then`. */
export function compose(first: Affine, then: Affine): Affine {
  const [a, b, c, d, e, f] = first;
  const [A, B, C, D, E, F] = then;
  return [A * a + C * b, B * a + D * b, A * c + C * d, B * c + D * d, A * e + C * f + E, B * e + D * f + F];
}

/** The matrix that undoes `m`. A matrix with no area undoes to the identity. */
export function invert(m: Affine): Affine {
  const [a, b, c, d, e, f] = m;
  const det = a * d - b * c;
  if (Math.abs(det) < 1e-12) return IDENTITY;
  return [d / det, -b / det, -c / det, a / det, (c * f - d * e) / det, (b * e - a * f) / det];
}

export function translation(dx: number, dy: number): Affine {
  return [1, 0, 0, 1, dx, dy];
}

/** Scale by `sx, sy` with `px, py` staying put. */
export function scalingAbout(px: number, py: number, sx: number, sy: number): Affine {
  return [sx, 0, 0, sy, px - sx * px, py - sy * py];
}

/** Turn by `angle` radians, clockwise on screen, about `px, py`. */
export function rotationAbout(px: number, py: number, angle: number): Affine {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return [cos, sin, -sin, cos, px - cos * px + sin * py, py - sin * px - cos * py];
}

export function applyPoint(m: Affine, x: number, y: number): { x: number; y: number } {
  return { x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] };
}

/** How much a matrix grows a length, on average over the two axes. */
export function lengthScale(m: Affine): number {
  return Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2]));
}

/** A stroke moved by a matrix: a new object, the same id. */
export function transformStroke(stroke: Stroke, m: Affine): Stroke {
  const points = stroke.points.slice();
  for (let i = 0; i + 1 < points.length; i += STRIDE) {
    const at = applyPoint(m, points[i], points[i + 1]);
    points[i] = at.x;
    points[i + 1] = at.y;
  }
  const grow = lengthScale(m);
  const next: Stroke = { ...stroke, points, size: Math.max(0.5, stroke.size * grow) };
  if (stroke.stamp) {
    next.stamp = {
      ...stroke.stamp,
      width: stroke.stamp.width * Math.hypot(m[0], m[1]),
      height: stroke.stamp.height * Math.hypot(m[2], m[3]),
    };
  }
  return next;
}

/** A list with the strokes named in `ids` moved, everything else as it was. */
export function transformSome(
  strokes: readonly Stroke[],
  ids: ReadonlySet<string>,
  m: Affine,
): Stroke[] {
  return strokes.map((stroke) => (ids.has(stroke.id) ? transformStroke(stroke, m) : stroke));
}
