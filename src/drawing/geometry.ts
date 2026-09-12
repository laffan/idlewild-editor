/**
 * Stroke geometry, ported from Hush's `engine/stroke-geometry.js`.
 *
 * Pure maths: no DOM, no canvas, no state. The streamline and the stamp
 * angle are what make the ink feel like Hush's ink, and the slice walk is
 * what makes its eraser cut a stroke rather than delete it — all three are
 * carried across unchanged in behaviour.
 *
 * The one difference is the point type. Hush's engine holds `{x, y,
 * pressure}` objects; the game document stores a flat `number[]` of
 * `[x, y, pressure, …]` triples, because a document is JSON on disk and a
 * few thousand small objects per layer is not. Conversion happens at this
 * boundary and nowhere else.
 */

import type { Stroke } from "../lib/types";
import type { Bounds } from "./types";

export interface InkPoint {
  x: number;
  y: number;
  /** 0–1. Fingers and mice report nothing useful, so they land at 0.5. */
  pressure: number;
}

/** A streamlined point, as the renderer stamps it. */
export interface StreamPoint {
  point: [number, number];
  pressure: number;
}

/** Values per point in the document's flat array. */
export const STRIDE = 3;

export function toPoints(flat: readonly number[]): InkPoint[] {
  const out: InkPoint[] = [];
  for (let i = 0; i + 2 < flat.length; i += STRIDE) {
    out.push({ x: flat[i], y: flat[i + 1], pressure: flat[i + 2] });
  }
  return out;
}

export function toFlat(points: readonly InkPoint[]): number[] {
  const out: number[] = [];
  for (const p of points) out.push(p.x, p.y, p.pressure);
  return out;
}

// ── perfect-freehand's streamline ───────────────────────────────────────────

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/**
 * Smooth a raw pointer trail into the point list the renderer stamps along.
 *
 * `streamline` is 0–1: 0 follows the hand exactly and shows every tremor, 1
 * lags heavily and draws a clean arc. The last raw point is always kept
 * verbatim so the live stroke ends under the pointer rather than behind it.
 */
export function streamlinePoints(
  raw: readonly InkPoint[],
  streamline: number,
): StreamPoint[] {
  if (raw.length === 0) return [];
  const t = 0.15 + (1 - streamline) * 0.85;
  const out: StreamPoint[] = [
    { point: [raw[0].x, raw[0].y], pressure: raw[0].pressure },
  ];

  let px = raw[0].x;
  let py = raw[0].y;
  for (let i = 1; i < raw.length; i++) {
    const last = i === raw.length - 1;
    const nx = last ? raw[i].x : lerp(px, raw[i].x, t);
    const ny = last ? raw[i].y : lerp(py, raw[i].y, t);
    if (nx === px && ny === py) continue;
    out.push({ point: [nx, ny], pressure: raw[i].pressure });
    px = nx;
    py = ny;
  }
  return out;
}

// ── smoothing ────────────────────────────────────────────────

/**
 * How many relaxation passes the slider asks for at 100.
 *
 * Each pass pulls every interior point a quarter of the way towards the mean
 * of its neighbours, which is the cheapest thing that reliably takes a tremor
 * out without moving where the line goes.
 */
const SMOOTH_PASSES = 14;

/**
 * Take the shake out of a drawn line, and at the top of the range straighten
 * it outright.
 *
 * This is the *smoothing* slider, which is a different thing from the
 * streamline the renderer already applies. The streamline is a fixed part of
 * how the ink feels — it lags the pointer a little so a stamp chain reads as
 * a stroke — and turning it up does not produce a straight line, it produces
 * a line that trails further behind the hand. What the slider asks for is
 * something the hand cannot do: at 100, only straight lines.
 *
 * So it is two stages, and the second is what makes the promise exact.
 * `relax` smooths, taking more passes the higher the setting. `straighten`
 * then pulls every point towards where it would sit on the straight line
 * between the two ends, spaced by how far along the stroke it is — at weight
 * 1 every point lands *on* that line, so a stroke drawn at 100 is a straight
 * segment from where the pen went down to where it came up, whatever the hand
 * did in between. The weight is the square of the setting, so the first half
 * of the slider is nearly all tremor-removal and the pull towards the line
 * comes in over the second.
 *
 * The endpoints never move under either stage: a line that started somewhere
 * other than where the pen went down is a line that ignored you.
 */
export function smoothPoints(
  raw: readonly InkPoint[],
  smoothing: number,
): InkPoint[] {
  const amount = Math.min(1, Math.max(0, smoothing / 100));
  // Two points are already a straight line, and one is a dot.
  if (amount <= 0 || raw.length < 3) return raw.map((p) => ({ ...p }));
  return straighten(relax(raw, Math.round(amount * SMOOTH_PASSES)), amount ** 2);
}

/** Laplacian passes with the ends pinned. Pressure is left alone. */
function relax(points: readonly InkPoint[], passes: number): InkPoint[] {
  let out = points.map((p) => ({ ...p }));
  for (let pass = 0; pass < passes; pass++) {
    const next = out.map((p) => ({ ...p }));
    for (let i = 1; i < out.length - 1; i++) {
      next[i].x = (out[i - 1].x + 2 * out[i].x + out[i + 1].x) / 4;
      next[i].y = (out[i - 1].y + 2 * out[i].y + out[i + 1].y) / 4;
    }
    out = next;
  }
  return out;
}

/**
 * Pull every point `t` of the way towards the chord between the two ends.
 *
 * Where a point belongs on that chord is its distance *along the stroke*
 * rather than its index, so the stamps stay evenly spread as the curve
 * flattens instead of bunching wherever the hand happened to slow down.
 */
function straighten(points: InkPoint[], t: number): InkPoint[] {
  if (t <= 0 || points.length < 3) return points;
  const first = points[0];
  const last = points[points.length - 1];

  const along: number[] = [0];
  for (let i = 1; i < points.length; i++) {
    along.push(
      along[i - 1] +
        Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y),
    );
  }
  const total = along[along.length - 1];
  // Every sample in the same place: there is no chord to pull towards.
  if (total === 0) return points;

  return points.map((point, i) => {
    const u = along[i] / total;
    return {
      x: lerp(point.x, first.x + (last.x - first.x) * u, t),
      y: lerp(point.y, first.y + (last.y - first.y) * u, t),
      pressure: point.pressure,
    };
  });
}

/**
 * A stable pseudo-random angle for stamp `i`, in [0, 2π).
 *
 * Each stamp is rotated so adjacent ones do not mirror each other and the
 * ink reads as a brush rather than a chain of discs. It is a hash rather
 * than a PRNG so the same stroke re-bakes identically every time — which is
 * what lets the backing be thrown away and rebuilt without the drawing
 * shimmering.
 */
export function stampAngle(i: number): number {
  let h = (i * 0x9e3779b1) >>> 0;
  h = Math.imul(h ^ (h >>> 15), h | 1);
  h ^= h + Math.imul(h ^ (h >>> 7), h | 61);
  return (((h ^ (h >>> 14)) >>> 0) / 4294967296) * Math.PI * 2;
}

// ── bounds ──────────────────────────────────────────────────────────────────

/** Bounds are derived from the points array and cached against the stroke's
 *  identity — sound because a mutation replaces the stroke object. */
const boundsCache = new WeakMap<Stroke, Bounds | null>();

export function strokeBox(stroke: Stroke): Bounds | null {
  const cached = boundsCache.get(stroke);
  if (cached !== undefined) return cached;

  const pts = stroke.points;
  let box: Bounds | null = null;
  if (pts.length >= STRIDE) {
    let minX = pts[0];
    let minY = pts[1];
    let maxX = pts[0];
    let maxY = pts[1];
    for (let i = STRIDE; i + 2 < pts.length; i += STRIDE) {
      if (pts[i] < minX) minX = pts[i];
      if (pts[i] > maxX) maxX = pts[i];
      if (pts[i + 1] < minY) minY = pts[i + 1];
      if (pts[i + 1] > maxY) maxY = pts[i + 1];
    }
    // A stamp reaches half the brush size from the centre; pad by the whole
    // size against the streamline's outward bump on tight corners.
    const pad = stroke.size + 1;
    box = {
      x: minX - pad,
      y: minY - pad,
      width: maxX - minX + pad * 2,
      height: maxY - minY + pad * 2,
    };
  }
  boundsCache.set(stroke, box);
  return box;
}

/** The union of a set of strokes' boxes, or null when there is nothing. */
export function strokesBox(strokes: readonly Stroke[]): Bounds | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const stroke of strokes) {
    const box = strokeBox(stroke);
    if (!box) continue;
    minX = Math.min(minX, box.x);
    minY = Math.min(minY, box.y);
    maxX = Math.max(maxX, box.x + box.width);
    maxY = Math.max(maxY, box.y + box.height);
  }

  if (!Number.isFinite(minX)) return null;
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

export function boxesOverlap(a: Bounds, b: Bounds): boolean {
  return (
    a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y
  );
}

// ── segment / disc maths, for the eraser ────────────────────────────────────

export function pointToSegmentDist2(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  const vx = bx - ax;
  const vy = by - ay;
  const wx = px - ax;
  const wy = py - ay;
  const vv = vx * vx + vy * vy;
  if (vv === 0) return wx * wx + wy * wy;
  const t = Math.max(0, Math.min(1, (wx * vx + wy * vy) / vv));
  const dx = px - (ax + vx * t);
  const dy = py - (ay + vy * t);
  return dx * dx + dy * dy;
}

/** The t values in (0, 1) where segment a→b crosses a circle, ascending. */
function segmentCircleRoots(
  a: InkPoint,
  b: InkPoint,
  cx: number,
  cy: number,
  r: number,
): number[] {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const ex = a.x - cx;
  const ey = a.y - cy;
  const A = dx * dx + dy * dy;
  if (A === 0) return [];
  const B = 2 * (ex * dx + ey * dy);
  const C = ex * ex + ey * ey - r * r;
  const D = B * B - 4 * A * C;
  if (D <= 0) return [];
  const root = Math.sqrt(D);
  const t1 = (-B - root) / (2 * A);
  const t2 = (-B + root) / (2 * A);
  const out: number[] = [];
  if (t1 > 0 && t1 < 1) out.push(t1);
  if (t2 > 0 && t2 < 1 && t2 !== t1) out.push(t2);
  return out;
}

function lerpPoint(a: InkPoint, b: InkPoint, t: number): InkPoint {
  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
    pressure: a.pressure + (b.pressure - a.pressure) * t,
  };
}

/**
 * Split a stroke around an eraser disc.
 *
 * Returns null when the disc does not touch it, otherwise the sub-strokes
 * that survive — an empty array meaning the stroke is gone entirely. The
 * walk emits boundary-crossing points rather than dropping whole segments,
 * so a cut lands where the eraser actually passed instead of at the nearest
 * recorded sample.
 */
export function sliceStroke(
  points: readonly InkPoint[],
  size: number,
  cx: number,
  cy: number,
  radius: number,
): InkPoint[][] | null {
  const hitR = radius + size / 2;
  const hit2 = hitR * hitR;

  if (points.length === 0) return null;
  if (points.length === 1) {
    const dx = points[0].x - cx;
    const dy = points[0].y - cy;
    return dx * dx + dy * dy < hit2 ? [] : null;
  }

  const inside = points.map((p) => {
    const dx = p.x - cx;
    const dy = p.y - cy;
    return dx * dx + dy * dy < hit2;
  });

  let touched = inside.some(Boolean);
  if (!touched) {
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1];
      const b = points[i];
      if (pointToSegmentDist2(cx, cy, a.x, a.y, b.x, b.y) < hit2) {
        touched = true;
        break;
      }
    }
    if (!touched) return null;
  }

  const subs: InkPoint[][] = [];
  let current: InkPoint[] | null = inside[0] ? null : [points[0]];

  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const aIn = inside[i - 1];
    const bIn = inside[i];

    if (aIn && bIn) continue;

    if (!aIn && !bIn) {
      const ts = segmentCircleRoots(a, b, cx, cy, hitR);
      if (ts.length === 2) {
        // Dips through the disc and comes out the far side.
        if (current) {
          current.push(lerpPoint(a, b, ts[0]));
          if (current.length > 1) subs.push(current);
        }
        current = [lerpPoint(a, b, ts[1]), b];
      } else if (current) {
        current.push(b);
      } else {
        current = [a, b];
      }
      continue;
    }

    if (!aIn && bIn) {
      // Entering the disc. With no root strictly inside the segment the
      // crossing sits on `a` itself, so that is where this piece ends.
      // (Hush falls back to `b` here and to `a` on the way out, which keeps
      // one sample of ink *inside* the eraser whenever a crossing lands
      // exactly on a recorded point — invisible at its sampling rates, but
      // the wrong end of the segment either way.)
      const ts = segmentCircleRoots(a, b, cx, cy, hitR);
      if (current) {
        current.push(lerpPoint(a, b, ts.length ? ts[0] : 0));
        if (current.length > 1) subs.push(current);
      }
      current = null;
      continue;
    }

    // Leaving it. Symmetrically, a degenerate crossing is on `b`.
    const ts = segmentCircleRoots(a, b, cx, cy, hitR);
    current = [lerpPoint(a, b, ts.length ? ts[ts.length - 1] : 1), b];
  }

  if (current && current.length > 1) subs.push(current);
  return subs;
}

// ── lasso ───────────────────────────────────────────────────────────────────

export function pointInPolygon(
  x: number,
  y: number,
  poly: readonly [number, number][],
): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    const crosses =
      yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (crosses) inside = !inside;
  }
  return inside;
}

/** A stroke is caught when any of its points falls inside the region. */
export function strokeInPolygon(
  stroke: Stroke,
  poly: readonly [number, number][],
): boolean {
  const pts = stroke.points;
  for (let i = 0; i + 2 < pts.length; i += STRIDE) {
    if (pointInPolygon(pts[i], pts[i + 1], poly)) return true;
  }
  return false;
}

// ── simplification, for the boundary conversion ─────────────────────────────

/**
 * Ramer–Douglas–Peucker. A drawn outline carries a sample every few pixels;
 * a psd-to-phaser zone wants a polygon, and every kept vertex is one more
 * edge play mode's point-in-zone test walks per cell.
 */
export function simplify(
  points: readonly InkPoint[],
  tolerance: number,
): InkPoint[] {
  if (points.length < 3) return [...points];

  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const tol2 = tolerance * tolerance;

  const stack: Array<[number, number]> = [[0, points.length - 1]];
  while (stack.length) {
    const [first, last] = stack.pop() as [number, number];
    let worst = 0;
    let index = -1;
    for (let i = first + 1; i < last; i++) {
      const d = pointToSegmentDist2(
        points[i].x,
        points[i].y,
        points[first].x,
        points[first].y,
        points[last].x,
        points[last].y,
      );
      if (d > worst) {
        worst = d;
        index = i;
      }
    }
    if (index >= 0 && worst > tol2) {
      keep[index] = 1;
      stack.push([first, index], [index, last]);
    }
  }

  return points.filter((_, i) => keep[i] === 1);
}
