/**
 * The Select tool's two gestures, which ask different questions.
 *
 * **Press and hold** asks for a patch of grid. Fill, Add Image and Generate
 * PSD act on it, so it is measured in spaces and drawn as the grid draws
 * them — under an isometric template, a diamond.
 *
 * **A drag** asks *what is in here*, and the things it catches are images
 * sitting at world coordinates that owe the grid nothing. So a drag is a
 * plain rectangle: the one that was dragged, pixel for pixel, with no lattice
 * to round to. They used to be the same gesture in two moods, both rounded to
 * cells, which on an isometric project meant dragging a box and watching a
 * diamond appear somewhere near it — reaching a long way past the corner you
 * started from and catching images you could see were outside it.
 *
 * The dragged band is deliberately not a `Selection`: it is a gesture still
 * happening, and nothing is chosen until the finger comes up. It has its own
 * graphics, in world coordinates, so a camera that moves under it leaves it
 * over the same ground.
 */

import type Phaser from "phaser";
import type { Grid } from "../lib/grid";
import type { Cell, Layer, Point, Rect, Selection } from "../lib/types";
import { pickPlacementsIn } from "./doc-renderer";

const ACCENT = 0xec3013;
/** With the selection overlay, above everything the document renders. */
const DEPTH = 1_000_000;

export class Marquee {
  private readonly graphics: Phaser.GameObjects.Graphics;
  private readonly grid: Grid;

  /** Held mode: the cell the gesture started on, and the one it is over. */
  private anchor: Cell | null = null;
  private corner: Cell | null = null;
  /** Dragged mode: where the finger went down, and the box since. */
  private from: Point | null = null;
  private box: Rect | null = null;
  private fromHold = false;

  constructor(graphics: Phaser.GameObjects.Graphics, grid: Grid) {
    this.graphics = graphics;
    this.graphics.setDepth(DEPTH);
    this.grid = grid;
  }

  /**
   * Whether the selection on screen is a patch of grid that was *asked for*.
   *
   * A finger held still means "this much space", and the floating action bar
   * is what that is for. A drag means "whatever is in here", and a bar of
   * things to make over it would interrupt a gesture about picking things up.
   * Outlives the gesture, because the bar is drawn for the selection it left.
   */
  get held(): boolean {
    return this.fromHold;
  }

  /** Begin, and hand back the selection the gesture starts with. */
  begin(at: Point, fromHold: boolean): Selection {
    this.fromHold = fromHold;
    if (!fromHold) {
      this.from = { x: at.x, y: at.y };
      this.box = null;
      this.graphics.clear();
      return { kind: "none" };
    }
    const cell = this.grid.worldToCell(at);
    this.anchor = cell;
    this.corner = cell;
    return { kind: "region", from: cell, to: cell };
  }

  /**
   * Follow the pointer.
   *
   * Returns a selection only in held mode: the dragged band is drawn rather
   * than selected, so the inspector is not rebuilt on every frame of a drag
   * for a thing that is not chosen yet.
   *
   * @param zoom camera zoom, so the outline keeps its weight on screen.
   */
  extend(to: Point, zoom = 1): Selection | null {
    if (this.from) {
      this.box = between(this.from, to);
      this.draw(this.box, zoom);
      return null;
    }
    if (!this.anchor) return null;
    this.corner = this.grid.worldToCell(to);
    return { kind: "region", from: this.anchor, to: this.corner };
  }

  /**
   * What the box caught, or null to leave the selection as it stands.
   *
   * A dragged rectangle is only ever about the things in it: what it catches
   * is the selection, and catching nothing is a selection of nothing — which
   * is what tapping empty space means too. A held patch is a piece of space
   * in its own right, so there what it caught wins if it caught anything and
   * the patch stands if it did not.
   */
  end(layers: readonly Layer[]): Selection | null {
    if (this.from) {
      const box = this.box;
      this.cancel();
      const caught = box ? pickPlacementsIn(layers, rectPoints(box)) : null;
      return caught
        ? { kind: "placements", layerId: caught.layerId, ids: caught.ids }
        : { kind: "none" };
    }

    const anchor = this.anchor;
    const corner = this.corner;
    this.cancel();
    if (!anchor || !corner) return null;
    // The held marquee's own shape, which under an isometric template is a
    // diamond — the box around it reaches a long way past what was dragged.
    const caught = pickPlacementsIn(layers, this.grid.rangePolygon(anchor, corner));
    return caught
      ? { kind: "placements", layerId: caught.layerId, ids: caught.ids }
      : null;
  }

  /** Abandon whatever is up — a change of mode, a teardown. */
  cancel(): void {
    this.anchor = null;
    this.corner = null;
    this.from = null;
    this.box = null;
    this.graphics.clear();
  }

  destroy(): void {
    this.graphics.destroy();
  }

  private draw(box: Rect, zoom: number): void {
    const g = this.graphics;
    g.clear();
    // Lighter than the selection outline on purpose: this is a question being
    // asked, not an answer, and it is gone by the time there is one.
    g.fillStyle(ACCENT, 0.08);
    g.fillRect(box.x, box.y, box.width, box.height);
    g.lineStyle(1.5 / zoom, ACCENT, 0.9);
    g.strokeRect(box.x, box.y, box.width, box.height);
  }
}

/** A rectangle as the four corners a convex overlap test wants. */
export function rectPoints(rect: Rect): Point[] {
  return [
    { x: rect.x, y: rect.y },
    { x: rect.x + rect.width, y: rect.y },
    { x: rect.x + rect.width, y: rect.y + rect.height },
    { x: rect.x, y: rect.y + rect.height },
  ];
}

/** The rectangle between two points, whichever corner each turned out to be. */
export function between(a: Point, b: Point): Rect {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(b.x - a.x),
    height: Math.abs(b.y - a.y),
  };
}
