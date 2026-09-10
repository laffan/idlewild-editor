import { describe, expect, it } from "vitest";
import {
  Grid,
  cellsInRange,
  describeRange,
  fillShape,
  rangeSize,
} from "../grid";
import type { FillPatch } from "../types";

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

  it("puts an orthogonal centre in the middle, not on the corner", () => {
    // cellToWorld returns each shape's natural anchor — a diamond's centre,
    // but a square's top-left. Anything testing containment needs the middle.
    const ortho = new Grid("orthogonal", 32);
    expect(ortho.cellToWorld({ cx: 1, cy: 1 })).toEqual({ x: 32, y: 32 });
    expect(ortho.cellCentre({ cx: 1, cy: 1 })).toEqual({ x: 48, y: 48 });

    const iso = new Grid("isometric", 64);
    expect(iso.cellCentre({ cx: 2, cy: 1 })).toEqual(iso.cellToWorld({ cx: 2, cy: 1 }));
  });
});

describe("the blank template", () => {
  const blank = new Grid("blank", 64);

  it("does not snap, and addresses single pixels", () => {
    expect(blank.snaps).toBe(false);
    expect(blank.cell).toBe(1);
    // The nominal unit survives: play mode's character and its navigation
    // lattice are still measured in it.
    expect(blank.size).toBe(64);
  });

  it("selects exactly the pixels that were dragged", () => {
    const bounds = blank.rangeBounds({ cx: 12, cy: 40 }, { cx: 431, cy: 299 });
    expect(bounds).toEqual({ x: 12, y: 40, width: 420, height: 260 });
    expect(describeRange(blank, { cx: 12, cy: 40 }, { cx: 431, cy: 299 })).toBe(
      "420 × 260 px",
    );
  });

  it("still round-trips a cell through world space", () => {
    for (const cell of [
      { cx: 0, cy: 0 },
      { cx: 417, cy: -83 },
    ]) {
      expect(blank.worldToCell(blank.cellToWorld(cell))).toEqual(cell);
    }
  });

  it("counts a snapping selection in spaces", () => {
    const grid = new Grid("orthogonal", 32);
    expect(describeRange(grid, { cx: 0, cy: 0 }, { cx: 2, cy: 1 })).toBe(
      "3 × 2 spaces",
    );
  });
});

describe("fillShape", () => {
  const fill = (over: Partial<FillPatch>): FillPatch => ({
    id: "f1",
    cells: [],
    kind: "color",
    color: "#ec3013",
    walkable: true,
    ...over,
  });

  it("gives a run of spaces one outline each", () => {
    const grid = new Grid("orthogonal", 10);
    const shape = fillShape(
      grid,
      fill({ cells: [{ cx: 0, cy: 0 }, { cx: 1, cy: 0 }] }),
    );
    expect(shape?.polygons).toHaveLength(2);
    expect(shape?.bounds).toEqual({ x: 0, y: 0, width: 20, height: 10 });
  });

  it("keeps an irregular run irregular", () => {
    // The reason a fill is not simply its bounding box: an L keeps its notch.
    const grid = new Grid("orthogonal", 10);
    const shape = fillShape(
      grid,
      fill({ cells: [{ cx: 0, cy: 0 }, { cx: 0, cy: 1 }, { cx: 1, cy: 1 }] }),
    );
    expect(shape?.polygons).toHaveLength(3);
    expect(shape?.bounds).toEqual({ x: 0, y: 0, width: 20, height: 20 });
  });

  it("gives a rectangle one outline of its own size", () => {
    const grid = new Grid("blank", 64);
    const rect = { x: 12, y: 40, width: 420, height: 260 };
    const shape = fillShape(grid, fill({ rect }));
    expect(shape?.bounds).toEqual(rect);
    expect(shape?.polygons).toEqual([
      [
        { x: 12, y: 40 },
        { x: 432, y: 40 },
        { x: 432, y: 300 },
        { x: 12, y: 300 },
      ],
    ]);
  });

  it("is null for a fill that covers nothing", () => {
    expect(fillShape(new Grid("orthogonal", 10), fill({}))).toBeNull();
  });
});
