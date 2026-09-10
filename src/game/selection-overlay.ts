/**
 * The selection overlay: the accent-red outline over a chosen region, fill or
 * placed image. Drawn above everything the document renders.
 */

import type Phaser from "phaser";
import type { DocStore } from "../lib/doc-store";
import { Grid } from "../lib/grid";
import type { Selection } from "../lib/types";
import { CORNERS, cornerPoint, HANDLE_SCREEN_PX, placementBox } from "./resize";

const ACCENT = 0xec3013;
const OVERLAY_DEPTH = 1_000_000;

export class SelectionOverlay {
  private readonly graphics: Phaser.GameObjects.Graphics;
  private readonly grid: Grid;

  constructor(graphics: Phaser.GameObjects.Graphics, grid: Grid) {
    this.graphics = graphics;
    this.grid = grid;
    this.graphics.setDepth(OVERLAY_DEPTH);
  }

  /** @param zoom camera zoom, so handles stay a constant size on screen. */
  render(selection: Selection, store: DocStore, zoom = 1): void {
    const g = this.graphics;
    g.clear();

    switch (selection.kind) {
      case "region": {
        const points = this.grid.rangePolygon(selection.from, selection.to);
        g.fillStyle(ACCENT, 0.1);
        g.lineStyle(2, ACCENT, 1);
        polygon(g, points, true);
        break;
      }
      case "fill": {
        const fill = store
          .layer(selection.layerId)
          ?.fills.find((f) => f.id === selection.fillId);
        if (!fill) break;
        g.lineStyle(2, ACCENT, 1);
        for (const cell of fill.cells) {
          polygon(g, this.grid.cellPolygon(cell), false);
        }
        break;
      }
      case "placement": {
        const placement = store
          .layer(selection.layerId)
          ?.placements.find((p) => p.id === selection.placementId);
        if (!placement) break;
        // Everything below is sized in world units but wants to look
        // constant on screen, so divide through by the zoom.
        const scale = 1 / zoom;

        // The cell the image is anchored to. It is what a grid resize will
        // move the image by, and it is not otherwise visible anywhere —
        // a placement can sit a long way from the space that owns it.
        const anchor = this.grid.cellPolygon(placement.anchor);
        g.fillStyle(ACCENT, 0.25);
        g.lineStyle(2 * scale, ACCENT, 0.8);
        polygon(g, anchor, true);

        g.lineStyle(2 * scale, ACCENT, 1);
        g.strokeRect(
          placement.x,
          placement.y,
          placement.width,
          placement.height,
        );

        // The four resize handles of image edit mode.
        const box = placementBox(placement);
        const size = HANDLE_SCREEN_PX * scale;
        for (const corner of CORNERS) {
          const c = cornerPoint(box, corner);
          g.fillStyle(0xf3f2f2, 1);
          g.fillRect(c.x - size / 2, c.y - size / 2, size, size);
          g.lineStyle(2 * scale, ACCENT, 1);
          g.strokeRect(c.x - size / 2, c.y - size / 2, size, size);
        }
        break;
      }
      case "zone": {
        const zone = store
          .layer(selection.layerId)
          ?.zones.find((z) => z.id === selection.zoneId);
        if (!zone || zone.points.length < 2) break;
        g.lineStyle(2, ACCENT, 1);
        polygon(g, zone.points, false);
        break;
      }
      case "layer":
      case "none":
        break;
    }
  }
}

function polygon(
  g: Phaser.GameObjects.Graphics,
  points: Array<{ x: number; y: number }>,
  fill: boolean,
): void {
  if (points.length < 2) return;
  g.beginPath();
  g.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i++) g.lineTo(points[i].x, points[i].y);
  g.closePath();
  if (fill) g.fillPath();
  g.strokePath();
}
