/**
 * The selection overlay: the accent-red outline over a chosen region, fill or
 * placed image. Drawn above everything the document renders.
 */

import type Phaser from "phaser";
import type { DocStore } from "../lib/doc-store";
import { Grid, fillShape } from "../lib/grid";
import type { Selection } from "../lib/types";
import { CORNERS, cornerPoint, HANDLE_SCREEN_PX, placementBox } from "./resize";
import { strokesBox } from "../drawing";
import { instanceMembers, instanceOf, unionRect } from "./instance";

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

  /**
   * @param zoom camera zoom, so handles stay a constant size on screen.
   * @param adjusting the placed PSD whose layers are being moved one at a
   *        time, if any — everything else draws a PSD as the one thing it is.
   */
  render(
    selection: Selection,
    store: DocStore,
    zoom = 1,
    adjusting: string | null = null,
  ): void {
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
        const shape = fillShape(this.grid, fill);
        if (!shape) break;
        g.lineStyle(2, ACCENT, 1);
        for (const points of shape.polygons) polygon(g, points, false);
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

        // What the gesture will act on: the whole placed PSD, or the one
        // layer of it that has been opened up. Outlining anything else would
        // promise a drag the canvas is not about to make.
        const open = adjusting === instanceOf(placement);
        const members = open
          ? [placement]
          : instanceMembers(store.layers, selection.layerId, instanceOf(placement));
        const box = unionRect(members) ?? placementBox(placement);

        // The cell the image is anchored to. It is what a grid resize will
        // move the image by, and it is not otherwise visible anywhere —
        // a placement can sit a long way from the space that owns it.
        const anchor = this.grid.cellPolygon(placement.anchor);
        g.fillStyle(ACCENT, 0.25);
        g.lineStyle(2 * scale, ACCENT, 0.8);
        polygon(g, anchor, true);

        // Opened up, the sibling layers are drawn faintly: they are what the
        // one being moved is being moved *against*, and a layer dragged out
        // of a PSD with nothing to judge it by is a layer dragged blind.
        if (open) {
          g.lineStyle(1 * scale, ACCENT, 0.35);
          for (const other of instanceMembers(
            store.layers,
            selection.layerId,
            instanceOf(placement),
          )) {
            if (other.id === placement.id) continue;
            g.strokeRect(other.x, other.y, other.width, other.height);
          }
        }

        g.lineStyle(2 * scale, ACCENT, 1);
        g.strokeRect(box.x, box.y, box.width, box.height);

        // The four resize handles of image edit mode.
        const size = HANDLE_SCREEN_PX * scale;
        for (const corner of CORNERS) {
          const c = cornerPoint(box, corner);
          g.fillStyle(open ? ACCENT : 0xf3f2f2, 1);
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
        // Filled, faintly, rather than outlined twice over what the document
        // renderer already draws: the fill is what says the whole region is
        // the selection, which is also the region a drag picks it up from.
        const scale = 1 / zoom;
        g.fillStyle(ACCENT, 0.12);
        g.lineStyle(2 * scale, ACCENT, 1);
        polygon(g, zone.points, true);
        break;
      }
      case "strokes": {
        // The ink itself is on the drawing layer's own canvas, so all this
        // has to add is the box around what the lasso caught.
        const layer = store.layer(selection.layerId);
        if (!layer) break;
        const chosen = new Set(selection.ids);
        const box = strokesBox(layer.strokes.filter((s) => chosen.has(s.id)));
        if (!box) break;
        const scale = 1 / zoom;
        g.lineStyle(2 * scale, ACCENT, 1);
        g.strokeRect(box.x, box.y, box.width, box.height);
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
