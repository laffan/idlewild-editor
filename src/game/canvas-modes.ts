/**
 * The modes that take the canvas over, and the one place that asks them.
 *
 * Three of them now — a solid being pulled out of the grid, a collider being
 * painted on it, and one layer of a PSD being drawn into — and they share a
 * rule: while one is up it owns the pointer, and every press, drag and tap
 * belongs to it rather than to the document underneath. The scene asks here
 * first at each stage and falls through to its ordinary behaviour only when
 * nobody claimed the gesture.
 *
 * Pen mode claims every gesture and *does* nothing with any of them, which
 * looks like a mistake and is the point: what draws there is the drawing
 * layer, a stack of canvases over Phaser's rather than anything in the scene,
 * so the mode's job under the ink is to keep a drag made with some other tool
 * from moving the artwork being drawn on. See `pen-mode.ts`.
 *
 * Only one of them is ever up, because entering one leaves the others — which
 * is enforced here rather than trusted, since each is entered from a place
 * that has no reason to know the rest exist: the floating action bar, a row
 * of the inspector, a button on a row of a PSD's layer list. That is also why
 * the asking is written once. Three call sites in the scene each deciding
 * which mode is up is how a mode ends up owning drags but not taps.
 */

import type Phaser from "phaser";
import type { Grid } from "../lib/grid";
import type { Point } from "../lib/types";
import { ColliderMode } from "./collider-mode";
import { ExtrudeMode } from "./extrude-mode";
import { PenMode } from "./pen-mode";

/** What the modes need from the scene around them. */
export interface CanvasModesHost {
  /** For their own graphics. The scene owns the display list, not these. */
  readonly scene: Phaser.Scene;
  readonly grid: Grid;
  zoom(): number;
  /** The scene's camera, which pen mode's dim is cut out of what it sees. */
  camera(): Phaser.Cameras.Scene2D.Camera;
  /** Where a client-space point lands in the world. */
  worldAt(screenX: number, screenY: number): Point;
  /**
   * Extrude mode owns the canvas while it is up, so nothing else stays
   * chosen underneath it — including the region selection it was entered
   * from, whose action bar would otherwise float over a dimmed canvas.
   */
  clearSelection(): void;
  onExtrudeChange(): void;
  onColliderChange(): void;
  onPenChange(): void;
}

export class CanvasModes {
  readonly extrude: ExtrudeMode;
  readonly collider: ColliderMode;
  readonly pen: PenMode;

  constructor(host: CanvasModesHost) {
    const shared = {
      scene: host.scene,
      grid: host.grid,
      zoom: () => host.zoom(),
      worldAt: (x: number, y: number) => host.worldAt(x, y),
    };
    this.extrude = new ExtrudeMode({
      ...shared,
      clearSelection: () => host.clearSelection(),
      onChange: () => host.onExtrudeChange(),
    });
    this.collider = new ColliderMode({
      ...shared,
      onChange: () => host.onColliderChange(),
    });
    this.pen = new PenMode({
      scene: host.scene,
      camera: () => host.camera(),
      clearSelection: () => host.clearSelection(),
      onChange: () => host.onPenChange(),
    });
  }

  /** Whether any mode currently owns the canvas. */
  get active(): boolean {
    return this.extrude.active || this.collider.active || this.pen.active;
  }

  // ── entering one, which is leaving the other ──────────────────────────────
  //
  // Only one mode can own the pointer, and each is entered from a different
  // place — the action bar, the inspector's own rows — so there is nothing at
  // either call site that knows about the other. Routing every entrance
  // through here is what stops the two bars from ever being up at once.

  startExtrude(...args: Parameters<ExtrudeMode["start"]>): boolean {
    this.collider.stop();
    this.pen.stop();
    return this.extrude.start(...args);
  }

  resumeExtrude(...args: Parameters<ExtrudeMode["resume"]>): boolean {
    this.collider.stop();
    this.pen.stop();
    return this.extrude.resume(...args);
  }

  startCollider(...args: Parameters<ColliderMode["start"]>): boolean {
    this.extrude.stop();
    this.pen.stop();
    return this.collider.start(...args);
  }

  startPen(...args: Parameters<PenMode["start"]>): boolean {
    this.extrude.stop();
    this.collider.stop();
    return this.pen.start(...args);
  }

  beginDrag(screenX: number, screenY: number): boolean {
    return (
      this.pen.claims() ||
      this.collider.beginPaint(screenX, screenY) ||
      this.extrude.beginPull(screenX, screenY)
    );
  }

  moveDrag(screenX: number, screenY: number): boolean {
    return (
      this.pen.claims() ||
      this.collider.movePaint(screenX, screenY) ||
      this.extrude.movePull(screenX, screenY)
    );
  }

  endDrag(): boolean {
    return this.pen.claims() || this.collider.endPaint() || this.extrude.endPull();
  }

  /**
   * A selection sweep, which is a hold or a rubber band everywhere else.
   *
   * Collider mode has no second gesture: painting is what its pointer does,
   * however the arbiter came to report it.
   */
  beginSelect(screenX: number, screenY: number): boolean {
    return (
      this.pen.claims() ||
      this.collider.beginPaint(screenX, screenY) ||
      this.extrude.beginSelect(screenX, screenY)
    );
  }

  extendSelect(screenX: number, screenY: number): boolean {
    return (
      this.pen.claims() ||
      this.collider.movePaint(screenX, screenY) ||
      this.extrude.extendSelect(screenX, screenY)
    );
  }

  endSelect(): boolean {
    return (
      this.pen.claims() || this.collider.endPaint() || this.extrude.endSelect()
    );
  }

  tap(screenX: number, screenY: number): boolean {
    return (
      this.pen.claims() ||
      this.collider.tap(screenX, screenY) ||
      this.extrude.tap(screenX, screenY)
    );
  }

  /** Redraw at the current zoom — mode chrome is sized in screen pixels. */
  refresh(): void {
    this.extrude.refresh();
    this.collider.refresh();
    this.pen.refresh();
  }

  /** Leave all of them, keeping nothing. What play mode and a teardown do. */
  stop(): void {
    this.extrude.stop();
    this.collider.stop();
    this.pen.stop();
  }

  destroy(): void {
    this.extrude.destroy();
    this.collider.destroy();
    this.pen.destroy();
  }
}
