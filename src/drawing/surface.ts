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
 *
 * ## Three things that are about cost rather than about drawing
 *
 * **The dirty region is what gets uploaded.** That is the cost model behind
 * every decision in this file (Hush's delta #31): fully dirtying a visible
 * canvas of four thousand pixels a side is a couple of hundred milliseconds
 * of upload however cheap the drawing that dirtied it was. So the live canvas
 * clears only the rectangle it last painted into, and the done canvas is not
 * cleared at all when a stroke is merely *added* to it.
 *
 * **A stroke added is not a layer repainted.** `apply` does Hush's identity
 * diff: when the new stroke list is the old one with something on the end —
 * which is what finishing a stroke gives — only the new strokes are stamped,
 * over ink that is already there. Anything else re-bakes. Without that, every
 * completed stroke re-laid every stroke on the layer, which is quadratic in
 * the number of strokes and is exactly what "it gets slow after the first few"
 * describes.
 *
 * **The live canvas holds nothing while nobody is drawing.** It is the same
 * size as the done canvas — up to 4096², which is 67 MB of backing store —
 * and it is empty except during a gesture. Hush's delta #39: it stays 1 × 1
 * until a drawing tool is picked, and is handed back when one is put down.
 * Keyed on the *tool* rather than on the first stamp, because assigning
 * `canvas.width` reallocates the backing store and doing that inside a
 * gesture drops the gesture.
 */

import type { Stroke } from "../lib/types";
import type { AtlasCache } from "./atlas";
import { boxesOverlap, strokeBox } from "./geometry";
import { renderStroke } from "./render";
import type { Bounds } from "./types";

/**
 * Artwork to bake under the ink: the picture, and where it goes in the world.
 *
 * See `Surface.backdrop` for what it is for.
 */
export interface Backdrop {
  image: CanvasImageSource;
  box: Bounds;
  /** False for a pixel-art project, where a smoothed enlargement is a smudge. */
  smooth: boolean;
}

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
/** Backing pixels of slack around a cleared rectangle, for rounding. */
const CLEAR_PAD = 2;

export class Surface {
  readonly root: HTMLElement;

  private readonly stage: HTMLElement;
  private readonly done: HTMLCanvasElement;
  private readonly doneCtx: CanvasRenderingContext2D;
  private readonly live: HTMLCanvasElement;
  private readonly liveCtx: CanvasRenderingContext2D;
  private readonly atlas: AtlasCache;

  /** World rect the backing covers, and the zoom its ink was baked at. */
  private anchorX = 0;
  private anchorY = 0;
  private worldSize = 0;
  private bakeZoom = 1;
  private pixels = 0;

  /**
   * The stroke list the done canvas currently holds, by identity.
   *
   * What `apply` diffs against. A sentinel empty array rather than null, so
   * the append test has something to compare lengths with on the first pass.
   */
  private painted: readonly Stroke[] = [];

  /**
   * Whether the live canvas has a backing store — see the note at the top.
   *
   * False is 1 × 1, on which every `clearRect` is a correct no-op and a
   * `drawImage` would land nowhere. Nothing paints into it without going
   * through `beginLive`, which is what makes that safe.
   */
  private liveBacked = false;
  /**
   * The rectangle the live canvas was last painted into, in backing pixels,
   * or null for "the whole thing" — which is what a caller that did not say
   * gets, and what a resize leaves behind.
   */
  private liveDirty: Bounds | null = null;

  /**
   * Artwork baked **under** the ink, in world units.
   *
   * One user: PSD Edit mode, which puts the layer being drawn into here and
   * turns the canvas's own copy of it off. Two reasons, and the second is the
   * one that matters. It stops the mode showing a picture the ink is merely
   * *over* — and it means an eraser has something to erase. A brush turned
   * round composites `destination-out`, which against a canvas holding only
   * this session's ink takes out this session's ink and nothing else; with
   * the artwork underneath, the same stroke cuts the artwork, exactly as the
   * cut `psd_paint::cut` will make when Apply lands. The preview and the
   * result are then the same arithmetic rather than two descriptions of it.
   */
  private backdrop: Backdrop | null = null;
  /**
   * An erase gesture in flight, previewed on the **baked** canvas.
   *
   * Every other tool previews on the live canvas, which sits over the baked
   * one. An eraser cannot: `destination-out` into a canvas that holds nothing
   * takes nothing out and shows nothing, and a hole in an upper layer only
   * reveals the layer below it. So an erase in progress is drawn into `done`
   * itself, over the pixels it is actually taking away, and what it took is
   * put back before the next frame re-lays it — the same "re-lay the whole
   * mark every frame" the live canvas's callers already do, against a backup
   * of the rectangle the mark covers rather than a clear.
   *
   * The backup is the mark's own rectangle, not the backing: a stroke covers
   * a few hundred pixels of a canvas that is four thousand across.
   */
  private erasing: { canvas: HTMLCanvasElement; rect: Bounds | null } | null =
    null;

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

  /**
   * Put artwork under the ink, or take it away.
   *
   * A re-bake either way, because what is baked is wrong the moment this
   * changes — and it is a mode opening or closing, which is nowhere near a
   * gesture.
   */
  setBackdrop(backdrop: Backdrop | null, strokes: readonly Stroke[]): void {
    // By identity, and that is what makes it safe to push on every document
    // change: the mode holds one record for the life of a session, so the
    // common call is "still that one" and costs a comparison.
    if (backdrop === this.backdrop) return;
    this.backdrop = backdrop;
    this.repaint(strokes);
  }

  /**
   * Whether the surface takes pointer events — set by the active tool.
   *
   * And the moment the live canvas is backed or handed back. A tool being
   * picked or put down is a button press, which is nowhere near a gesture;
   * backing it on the first stamp instead would put a 67 MB reallocation
   * *inside* the stroke, which is measurably enough to drop it.
   */
  setInteractive(interactive: boolean): void {
    this.root.classList.toggle("active", interactive);
    if (interactive) this.backLive();
    else this.releaseLive();
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

  /**
   * Bring the backing in line with a stroke list, doing the least that will.
   *
   * Three answers, in the order they are cheap. The same array is nothing at
   * all — which is the common case, because the document fires a change for
   * every edit anywhere in it and almost none of them are ink. A list that
   * extends the painted one is stamped from where it left off, over what is
   * already there. Anything else — an erase, an undo, a layer switch — is a
   * re-bake.
   *
   * The append test is a reference walk over the shared prefix and nothing
   * deeper. It can be that shallow because of the hard rule the whole
   * document keeps: a stroke is replaced rather than written through, so two
   * strokes that are the same object are the same stroke.
   */
  apply(strokes: readonly Stroke[]): void {
    if (strokes === this.painted) return;
    if (this.pixels === 0) {
      this.repaint(strokes);
      return;
    }
    const added = appended(this.painted, strokes);
    if (!added) {
      this.repaint(strokes);
      return;
    }
    if (added.length > 0) {
      this.applyWorldTransform(this.doneCtx);
      const visible = this.backingBounds();
      for (const stroke of added) {
        const box = strokeBox(stroke);
        if (box && !boxesOverlap(box, visible)) continue;
        renderStroke(this.doneCtx, stroke, this.atlas);
      }
      this.doneCtx.setTransform(1, 0, 0, 1, 0, 0);
    }
    this.painted = strokes;
  }

  /** Re-lay every stroke. Called when the ink itself changes. */
  repaint(strokes: readonly Stroke[]): void {
    if (this.pixels === 0) {
      if (this.view.width === 0) return;
      this.reanchor(this.view, strokes);
      this.present();
      return;
    }

    // A re-bake is the baked state, so any backup taken before it describes
    // nothing — see `restoreErased`.
    if (this.erasing) this.erasing.rect = null;
    this.clearAll(this.doneCtx);
    this.applyWorldTransform(this.doneCtx);
    this.layBackdrop();
    const visible = this.backingBounds();
    for (const stroke of strokes) {
      const box = strokeBox(stroke);
      if (box && !boxesOverlap(box, visible)) continue;
      renderStroke(this.doneCtx, stroke, this.atlas);
    }
    this.doneCtx.setTransform(1, 0, 0, 1, 0, 0);
    this.painted = strokes;
  }

  /**
   * Show an in-flight erase on the baked canvas.
   *
   * `box` is the mark's world bounds, and what comes back is a context
   * carrying the world transform — `beginLive`'s shape, so a caller swaps one
   * for the other and draws the same mark.
   *
   * Everything laid into it is put back at the start of the next frame and by
   * `endErase`, so a caller re-lays its whole mark every frame exactly as it
   * would on the live canvas. What lands for real is the stroke going into the
   * document afterwards, through `apply`.
   */
  beginErase(box: Bounds): CanvasRenderingContext2D {
    this.restoreErased();
    if (this.pixels === 0) return this.doneCtx;
    const held = this.erasing ?? { canvas: document.createElement("canvas"), rect: null };
    this.erasing = held;

    // The mark's rectangle in backing pixels, clamped to the backing: a stroke
    // run off the edge has nothing out there to put back.
    const want = this.toBacking(box);
    const x = Math.max(0, Math.floor(want.x));
    const y = Math.max(0, Math.floor(want.y));
    const right = Math.min(this.pixels, Math.ceil(want.x + want.width));
    const bottom = Math.min(this.pixels, Math.ceil(want.y + want.height));
    const width = right - x;
    const height = bottom - y;

    if (width > 0 && height > 0) {
      // Grown in steps, because the rectangle grows with the stroke and
      // assigning `canvas.width` reallocates the backing store every time.
      const step = (n: number) => Math.min(this.pixels, Math.ceil(n / 256) * 256);
      if (held.canvas.width < width || held.canvas.height < height) {
        held.canvas.width = Math.max(held.canvas.width, step(width));
        held.canvas.height = Math.max(held.canvas.height, step(height));
      }
      const backup = held.canvas.getContext("2d");
      if (backup) {
        backup.clearRect(0, 0, width, height);
        backup.drawImage(this.done, x, y, width, height, 0, 0, width, height);
        held.rect = { x, y, width, height };
      }
    } else {
      held.rect = null;
    }

    this.applyWorldTransform(this.doneCtx);
    return this.doneCtx;
  }

  /** Done laying this frame's mark — the counterpart to `endLive`. */
  endEraseFrame(): void {
    this.doneCtx.setTransform(1, 0, 0, 1, 0, 0);
  }

  /** Put the baked canvas back as it was, and forget the gesture. */
  endErase(): void {
    this.restoreErased();
    this.erasing = null;
  }

  /**
   * Undo the last previewed frame, if there is one to undo.
   *
   * Also what `repaint` calls: a re-bake writes the baked state from the
   * strokes themselves, so a backup taken before it is not a backup of
   * anything any more and putting it back would restore ink that has gone.
   */
  private restoreErased(): void {
    const held = this.erasing;
    if (!held?.rect) return;
    const { x, y, width, height } = held.rect;
    this.doneCtx.setTransform(1, 0, 0, 1, 0, 0);
    this.doneCtx.clearRect(x, y, width, height);
    this.doneCtx.drawImage(held.canvas, 0, 0, width, height, x, y, width, height);
    held.rect = null;
  }

  /** Put the live context into world coordinates, cleared and ready. */
  beginLive(): CanvasRenderingContext2D {
    this.backLive();
    this.clearLiveDirty();
    this.applyWorldTransform(this.liveCtx);
    return this.liveCtx;
  }

  /**
   * Done painting, and here is where the paint went.
   *
   * `bounds` is in world units and is what the *next* clear will cover, so a
   * caller that knows its own extent — every tool does; a stroke's points, a
   * lasso's polygon, the eraser's disc — spares the surface a full-surface
   * clear per frame. Omitting it is safe and says "clear the lot".
   */
  endLive(bounds?: Bounds): void {
    this.liveCtx.setTransform(1, 0, 0, 1, 0, 0);
    this.liveDirty =
      bounds && this.worldSize > 0 ? this.toBacking(bounds) : null;
  }

  clearLive(): void {
    this.clearLiveDirty();
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

  /**
   * The other direction, for chrome that has to stand beside something drawn
   * in world units — the floating bar over a half-built fill.
   *
   * Relative to this surface's own top-left, which is the canvas column's:
   * the surface is `inset: 0` inside it, so the two agree.
   */
  worldToScreen(worldX: number, worldY: number): { x: number; y: number } {
    return {
      x: (worldX - this.view.originX) * this.view.zoom,
      y: (worldY - this.view.originY) * this.view.zoom,
    };
  }

  /** How many CSS pixels one world unit covers. */
  get screenPerWorldUnit(): number {
    return this.view.zoom;
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
      // so it is only touched when the size has genuinely changed — Hush's
      // delta #27, where the pointless reallocation measured most of a second
      // of IOSurface churn on an iPad.
      this.pixels = pixels;
      this.size(this.done, pixels, dpr);
      // And the live canvas only when it is holding something. Sizing an
      // unbacked one here would allocate the very megabytes the sentinel
      // exists to avoid.
      if (this.liveBacked) this.size(this.live, pixels, dpr);
    }
    // Whether or not the pixels moved: the rectangle is remembered in
    // *backing* coordinates, and re-anchoring is the world→backing mapping
    // changing under it. Clearing a stale one would leave ink behind.
    this.liveDirty = null;

    this.repaint(strokes);
  }

  /**
   * The artwork, under everything, in the world transform already applied.
   *
   * Nothing is clipped to the backing here: `drawImage` with a destination
   * rectangle does its own clipping, and the whole point of the backing is
   * that it covers rather more world than fits on the screen.
   */
  private layBackdrop(): void {
    if (!this.backdrop) return;
    const { image, box, smooth } = this.backdrop;
    const held = this.doneCtx.imageSmoothingEnabled;
    // A pixel-art project's artwork is pixels, and a smoothed one is a smudge
    // that happens to be the right size — the same call `paint-render.ts`
    // makes about a pattern.
    this.doneCtx.imageSmoothingEnabled = smooth;
    this.doneCtx.drawImage(image, box.x, box.y, box.width, box.height);
    this.doneCtx.imageSmoothingEnabled = held;
  }

  private size(el: HTMLCanvasElement, pixels: number, dpr: number): void {
    el.width = pixels;
    el.height = pixels;
    el.style.width = `${pixels / dpr}px`;
    el.style.height = `${pixels / dpr}px`;
  }

  /** Give the live canvas a backing store, if it has not got one. */
  private backLive(): void {
    if (this.liveBacked || this.pixels === 0) return;
    this.liveBacked = true;
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    this.size(this.live, this.pixels, dpr);
    this.liveDirty = null;
  }

  /**
   * Hand the backing store back.
   *
   * A 1 × 1 canvas, which is the same sentinel the size pass reads. Every
   * other site that touches the live context is a clear, and a clear on a
   * 1 × 1 canvas is a correct no-op — which is what keeps this from needing a
   * guard anywhere else.
   */
  private releaseLive(): void {
    if (!this.liveBacked) return;
    this.liveBacked = false;
    this.live.width = 1;
    this.live.height = 1;
    this.live.style.width = "1px";
    this.live.style.height = "1px";
    this.liveDirty = null;
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

  /** A world rectangle as backing pixels, grown for rounding and clamped. */
  private toBacking(bounds: Bounds): Bounds {
    const scale = this.pixels / this.worldSize;
    const x = (bounds.x - this.anchorX) * scale - CLEAR_PAD;
    const y = (bounds.y - this.anchorY) * scale - CLEAR_PAD;
    const width = bounds.width * scale + CLEAR_PAD * 2;
    const height = bounds.height * scale + CLEAR_PAD * 2;
    return { x, y, width, height };
  }

  private clearAll(ctx: CanvasRenderingContext2D): void {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.pixels, this.pixels);
  }

  /**
   * Clear what the live canvas was last painted into, and only that.
   *
   * The whole point of tracking the rectangle: a stroke covers a few hundred
   * pixels of a four-thousand-pixel canvas, and the upload that follows a
   * clear is charged on the region dirtied rather than on the region that
   * held anything.
   */
  private clearLiveDirty(): void {
    const ctx = this.liveCtx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const rect = this.liveDirty;
    if (!rect) {
      ctx.clearRect(0, 0, this.live.width, this.live.height);
      return;
    }
    ctx.clearRect(rect.x, rect.y, rect.width, rect.height);
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

/**
 * The strokes `next` has that `before` did not, or null if it is not simply
 * `before` with something on the end.
 *
 * Identity and nothing deeper — see `apply`. Returns an empty array for a
 * list that merely re-wraps the same strokes, which is what an erase drag's
 * commit hands over and which correctly bakes nothing.
 */
function appended(
  before: readonly Stroke[],
  next: readonly Stroke[],
): Stroke[] | null {
  if (next.length < before.length) return null;
  for (let i = 0; i < before.length; i++) {
    if (before[i] !== next[i]) return null;
  }
  return next.slice(before.length);
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
