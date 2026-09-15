/**
 * What the shape editor's toolbar does — the operations, with no DOM in them.
 *
 * Carried over from simple-tileset-generator's `shapeToolbar.js`: add a
 * primitive, reflect, align, distribute, toggle a hole, and cut one path out
 * of another. Its two-thousand lines are mostly Two.js bookkeeping and the
 * boolean; the bookkeeping is gone because this editor works in the stored
 * format, and the boolean lives in `lib/polygon-ops.ts` where it can be
 * tested without an editor around it.
 *
 * **Align and distribute read the selection.** One path selected aligns to
 * the tile — which is what you want when you are placing a single shape in
 * its box — and several align to each other. That is upstream's rule, and it
 * is the one that makes a single control do the obvious thing in both cases.
 */

import { polygonDifference } from "../../lib/polygon-ops";
import { subPathPolygon } from "../../lib/shape-path";
import type { Point } from "../../lib/types";
import { BEZIER_CIRCLE, type Vertex } from "../../lib/library";
import { pathBounds, pathsBounds } from "./geometry";
import {
  capture,
  copyPath,
  copyVertex,
  selectedPaths,
  type EditPath,
  type ShapeEditorState,
} from "./state";

export type Alignment =
  | "left"
  | "centre"
  | "right"
  | "top"
  | "middle"
  | "bottom";

export type Distribution = "horizontal" | "vertical" | "line";

export type Primitive = "circle" | "square" | "triangle" | "hexagon";

// ── new paths ───────────────────────────────────────────────────────────────

/** A primitive, put down in the middle of the tile at half its size. */
export function primitivePath(kind: Primitive): EditPath {
  const vertices: Vertex[] = [];
  const cx = 0.5;
  const cy = 0.5;
  const r = 0.25;

  if (kind === "circle") {
    const bc = BEZIER_CIRCLE * r;
    vertices.push(
      { x: cx, y: cy - r, ctrlLeft: { x: -bc, y: 0 }, ctrlRight: { x: bc, y: 0 } },
      { x: cx + r, y: cy, ctrlLeft: { x: 0, y: -bc }, ctrlRight: { x: 0, y: bc } },
      { x: cx, y: cy + r, ctrlLeft: { x: bc, y: 0 }, ctrlRight: { x: -bc, y: 0 } },
      { x: cx - r, y: cy, ctrlLeft: { x: 0, y: bc }, ctrlRight: { x: 0, y: -bc } },
    );
  } else if (kind === "square") {
    vertices.push(
      { x: cx - r, y: cy - r },
      { x: cx + r, y: cy - r },
      { x: cx + r, y: cy + r },
      { x: cx - r, y: cy + r },
    );
  } else if (kind === "triangle") {
    vertices.push(
      { x: cx, y: cy - r },
      { x: cx + r, y: cy + r },
      { x: cx - r, y: cy + r },
    );
  } else {
    for (let i = 0; i < 6; i++) {
      const angle = (Math.PI / 3) * i - Math.PI / 2;
      vertices.push({ x: cx + Math.cos(angle) * r, y: cy + Math.sin(angle) * r });
    }
  }

  return { vertices, closed: true, hole: false };
}

export function addPath(state: ShapeEditorState, path: EditPath): void {
  capture(state);
  state.paths.push(path);
  state.current = state.paths.length - 1;
  state.selectedPaths = new Set([state.current]);
  state.selectedPoints.clear();
}

/** A copy of every selected path, offset a little so it can be seen. */
export function duplicateSelected(state: ShapeEditorState, dx = 0.05, dy = 0.05): void {
  const wanted = selectedPaths(state);
  capture(state);
  const made: number[] = [];
  for (const index of wanted) {
    const copy = copyPath(state.paths[index]);
    for (const vertex of copy.vertices) {
      vertex.x += dx;
      vertex.y += dy;
    }
    state.paths.push(copy);
    made.push(state.paths.length - 1);
  }
  state.selectedPaths = new Set(made);
  state.current = made[made.length - 1] ?? state.current;
  state.selectedPoints.clear();
}

/** Get rid of the selected paths — but never the last one. */
export function deleteSelected(state: ShapeEditorState): void {
  const wanted = selectedPaths(state);
  if (state.paths.length - wanted.length < 1) return;
  capture(state);
  for (const index of [...wanted].sort((a, b) => b - a)) state.paths.splice(index, 1);
  state.current = Math.max(0, Math.min(state.current, state.paths.length - 1));
  state.selectedPaths = new Set([state.current]);
  state.selectedPoints.clear();
}

/** Cut the selected paths out of the body instead of adding them to it. */
export function toggleHole(state: ShapeEditorState): void {
  capture(state);
  for (const index of selectedPaths(state)) {
    state.paths[index].hole = !state.paths[index].hole;
  }
}

// ── moving what is there ────────────────────────────────────────────────────

/** Move a whole path, handles and all — a handle is an offset, so it rides. */
export function movePath(path: EditPath, dx: number, dy: number): void {
  for (const vertex of path.vertices) {
    vertex.x += dx;
    vertex.y += dy;
  }
}

/** Scale and move a path about a fixed point. */
export function scalePath(
  path: EditPath,
  sx: number,
  sy: number,
  origin: Point,
): void {
  for (const vertex of path.vertices) {
    vertex.x = origin.x + (vertex.x - origin.x) * sx;
    vertex.y = origin.y + (vertex.y - origin.y) * sy;
    if (vertex.ctrlLeft) {
      vertex.ctrlLeft.x *= sx;
      vertex.ctrlLeft.y *= sy;
    }
    if (vertex.ctrlRight) {
      vertex.ctrlRight.x *= sx;
      vertex.ctrlRight.y *= sy;
    }
  }
}

/** Turn a path about a point. Handles turn with it, which is what keeps the
 *  curve the same curve rather than a sheared version of it. */
export function rotatePath(path: EditPath, angle: number, origin: Point): void {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const turn = (x: number, y: number) => ({ x: x * cos - y * sin, y: x * sin + y * cos });
  for (const vertex of path.vertices) {
    const moved = turn(vertex.x - origin.x, vertex.y - origin.y);
    vertex.x = origin.x + moved.x;
    vertex.y = origin.y + moved.y;
    if (vertex.ctrlLeft) vertex.ctrlLeft = turn(vertex.ctrlLeft.x, vertex.ctrlLeft.y);
    if (vertex.ctrlRight) vertex.ctrlRight = turn(vertex.ctrlRight.x, vertex.ctrlRight.y);
  }
}

/**
 * Mirror the selected paths in their own box.
 *
 * The handles swap sides as well as flipping, which is the half that is easy
 * to miss: a vertex's left handle leads into it along the path, and after a
 * mirror the path arrives from the other direction.
 */
export function reflect(state: ShapeEditorState, axis: "horizontal" | "vertical"): void {
  const wanted = selectedPaths(state);
  capture(state);
  const box = pathsBounds(wanted.map((i) => state.paths[i]));
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;

  for (const index of wanted) {
    const path = state.paths[index];
    for (const vertex of path.vertices) {
      if (axis === "horizontal") {
        vertex.x = cx * 2 - vertex.x;
        if (vertex.ctrlLeft) vertex.ctrlLeft.x *= -1;
        if (vertex.ctrlRight) vertex.ctrlRight.x *= -1;
      } else {
        vertex.y = cy * 2 - vertex.y;
        if (vertex.ctrlLeft) vertex.ctrlLeft.y *= -1;
        if (vertex.ctrlRight) vertex.ctrlRight.y *= -1;
      }
    }
    // A mirror reverses the winding, so the path now runs the other way and
    // every handle is on the wrong side of its vertex.
    path.vertices.reverse();
    for (const vertex of path.vertices) {
      const left = vertex.ctrlLeft;
      vertex.ctrlLeft = vertex.ctrlRight;
      vertex.ctrlRight = left;
    }
  }
}

/** Line the selected paths up — with the tile if there is one, or each other. */
export function align(state: ShapeEditorState, how: Alignment): void {
  const wanted = selectedPaths(state);
  capture(state);
  const target =
    wanted.length > 1
      ? pathsBounds(wanted.map((i) => state.paths[i]))
      : { x: 0, y: 0, width: 1, height: 1 };

  for (const index of wanted) {
    const box = pathBounds(state.paths[index]);
    let dx = 0;
    let dy = 0;
    if (how === "left") dx = target.x - box.x;
    if (how === "centre") dx = target.x + target.width / 2 - (box.x + box.width / 2);
    if (how === "right") dx = target.x + target.width - (box.x + box.width);
    if (how === "top") dy = target.y - box.y;
    if (how === "middle") dy = target.y + target.height / 2 - (box.y + box.height / 2);
    if (how === "bottom") dy = target.y + target.height - (box.y + box.height);
    movePath(state.paths[index], dx, dy);
  }
}

/**
 * Space the selected paths out evenly.
 *
 * The two ends stay where they are and everything between them is moved onto
 * an even spacing — which is what distribute means everywhere else and is why
 * it needs three paths before it does anything. **Along line** puts their
 * centres on the straight line between the first and the last, which is
 * upstream's third mode and the one that has no equivalent anywhere else.
 */
export function distribute(state: ShapeEditorState, how: Distribution): void {
  const wanted = selectedPaths(state);
  if (wanted.length < 3) return;
  capture(state);

  const boxes = wanted.map((index) => ({ index, box: pathBounds(state.paths[index]) }));
  const centre = (b: { x: number; y: number; width: number; height: number }) => ({
    x: b.x + b.width / 2,
    y: b.y + b.height / 2,
  });

  if (how === "line") {
    boxes.sort((a, b) => centre(a.box).x - centre(b.box).x || centre(a.box).y - centre(b.box).y);
    const from = centre(boxes[0].box);
    const to = centre(boxes[boxes.length - 1].box);
    boxes.forEach((entry, i) => {
      const t = i / (boxes.length - 1);
      const want = { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t };
      const at = centre(entry.box);
      movePath(state.paths[entry.index], want.x - at.x, want.y - at.y);
    });
    return;
  }

  const axis = how === "horizontal" ? "x" : "y";
  const span = how === "horizontal" ? "width" : "height";
  boxes.sort((a, b) => a.box[axis] - b.box[axis]);
  const first = boxes[0].box;
  const last = boxes[boxes.length - 1].box;
  const total = last[axis] + last[span] - first[axis];
  const used = boxes.reduce((sum, entry) => sum + entry.box[span], 0);
  const gap = (total - used) / (boxes.length - 1);

  let at = first[axis];
  boxes.forEach((entry, i) => {
    if (i > 0) {
      const delta = at - entry.box[axis];
      movePath(state.paths[entry.index], axis === "x" ? delta : 0, axis === "x" ? 0 : delta);
    }
    at += entry.box[span] + gap;
  });
}

/**
 * Take one path out of another.
 *
 * The **current** path is the subject and every other selected path is a
 * clip, applied in turn. A cut that splits the subject in two leaves two
 * paths, which is the answer rather than a failure — a bitten ring is a ring
 * with a bite in it, and a severed one is two pieces.
 *
 * What comes back is a polygon, not a curve: a boolean on beziers is a
 * different and much larger piece of work, and upstream makes the same trade.
 * The curve is walked finely enough that the edge reads as the curve it came
 * from at a tile's size.
 */
export function booleanCut(state: ShapeEditorState): boolean {
  const wanted = selectedPaths(state).filter((i) => i !== state.current);
  const subject = state.paths[state.current];
  if (!subject || wanted.length === 0) return false;

  const unit = { x: 0, y: 0, width: 1, height: 1 };
  let rings: Point[][] = [
    subPathPolygon({ vertices: subject.vertices, closed: subject.closed }, unit, 12),
  ];

  for (const index of wanted) {
    const clip = subPathPolygon(
      { vertices: state.paths[index].vertices, closed: state.paths[index].closed },
      unit,
      12,
    );
    const next: Point[][] = [];
    for (const ring of rings) next.push(...polygonDifference(ring, clip));
    rings = next;
    if (rings.length === 0) break;
  }

  // A cut that removes the subject entirely is a cut whose clip swallowed it,
  // and applying it leaves an editor holding a shape with no points — which
  // is a dead end rather than an answer. Refused, and the caller says so.
  if (rings.length === 0) return false;

  capture(state);
  const made: EditPath[] = rings.map((ring) => ({
    vertices: ring.map((p) => ({ x: p.x, y: p.y })),
    closed: true,
    hole: subject.hole,
  }));

  // The clips go with the subject: they described the cut, and leaving them
  // behind would draw the shape you just removed back over the hole.
  const drop = new Set([state.current, ...wanted]);
  state.paths = state.paths.filter((_, i) => !drop.has(i));
  const at = state.paths.length;
  state.paths.push(...made);
  state.current = Math.min(at, state.paths.length - 1);
  state.selectedPaths = new Set([state.current]);
  state.selectedPoints.clear();
  return true;
}

// ── points ──────────────────────────────────────────────────────────────────

/** Drop a new anchor into a segment, as a corner. */
export function insertPoint(
  state: ShapeEditorState,
  pathIndex: number,
  segment: number,
  at: Point,
): void {
  const path = state.paths[pathIndex];
  if (!path) return;
  capture(state);
  path.vertices.splice(segment + 1, 0, { x: at.x, y: at.y });
  state.current = pathIndex;
  state.selectedPaths = new Set([pathIndex]);
  state.selectedPoints = new Set([segment + 1]);
}

/** Take the selected points out, so long as three are left. */
export function deletePoints(state: ShapeEditorState): boolean {
  const path = state.paths[state.current];
  if (!path || state.selectedPoints.size === 0) return false;
  if (path.vertices.length - state.selectedPoints.size < 3) return false;
  capture(state);
  for (const index of [...state.selectedPoints].sort((a, b) => b - a)) {
    path.vertices.splice(index, 1);
  }
  state.selectedPoints.clear();
  return true;
}

/**
 * Turn the selected points from corners into curves and back.
 *
 * A corner becoming a curve gets handles along the line between its
 * neighbours, which is the one starting guess that never kinks the path: the
 * curve leaves and arrives in the direction the path was already going.
 */
export function toggleCurve(state: ShapeEditorState): void {
  const path = state.paths[state.current];
  if (!path || state.selectedPoints.size === 0) return;
  capture(state);

  for (const index of state.selectedPoints) {
    const vertex = path.vertices[index];
    if (!vertex) continue;
    const live = (c?: { x: number; y: number }) => !!c && (c.x !== 0 || c.y !== 0);
    if (live(vertex.ctrlLeft) || live(vertex.ctrlRight)) {
      delete vertex.ctrlLeft;
      delete vertex.ctrlRight;
      continue;
    }
    const count = path.vertices.length;
    const before = path.vertices[(index - 1 + count) % count];
    const after = path.vertices[(index + 1) % count];
    const dx = (after.x - before.x) / 6;
    const dy = (after.y - before.y) / 6;
    vertex.ctrlLeft = { x: -dx, y: -dy };
    vertex.ctrlRight = { x: dx, y: dy };
  }
}

/** Every path scaled and moved so the shape fills its own 0–1 box. */
export function crop(state: ShapeEditorState): void {
  const box = pathsBounds(state.paths);
  if (box.width <= 0 || box.height <= 0) return;
  capture(state);
  const sx = 1 / box.width;
  const sy = 1 / box.height;
  for (const path of state.paths) {
    for (const vertex of path.vertices) {
      vertex.x = (vertex.x - box.x) * sx;
      vertex.y = (vertex.y - box.y) * sy;
      if (vertex.ctrlLeft) {
        vertex.ctrlLeft.x *= sx;
        vertex.ctrlLeft.y *= sy;
      }
      if (vertex.ctrlRight) {
        vertex.ctrlRight.x *= sx;
        vertex.ctrlRight.y *= sy;
      }
    }
  }
}

/** A path with every vertex copied — for a drag that needs its starting state. */
export function snapshotPaths(paths: readonly EditPath[]): EditPath[] {
  return paths.map((path) => ({
    vertices: path.vertices.map(copyVertex),
    closed: path.closed,
    hole: path.hole,
  }));
}
