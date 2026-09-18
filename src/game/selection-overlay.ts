/**
 * The selection overlay: the accent-red outline over a chosen region, fill,
 * point or placed image. Drawn above everything the document renders.
 */

import type Phaser from "phaser";
import type { DocStore } from "../lib/doc-store";
import { Grid, fillShape } from "../lib/grid";
import type { Selection } from "../lib/types";
import { CORNERS, cornerPoint, HANDLE_SCREEN_PX, placementBox } from "./resize";
import { strokesBox } from "../drawing";
import { planeFor, textById, textFrame, textPoint } from "../lib/text-items";
import { isInstance } from "./instances";
import { unitMembers, unitOf, unionRect } from "./unit";

const ACCENT = 0xec3013;
const OVERLAY_DEPTH = 1_000_000;

/**
 * How long a dash and a gap are, in screen pixels, on an instance's outline.
 *
 * Screen rather than world, like every other width here: a dash measured on the
 * grid would be a hairline pattern at 1× and a row of bricks at 4×.
 */
const DASH = 6;

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
        // Two screen pixels, as everything else here is: an outline drawn on
        // the grid thickens with the camera otherwise, and on a project
        // opened at 4× that is eight pixels of chrome around a small
        // selection.
        g.lineStyle(2 / zoom, ACCENT, 1);
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
        g.lineStyle(2 / zoom, ACCENT, 1);
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
        const open = adjusting === unitOf(placement);
        const members = open
          ? [placement]
          : unitMembers(store.layers, selection.layerId, unitOf(placement));
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
          for (const other of unitMembers(
            store.layers,
            selection.layerId,
            unitOf(placement),
          )) {
            if (other.id === placement.id) continue;
            g.strokeRect(other.x, other.y, other.width, other.height);
          }
        }

        // **A dashed box for an instance**, solid for an object that has its
        // file to itself. One of several placed PSDs on the same file is a
        // different kind of thing to have selected — an edit to the artwork
        // reaches every one of them — and the canvas should say so before the
        // inspector has to. A different *kind* of line rather than a different
        // colour, because the accent is the only one this design has, and
        // because dashed already reads as "shared with something else".
        g.lineStyle(2 * scale, ACCENT, 1);
        if (isInstance(store.allLayers, placement)) {
          dashedRect(g, box, DASH * scale);
        } else {
          g.strokeRect(box.x, box.y, box.width, box.height);
        }

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
      case "placements": {
        // Several images caught by a marquee. Each is outlined so it is clear
        // what was caught, and the box around the lot says what a drag moves
        // — but no handles: they resize as a group only when they are one
        // PSD, and these merely happen to be near each other.
        const layer = store.layer(selection.layerId);
        if (!layer) break;
        const chosen = new Set(selection.ids);
        const members = layer.placements.filter((p) => chosen.has(p.id));
        const box = unionRect(members);
        if (!box) break;

        const scale = 1 / zoom;
        g.lineStyle(1 * scale, ACCENT, 0.55);
        for (const member of members) {
          g.strokeRect(member.x, member.y, member.width, member.height);
        }
        g.fillStyle(ACCENT, 0.06);
        g.lineStyle(2 * scale, ACCENT, 1);
        g.fillRect(box.x, box.y, box.width, box.height);
        g.strokeRect(box.x, box.y, box.width, box.height);
        break;
      }
      case "point": {
        const point = store
          .layer(selection.layerId)
          ?.points.find((p) => p.id === selection.pointId);
        if (!point) break;
        // A ring around the marker rather than a box: a point has no extent,
        // and a rectangle drawn round a dot says it has a size it has not.
        // Sized off the grid like the marker itself, and thickened against
        // the zoom so it stays a highlight rather than a blob.
        const scale = 1 / zoom;
        const at = this.grid.cellCentre(point.cell);
        const radius = this.grid.tileHeight * 0.5;
        g.fillStyle(ACCENT, 0.12);
        g.lineStyle(2 * scale, ACCENT, 1);
        g.fillCircle(at.x, at.y, radius);
        g.strokeCircle(at.x, at.y, radius);
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
      case "text": {
        const item = textById(
          store.layer(selection.layerId),
          selection.textId,
        );
        if (!item) break;
        // The measured box, which is the box a tap picks it up from and the
        // box a conversion crops to — see `lib/text-items.ts`. Outlined
        // rather than filled: a wash over words is a wash over the one thing
        // here that has to stay readable while it is selected.
        const scale = 1 / zoom;
        g.lineStyle(2 * scale, ACCENT, 1);
        g.strokeRect(item.x, item.y, item.width, item.height);

        // And, on a note that wraps, the column itself with a handle at the
        // end of it. Not the right-hand edge of the box: on a note laid into
        // the grid the column runs off along a diagonal, and a handle on the
        // box's corner would be nowhere near where the words stop. `textPoint`
        // is what puts it at the end of the *text* in all four orientations.
        if (item.wrapWidth !== undefined) {
          const frame = textFrame(item, planeFor(item, this.grid));
          const top = textPoint(frame, frame.flat.width, 0);
          const foot = textPoint(frame, frame.flat.width, frame.flat.height);
          g.lineStyle(2 * scale, ACCENT, 0.6);
          g.beginPath();
          g.moveTo(top.x, top.y);
          g.lineTo(foot.x, foot.y);
          g.strokePath();

          const at = textPoint(frame, frame.flat.width, frame.flat.height / 2);
          const size = HANDLE_SCREEN_PX * scale;
          g.fillStyle(0xf3f2f2, 1);
          g.fillRect(at.x - size / 2, at.y - size / 2, size, size);
          g.lineStyle(2 * scale, ACCENT, 1);
          g.strokeRect(at.x - size / 2, at.y - size / 2, size, size);
        }
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

/**
 * A rectangle drawn as a run of dashes.
 *
 * Phaser's Graphics has no dash pattern, so the four sides are walked a
 * `dash`-long stroke and a `dash`-long gap at a time. Started at the top-left
 * and taken corner by corner, so each corner is the start of a dash and the box
 * reads as a box rather than as four lines that nearly meet.
 */
function dashedRect(
  g: Phaser.GameObjects.Graphics,
  box: { x: number; y: number; width: number; height: number },
  dash: number,
): void {
  const corners = [
    { x: box.x, y: box.y },
    { x: box.x + box.width, y: box.y },
    { x: box.x + box.width, y: box.y + box.height },
    { x: box.x, y: box.y + box.height },
  ];
  g.beginPath();
  for (let i = 0; i < corners.length; i++) {
    const from = corners[i];
    const to = corners[(i + 1) % corners.length];
    const length = Math.hypot(to.x - from.x, to.y - from.y);
    if (length <= 0) continue;
    const stepX = ((to.x - from.x) / length) * dash;
    const stepY = ((to.y - from.y) / length) * dash;
    // A side shorter than one dash is drawn whole: a gap in it would be most
    // of the side, which looks like nothing rather than like a dash.
    for (let at = 0; at < length; at += dash * 2) {
      const end = Math.min(at + dash, length);
      g.moveTo(from.x + (stepX * at) / dash, from.y + (stepY * at) / dash);
      g.lineTo(from.x + (stepX * end) / dash, from.y + (stepY * end) / dash);
    }
  }
  g.strokePath();
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
