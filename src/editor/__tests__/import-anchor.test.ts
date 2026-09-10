/**
 * What travels into a PSD with an imported image.
 *
 * These numbers are the contract between the editor's grid and the marks
 * Rust draws: get the outline's frame of reference wrong and the footprint
 * lands somewhere the artist has to guess at.
 */

import { describe, expect, it } from "vitest";
import {
  cellsBounds,
  convexOverlapsRect,
  Grid,
  pointsBounds,
} from "../../lib/grid";
import {
  anchorCell,
  EXPORT_SCALE,
  footprintForBox,
  IMPORT_SCALE,
  marksForCells,
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

describe("footprintForBox", () => {
  it("covers the spaces an orthogonal box sits over", () => {
    const grid = new Grid("orthogonal", 32);
    const { cells, anchor } = footprintForBox(grid, {
      x: 0,
      y: 0,
      width: 64,
      height: 32,
    });
    expect(anchor).toEqual({ cx: 0, cy: 0 });
    // Two spaces across, one down: the box's own right and bottom edges only
    // graze the next ones, which is not covering them.
    expect(cells).toEqual([
      { cx: 0, cy: 0 },
      { cx: 1, cy: 0 },
    ]);
  });

  /**
   * The bug this exists for.
   *
   * A world-space box is a diamond in cell space, so the axis-aligned *range*
   * around an isometric box holds many spaces the box never touches — and the
   * footprint drawn from that range decides how big the PSD's canvas is. A
   * 132 x 136 sketch was landing in an 832 x 416 file.
   */
  it("takes only the spaces an isometric box really touches", () => {
    const grid = new Grid("isometric", 64);
    const box = { x: 0, y: 0, width: 132, height: 136 };
    const { cells } = footprintForBox(grid, box);

    // Every cell it kept genuinely overlaps the box.
    for (const cell of cells) {
      expect(convexOverlapsRect(grid.cellPolygon(cell), box)).toBe(true);
    }

    // And the footprint it produces is far tighter than the enclosing range.
    const covered = pointsBounds(cells.flatMap((c) => grid.cellPolygon(c)));
    const { from, to } = cellsBounds(cells);
    const enclosing = grid.rangeBounds(from, to);
    expect(covered.width).toBeLessThan(enclosing.width);
    expect(covered.width).toBeLessThan(box.width * 2);
    expect(covered.height).toBeLessThan(box.height * 2);
  });
});

describe("marksForCells", () => {
  it("outlines the box around the spaces, and divides them one by one", () => {
    const grid = new Grid("orthogonal", 32);
    const cells = [
      { cx: 0, cy: 0 },
      { cx: 1, cy: 0 },
    ];
    const marks = marksForCells(grid, cells, { cx: 0, cy: 0 });

    // Anchor-relative, so the first space starts at the origin.
    expect(marks.outline).toEqual([
      { x: 0, y: 0 },
      { x: 64, y: 0 },
      { x: 64, y: 32 },
      { x: 0, y: 32 },
    ]);
    // Four edges per space, so the artist sees where each one begins.
    expect(marks.lines).toHaveLength(8);
    expect([marks.cols, marks.rows]).toEqual([2, 1]);
  });

  it("keeps an irregular set irregular rather than filling in its box", () => {
    const grid = new Grid("orthogonal", 32);
    const marks = marksForCells(
      grid,
      [
        { cx: 0, cy: 0 },
        { cx: 0, cy: 1 },
        { cx: 1, cy: 1 },
      ],
      { cx: 0, cy: 0 },
    );
    // Three spaces drawn, inside a two-by-two outline: the missing corner is
    // visibly missing, which is the point of drawing the spaces at all.
    expect(marks.lines).toHaveLength(12);
    expect([marks.cols, marks.rows]).toEqual([2, 2]);
  });

  it("carries the artwork offset through untouched", () => {
    const grid = new Grid("orthogonal", 32);
    const art = { x: 4, y: -7 };
    expect(marksForCells(grid, [{ cx: 0, cy: 0 }], { cx: 0, cy: 0 }, art).art).toEqual(
      art,
    );
  });
});
