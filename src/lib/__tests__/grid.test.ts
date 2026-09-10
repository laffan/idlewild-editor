import { describe, expect, it } from "vitest";
import { Grid, cellsInRange, rangeSize } from "../grid";

describe("Grid", () => {
  it("round-trips isometric cells through world space", () => {
    const grid = new Grid("isometric", 64);
    for (const cell of [
      { cx: 0, cy: 0 },
      { cx: 3, cy: -2 },
      { cx: -7, cy: 11 },
    ]) {
      expect(grid.worldToCell(grid.cellToWorld(cell))).toEqual(cell);
    }
  });

  it("round-trips orthogonal cells through world space", () => {
    const grid = new Grid("orthogonal", 32);
    for (const cell of [
      { cx: 0, cy: 0 },
      { cx: 5, cy: 9 },
      { cx: -4, cy: -6 },
    ]) {
      expect(grid.worldToCell(grid.cellToWorld(cell))).toEqual(cell);
    }
  });

  it("makes isometric tiles 2:1", () => {
    const grid = new Grid("isometric", 64);
    expect(grid.tileWidth).toBe(64);
    expect(grid.tileHeight).toBe(32);
  });

  it("bounds a range from its outline, not by walking every cell", () => {
    const grid = new Grid("orthogonal", 10);
    const bounds = grid.rangeBounds({ cx: 0, cy: 0 }, { cx: 2, cy: 1 });
    expect(bounds).toEqual({ x: 0, y: 0, width: 30, height: 20 });
  });

  it("bounds an isometric range symmetrically about its origin", () => {
    const grid = new Grid("isometric", 64);
    const bounds = grid.rangeBounds({ cx: 0, cy: 0 }, { cx: 0, cy: 0 });
    expect(bounds.width).toBe(64);
    expect(bounds.height).toBe(32);
  });

  it("treats a range as inclusive in both directions", () => {
    expect(rangeSize({ cx: 2, cy: 2 }, { cx: 0, cy: 0 })).toEqual({ w: 3, h: 3 });
    expect([...cellsInRange({ cx: 1, cy: 1 }, { cx: 0, cy: 0 })]).toHaveLength(4);
  });
});
