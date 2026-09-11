/**
 * What collider mode draws: a dim over the canvas, and the spaces the file
 * blocks painted on the grid.
 *
 * Two graphics rather than one, for the reason extrude mode keeps three: the
 * scrim is fixed to the screen and never redrawn, while the shape changes on
 * every pointer move. Both sit above the document, so the spaces are visible
 * over the artwork they belong to.
 *
 * The scrim is lighter here than extrude mode's. There the solid being pulled
 * replaces what is underneath it; here the artwork *is* what you are aiming
 * at — a collider is drawn by looking at the tree and saying which spaces it
 * stands on — so the dim has to say the canvas is in a mode without hiding
 * the thing the mode is about.
 */

import type Phaser from "phaser";
import type { Grid } from "../lib/grid";
import type { Cell, Point } from "../lib/types";

/** Above the document, below the selection overlay and the marquee. */
const DIM_DEPTH = 920_000;
const CELLS_DEPTH = 935_000;

/** The accent, which is what this editor uses for "the thing in hand". */
const ACCENT = 0xec3013;

/** How far the screen-fixed scrim reaches; bigger than any viewport. */
const SCRIM = 20_000;

export class ColliderRender {
  private readonly grid: Grid;
  private readonly dim: Phaser.GameObjects.Graphics;
  private readonly cells: Phaser.GameObjects.Graphics;

  constructor(scene: Phaser.Scene, grid: Grid) {
    this.grid = grid;
    this.dim = scene.add.graphics().setScrollFactor(0).setDepth(DIM_DEPTH);
    this.cells = scene.add.graphics().setDepth(CELLS_DEPTH);
    this.dim.setVisible(false);
    this.dim.fillStyle(0x201e1d, 0.3);
    this.dim.fillRect(-SCRIM / 2, -SCRIM / 2, SCRIM, SCRIM);
  }

  /**
   * @param cells the spaces the collider holds, in absolute grid coordinates.
   * @param zoom camera zoom, so the outlines keep their weight on screen
   *        rather than thickening as the camera comes in.
   */
  render(cells: readonly Cell[], zoom: number): void {
    this.dim.setVisible(true);
    const scale = 1 / zoom;

    const g = this.cells;
    g.clear();
    g.fillStyle(ACCENT, 0.34);
    g.lineStyle(2 * scale, ACCENT, 1);
    for (const cell of cells) polygon(g, this.grid.cellPolygon(cell));
  }

  /** Take everything down, leaving the canvas as it was. */
  clear(): void {
    this.dim.setVisible(false);
    this.cells.clear();
  }

  destroy(): void {
    this.dim.destroy();
    this.cells.destroy();
  }
}

function polygon(
  g: Phaser.GameObjects.Graphics,
  points: readonly Point[],
): void {
  if (points.length < 3) return;
  g.beginPath();
  g.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i++) g.lineTo(points[i].x, points[i].y);
  g.closePath();
  g.fillPath();
  g.strokePath();
}
