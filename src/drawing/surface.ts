/**
 * The drawing surface: two stacked canvases in a GPU-composited stage,
 * superimposed over Phaser's canvas with their camera slaved to its.
 *
 * This is Hush's stage architecture, and it is here for Hush's reason. The
 * canvases are *not* viewport-sized and repainted as the camera moves —
 * WebKit rasterises Canvas2D on the CPU and uploads the dirty region of a
 * visible canvas at a fixed rate, so re-presenting a screenful of ink every
 * pan frame costs tens of milliseconds however cheap the drawing is. Instead
 * the ink is baked once into a canvas covering rather more world than fits
 * on screen, and a pan or a zoom is one CSS transform on the wrapper: a
 * compositor operation that touches no pixels at all.
 *
 * What the backing cannot do is cover an infinite canvas, so it follows the
 * camera. `sync` re-anchors it when the viewport drifts near an edge or the
 * zoom has moved far enough that the baked ink would show its resolution;
 * everything else is a transform. Hush's blit-forward re-anchor (its delta
 * #25), which slides the baked pixels and repaints only the newly exposed
 * strips, is the next increment — this one re-bakes what is visible.
 */

import type { Stroke } from "../lib/types";
import type { AtlasCache } from "./atlas";
import { boxesOverlap, strokeBox } from "./geometry";
import { renderStroke } from "./render";
import type { Bounds } from "./types";

/** How the world maps onto the screen: `screen = (world − origin) × zoom`. */
export interface Viewport {
  originX: number;
  originY: number;
  zoom: number;
  /** The host's size in CSS pixels. */
  width: number;
  height: number;
}

/** How much more than the viewport the backing covers. */
const COVER = 1.6;
/** Re-anchor when the viewport comes this close to a backing edge. */
const EDGE_MARGIN = 0.07;
/** Re-bake when presentation has stretched the ink past this ratio. */
const ZOOM_TOLERANCE = 1.4;
/** A hard ceiling on the backing, in device pixels per side. */
const MAX_BACKING_PX = 4096;

export class Surface {
  readonly root: HTMLElement;
  /** The in-flight stroke, the lasso path and the eraser cursor. */
  readonly liveCtx: CanvasRenderingContext2D;

  private readonly stage: HTMLElement;
  private readonly done: HTMLCanvasElement;
  private readonly doneCtx: CanvasRenderingContext2D;
  private readonly live: HTMLCanvasElement;
  private readonly atlas: AtlasCache;

  /** World rect the backing covers, and the zoom its ink was baked at. */
  private anchorX = 0;
  private anchorY = 0;
  private worldSize = 0;
  private bakeZoom = 1;
  private pixels = 0;

  private view: Viewport = {
    originX: 0,
    originY: 0,
    zoom: 1,
    width: 0,
    height: 0,
  };

  constructor(atlas: AtlasCache) {
    this.atlas = atlas;

    this.done = canvas("draw-done");
    this.live = canvas("draw-live");
    this.stage = document.createElement("div");
    this.stage.className = "draw-stage";
    this.stage.append(this.done, this.live);

    this.root = document.createElement("div");
    this.root.className = "draw-surface";
    this.root.appendChild(this.stage);

    this.doneCtx = context(this.done);
    this.liveCtx = context(this.live);
  }

  /** Whether the surface takes pointer events — set by the active tool. */
  setInteractive(interactive: boolean): void {
    this.root.classList.toggle("active", interactive);
  }

  /**
   * Follow the camera. Cheap by design: the common case writes one transform
   * and returns, and only a drift past the backing's edge or a real change
   * of scale costs a re-bake.
   */
  sync(view: Viewport, strokes: readonly Stroke[]): void {
    this.view = view;
    if (view.width === 0 || view.height === 0) return;

    if (this.needsAnchor(view)) this.reanchor(view, strokes);
    this.present();
  }

  /** Re-lay every stroke. Called when the ink itself changes. */
  repaint(strokes: readonly Stroke[]): void {
    if (this.pixels === 0) {
      if (this.view.width === 0) return;
      this.reanchor(this.view, strokes);
      this.present();
      return;
    }

    this.clear(this.doneCtx);
    this.applyWorldTransform(this.doneCtx);
    const visible = this.backingBounds();
    for (const stroke of strokes) {
      const box = strokeBox(stroke);
      if (box && !boxesOverlap(box, visible)) continue;
      renderStroke(this.doneCtx, stroke, this.atlas);
    }
    this.doneCtx.setTransform(1, 0, 0, 1, 0, 0);
  }

  /** Put the live context into world coordinates, cleared and ready. */
  beginLive(): CanvasRenderingContext2D {
    this.clear(this.liveCtx);
    this.applyWorldTransform(this.liveCtx);
    return this.liveCtx;
  }

  endLive(): void {
    this.liveCtx.setTransform(1, 0, 0, 1, 0, 0);
  }

  clearLive(): void {
    this.clear(this.liveCtx);
    this.liveCtx.setTransform(1, 0, 0, 1, 0, 0);
  }

  /** One world unit, in the CSS pixels the live layer is drawn with. */
  get worldPerScreenPixel(): number {
    return 1 / Math.max(0.0001, this.view.zoom);
  }

  screenToWorld(screenX: number, screenY: number): { x: number; y: number } {
    return {
      x: screenX / this.view.zoom + this.view.originX,
      y: screenY / this.view.zoom + this.view.originY,
    };
  }

  destroy(): void {
    this.root.remove();
  }

  // ── the backing ───────────────────────────────────────────────────────────

  private backingBounds(): Bounds {
    return {
      x: this.anchorX,
      y: this.anchorY,
      width: this.worldSize,
      height: this.worldSize,
    };
  }

  /**
   * Is the backing still good for this camera? Two ways it stops being: the
   * viewport has drifted towards an edge, or the zoom has moved far enough
   * that presenting the baked ink would visibly stretch it.
   */
  private needsAnchor(view: Viewport): boolean {
    if (this.pixels === 0) return true;

    const ratio = view.zoom / this.bakeZoom;
    if (ratio > ZOOM_TOLERANCE || ratio < 1 / ZOOM_TOLERANCE) return true;

    const margin = this.worldSize * EDGE_MARGIN;
    const left = view.originX;
    const top = view.originY;
    const right = left + view.width / view.zoom;
    const bottom = top + view.height / view.zoom;
    return (
      left < this.anchorX + margin ||
      top < this.anchorY + margin ||
      right > this.anchorX + this.worldSize - margin ||
      bottom > this.anchorY + this.worldSize - margin
    );
  }

  /**
   * Re-centre the backing on the camera and bake into it.
   *
   * The pixel budget is fixed — `viewport × COVER × dpr`, capped — and the
   * *world* size is what varies with zoom. That is what keeps the ink at
   * screen resolution however far in the user has zoomed, without the
   * backing growing without bound when they zoom out.
   */
  private reanchor(view: Viewport, strokes: readonly Stroke[]): void {
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    const longest = Math.max(view.width, view.height);
    const pixels = Math.max(
      256,
      Math.min(MAX_BACKING_PX, Math.round(longest * COVER * dpr)),
    );

    this.bakeZoom = view.zoom;
    this.worldSize = pixels / (dpr * this.bakeZoom);
    // Centre the covered rect on the middle of what the camera can see.
    this.anchorX = view.originX + view.width / view.zoom / 2 - this.worldSize / 2;
    this.anchorY = view.originY + view.height / view.zoom / 2 - this.worldSize / 2;

    if (pixels !== this.pixels) {
      // Assigning width always clears and may reallocate the backing store,
      // so it is only touched when the size has genuinely changed.
      this.pixels = pixels;
      for (const el of [this.done, this.live]) {
        el.width = pixels;
        el.height = pixels;
        el.style.width = `${pixels / dpr}px`;
        el.style.height = `${pixels / dpr}px`;
      }
    }

    this.repaint(strokes);
  }

  /** World → backing pixels, for both canvases. */
  private applyWorldTransform(ctx: CanvasRenderingContext2D): void {
    const scale = this.pixels / this.worldSize;
    ctx.setTransform(
      scale,
      0,
      0,
      scale,
      -this.anchorX * scale,
      -this.anchorY * scale,
    );
  }

  private clear(ctx: CanvasRenderingContext2D): void {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.pixels, this.pixels);
  }

  /**
   * Put the baked ink where the camera says it belongs. One transform on the
   * wrapper, so a pan never re-uploads a pixel.
   */
  private present(): void {
    const { originX, originY, zoom } = this.view;
    const scale = zoom / this.bakeZoom;
    const tx = (this.anchorX - originX) * zoom;
    const ty = (this.anchorY - originY) * zoom;
    this.stage.style.transform =
      `translate3d(${tx}px, ${ty}px, 0) scale(${scale})`;
  }
}

function canvas(className: string): HTMLCanvasElement {
  const el = document.createElement("canvas");
  el.className = className;
  el.width = 1;
  el.height = 1;
  return el;
}

function context(el: HTMLCanvasElement): CanvasRenderingContext2D {
  const ctx = el.getContext("2d");
  if (!ctx) throw new Error("The drawing layer needs a 2D canvas context");
  return ctx;
}
