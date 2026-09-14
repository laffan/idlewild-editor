/**
 * Where things are in the shape editor: unit space to pixels, and what is
 * under the pointer.
 *
 * The shape's coordinates are 0–1 and the canvas is pixels, so every hit test
 * is a comparison in one of the two and a conversion to get there. Points and
 * handles are tested in **pixels**, because "near enough to grab" is a fact
 * about a finger; edges are walked in unit space and compared in pixels for
 * the same reason.
 */

import { cubicAt, subPathPolygon } from "../../lib/shape-path";
import type { Point } from "../../lib/types";
import type { Vertex } from "../../lib/library";
import {
  EDGE_HIT_PX,
  HIT_PX,
  INNER_PX,
  MARGIN_PX,
  hasCurve,
  type EditPath,
  type ShapeEditorState,
} from "./state";

/** Unit space → canvas pixels. */
export function toPx(p: Point): Point {
  return { x: MARGIN_PX + p.x * INNER_PX, y: MARGIN_PX + p.y * INNER_PX };
}

/** Canvas pixels → unit space. */
export function toUnit(p: Point): Point {
  return { x: (p.x - MARGIN_PX) / INNER_PX, y: (p.y - MARGIN_PX) / INNER_PX };
}

/** A control handle's tip, in unit space. */
export function controlPoint(vertex: Vertex, side: "left" | "right"): Point {
  const c = side === "left" ? vertex.ctrlLeft : vertex.ctrlRight;
  return { x: vertex.x + (c?.x ?? 0), y: vertex.y + (c?.y ?? 0) };
}

/** The box a path covers, walked rather than measured off its handles. */
export function pathBounds(path: EditPath): {
  x: number;
  y: number;
  width: number;
  height: number;
} {
  const points = subPathPolygon(
    { vertices: path.vertices, closed: path.closed },
    { x: 0, y: 0, width: 1, height: 1 },
    10,
  );
  return boundsOf(points);
}

export function boundsOf(points: readonly Point[]): {
  x: number;
  y: number;
  width: number;
  height: number;
} {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  if (minX === Infinity) return { x: 0, y: 0, width: 0, height: 0 };
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/** The box around every path in a list. */
export function pathsBounds(paths: readonly EditPath[]): {
  x: number;
  y: number;
  width: number;
  height: number;
} {
  const corners: Point[] = [];
  for (const path of paths) {
    const box = pathBounds(path);
    corners.push({ x: box.x, y: box.y }, { x: box.x + box.width, y: box.y + box.height });
  }
  return boundsOf(corners);
}

/** How far apart two points are, in pixels. */
function pixelGap(a: Point, b: Point): number {
  const pa = toPx(a);
  const pb = toPx(b);
  return Math.hypot(pa.x - pb.x, pa.y - pb.y);
}

/**
 * The anchor nearest a point, if one is within reach.
 *
 * Every path is searched, not only the current one — picking a point on a
 * path you are not on is how you get onto it, and requiring two taps for that
 * is the kind of thing that makes a vector editor feel locked.
 */
export function anchorAt(
  state: ShapeEditorState,
  at: Point,
): { path: number; index: number } | null {
  let best: { path: number; index: number } | null = null;
  let bestGap = HIT_PX;
  state.paths.forEach((path, pathIndex) => {
    path.vertices.forEach((vertex, index) => {
      const gap = pixelGap(vertex, at);
      if (gap > bestGap) return;
      bestGap = gap;
      best = { path: pathIndex, index };
    });
  });
  return best;
}

/**
 * A control handle near a point, on the current path only.
 *
 * Only the current path, because handles are only *drawn* for it — a hit test
 * that reached an invisible handle would be a drag on nothing visible.
 */
export function controlAt(
  state: ShapeEditorState,
  at: Point,
): { path: number; index: number; side: "left" | "right" } | null {
  const path = state.paths[state.current];
  if (!path) return null;
  for (let index = 0; index < path.vertices.length; index++) {
    const vertex = path.vertices[index];
    if (!hasCurve(vertex)) continue;
    for (const side of ["left", "right"] as const) {
      if (pixelGap(controlPoint(vertex, side), at) <= HIT_PX) {
        return { path: state.current, index, side };
      }
    }
  }
  return null;
}

/**
 * The segment a point is sitting on, and where along it — which is what
 * dropping a new anchor into an edge needs.
 *
 * Every segment is walked at sixteen samples and the nearest one wins. That
 * is more than enough on a curve the size of a tile, and it means a click
 * lands on the curve as drawn rather than on the chord under it.
 */
export function edgeAt(
  state: ShapeEditorState,
  at: Point,
): { path: number; index: number; point: Point } | null {
  let best: { path: number; index: number; point: Point } | null = null;
  let bestGap = EDGE_HIT_PX;

  state.paths.forEach((path, pathIndex) => {
    const count = path.closed ? path.vertices.length : path.vertices.length - 1;
    for (let index = 0; index < count; index++) {
      const from = path.vertices[index];
      const to = path.vertices[(index + 1) % path.vertices.length];
      for (let step = 1; step < 16; step++) {
        const sample = pointOnSegment(from, to, step / 16);
        const gap = pixelGap(sample, at);
        if (gap > bestGap) continue;
        bestGap = gap;
        best = { path: pathIndex, index, point: sample };
      }
    }
  });
  return best;
}

/** A point along one segment, curve or line. */
export function pointOnSegment(from: Vertex, to: Vertex, t: number): Point {
  const a = { x: from.x, y: from.y };
  const b = { x: to.x, y: to.y };
  const live = (c?: { x: number; y: number }) => !!c && (c.x !== 0 || c.y !== 0);
  if (!live(from.ctrlRight) && !live(to.ctrlLeft)) {
    return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
  }
  return cubicAt(a, controlPoint(from, "right"), controlPoint(to, "left"), b, t);
}

/** Even-odd containment against the path as drawn. */
export function pathContains(path: EditPath, at: Point): boolean {
  const polygon = subPathPolygon(
    { vertices: path.vertices, closed: path.closed },
    { x: 0, y: 0, width: 1, height: 1 },
    10,
  );
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i];
    const b = polygon[j];
    if (a.y > at.y === b.y > at.y) continue;
    const x = ((b.x - a.x) * (at.y - a.y)) / (b.y - a.y) + a.x;
    if (at.x < x) inside = !inside;
  }
  return inside;
}

/** The front-most path a point is inside, searching the top of the stack first. */
export function pathAt(state: ShapeEditorState, at: Point): number | null {
  for (let i = state.paths.length - 1; i >= 0; i--) {
    if (pathContains(state.paths[i], at)) return i;
  }
  return null;
}

/** The eight handles of a transform box, clockwise from the top-left. */
export function boxHandles(box: {
  x: number;
  y: number;
  width: number;
  height: number;
}): Point[] {
  const { x, y, width: w, height: h } = box;
  return [
    { x, y },
    { x: x + w / 2, y },
    { x: x + w, y },
    { x: x + w, y: y + h / 2 },
    { x: x + w, y: y + h },
    { x: x + w / 2, y: y + h },
    { x, y: y + h },
    { x, y: y + h / 2 },
  ];
}

/** Where the rotate handle sits: above the middle of the box's top edge. */
export function rotateHandle(box: {
  x: number;
  y: number;
  width: number;
  height: number;
}): Point {
  return { x: box.x + box.width / 2, y: box.y - 28 / INNER_PX };
}

/** Which transform handle a point is on, or null. */
export function handleAt(
  box: { x: number; y: number; width: number; height: number },
  at: Point,
): { kind: "scale"; corner: number } | { kind: "rotate" } | null {
  if (pixelGap(rotateHandle(box), at) <= HIT_PX) return { kind: "rotate" };
  const handles = boxHandles(box);
  for (let i = 0; i < handles.length; i++) {
    if (pixelGap(handles[i], at) <= HIT_PX) return { kind: "scale", corner: i };
  }
  return null;
}
