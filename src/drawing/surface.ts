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
 * everything else is a transform. A re-anchor for a pan slides the baked
 * pixels and draws only the strips that uncovers (`backing-slide.ts`); one
 * for a change of zoom or size re-bakes what is visible. Both go through a
 * spare canvas and a swap (`done-pair.ts`), never a full write to the canvas
 * on screen — see Docs/drawing.md, "What a pan costs, on WebKit's terms".
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
import { appended, boxesOverlap, strokeBox } from "./geometry";
import { renderStroke } from "./render";
import { PixelBackup } from "./pixel-backup";
import { redrawStrips, stripsFor } from "./backing-slide";
import { DonePair } from "./done-pair";
import { LiveLayer } from "./live-layer";
import type { Bounds } from "./types";
import { screenToWorld, worldToScreen, type Viewport } from "./viewport";

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

export type { Viewport } from "./viewport";

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
  /** The baked canvas and its spare — see `done-pair.ts`. */
  private readonly pair = new DonePair();
  /** The live canvas and the tail over it — see `live-layer.ts`. */
  private readonly live = new LiveLayer();
  private readonly atlas: AtlasCache;

  /** World rect the backing covers, and the zoom its ink was baked at. */
  private anchorX = 0;
  private anchorY = 0;
  private worldSize = 0;
  private bakeZoom = 1;
  private pixels = 0;
  private dpr = 1;

  /**
   * The stroke list the done canvas currently holds, by identity.
   *
   * What `apply` diffs against. A sentinel empty array rather than null, so
   * the append test has something to compare lengths with on the first pass.
   */
  private painted: readonly Stroke[] = [];

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
   * An erase gesture in flight, previewed on the **baked** canvas: a hole in
   * the live canvas over it would only reveal the canvas below. What it cut
   * last frame is put back from here before the next frame cuts again — the
   * mark's own rectangle, not the backing. See `beginErase`.
   */
  private erasing: PixelBackup | null = null;
  /** Whether the backdrop is on the canvas, and whether a resize just wiped it. */
  private backdropShown = false;
  private resized = false;

  // See `generation`; inside `adoptAppend`; an eraser in flight has cut into
  // the done canvas (`continueDone`), so a pan has to re-bake, not slide.
  private generationValue = 0;
  private adopting = false;
  private cutting = false;

  private view: Viewport = {
    originX: 0,
    originY: 0,
    zoom: 1,
    width: 0,
    height: 0,
  };

  constructor(atlas: AtlasCache) {
    this.atlas = atlas;

    this.stage = document.createElement("div");
    this.stage.className = "draw-stage";
    this.stage.append(...this.pair.els, this.live.el);

    this.root = document.createElement("div");
    this.root.className = "draw-surface";
    this.root.appendChild(this.stage);

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
    if (interactive) this.live.back(this.pixels, this.dpr);
    else this.live.release();
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
    if (this.adopting && added.length === 1) {
      this.adopting = false;
      this.painted = strokes;
      return;
    }
    if (added.length > 0) {
      this.applyWorldTransform(this.doneCtx);
      this.layStrokes(this.doneCtx, added, [this.backingBounds()]);
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
    // A re-anchor comes through here too, so this one count covers both ways
    // the pixels stop meaning what they meant — see `generation`.
    this.generationValue++;
    this.cutting = false;

    // A re-bake is the baked state, so any backup taken before it describes
    // nothing — see `restoreErased`.
    this.erasing?.drop();
    // Nothing on it and nothing to put on it — a plan nobody drew, a layer
    // with no ink — costs nothing, not a clear of four thousand pixels.
    // A resize wipes the canvas, so it is blank after one whatever it held.
    const blank = (this.painted.length === 0 && !this.backdropShown) || this.resized;
    this.resized = false;
    this.backdropShown = this.backdrop !== null;
    this.painted = strokes;
    if (blank && strokes.length === 0 && !this.backdrop) return;
    // Aside and swapped in, so the canvas on screen is never fully dirtied.
    this.pair.paintAside((ctx) => {
      this.applyWorldTransform(ctx);
      this.layBackdrop(ctx);
      this.layStrokes(ctx, strokes, [this.backingBounds()]);
    });
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
    this.erasing ??= new PixelBackup();
    // The mark's rectangle in backing pixels, clamped to the backing: a stroke
    // run off the edge has nothing out there to put back.
    this.erasing.take(this.pair.canvas, this.backingRect(box));
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
    this.erasing?.restore(this.doneCtx);
  }

  /**
   * Bumped whenever the done canvas is re-laid from the strokes, which a
   * re-anchor does too after moving the world under both canvases. A stroke
   * that keeps its pixels between frames (`live-ink.ts`) lays itself again
   * from the beginning when it changes.
   */
  get generation(): number {
    return this.generationValue;
  }

  /** `beginLive` without the clear, for `live-ink.ts`. Close it with `endLive`. */
  continueLive(): CanvasRenderingContext2D {
    this.live.back(this.pixels, this.dpr);
    this.live.touched();
    this.applyWorldTransform(this.live.ctx);
    return this.live.ctx;
  }

  /** A world box as whole backing pixels, clamped to the backing; null if off it. */
  backingRect(box: Bounds): Bounds | null {
    if (this.pixels === 0) return null;
    const want = this.toBacking(box);
    const x = Math.max(0, Math.floor(want.x));
    const y = Math.max(0, Math.floor(want.y));
    const right = Math.min(this.pixels, Math.ceil(want.x + want.width));
    const bottom = Math.min(this.pixels, Math.ceil(want.y + want.height));
    if (right <= x || bottom <= y) return null;
    return { x, y, width: right - x, height: bottom - y };
  }

  /**
   * The opacity a stroke in flight is shown at. A translucent one is stamped
   * opaque and shown through this, which is the picture `composited` makes
   * of it — one alpha over the finished mark — without flattening the whole
   * mark every frame. Back to 1 when the stroke is over, by whoever set it.
   */
  setInkOpacity(opacity: number): void {
    this.live.setOpacity(opacity);
  }

  /**
   * The tail canvas over `box`, cleared, in world coordinates — see
   * `tail-canvas.ts`. Null clears it and hands nothing back.
   */
  beginTail(box: Bounds | null): CanvasRenderingContext2D | null {
    const scale = this.pixels / this.worldSize;
    const rect = box ? this.backingRect(box) : null;
    return this.live.beginTail(rect, scale, this.anchorX, this.anchorY, this.dpr);
  }

  /** The done canvas in world coordinates, for `live-ink.ts`'s eraser. Close with `endEraseFrame`. */
  continueDone(): CanvasRenderingContext2D {
    this.cutting = true;
    this.applyWorldTransform(this.doneCtx);
    return this.doneCtx;
  }

  /**
   * Run `add`, which appends a stroke whose mark the done canvas already
   * carries — an erase cut a frame at a time — so the append is recorded as
   * painted rather than cut a second time. If nothing was appended, because a
   * locked layer turned the stroke away, the cut is in the canvas and not in
   * the document, and only a re-bake takes it back out.
   */
  adoptAppend(add: () => void, strokes: () => readonly Stroke[]): void {
    this.adopting = true;
    this.cutting = false;
    try {
      add();
    } finally {
      if (this.adopting) {
        this.adopting = false;
        this.repaint(strokes());
      }
    }
  }

  /** Put the live context into world coordinates, cleared and ready. */
  beginLive(): CanvasRenderingContext2D {
    this.live.back(this.pixels, this.dpr);
    this.live.clear();
    this.applyWorldTransform(this.live.ctx);
    return this.live.ctx;
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
    this.live.painted(bounds && this.worldSize > 0 ? this.toBacking(bounds) : null);
  }

  clearLive(): void {
    this.live.clear();
    this.live.clearTail();
  }

  /** One world unit, in the CSS pixels the live layer is drawn with. */
  get worldPerScreenPixel(): number {
    return 1 / Math.max(0.0001, this.view.zoom);
  }

  screenToWorld(screenX: number, screenY: number): { x: number; y: number } {
    return screenToWorld(this.view, screenX, screenY);
  }

  /**
   * The other direction, for chrome that has to stand beside something drawn
   * in world units — the floating bar over a half-built fill.
   *
   * Relative to this surface's own top-left, which is the canvas column's:
   * the surface is `inset: 0` inside it, so the two agree.
   */
  worldToScreen(worldX: number, worldY: number): { x: number; y: number } {
    return worldToScreen(this.view, worldX, worldY);
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
    // A pan over a canvas holding just the baked strokes slides rather than
    // re-bakes (`backing-slide.ts`); a cut in flight or a new scale re-bakes.
    const slides =
      pixels === this.pixels &&
      dpr === this.dpr &&
      view.zoom === this.bakeZoom &&
      strokes === this.painted &&
      !this.cutting &&
      !this.erasing?.rect;
    const was = { x: this.anchorX, y: this.anchorY };

    this.bakeZoom = view.zoom;
    this.dpr = dpr;
    this.worldSize = pixels / (dpr * this.bakeZoom);
    // Centre the covered rect on the middle of what the camera can see.
    this.anchorX = view.originX + view.width / view.zoom / 2 - this.worldSize / 2;
    this.anchorY = view.originY + view.height / view.zoom / 2 - this.worldSize / 2;
    // A slide moves whole pixels, so the anchor moves by whole pixels too.
    const scale = pixels / this.worldSize;
    const [dx, dy] = [was.x - this.anchorX, was.y - this.anchorY].map((d) => Math.round(d * scale));
    if (slides) {
      this.anchorX = was.x - dx / scale;
      this.anchorY = was.y - dy / scale;
    }

    if (pixels !== this.pixels) {
      // Assigning width always clears and may reallocate the backing store,
      // so it is only touched when the size has genuinely changed — Hush's
      // delta #27, where the pointless reallocation measured most of a second
      // of IOSurface churn on an iPad.
      this.pixels = pixels;
      this.pair.size(pixels, dpr);
      this.resized = true;
      // And the live canvas only when it is holding something. Sizing an
      // unbacked one here would allocate the very megabytes the sentinel
      // exists to avoid.
      this.live.resize(pixels, dpr);
    }
    // Whether or not the pixels moved: the rectangle is remembered in
    // *backing* coordinates, and re-anchoring is the world→backing mapping
    // changing under it. Clearing a stale one would leave ink behind.
    this.live.forgetDirty();

    if (slides && Math.abs(dx) < pixels && Math.abs(dy) < pixels) {
      this.slideBy(dx, dy, strokes);
    } else {
      this.repaint(strokes);
    }
  }

  /** Move the baked pixels and draw what the move uncovered — `backing-slide.ts`. */
  private slideBy(dx: number, dy: number, strokes: readonly Stroke[]): void {
    // What was drawn against the old anchor is somewhere else now.
    this.generationValue++;
    // A blank canvas moved is the same blank canvas.
    if (strokes.length === 0 && !this.backdropShown) return;
    this.pair.shift(dx, dy);
    const world = { x: this.anchorX, y: this.anchorY, scale: this.pixels / this.worldSize };
    const ctx = this.doneCtx;
    redrawStrips(ctx, stripsFor(this.pixels, dx, dy), world, (reach) => {
      this.applyWorldTransform(ctx);
      this.layBackdrop(ctx);
      this.layStrokes(ctx, strokes, reach);
    });
  }

  /** Stamp the strokes that reach into any of `within`, in order. */
  private layStrokes(
    ctx: CanvasRenderingContext2D,
    strokes: readonly Stroke[],
    within: readonly Bounds[],
  ): void {
    for (const stroke of strokes) {
      const box = strokeBox(stroke);
      if (box && !within.some((r) => boxesOverlap(box, r))) continue;
      renderStroke(ctx, stroke, this.atlas);
    }
  }

  /** The baked canvas on screen — resolved each time, because a swap moves it. */
  private get doneCtx(): CanvasRenderingContext2D {
    return this.pair.ctx;
  }


  /**
   * The artwork, under everything, in the world transform already applied.
   *
   * Nothing is clipped to the backing here: `drawImage` with a destination
   * rectangle does its own clipping, and the whole point of the backing is
   * that it covers rather more world than fits on the screen.
   */
  private layBackdrop(ctx: CanvasRenderingContext2D): void {
    if (!this.backdrop) return;
    const { image, box, smooth } = this.backdrop;
    const held = ctx.imageSmoothingEnabled;
    // A pixel-art project's artwork is pixels, and a smoothed one is a smudge
    // that happens to be the right size — the same call `paint-render.ts`
    // makes about a pattern.
    ctx.imageSmoothingEnabled = smooth;
    ctx.drawImage(image, box.x, box.y, box.width, box.height);
    ctx.imageSmoothingEnabled = held;
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
