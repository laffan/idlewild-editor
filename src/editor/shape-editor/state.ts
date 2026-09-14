/**
 * What the shape editor is holding while it is open.
 *
 * simple-tileset-generator's editor is built on Two.js, and this one is not.
 * That is the only deliberate difference, and it is worth stating: Two.js
 * carries a scene graph, a per-path translation and an `Anchor` type with
 * commands on it, and the editor spends a good deal of its code converting
 * between that and the flat `{x, y, ctrlLeft, ctrlRight}` the library
 * actually stores. Here the editor works **in the stored format**, in the
 * shape's own 0–1 box, and the canvas is drawn from it directly. Nothing is
 * converted on the way in or the way out, so there is no place for the two
 * representations to disagree.
 *
 * Everything below is therefore in unit space. Pixels appear only where a
 * pointer does — see `geometry.ts`.
 */

import {
  copyShape,
  isHole,
  pathsOf,
  type ShapeData,
  type SubPath,
  type Vertex,
} from "../../lib/library";

/** The workspace, and the box inside it that is the shape's 0–1 square. */
export const CANVAS_PX = 440;
export const MARGIN_PX = 56;
export const INNER_PX = CANVAS_PX - MARGIN_PX * 2;

/** How near a tap has to land to take hold of something, in CSS pixels. */
export const HIT_PX = 10;
/** And how near an edge, to drop a point into it. */
export const EDGE_HIT_PX = 7;

export const HISTORY_LIMIT = 40;

/** One subpath, as the editor works on it. */
export interface EditPath {
  vertices: Vertex[];
  closed: boolean;
  /** Cut out of the body rather than added to it. */
  hole: boolean;
}

/** What a drag has hold of. */
export type Grip =
  | { kind: "none" }
  | { kind: "point"; path: number; index: number }
  | { kind: "control"; path: number; index: number; side: "left" | "right" }
  | { kind: "path"; path: number }
  | { kind: "scale"; corner: number }
  | { kind: "rotate" };

export interface ShapeEditorState {
  paths: EditPath[];
  /** The path everything without an explicit target is about. */
  current: number;
  /** Several paths, for align, distribute and cut. Always includes `current`. */
  selectedPaths: Set<number>;
  /** Points of the current path that are selected. */
  selectedPoints: Set<number>;

  sourceId: string | null;
  name: string;
  /** Whether Save first scales the shape to fill its own box. */
  crop: boolean;
  /** Whether the transform box is showing — ⌘, or the toolbar's own toggle. */
  transforming: boolean;

  past: ShapeSnapshot[];
  future: ShapeSnapshot[];
}

export interface ShapeSnapshot {
  paths: EditPath[];
  current: number;
}

/** A shape as the editor's paths. */
export function toEditPaths(shape: ShapeData): EditPath[] {
  return pathsOf(shape).map((path, index) => ({
    vertices: path.vertices.map(copyVertex),
    closed: path.closed !== false,
    hole: isHole(shape, index),
  }));
}

/** And back, in the format the library stores. */
export function toShapeData(paths: readonly EditPath[]): ShapeData {
  const subPaths: SubPath[] = paths.map((path) => ({
    vertices: path.vertices.map(copyVertex),
    closed: path.closed,
  }));
  const holes = paths.map((p, i) => (p.hole ? i : -1)).filter((i) => i >= 0);
  const out: ShapeData = { paths: subPaths };
  if (holes.length > 0) out.holePathIndices = holes;
  return out;
}

export function copyVertex(vertex: Vertex): Vertex {
  const out: Vertex = { x: vertex.x, y: vertex.y };
  if (vertex.ctrlLeft) out.ctrlLeft = { ...vertex.ctrlLeft };
  if (vertex.ctrlRight) out.ctrlRight = { ...vertex.ctrlRight };
  return out;
}

export function copyPath(path: EditPath): EditPath {
  return {
    vertices: path.vertices.map(copyVertex),
    closed: path.closed,
    hole: path.hole,
  };
}

export function createShapeState(
  shape: ShapeData,
  sourceId: string | null,
  name: string,
): ShapeEditorState {
  const paths = toEditPaths(copyShape(shape));
  return {
    paths: paths.length > 0 ? paths : [squarePath()],
    current: 0,
    selectedPaths: new Set([0]),
    selectedPoints: new Set(),
    sourceId,
    name,
    crop: false,
    transforming: false,
    past: [],
    future: [],
  };
}

/** The shape a brand new row starts as: the whole tile. */
export function squarePath(): EditPath {
  return {
    vertices: [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 1 },
      { x: 0, y: 1 },
    ],
    closed: true,
    hole: false,
  };
}

/** Whether a handle on this vertex is doing anything. */
export function hasCurve(vertex: Vertex): boolean {
  const live = (c?: { x: number; y: number }) => !!c && (c.x !== 0 || c.y !== 0);
  return live(vertex.ctrlLeft) || live(vertex.ctrlRight);
}

export function capture(state: ShapeEditorState): void {
  state.past.push({ paths: state.paths.map(copyPath), current: state.current });
  if (state.past.length > HISTORY_LIMIT) state.past.shift();
  state.future.length = 0;
}

export function undo(state: ShapeEditorState): boolean {
  const previous = state.past.pop();
  if (!previous) return false;
  state.future.push({ paths: state.paths.map(copyPath), current: state.current });
  restore(state, previous);
  return true;
}

export function redo(state: ShapeEditorState): boolean {
  const next = state.future.pop();
  if (!next) return false;
  state.past.push({ paths: state.paths.map(copyPath), current: state.current });
  restore(state, next);
  return true;
}

function restore(state: ShapeEditorState, snapshot: ShapeSnapshot): void {
  state.paths = snapshot.paths.map(copyPath);
  state.current = Math.min(snapshot.current, state.paths.length - 1);
  state.selectedPaths = new Set([state.current]);
  state.selectedPoints.clear();
}

/** The path everything unqualified is about, or null while there are none. */
export function currentPath(state: ShapeEditorState): EditPath | null {
  return state.paths[state.current] ?? null;
}

/** The paths a multi-path operation should act on, in index order. */
export function selectedPaths(state: ShapeEditorState): number[] {
  const wanted = [...state.selectedPaths].filter((i) => state.paths[i]);
  return wanted.length > 0 ? wanted.sort((a, b) => a - b) : [state.current];
}

/** Point one path out, on its own or added to what is already picked. */
export function selectPath(state: ShapeEditorState, index: number, add: boolean): void {
  if (!state.paths[index]) return;
  if (add) {
    if (state.selectedPaths.has(index) && state.selectedPaths.size > 1) {
      state.selectedPaths.delete(index);
    } else {
      state.selectedPaths.add(index);
    }
  } else {
    state.selectedPaths = new Set([index]);
  }
  state.current = index;
  state.selectedPoints.clear();
}
