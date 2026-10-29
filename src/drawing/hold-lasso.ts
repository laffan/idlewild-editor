/**
 * Press and hold to lasso, from whatever tool is in hand.
 *
 * Hush's gesture, on both of the drawing layers here — the scene's ink and
 * the plan. **The pen tip held still** where a stroke begins, for half a
 * second, throws the stroke away and turns the same contact into a lasso:
 * keep the tip down and sweep round what you want. **A finger held still**
 * does the same a little sooner, since a finger draws nothing else and a
 * finger that moves first is a pan.
 *
 * The Lasso is **borrowed**, not picked up. The tool is given back the moment
 * the pen next touches somewhere other than the selection's box — that
 * contact draws, as if nothing had happened — when a finger taps the surface,
 * or straight away when the loop caught nothing. A tool picked from the bar
 * meanwhile simply replaces it. See `DrawingLayer` for where each of those
 * is heard.
 *
 * Only where a still hold means nothing else: PSD Edit mode spends it on
 * straightening a stroke (`DrawOptions.straightenAfterMs`), and that is left
 * as it is.
 *
 * This file is the timer. Distances are in screen pixels, because the
 * tolerance that matters is how still a hand can hold, whatever the zoom.
 */

import type { DrawingTool } from "./types";

/** How long the pen has to stay still at the start of a stroke. Hush's. */
export const PEN_HOLD_MS = 500;
/** And a finger, which draws nothing and so can be read sooner. Hush's. */
export const FINGER_HOLD_MS = 400;
/** How far the pen may stray and still be holding, in screen px. */
export const PEN_SLOP_PX = 4;
/** And a finger, which is not a fine point. Past this it is a pan. */
export const FINGER_SLOP_PX = 8;
/** How long a finger may be down and still be a tap. */
export const TAP_MS = 300;

/** The tools whose stroke a held pen turns into a lasso. */
export const PEN_HOLD_TOOLS: ReadonlySet<DrawingTool | null> = new Set<DrawingTool | null>([
  "pencil",
  "pattern",
  "eraser",
]);

/** One pending hold: a pointer, where it went down, and what to do. */
export class Hold {
  private timer: number | null = null;
  private pointer: number | null = null;
  private x = 0;
  private y = 0;
  private slop = 0;

  /** Start waiting on `pointerId`; `fire` runs if it stays within `slop`. */
  arm(event: PointerEvent, ms: number, slop: number, fire: () => void): void {
    this.disarm();
    this.pointer = event.pointerId;
    this.x = event.clientX;
    this.y = event.clientY;
    this.slop = slop;
    this.timer = window.setTimeout(() => {
      this.timer = null;
      this.pointer = null;
      fire();
    }, ms);
  }

  /** A pointer moved: a hold it was waiting on ends once it strays. */
  move(event: PointerEvent): void {
    if (event.pointerId !== this.pointer) return;
    if (Math.hypot(event.clientX - this.x, event.clientY - this.y) > this.slop) {
      this.disarm();
    }
  }

  /** Whether this is still waiting on `pointerId`. */
  waiting(pointerId: number): boolean {
    return this.timer !== null && this.pointer === pointerId;
  }

  disarm(): void {
    if (this.timer !== null) window.clearTimeout(this.timer);
    this.timer = null;
    this.pointer = null;
  }
}
