/**
 * The infinite grid.
 *
 * "Infinite" here means the grid is never stored — it is recomputed from the
 * camera each time the view changes, over exactly the cells the viewport can
 * see, and nothing else. There is no world bound to hit.
 */

import type Phaser from "phaser";
import { Grid } from "../lib/grid";
import type { Cell } from "../lib/types";

/** Beyond this zoom-out the lines stop reading and start costing; fade them. */
const MIN_VISIBLE_TILE_PX = 6;
/** A margin of cells past the viewport, so a pan does not reveal bare ground. */
const OVERDRAW = 2;

export class GridRenderer {
  private readonly graphics: Phaser.GameObjects.Graphics;
  private readonly grid: Grid;
  private lastSignature = "";

  constructor(graphics: Phaser.GameObjects.Graphics, grid: Grid) {
    this.graphics = graphics;
    this.grid = grid;
    this.graphics.setDepth(-10_000);
  }

  /** Redraw if the visible cell range changed. Cheap to call every frame. */
  update(camera: Phaser.Cameras.Scene2D.Camera): void {
    const range = this.visibleRange(camera);
    const signature = `${range.from.cx},${range.from.cy},${range.to.cx},${range.to.cy}`;
    if (signature === this.lastSignature) return;
    this.lastSignature = signature;
    this.draw(range, camera.zoom);
  }

  /** Force the next update() to redraw — after a projection or size change. */
  invalidate(): void {
    this.lastSignature = "";
  }

  /** The inclusive cell range the camera can currently see. */
  visibleRange(camera: Phaser.Cameras.Scene2D.Camera): { from: Cell; to: Cell } {
    const view = camera.worldView;
    // Iso cell space is rotated against the viewport, so the axis-aligned
    // range has to come from all four corners, not just two.
    const corners: Cell[] = [
      this.grid.worldToCell({ x: view.left, y: view.top }),
      this.grid.worldToCell({ x: view.right, y: view.top }),
      this.grid.worldToCell({ x: view.right, y: view.bottom }),
      this.grid.worldToCell({ x: view.left, y: view.bottom }),
    ];

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const c of corners) {
      minX = Math.min(minX, c.cx);
      minY = Math.min(minY, c.cy);
      maxX = Math.max(maxX, c.cx);
      maxY = Math.max(maxY, c.cy);
    }

    return {
      from: { cx: minX - OVERDRAW, cy: minY - OVERDRAW },
      to: { cx: maxX + OVERDRAW, cy: maxY + OVERDRAW },
    };
  }

  private draw(range: { from: Cell; to: Cell }, zoom: number): void {
    const g = this.graphics;
    g.clear();

    const tilePx = this.grid.tileWidth * zoom;
    if (tilePx < MIN_VISIBLE_TILE_PX) return;

    // Fade the lines out as tiles approach the legibility floor rather than
    // popping them off at the threshold.
    const alpha = Math.min(0.9, (tilePx - MIN_VISIBLE_TILE_PX) / 30);
    g.lineStyle(1, 0xa9c2d3, alpha);

    // Two edges per cell, not the whole tile outline: neighbours supply the
    // other two. Stroking every outline drew each shared edge twice, which
    // both doubled the work and darkened the lattice where they overlapped.
    g.beginPath();
    for (let cy = range.from.cy; cy <= range.to.cy + 1; cy++) {
      for (let cx = range.from.cx; cx <= range.to.cx + 1; cx++) {
        // One path serves both projections: vertices 3 → 0 → 1 are
        // left → top → right on an isometric diamond, and bottom-left →
        // top-left → top-right on an orthogonal square. Either way that is
        // the cell's two leading edges.
        const points = this.grid.cellPolygon({ cx, cy });
        g.moveTo(points[3].x, points[3].y);
        g.lineTo(points[0].x, points[0].y);
        g.lineTo(points[1].x, points[1].y);
      }
    }
    g.strokePath();
  }
}
