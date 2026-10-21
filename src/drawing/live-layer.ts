/**
 * The live canvas — where a gesture in flight is drawn — and the small tail
 * canvas over it, in the one group a stroke's opacity is set on.
 *
 * Everything here is about not paying for pixels nobody needs, because on
 * WebKit a visible canvas costs its dirtied region in upload at every commit:
 *
 * - **Backed only while a drawing tool is up** (Hush #39). It is the size of
 *   the baked canvas — up to 4096², 67 MB — and holds nothing between
 *   gestures. 1 × 1 otherwise, on which every clear is a correct no-op.
 * - **Cleared only where it was painted.** Each tool says where it drew;
 *   the next clear covers that rectangle rather than the whole surface.
 * - **Not cleared at all when it holds nothing** (Hush #28). A re-anchor
 *   forgets the rectangle, because it is in backing pixels and the mapping
 *   just moved — so without this the first clear after every pan was the
 *   whole four-thousand-pixel canvas, about a quarter of a second.
 */

import type { Bounds } from "./types";
import { sizeCanvas } from "./done-pair";
import { context, stageCanvas, TailCanvas } from "./tail-canvas";

export class LiveLayer {
  /** The group: the live canvas and the tail over it. */
  readonly el: HTMLElement;
  readonly ctx: CanvasRenderingContext2D;
  private readonly canvas: HTMLCanvasElement;
  private readonly tail = new TailCanvas();
  private backed = false;
  /** Last painted, in backing pixels; null is "the whole thing". */
  private dirty: Bounds | null = null;
  private holds = false;

  constructor() {
    this.canvas = stageCanvas("draw-live");
    this.ctx = context(this.canvas);
    this.el = document.createElement("div");
    this.el.className = "draw-ink";
    this.el.append(this.canvas, this.tail.el);
  }

  /** Give it a backing store at this size, if it has not got one. */
  back(pixels: number, dpr: number): void {
    if (this.backed || pixels === 0) return;
    this.backed = true;
    sizeCanvas(this.canvas, pixels, dpr);
    this.dirty = null;
    this.holds = false;
  }

  /** The backing changed size: follow it, if backed. Sizing empties it. */
  resize(pixels: number, dpr: number): void {
    if (this.backed) sizeCanvas(this.canvas, pixels, dpr);
    this.holds = false;
  }

  /** Hand the backing store back — a 1 × 1 canvas. */
  release(): void {
    if (!this.backed) return;
    this.backed = false;
    sizeCanvas(this.canvas, 1, 1);
    this.dirty = null;
    this.holds = false;
    this.tail.release();
  }

  /** The world→backing mapping moved, so the rectangle means nothing now. */
  forgetDirty(): void {
    this.dirty = null;
  }

  /** It is about to be drawn into. */
  touched(): void {
    this.holds = true;
  }

  /** Done drawing; `rect` (backing pixels) is where, or null for anywhere. */
  painted(rect: Bounds | null): void {
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.holds = true;
    this.dirty = rect;
  }

  /** Clear what was last painted, and only that — or nothing, if nothing was. */
  clear(): void {
    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (!this.holds) return;
    this.holds = false;
    const rect = this.dirty;
    if (rect) ctx.clearRect(rect.x, rect.y, rect.width, rect.height);
    else ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }

  clearTail(): void {
    this.tail.clear();
  }

  /** See `Surface.setInkOpacity`. */
  setOpacity(opacity: number): void {
    this.el.style.opacity = opacity < 1 ? String(opacity) : "";
  }

  /** See `TailCanvas.begin`. */
  beginTail(
    rect: Bounds | null,
    scale: number,
    anchorX: number,
    anchorY: number,
    dpr: number,
  ): CanvasRenderingContext2D | null {
    return this.tail.begin(rect, scale, anchorX, anchorY, dpr);
  }
}
