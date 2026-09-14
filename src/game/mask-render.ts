/**
 * What mask mode draws: a dim over the canvas, the spaces the shape holds,
 * the sweep in flight, and the layer's other shapes behind them.
 *
 * `collider-render.ts` with one thing added, and it is the thing that makes
 * the mode usable. A collider is one shape on one file; a pattern layer's
 * mask is a *set* of shapes that between them say where the rule may apply,
 * and editing one of them without seeing the rest is editing half a boundary
 * blind. So the others are drawn in outline, behind the one in hand, in the
 * same accent at a fraction of its weight.
 *
 * The scrim is the collider's rather than extrude's, and for the collider's
 * reason: what you are aiming at is the grid and whatever is standing on it,
 * so the dim has to say the canvas is in a mode without hiding the thing the
 * mode is about.
 */

import type Phaser from "phaser";
import type { Grid } from "../lib/grid";
import type { Cell, PatternShape, Point } from "../lib/types";

/** Above the document, below the selection overlay and the marquee. */
const DIM_DEPTH = 920_000;
const OTHERS_DEPTH = 932_000;
const CELLS_DEPTH = 935_000;
const SWEEP_DEPTH = 937_000;

/** The accent, which is what this editor uses for "the thing in hand". */
const ACCENT = 0xec3013;

/** How far the screen-fixed scrim reaches; bigger than any viewport. */
const SCRIM = 20_000;

/** A rectangle of grid spaces, inclusive of both corners. */
export interface MaskSweep {
  from: Cell;
  to: Cell;
  /** Whether the release will add the spaces or take them away. */
  adding: boolean;
}

export class MaskRender {
  private readonly grid: Grid;
  private readonly dim: Phaser.GameObjects.Graphics;
  private readonly others: Phaser.GameObjects.Graphics;
  private readonly cells: Phaser.GameObjects.Graphics;
  private readonly sweep: Phaser.GameObjects.Graphics;

  constructor(scene: Phaser.Scene, grid: Grid) {
    this.grid = grid;
    this.dim = scene.add.graphics().setScrollFactor(0).setDepth(DIM_DEPTH);
    this.others = scene.add.graphics().setDepth(OTHERS_DEPTH);
    this.cells = scene.add.graphics().setDepth(CELLS_DEPTH);
    this.sweep = scene.add.graphics().setDepth(SWEEP_DEPTH);
    this.dim.setVisible(false);
    this.dim.fillStyle(0x201e1d, 0.3);
    this.dim.fillRect(-SCRIM / 2, -SCRIM / 2, SCRIM, SCRIM);
  }

  /**
   * @param cells the spaces the shape holds, in absolute grid coordinates.
   * @param others every other shape on the layer, drawn behind in outline.
   * @param sweep the rectangle being dragged, if one is.
   * @param zoom camera zoom, so the outlines keep their weight on screen
   *        rather than thickening as the camera comes in.
   */
  render(
    cells: readonly Cell[],
    others: readonly PatternShape[],
    sweep: MaskSweep | null,
    zoom: number,
  ): void {
    this.dim.setVisible(true);
    const scale = 1 / zoom;

    const o = this.others;
    o.clear();
    o.lineStyle(1 * scale, ACCENT, 0.4);
    for (const shape of others) {
      for (const cell of shape.cells ?? []) {
        outline(o, this.grid.cellPolygon(cell));
      }
    }

    const g = this.cells;
    g.clear();
    g.fillStyle(ACCENT, 0.34);
    g.lineStyle(2 * scale, ACCENT, 1);
    for (const cell of cells) polygon(g, this.grid.cellPolygon(cell));

    const s = this.sweep;
    s.clear();
    if (!sweep) return;
    // Dashed rather than solid, and unfilled: what the rectangle says is
    // *what will change on release*, which is a different claim from the
    // filled spaces under it saying what the shape already holds. Adding and
    // removing are the same box in the same colour — the bar says which, and
    // the spaces under it change the moment the finger lifts.
    s.lineStyle(2 * scale, ACCENT, sweep.adding ? 1 : 0.55);
    outline(s, this.grid.rangePolygon(sweep.from, sweep.to));
  }

  /** Take everything down, leaving the canvas as it was. */
  clear(): void {
    this.dim.setVisible(false);
    this.others.clear();
    this.cells.clear();
    this.sweep.clear();
  }

  destroy(): void {
    this.dim.destroy();
    this.others.destroy();
    this.cells.destroy();
    this.sweep.destroy();
  }
}

function polygon(
  g: Phaser.GameObjects.Graphics,
  points: readonly Point[],
): void {
  if (points.length < 3) return;
  path(g, points);
  g.fillPath();
  g.strokePath();
}

function outline(
  g: Phaser.GameObjects.Graphics,
  points: readonly Point[],
): void {
  if (points.length < 3) return;
  path(g, points);
  g.strokePath();
}

function path(g: Phaser.GameObjects.Graphics, points: readonly Point[]): void {
  g.beginPath();
  g.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i++) g.lineTo(points[i].x, points[i].y);
  g.closePath();
}
