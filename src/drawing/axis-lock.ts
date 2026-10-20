/**
 * Shift held under the Pencil, the Pattern brush or the Shape brush keeps the
 * mark to one axis: a straight row across the canvas, or a straight column
 * down it.
 *
 * Which axis is the way the pointer first moved — the larger of the two once
 * it has gone far enough to say (`DECIDE_PX`, in world pixels) — and it holds
 * for the rest of the stroke while Shift is down. Let go of Shift and the
 * pointer is free again; press it again and the axis is decided afresh from
 * where the stroke is then. The point that is held is where the stroke was
 * when the lock began, so a row starts level with the pen's first touch.
 */

/** How far the pointer must move before its direction counts. */
const DECIDE_PX = 4;

export type Axis = "x" | "y";

export class AxisLock {
  private anchor: { x: number; y: number };
  private axis: Axis | null = null;

  constructor(x: number, y: number) {
    this.anchor = { x, y };
  }

  /** Where a pointer at `x, y` draws, with Shift `held` or not. */
  apply(x: number, y: number, held: boolean): { x: number; y: number } {
    if (!held) {
      // Free — and whatever comes next is measured from here.
      this.axis = null;
      this.anchor = { x, y };
      return { x, y };
    }
    if (!this.axis) {
      const dx = Math.abs(x - this.anchor.x);
      const dy = Math.abs(y - this.anchor.y);
      if (Math.max(dx, dy) < DECIDE_PX) return { ...this.anchor };
      this.axis = dx >= dy ? "x" : "y";
    }
    return this.axis === "x" ? { x, y: this.anchor.y } : { x: this.anchor.x, y };
  }

  /** The axis held, or null before one is decided or with Shift up. */
  get locked(): Axis | null {
    return this.axis;
  }
}
