import type { Cell, FillPatch, Point, Projection, Rect } from "./types";

/**
 * Grid projection. All three templates share one integer cell space; only the
 * cell -> world mapping differs, so everything downstream (selection, fills,
 * A*, export bounds) is written once against `Grid`.
 *
 * Isometric tiles are the usual 2:1 diamond: a `size` of 64 means a tile
 * 64px wide and 32px tall. Orthogonal tiles are square at `size`.
 *
 * The blank template is the orthogonal mapping with a cell of one world
 * pixel. That is what "no snapping" means here rather than a second code
 * path: a selection dragged across it covers exactly the pixels it was
 * dragged across, an image dropped on it lands where it was dropped, and
 * every projection-aware call site above keeps working unchanged. `size` is
 * still the project's nominal unit — play mode's character is measured in it,
 * and so is the lattice its navigation walks — it simply is not what the
 * editor rounds to.
 */
export class Grid {
  readonly projection: Projection;
  readonly size: number;

  constructor(projection: Projection, size: number) {
    this.projection = projection;
    this.size = size;
  }

  /** Whether cells are a lattice the editor rounds to. */
  get snaps(): boolean {
    return this.projection !== "blank";
  }

  /** The side of one addressable cell: the grid unit, or a single pixel. */
  get cell(): number {
    return this.snaps ? this.size : 1;
  }

  get tileWidth(): number {
    return this.cell;
  }

  get tileHeight(): number {
    return this.projection === "isometric" ? this.size / 2 : this.cell;
  }

  /** World position of a cell. Iso returns the diamond's centre, ortho its
   *  top-left corner — the natural anchor for each shape. */
  cellToWorld(cell: Cell): Point {
    if (this.projection === "isometric") {
      return {
        x: (cell.cx - cell.cy) * (this.tileWidth / 2),
        y: (cell.cx + cell.cy) * (this.tileHeight / 2),
      };
    }
    return { x: cell.cx * this.cell, y: cell.cy * this.cell };
  }

  /** The cell containing a world point. */
  worldToCell(p: Point): Cell {
    if (this.projection === "isometric") {
      const a = p.x / (this.tileWidth / 2);
      const b = p.y / (this.tileHeight / 2);
      return {
        cx: Math.round((a + b) / 2),
        cy: Math.round((b - a) / 2),
      };
    }
    return {
      cx: Math.floor(p.x / this.cell),
      cy: Math.floor(p.y / this.cell),
    };
  }

  /**
   * The middle of a cell.
   *
   * Not the same as `cellToWorld`, which returns each shape's natural anchor:
   * an isometric diamond is addressed by its centre, but an orthogonal square
   * is addressed by its top-left corner. Anything asking "is this cell inside
   * that shape" has to test a point that is unambiguously *in* the cell, and
   * a corner is shared with three neighbours.
   */
  cellCentre(cell: Cell): Point {
    const c = this.cellToWorld(cell);
    if (this.projection === "isometric") return c;
    return { x: c.x + this.cell / 2, y: c.y + this.cell / 2 };
  }

  /** The tile outline, in world pixels, ready to hand to a Phaser polygon. */
  cellPolygon(cell: Cell): Point[] {
    const c = this.cellToWorld(cell);
    const hw = this.tileWidth / 2;
    const hh = this.tileHeight / 2;
    if (this.projection === "isometric") {
      return [
        { x: c.x, y: c.y - hh },
        { x: c.x + hw, y: c.y },
        { x: c.x, y: c.y + hh },
        { x: c.x - hw, y: c.y },
      ];
    }
    return [
      { x: c.x, y: c.y },
      { x: c.x + this.cell, y: c.y },
      { x: c.x + this.cell, y: c.y + this.cell },
      { x: c.x, y: c.y + this.cell },
    ];
  }

  /**
   * Axis-aligned world bounds of a rectangular cell range, inclusive.
   *
   * Derived from the range's outline rather than by walking its cells: this
   * runs on every camera change while a region is selected, and a large drag
   * would otherwise cost a pass over every cell in it per frame.
   */
  rangeBounds(
    from: Cell,
    to: Cell,
  ): { x: number; y: number; width: number; height: number } {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const p of this.rangePolygon(from, to)) {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
    return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
  }

  /**
   * The outline of a rectangular cell range as one closed polygon. For ortho
   * that is the bounding box; for iso it is the larger diamond the range
   * traces, which is what the selection overlay draws.
   */
  rangePolygon(from: Cell, to: Cell): Point[] {
    const x0 = Math.min(from.cx, to.cx);
    const x1 = Math.max(from.cx, to.cx);
    const y0 = Math.min(from.cy, to.cy);
    const y1 = Math.max(from.cy, to.cy);

    if (this.projection !== "isometric") {
      const a = this.cellToWorld({ cx: x0, cy: y0 });
      const b = this.cellToWorld({ cx: x1 + 1, cy: y1 + 1 });
      return [
        { x: a.x, y: a.y },
        { x: b.x, y: a.y },
        { x: b.x, y: b.y },
        { x: a.x, y: b.y },
      ];
    }

    const hw = this.tileWidth / 2;
    const hh = this.tileHeight / 2;
    const top = this.cellToWorld({ cx: x0, cy: y0 });
    const right = this.cellToWorld({ cx: x1, cy: y0 });
    const bottom = this.cellToWorld({ cx: x1, cy: y1 });
    const left = this.cellToWorld({ cx: x0, cy: y1 });
    return [
      { x: top.x, y: top.y - hh },
      { x: right.x + hw, y: right.y },
      { x: bottom.x, y: bottom.y + hh },
      { x: left.x - hw, y: left.y },
    ];
  }
}

/** Every cell in an inclusive rectangular range, row-major. */
export function* cellsInRange(from: Cell, to: Cell): Generator<Cell> {
  const x0 = Math.min(from.cx, to.cx);
  const x1 = Math.max(from.cx, to.cx);
  const y0 = Math.min(from.cy, to.cy);
  const y1 = Math.max(from.cy, to.cy);
  for (let cy = y0; cy <= y1; cy++) {
    for (let cx = x0; cx <= x1; cx++) yield { cx, cy };
  }
}

export function rangeSize(from: Cell, to: Cell): { w: number; h: number } {
  return {
    w: Math.abs(to.cx - from.cx) + 1,
    h: Math.abs(to.cy - from.cy) + 1,
  };
}

/**
 * A selection's size in the units the project actually uses.
 *
 * Grid spaces where there are grid spaces, world pixels where a cell is one —
 * "3 × 2 spaces" and "418 × 260 px" are the same sentence about two
 * templates, and every readout of a selection wants the right one.
 */
export function describeRange(grid: Grid, from: Cell, to: Cell): string {
  const { w, h } = rangeSize(from, to);
  return grid.snaps ? `${w} × ${h} spaces` : `${w} × ${h} px`;
}

export function cellKey(cell: Cell): string {
  return `${cell.cx},${cell.cy}`;
}

export function cellsEqual(a: Cell, b: Cell): boolean {
  return a.cx === b.cx && a.cy === b.cy;
}

/** The inclusive cell range a set of cells spans. */
export function cellsBounds(cells: readonly Cell[]): { from: Cell; to: Cell } {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const cell of cells) {
    minX = Math.min(minX, cell.cx);
    minY = Math.min(minY, cell.cy);
    maxX = Math.max(maxX, cell.cx);
    maxY = Math.max(maxY, cell.cy);
  }
  return { from: { cx: minX, cy: minY }, to: { cx: maxX, cy: maxY } };
}

/**
 * What a fill covers, in world pixels: the outlines to paint, and the box
 * around them.
 *
 * A fill is stored one of two ways and everything that draws one — the
 * canvas, the selection overlay, the PNG export, the conversion to a PSD —
 * wants the same answer from both. On a snapping project it is a run of grid
 * spaces, so each space contributes its own outline and an irregular shape
 * stays irregular. On a blank one it is a single rectangle. Null for a fill
 * that covers nothing, which nothing downstream can draw.
 */
export function fillShape(
  grid: Grid,
  fill: FillPatch,
): { polygons: Point[][]; bounds: Rect } | null {
  if (fill.rect) {
    const { x, y, width, height } = fill.rect;
    return {
      polygons: [
        [
          { x, y },
          { x: x + width, y },
          { x: x + width, y: y + height },
          { x, y: y + height },
        ],
      ],
      bounds: fill.rect,
    };
  }
  if (fill.cells.length === 0) return null;
  const { from, to } = cellsBounds(fill.cells);
  return {
    polygons: fill.cells.map((cell) => grid.cellPolygon(cell)),
    bounds: grid.rangeBounds(from, to),
  };
}

/**
 * The cells a world-space box actually covers.
 *
 * Not the same as the cell *range* enclosing the box, and the difference is
 * large under an isometric projection: a box in world space is a diamond in
 * cell space, so the axis-aligned range around it holds a great many cells
 * the box never touches. A 132 × 136 sketch on a 64px isometric grid falls
 * inside a 7 × 6 range whose own world bounds are 416 × 208 — three times the
 * width of the thing that produced it. Anything marking "the spaces this was
 * drawn over" wants these cells, not that range.
 *
 * The test is a separating-axis check between the box and the cell's outline,
 * both convex: they overlap unless some axis separates them, and the axes
 * worth trying are the box's two and the outline's edge normals.
 */
export function cellsUnderBox(grid: Grid, box: Rect): Cell[] {
  const corners = [
    grid.worldToCell({ x: box.x, y: box.y }),
    grid.worldToCell({ x: box.x + box.width, y: box.y }),
    grid.worldToCell({ x: box.x, y: box.y + box.height }),
    grid.worldToCell({ x: box.x + box.width, y: box.y + box.height }),
  ];
  // A cell whose centre is outside the box can still overlap it, so the
  // candidate range is widened by one before anything is ruled out.
  const x0 = Math.min(...corners.map((c) => c.cx)) - 1;
  const x1 = Math.max(...corners.map((c) => c.cx)) + 1;
  const y0 = Math.min(...corners.map((c) => c.cy)) - 1;
  const y1 = Math.max(...corners.map((c) => c.cy)) + 1;

  const out: Cell[] = [];
  for (let cy = y0; cy <= y1; cy++) {
    for (let cx = x0; cx <= x1; cx++) {
      if (convexOverlapsRect(grid.cellPolygon({ cx, cy }), box)) {
        out.push({ cx, cy });
      }
    }
  }
  return out;
}

/** Separating-axis overlap between a convex polygon and an axis-aligned box. */
export function convexOverlapsRect(points: readonly Point[], box: Rect): boolean {
  if (points.length < 3) return false;

  const axes: Point[] = [{ x: 1, y: 0 }, { x: 0, y: 1 }];
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    axes.push({ x: -(b.y - a.y), y: b.x - a.x });
  }

  const rect: Point[] = [
    { x: box.x, y: box.y },
    { x: box.x + box.width, y: box.y },
    { x: box.x + box.width, y: box.y + box.height },
    { x: box.x, y: box.y + box.height },
  ];

  for (const axis of axes) {
    const a = project(points, axis);
    const b = project(rect, axis);
    // Touching along an edge is not overlapping: a cell the box only grazes
    // is not a space it was drawn over.
    if (a.max <= b.min || b.max <= a.min) return false;
  }
  return true;
}

function project(
  points: readonly Point[],
  axis: Point,
): { min: number; max: number } {
  let min = Infinity;
  let max = -Infinity;
  for (const p of points) {
    const value = p.x * axis.x + p.y * axis.y;
    if (value < min) min = value;
    if (value > max) max = value;
  }
  return { min, max };
}

/** The box around a set of world-space points. */
export function pointsBounds(points: readonly Point[]): Rect {
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
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/** Whether a world point falls inside a rectangle, edges included. */
export function rectContains(rect: Rect, p: Point): boolean {
  return (
    p.x >= rect.x &&
    p.x <= rect.x + rect.width &&
    p.y >= rect.y &&
    p.y <= rect.y + rect.height
  );
}
