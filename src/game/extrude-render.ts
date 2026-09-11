/**
 * What extrude mode draws: the dim over everything else, the shaded solid,
 * and the face currently in the user's hands.
 *
 * Three graphics rather than one, because they change on different beats. The
 * dim is fixed to the screen and never redrawn; the solid changes once per
 * pointer move while a pull is under way; the highlight changes with the
 * selection. All of them sit above the document and below the marquee, so the
 * rubber band is still visible over the shape it is being dragged across.
 */

import type Phaser from "phaser";
import type { Grid } from "../lib/grid";
import type { Point } from "../lib/types";
import {
  EDGE_COLOR,
  patchFaces,
  SHADE_COLORS,
  type Face,
  type Patch,
} from "../lib/extrude";

/** Above the document, below the selection overlay and the marquee. */
const DIM_DEPTH = 920_000;
const SOLID_DEPTH = 930_000;
const PATCH_DEPTH = 940_000;

const ACCENT = 0xec3013;

/** The shared palette, as Phaser wants it. */
const SHADES: Record<"top" | "right" | "left", number> = {
  top: rgb(SHADE_COLORS.top),
  right: rgb(SHADE_COLORS.right),
  left: rgb(SHADE_COLORS.left),
};
const EDGE = rgb(EDGE_COLOR);

function rgb(css: string): number {
  return parseInt(css.slice(1), 16);
}

/**
 * How far the scrim reaches.
 *
 * It is pinned to the camera rather than to the world, so it needs no redraw
 * on a pan or a zoom — it only has to be bigger than any viewport this will
 * ever run in.
 */
const SCRIM = 20_000;

export class ExtrudeRender {
  private readonly grid: Grid;
  private readonly dim: Phaser.GameObjects.Graphics;
  private readonly solid: Phaser.GameObjects.Graphics;
  private readonly held: Phaser.GameObjects.Graphics;

  constructor(scene: Phaser.Scene, grid: Grid) {
    this.grid = grid;
    this.dim = scene.add.graphics().setScrollFactor(0).setDepth(DIM_DEPTH);
    this.solid = scene.add.graphics().setDepth(SOLID_DEPTH);
    this.held = scene.add.graphics().setDepth(PATCH_DEPTH);
    this.dim.setVisible(false);
    this.dim.fillStyle(0x201e1d, 0.45);
    this.dim.fillRect(-SCRIM / 2, -SCRIM / 2, SCRIM, SCRIM);
  }

  /**
   * @param faces the shape's visible surface, back to front. Handed in rather
   *        than derived, because the mode above has already worked it out to
   *        hit-test against and there is no sense in building it twice.
   * @param zoom camera zoom, so the hairlines between spaces keep their
   *        weight on screen rather than thickening as the camera comes in.
   */
  render(faces: readonly Face[], patch: Patch | null, zoom: number): void {
    this.dim.setVisible(true);
    const scale = 1 / zoom;

    const g = this.solid;
    g.clear();
    for (const face of faces) {
      g.fillStyle(SHADES[face.shade], 1);
      g.lineStyle(1 * scale, EDGE, 0.5);
      polygon(g, face.points, true);
    }

    const h = this.held;
    h.clear();
    if (!patch) return;
    h.fillStyle(ACCENT, 0.32);
    h.lineStyle(2 * scale, ACCENT, 1);
    for (const points of patchFaces(this.grid, patch)) polygon(h, points, true);
  }

  /** Take everything down, leaving the canvas as it was. */
  clear(): void {
    this.dim.setVisible(false);
    this.solid.clear();
    this.held.clear();
  }

  destroy(): void {
    this.dim.destroy();
    this.solid.destroy();
    this.held.destroy();
  }
}

function polygon(
  g: Phaser.GameObjects.Graphics,
  points: readonly Point[],
  fill: boolean,
): void {
  if (points.length < 3) return;
  g.beginPath();
  g.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i++) g.lineTo(points[i].x, points[i].y);
  g.closePath();
  if (fill) g.fillPath();
  g.strokePath();
}
