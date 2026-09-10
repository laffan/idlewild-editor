/**
 * What travels into a PSD with an imported image.
 *
 * These numbers are the contract between the editor's grid and the marks
 * Rust draws: get the outline's frame of reference wrong and the footprint
 * lands somewhere the artist has to guess at.
 */

import { describe, expect, it } from "vitest";
import { Grid } from "../../lib/grid";
import { anchorCell, IMPORT_SCALE, marksForSelection } from "../import-anchor";

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
