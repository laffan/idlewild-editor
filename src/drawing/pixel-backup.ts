/**
 * A rectangle of a canvas, put aside and put back.
 *
 * Two things preview a mark by drawing it into pixels they then have to
 * return: the erase preview, which cuts into the baked canvas and puts the
 * cut back before the next frame cuts again (`Surface.beginErase`), and the
 * tail of a stroke drawn a frame at a time, which is the only part of it
 * still moving (`live-ink.ts`). Both hold a rectangle in backing pixels.
 *
 * The holding canvas grows in 256-pixel steps and never shrinks: the
 * rectangle grows as a stroke does, and assigning `canvas.width`
 * reallocates the backing store every time it is touched.
 */

import type { Bounds } from "./types";

const STEP = 256;

export class PixelBackup {
  private canvas: HTMLCanvasElement | null = null;
  /** What is held, in the source's backing pixels; null when nothing is. */
  private held: Bounds | null = null;

  /** Copy `rect` of the source aside, in place of whatever was held. */
  take(source: CanvasImageSource, rect: Bounds | null): void {
    this.held = null;
    if (!rect) return;
    const { x, y, width, height } = rect;
    if (!this.canvas) this.canvas = document.createElement("canvas");
    const canvas = this.canvas;
    if (canvas.width < width || canvas.height < height) {
      canvas.width = Math.max(canvas.width, Math.ceil(width / STEP) * STEP);
      canvas.height = Math.max(canvas.height, Math.ceil(height / STEP) * STEP);
    }
    const backup = canvas.getContext("2d");
    if (!backup) return;
    backup.clearRect(0, 0, width, height);
    backup.drawImage(source, x, y, width, height, 0, 0, width, height);
    this.held = rect;
  }

  /**
   * Put what is held back where it came from, and forget it. Leaves the
   * target at the identity transform, which is the one this is drawn in.
   */
  restore(target: CanvasRenderingContext2D): void {
    const rect = this.held;
    if (!rect || !this.canvas) return;
    const { x, y, width, height } = rect;
    target.setTransform(1, 0, 0, 1, 0, 0);
    target.clearRect(x, y, width, height);
    target.drawImage(this.canvas, 0, 0, width, height, x, y, width, height);
    this.held = null;
  }

  /** The rectangle held, if any. */
  get rect(): Bounds | null {
    return this.held;
  }

  /** Forget what is held without putting it back — the pixels under it moved. */
  drop(): void {
    this.held = null;
  }
}
