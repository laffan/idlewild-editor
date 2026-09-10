/**
 * What travels into a PSD with an imported image.
 *
 * These numbers are the contract between the editor's grid and the marks
 * Rust draws: get the outline's frame of reference wrong and the footprint
 * lands somewhere the artist has to guess at.
 */

import { describe, expect, it } from "vitest";
import { Grid } from "../../lib/grid";
import {
  anchorCell,
  cellRangeForBox,
  EXPORT_SCALE,
  IMPORT_SCALE,
  marksForSelection,
  scaleMarks,
} from "../import-anchor";

describe("anchorCell", () => {
  it("takes the lowest corner however the selection was dragged", () => {
    const a = { cx: 4, cy: 9 };
    const b = { cx: 1, cy: 2 };
    expect(anchorCell(a, b)).toEqual({ cx: 1, cy: 2 });
    expect(anchorCell(b, a)).toEqual({ cx: 1, cy: 2 });
  });
});

describe("marksForSelection", () => {
  it("frames an orthogonal cell on its own top-left corner", () => {
    const grid = new Grid("orthogonal", 32);
    const marks = marksForSelection(grid, { cx: 3, cy: 5 }, { cx: 3, cy: 5 });
    // Anchor-relative, so the cell it sits on starts at the origin.
    expect(marks.outline).toEqual([
      { x: 0, y: 0 },
      { x: 32, y: 0 },
      { x: 32, y: 32 },
      { x: 0, y: 32 },
    ]);
    expect([marks.cols, marks.rows]).toEqual([1, 1]);
  });

  it("frames an isometric cell as the diamond around its centre", () => {
    const grid = new Grid("isometric", 64);
    const marks = marksForSelection(grid, { cx: 0, cy: 0 }, { cx: 0, cy: 0 });
    // cellToWorld returns the diamond's centre for iso, so the outline runs
    // half a tile out in each direction from the anchor.
    expect(marks.outline).toEqual([
      { x: 0, y: -16 },
      { x: 32, y: 0 },
      { x: 0, y: 16 },
      { x: -32, y: 0 },
    ]);
  });

  it("stays anchor-relative wherever on the grid the selection is", () => {
    const grid = new Grid("isometric", 64);
    const near = marksForSelection(grid, { cx: 0, cy: 0 }, { cx: 1, cy: 1 });
    const far = marksForSelection(grid, { cx: 40, cy: -12 }, { cx: 41, cy: -11 });
    expect(far.outline).toEqual(near.outline);
  });

  it("has nothing to divide on a single space", () => {
    const grid = new Grid("orthogonal", 32);
    expect(marksForSelection(grid, { cx: 0, cy: 0 }, { cx: 0, cy: 0 }).lines)
      .toEqual([]);
  });

  it("divides a run of spaces once between each pair", () => {
    const grid = new Grid("orthogonal", 32);
    // Two spaces side by side: one division, down the shared edge.
    const pair = marksForSelection(grid, { cx: 0, cy: 0 }, { cx: 1, cy: 0 });
    expect(pair.lines).toEqual([{ a: { x: 32, y: 0 }, b: { x: 32, y: 32 } }]);

    // A 3x3 block has two divisions each way, and each is drawn once per
    // space it borders rather than once for the whole run.
    const block = marksForSelection(grid, { cx: 0, cy: 0 }, { cx: 2, cy: 2 });
    expect(block.lines).toHaveLength(12);
  });

  it("runs an isometric division along the diamond's own edge", () => {
    const grid = new Grid("isometric", 64);
    const pair = marksForSelection(grid, { cx: 0, cy: 0 }, { cx: 1, cy: 0 });
    // The edge cell (0,0) shares with (1,0): its right corner to its bottom.
    expect(pair.lines).toEqual([{ a: { x: 32, y: 0 }, b: { x: 0, y: 16 } }]);
  });

  it("counts the spaces it covers, for the zone's name", () => {
    const grid = new Grid("orthogonal", 16);
    const marks = marksForSelection(grid, { cx: 0, cy: 0 }, { cx: 2, cy: 4 });
    expect([marks.cols, marks.rows]).toEqual([3, 5]);
  });
});

describe("IMPORT_SCALE", () => {
  it("halves, because everything authored on a retina machine is 2×", () => {
    expect(IMPORT_SCALE).toBe(0.5);
  });
});

describe("scaleMarks", () => {
  const marks = {
    outline: [
      { x: 0, y: 0 },
      { x: 32, y: 0 },
      { x: 32, y: 32 },
      { x: 0, y: 32 },
    ],
    lines: [{ a: { x: 0, y: 16 }, b: { x: 32, y: 16 } }],
    art: { x: -4, y: -8 },
    cols: 1,
    rows: 1,
  };

  it("takes every point up together, so the footprint still fits the art", () => {
    const up = scaleMarks(marks, 2);
    expect(up.outline).toEqual([
      { x: 0, y: 0 },
      { x: 64, y: 0 },
      { x: 64, y: 64 },
      { x: 0, y: 64 },
    ]);
    expect(up.lines).toEqual([{ a: { x: 0, y: 32 }, b: { x: 64, y: 32 } }]);
    expect(up.art).toEqual({ x: -8, y: -16 });
  });

  it("leaves the counts alone — they are spaces, not pixels", () => {
    expect(scaleMarks(marks, 2).cols).toBe(1);
    expect(scaleMarks(marks, 2).rows).toBe(1);
  });

  it("carries no art through when there was none", () => {
    const { art: _art, ...without } = marks;
    expect(scaleMarks(without, 2).art).toBeUndefined();
  });

  /**
   * The invariant behind every conversion: draw at EXPORT_SCALE, place at
   * IMPORT_SCALE, and the artwork lands exactly where it was drawn.
   */
  it("undoes itself against the scale a conversion is placed at", () => {
    expect(EXPORT_SCALE * IMPORT_SCALE).toBe(1);
    expect(scaleMarks(scaleMarks(marks, EXPORT_SCALE), IMPORT_SCALE)).toEqual(marks);
  });
});

describe("cellRangeForBox", () => {
  it("covers the spaces an orthogonal box sits over", () => {
    const grid = new Grid("orthogonal", 32);
    expect(cellRangeForBox(grid, { x: 0, y: 0, width: 64, height: 32 })).toEqual({
      from: { cx: 0, cy: 0 },
      to: { cx: 2, cy: 1 },
    });
  });

  it("reads all four corners, which is what an isometric box needs", () => {
    // A world-space box is a diamond in cell space: its widest cell extents
    // come from the corners a rectangle would call top-right and bottom-left.
    const grid = new Grid("isometric", 64);
    const range = cellRangeForBox(grid, { x: -64, y: -32, width: 128, height: 64 });
    expect(range.from.cx).toBeLessThan(0);
    expect(range.from.cy).toBeLessThan(0);
    expect(range.to.cx).toBeGreaterThan(0);
    expect(range.to.cy).toBeGreaterThan(0);
    // Symmetric about the origin, so the two extents mirror.
    expect(range.to.cx).toBe(-range.from.cx);
    expect(range.to.cy).toBe(-range.from.cy);
  });
});
