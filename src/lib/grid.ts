import type { Cell, Point, Projection } from "./types";

/**
 * Grid projection. Both templates share one integer cell space; only the
 * cell -> world mapping differs, so everything downstream (selection, fills,
 * A*, export bounds) is written once against `Grid`.
 *
 * Isometric tiles are the usual 2:1 diamond: a `size` of 64 means a tile
 * 64px wide and 32px tall. Orthogonal tiles are square at `size`.
 */
export class Grid {
  readonly projection: Projection;
  readonly size: number;

  constructor(projection: Projection, size: number) {
    this.projection = projection;
    this.size = size;
  }

  get tileWidth(): number {
    return this.size;
  }

  get tileHeight(): number {
    return this.projection === "isometric" ? this.size / 2 : this.size;
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
    return { x: cell.cx * this.size, y: cell.cy * this.size };
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
      cx: Math.floor(p.x / this.size),
      cy: Math.floor(p.y / this.size),
    };
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
      { x: c.x + this.size, y: c.y },
      { x: c.x + this.size, y: c.y + this.size },
      { x: c.x, y: c.y + this.size },
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

    if (this.projection === "orthogonal") {
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

export function cellKey(cell: Cell): string {
  return `${cell.cx},${cell.cy}`;
}

export function cellsEqual(a: Cell, b: Cell): boolean {
  return a.cx === b.cx && a.cy === b.cy;
}
