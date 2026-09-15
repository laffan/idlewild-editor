/**
 * The shape editor's operations, and the two places its rules are not
 * obvious.
 *
 * **A mirror reverses the winding**, so every handle ends up on the wrong
 * side of its vertex — the flip is only half the job, and a shape flipped
 * twice has to come back to itself.
 *
 * **Adding a path to the selection must not change the subject.** *Cut out*
 * takes every other selected path out of the current one, so a ⊕ that quietly
 * made the clip current took the shape out of the thing being cut with — and
 * a circle inside a square then removed the square.
 */

import { describe, expect, it } from "vitest";
import {
  align,
  booleanCut,
  crop,
  deletePoints,
  distribute,
  insertPoint,
  primitivePath,
  reflect,
  toggleCurve,
  toggleHole,
} from "../shape-editor/ops";
import { pathBounds } from "../shape-editor/geometry";
import {
  createShapeState,
  hasCurve,
  selectPath,
  toEditPaths,
  toShapeData,
  togglePathInSelection,
  undo,
  type EditPath,
  type ShapeEditorState,
} from "../shape-editor/state";
import { parsePathData, pathsToSvg } from "../shape-editor/svg";
import { DEFAULT_SHAPES } from "../../lib/library";

const square = (x: number, y: number, side: number): EditPath => ({
  vertices: [
    { x, y },
    { x: x + side, y },
    { x: x + side, y: y + side },
    { x, y: y + side },
  ],
  closed: true,
  hole: false,
});

function stateOf(paths: EditPath[]): ShapeEditorState {
  const state = createShapeState({ paths: [] }, null, "Test");
  state.paths = paths;
  state.current = 0;
  state.selectedPaths = new Set([0]);
  return state;
}

describe("reflecting", () => {
  it("brings a shape back to itself when done twice", () => {
    const circle = DEFAULT_SHAPES.find((s) => s.id === "circle")!;
    const state = stateOf(toEditPaths(circle));
    reflect(state, "horizontal");
    reflect(state, "horizontal");

    // Same points, same handles — the winding was reversed and put back.
    const before = toEditPaths(circle)[0];
    const after = state.paths[0];
    const key = (p: EditPath) =>
      p.vertices
        .map((v) => [v.x, v.y, v.ctrlLeft?.x ?? 0, v.ctrlRight?.x ?? 0])
        .flat()
        .map((n) => Math.round(n * 1e6) / 1e6)
        .sort((a, b) => a - b);
    expect(key(after)).toEqual(key(before));
  });

  it("mirrors inside the shape's own box, not the tile's", () => {
    const state = stateOf([square(0, 0, 0.4)]);
    reflect(state, "horizontal");
    expect(pathBounds(state.paths[0]).x).toBeCloseTo(0, 6);
  });
});

describe("aligning", () => {
  it("lines one path up with the tile", () => {
    const state = stateOf([square(0.1, 0.1, 0.2)]);
    align(state, "right");
    const box = pathBounds(state.paths[0]);
    expect(box.x + box.width).toBeCloseTo(1, 6);
  });

  it("lines several up with each other", () => {
    const state = stateOf([square(0, 0, 0.2), square(0.5, 0.5, 0.2)]);
    state.selectedPaths = new Set([0, 1]);
    align(state, "left");
    expect(pathBounds(state.paths[0]).x).toBeCloseTo(0, 6);
    expect(pathBounds(state.paths[1]).x).toBeCloseTo(0, 6);
  });
});

describe("distributing", () => {
  it("does nothing with fewer than three", () => {
    const state = stateOf([square(0, 0, 0.1), square(0.8, 0, 0.1)]);
    state.selectedPaths = new Set([0, 1]);
    distribute(state, "horizontal");
    expect(pathBounds(state.paths[1]).x).toBeCloseTo(0.8, 6);
  });

  it("evens out the gaps, leaving the two ends where they are", () => {
    const state = stateOf([square(0, 0, 0.1), square(0.2, 0, 0.1), square(0.9, 0, 0.1)]);
    state.selectedPaths = new Set([0, 1, 2]);
    distribute(state, "horizontal");
    const xs = state.paths.map((p) => pathBounds(p).x);
    expect(xs[0]).toBeCloseTo(0, 6);
    expect(xs[2]).toBeCloseTo(0.9, 6);
    expect(xs[1]).toBeCloseTo(0.45, 6);
  });
});

describe("points", () => {
  it("drops a new one into the segment it was asked for", () => {
    const state = stateOf([square(0, 0, 1)]);
    insertPoint(state, 0, 0, { x: 0.5, y: 0 });
    expect(state.paths[0].vertices).toHaveLength(5);
    expect(state.paths[0].vertices[1]).toEqual({ x: 0.5, y: 0 });
    expect([...state.selectedPoints]).toEqual([1]);
  });

  it("refuses to leave a path with fewer than three", () => {
    const state = stateOf([{ vertices: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }], closed: true, hole: false }]);
    state.selectedPoints = new Set([0]);
    expect(deletePoints(state)).toBe(false);
    expect(state.paths[0].vertices).toHaveLength(3);
  });

  it("turns a corner into a curve and back", () => {
    const state = stateOf([square(0, 0, 1)]);
    state.selectedPoints = new Set([1]);
    toggleCurve(state);
    expect(hasCurve(state.paths[0].vertices[1])).toBe(true);
    toggleCurve(state);
    expect(hasCurve(state.paths[0].vertices[1])).toBe(false);
  });

  it("aims a new curve along the path rather than kinking it", () => {
    // The neighbours of the top-right corner (1,0) are (0,0) and (1,1), so
    // the curve leaves and arrives along the diagonal between them — which is
    // the one starting guess that does not put a kink in the outline.
    const state = stateOf([square(0, 0, 1)]);
    state.selectedPoints = new Set([1]);
    toggleCurve(state);
    const v = state.paths[0].vertices[1];
    expect(v.ctrlRight?.x).toBeCloseTo(1 / 6, 6);
    expect(v.ctrlRight?.y).toBeCloseTo(1 / 6, 6);
    expect(v.ctrlLeft?.x).toBeCloseTo(-1 / 6, 6);
    expect(v.ctrlLeft?.y).toBeCloseTo(-1 / 6, 6);
  });
});

describe("the selection", () => {
  it("moves the subject when a path is picked", () => {
    const state = stateOf([square(0, 0, 1), square(0.2, 0.2, 0.2)]);
    selectPath(state, 1, false);
    expect(state.current).toBe(1);
    expect([...state.selectedPaths]).toEqual([1]);
  });

  it("leaves the subject alone when a path is added to it", () => {
    const state = stateOf([square(0, 0, 1), square(0.2, 0.2, 0.2)]);
    togglePathInSelection(state, 1);
    expect(state.current).toBe(0);
    expect([...state.selectedPaths].sort()).toEqual([0, 1]);
  });

  it("never empties itself", () => {
    const state = stateOf([square(0, 0, 1)]);
    togglePathInSelection(state, 0);
    expect([...state.selectedPaths]).toEqual([0]);
  });
});

describe("cutting one path out of another", () => {
  it("bites a corner, and takes the clip with it", () => {
    const state = stateOf([square(0, 0, 1), square(0.5, 0.5, 1)]);
    state.selectedPaths = new Set([0, 1]);
    expect(booleanCut(state)).toBe(true);
    expect(state.paths).toHaveLength(1);
    const box = pathBounds(state.paths[0]);
    expect(box.width).toBeCloseTo(1, 6);
  });

  it("refuses rather than leaving nothing to edit", () => {
    // The clip swallows the subject, so the answer is an empty shape — which
    // is a dead end rather than a result.
    const state = stateOf([square(0.25, 0.25, 0.25), square(0, 0, 1)]);
    state.selectedPaths = new Set([0, 1]);
    expect(booleanCut(state)).toBe(false);
    expect(state.paths).toHaveLength(2);
  });

  it("refuses when there is nothing to cut with", () => {
    const state = stateOf([square(0, 0, 1)]);
    expect(booleanCut(state)).toBe(false);
  });
});

describe("holes, cropping and undo", () => {
  it("marks the selected paths as holes and back", () => {
    const state = stateOf([square(0, 0, 1), square(0.3, 0.3, 0.4)]);
    selectPath(state, 1, false);
    toggleHole(state);
    expect(toShapeData(state.paths).holePathIndices).toEqual([1]);
    toggleHole(state);
    expect(toShapeData(state.paths).holePathIndices).toBeUndefined();
  });

  it("scales a small shape out to fill the tile", () => {
    const state = stateOf([square(0.25, 0.25, 0.25)]);
    crop(state);
    expect(pathBounds(state.paths[0])).toEqual({ x: 0, y: 0, width: 1, height: 1 });
  });

  it("takes an operation back", () => {
    const state = stateOf([square(0, 0, 0.5)]);
    align(state, "right");
    expect(pathBounds(state.paths[0]).x).toBeCloseTo(0.5, 6);
    expect(undo(state)).toBe(true);
    expect(pathBounds(state.paths[0]).x).toBeCloseTo(0, 6);
  });
});

describe("primitives", () => {
  it("land in the middle of the tile at half its size", () => {
    for (const kind of ["square", "circle", "triangle", "hexagon"] as const) {
      const box = pathBounds(primitivePath(kind));
      expect(box.x + box.width / 2, kind).toBeCloseTo(0.5, 2);
      expect(box.y + box.height / 2, kind).toBeCloseTo(0.5, 2);
      expect(box.width, kind).toBeGreaterThan(0.3);
      expect(box.width, kind).toBeLessThan(0.7);
    }
  });
});

describe("SVG", () => {
  const same = (x: number, y: number) => ({ x, y });

  it("round-trips a polygon", () => {
    const svg = pathsToSvg([square(0, 0, 1)]);
    const d = /d="([^"]+)"/.exec(svg)?.[1] ?? "";
    const back = parsePathData(d, (x, y) => same(x / 100, y / 100));
    expect(back).toHaveLength(1);
    expect(back[0].closed).toBe(true);
    expect(back[0].vertices.map((v) => [v.x, v.y])).toEqual([
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
    ]);
  });

  it("round-trips a curve, handles and all", () => {
    const circle = toEditPaths(DEFAULT_SHAPES.find((s) => s.id === "circle")!);
    const d = /d="([^"]+)"/.exec(pathsToSvg(circle))?.[1] ?? "";
    const back = parsePathData(d, (x, y) => same(x / 100, y / 100));
    expect(back[0].vertices).toHaveLength(4);
    for (let i = 0; i < 4; i++) {
      expect(back[0].vertices[i].x).toBeCloseTo(circle[0].vertices[i].x, 4);
      expect(back[0].vertices[i].ctrlRight?.x ?? 0).toBeCloseTo(
        circle[0].vertices[i].ctrlRight?.x ?? 0,
        4,
      );
    }
  });

  it("reads the relative and shorthand commands", () => {
    // `m` then `h`/`v` relative, closed — a rectangle as a terse exporter
    // would write it.
    const back = parsePathData("m 0 0 h 10 v 10 h -10 z", same);
    expect(back[0].closed).toBe(true);
    expect(back[0].vertices.map((v) => [v.x, v.y])).toEqual([
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 10],
    ]);
  });

  it("reads a quadratic as the cubic it is", () => {
    // `C1 = P0 + ⅔(Q − P0)` and `C2 = P1 + ⅔(Q − P1)`, stored as offsets from
    // the vertex each belongs to.
    const back = parsePathData("M 0 0 Q 5 10 10 0", same);
    const [from, to] = back[0].vertices;
    expect(from.ctrlRight?.x).toBeCloseTo((2 / 3) * 5, 6);
    expect(from.ctrlRight?.y).toBeCloseTo((2 / 3) * 10, 6);
    expect(to.ctrlLeft?.x).toBeCloseTo(-10 / 3, 6);
    expect(to.ctrlLeft?.y).toBeCloseTo(20 / 3, 6);
  });

  it("starts a new subpath at every move", () => {
    const back = parsePathData("M 0 0 L 1 0 L 1 1 Z M 2 2 L 3 2 L 3 3 Z", same);
    expect(back).toHaveLength(2);
  });

  it("stops rather than spinning on something it cannot read", () => {
    expect(() => parsePathData("M 0 0 ? 9 9 L 1 1", same)).not.toThrow();
  });
});
