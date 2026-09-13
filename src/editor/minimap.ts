/**
 * The minimap, along the bottom of the left sidebar.
 *
 * The sidebar reads as one column of questions in the order you ask them:
 * which place am I in (the scene), what is in it (the layers), and where am I
 * standing in it (this). The third one had no answer before: the canvas is
 * effectively infinite and the only way to find work you had drifted away
 * from was to pan until it came back.
 *
 * It is a plain 2D canvas rather than a second Phaser camera. What it draws
 * is the *document* — the boxes things occupy, not the artwork in them — so
 * it needs none of the texture machinery, and a second WebGL camera over the
 * same scene would cost a full render of every placement per frame to say
 * something a rectangle says.
 *
 * **The frame is a div, not paint.** A pan moves the camera every frame, and
 * the map under it has not changed: repainting a whole document to move one
 * rectangle is the kind of per-frame work this editor keeps off the main
 * thread everywhere else. So the content is baked only when the document or
 * the framing actually changes, and the camera is a positioned element over
 * the top of it — the same bargain the drawing layer's stage strikes.
 */

import { h } from "../lib/dom";
import type { DocStore } from "../lib/doc-store";
import { fillShape, type Grid } from "../lib/grid";
import { STRIDE, type Viewport } from "../drawing";
import type { FillPatch, Rect, Stroke, Zone } from "../lib/types";
import { createResizer, type Resizer } from "./resizer";
import {
  cameraRect,
  contentBounds,
  miniView,
  toWorld,
  type MiniView,
  type Size,
} from "./minimap-view";

/**
 * The canvas ground and its lattice, as `tokens.css` has them.
 *
 * Written out rather than read from the custom properties because this is a
 * canvas: every one of them would be a `getComputedStyle` on the way into a
 * paint that is trying to be cheap. The doc renderer writes its own out for
 * the same reason.
 */
const GROUND = "#d9e6ef";
const AXIS = "#a9c2d3";
/** Placed artwork, which the map has only the shape of. */
const PLACED = "rgba(68, 65, 65, 0.75)";
/** A boundary: the accent when it blocks, neutral when it does not. */
const BLOCKING = "#ec3013";
const OPEN = "#7d7979";
/** A named place, and the light it is haloed in — as on the canvas. */
const POINT = "#ec3013";
const POINT_HALO = "#f3f2f2";

/** How small a placed PSD is allowed to get on the map, in map pixels. */
const MIN_PLACED = 2;
/** And how big a point's dot is, which does not shrink at all. */
const POINT_RADIUS = 2.5;
/** A cap on the backing store, so a retina iPad does not bake four times. */
const MAX_DPR = 2;
/**
 * How many samples of a stroke are worth drawing here.
 *
 * A stroke is a few hundred points and the map is a few hundred pixels wide,
 * so past this the segments are shorter than a pixel and the line is the same
 * line drawn more slowly. The last point is always taken, so a sampled stroke
 * still ends where it ended.
 */
const STROKE_SAMPLES = 96;

export interface MinimapCallbacks {
  /** Put the camera on a world point: what a tap or a drag on the map means. */
  centreOn: (x: number, y: number) => void;
}

export class Minimap {
  readonly root: HTMLElement;

  private readonly store: DocStore;
  private readonly grid: Grid;
  private readonly callbacks: MinimapCallbacks;
  private readonly body: HTMLElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly frame: HTMLElement;
  private readonly readout: HTMLElement;
  private readonly resizer: Resizer;
  private readonly observer: ResizeObserver;

  /** Where the camera is, as the scene last published it. */
  private view: Viewport | null = null;
  /** Bumped by every document change, so a bake knows it has gone stale. */
  private revision = 0;
  /** What the baked canvas is currently of, or "" for nothing. */
  private baked = "";
  /** The content box, and the revision it was measured at. */
  private bounds: Rect | null = null;
  private boundsAt = -1;
  private raf: number | null = null;
  /**
   * The projection the map was showing when a scrub started.
   *
   * Held for the length of the gesture. Centring the camera on a tap can
   * widen the extent — that is what walking off the edge of the document
   * does — and re-fitting mid-drag would slide the map out from under the
   * finger that is driving it.
   */
  private scrub: { pointerId: number; view: MiniView } | null = null;

  constructor(store: DocStore, grid: Grid, callbacks: MinimapCallbacks) {
    this.store = store;
    this.grid = grid;
    this.callbacks = callbacks;

    this.canvas = h("canvas", { class: "minimap-canvas" });
    const ctx = this.canvas.getContext("2d");
    if (!ctx) throw new Error("The minimap needs a 2D canvas context");
    this.ctx = ctx;

    this.frame = h("div", { class: "minimap-frame" });
    this.body = h(
      "div",
      {
        class: "minimap-body",
        title: "Tap or drag to move the camera",
        onPointerDown: (event: PointerEvent) => this.beginScrub(event),
        onPointerMove: (event: PointerEvent) => this.moveScrub(event),
        onPointerUp: (event: PointerEvent) => this.endScrub(event),
        onPointerCancel: (event: PointerEvent) => this.endScrub(event),
      },
      this.canvas,
      this.frame,
    );

    this.readout = h("span", { class: "minimap-zoom m" });
    this.resizer = createResizer({
      target: this.body,
      axis: "height",
      edge: "start",
      min: 80,
      max: 420,
      storageKey: "minimapHeight",
      onResize: () => this.schedule(),
    });

    this.root = h(
      "div",
      { class: "minimap" },
      this.resizer.handle,
      h(
        "div",
        { class: "minimap-head" },
        h("div", { class: "panel-title m", text: "Minimap" }),
        this.readout,
      ),
      this.body,
    );

    store.addEventListener("change", this.onDocChanged);
    store.addEventListener("scene", this.onDocChanged);
    // The sidebar is resizable and can be folded away entirely, and either
    // changes the box the map is fitted into.
    this.observer = new ResizeObserver(() => this.schedule());
    this.observer.observe(this.body);
    this.resizer.restore();
  }

  /** Where the camera is now — the scene publishes this as it moves. */
  setViewport(view: Viewport): void {
    this.view = view;
    this.schedule();
  }

  destroy(): void {
    if (this.raf !== null) cancelAnimationFrame(this.raf);
    this.raf = null;
    this.store.removeEventListener("change", this.onDocChanged);
    this.store.removeEventListener("scene", this.onDocChanged);
    this.observer.disconnect();
    this.resizer.destroy();
  }

  private readonly onDocChanged = (): void => {
    this.revision += 1;
    this.schedule();
  };

  /** Coalesce every reason to repaint into one paint per frame. */
  private schedule(): void {
    if (this.raf !== null) return;
    this.raf = requestAnimationFrame(() => {
      this.raf = null;
      this.paint();
    });
  }

  private paint(): void {
    const box: Size = {
      width: this.body.clientWidth,
      height: this.body.clientHeight,
    };
    // A folded sidebar has no box to fit anything into, and the observer
    // brings us back the moment it has one again.
    if (!this.view || box.width <= 0 || box.height <= 0) return;

    const camera = cameraRect(this.view);
    const view = this.scrub?.view ?? miniView(this.content(), camera, box);
    if (view.scale <= 0) return;

    const key = [
      view.world.x,
      view.world.y,
      view.world.width,
      view.scale,
      box.width,
      box.height,
      this.revision,
    ].join("|");
    if (key !== this.baked) {
      this.baked = key;
      this.bake(view, box);
    }

    const scale = view.scale;
    this.frame.style.left = `${(camera.x - view.world.x) * scale}px`;
    this.frame.style.top = `${(camera.y - view.world.y) * scale}px`;
    this.frame.style.width = `${camera.width * scale}px`;
    this.frame.style.height = `${camera.height * scale}px`;
    this.readout.textContent = `${Math.round(this.view.zoom * 100)}%`;
  }

  /** The content box, measured once per document change. */
  private content(): Rect | null {
    if (this.boundsAt !== this.revision) {
      this.bounds = contentBounds(this.store.layers, this.grid);
      this.boundsAt = this.revision;
    }
    return this.bounds;
  }

  /**
   * Draw the document into the canvas.
   *
   * Everything below is in **world** coordinates: the context carries the
   * projection, so a fill's cells and a boundary's polygon are handed over
   * exactly as the document stores them. Widths are divided by the scale for
   * the reason the canvas divides them by the zoom — a hairline is a hairline
   * at any framing.
   */
  private bake(view: MiniView, box: Size): void {
    const ctx = this.ctx;
    const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
    const width = Math.max(1, Math.round(box.width * dpr));
    const height = Math.max(1, Math.round(box.height * dpr));
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = GROUND;
    ctx.fillRect(0, 0, width, height);

    const scale = view.scale * dpr;
    ctx.setTransform(
      scale,
      0,
      0,
      scale,
      -view.world.x * scale,
      -view.world.y * scale,
    );
    const px = 1 / view.scale;
    this.paintAxes(view, px);

    // Bottom layer first, so the top of the stack is what is seen — the same
    // order the canvas draws in, with the depths taken out of it.
    const layers = this.store.layers;
    for (let i = layers.length - 1; i >= 0; i--) {
      const layer = layers[i];
      if (!layer.visible) continue;
      for (const fill of layer.fills) this.paintFill(fill);
      for (const placement of layer.placements) {
        this.paintPlaced(placement, px);
      }
      for (const stroke of layer.strokes) this.paintStroke(stroke, px);
      for (const zone of layer.zones) this.paintZone(zone, px);
    }
    // Markers go over everything, as they do on the canvas: a point behind a
    // building is a point nobody can find.
    this.paintPoints(px);
  }

  /** The origin, which is the one fixed thing in a world with no bounds. */
  private paintAxes(view: MiniView, px: number): void {
    const { x, y, width, height } = view.world;
    const ctx = this.ctx;
    ctx.strokeStyle = AXIS;
    ctx.lineWidth = px;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x + width, 0);
    ctx.moveTo(0, y);
    ctx.lineTo(0, y + height);
    ctx.stroke();
  }

  /**
   * A fill, in its own colour.
   *
   * One path for all of its cells rather than one per cell: a patch is a run
   * of grid spaces and there can be thousands of them, and a single path with
   * many subpaths is what a canvas is good at.
   */
  private paintFill(fill: FillPatch): void {
    const shape = fillShape(this.grid, fill);
    if (!shape) return;
    const ctx = this.ctx;
    ctx.fillStyle = fill.color ?? BLOCKING;
    // A pattern fill draws as a tint on the canvas too, until its texture is
    // sampled — see the known gaps.
    ctx.globalAlpha = fill.kind === "pattern" ? 0.35 : 1;
    ctx.beginPath();
    for (const points of shape.polygons) {
      ctx.moveTo(points[0].x, points[0].y);
      for (let i = 1; i < points.length; i++) {
        ctx.lineTo(points[i].x, points[i].y);
      }
      ctx.closePath();
    }
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  /**
   * A placed PSD: the space it takes up.
   *
   * Never smaller than a couple of map pixels. A sprite at a low framing is a
   * fraction of a pixel and antialiases away to nothing, and a map that shows
   * nothing where there is something is worse than one that shows it roughly.
   */
  private paintPlaced(placement: Rect, px: number): void {
    const ctx = this.ctx;
    const floor = MIN_PLACED * px;
    ctx.fillStyle = PLACED;
    ctx.fillRect(
      placement.x,
      placement.y,
      Math.max(placement.width, floor),
      Math.max(placement.height, floor),
    );
  }

  private paintZone(zone: Zone, px: number): void {
    if (zone.points.length < 2) return;
    const ctx = this.ctx;
    ctx.strokeStyle = zone.blocking ? BLOCKING : OPEN;
    ctx.lineWidth = px;
    ctx.beginPath();
    ctx.moveTo(zone.points[0].x, zone.points[0].y);
    for (let i = 1; i < zone.points.length; i++) {
      ctx.lineTo(zone.points[i].x, zone.points[i].y);
    }
    ctx.closePath();
    ctx.stroke();
  }

  /**
   * A stroke, as the line it was drawn as.
   *
   * Its own colour and a hairline, rather than the brush: at this framing a
   * sketch is a shape on the map, and stamping a few hundred brush tips per
   * stroke to say so is the whole reason the drawing layer bakes.
   */
  private paintStroke(stroke: Stroke, px: number): void {
    const points = stroke.points;
    const count = Math.floor(points.length / STRIDE);
    if (count < 2) return;
    const step = STRIDE * Math.max(1, Math.ceil(count / STROKE_SAMPLES));

    const ctx = this.ctx;
    ctx.strokeStyle = stroke.color;
    ctx.lineWidth = px;
    ctx.beginPath();
    ctx.moveTo(points[0], points[1]);
    for (let i = step; i + 1 < points.length; i += step) {
      ctx.lineTo(points[i], points[i + 1]);
    }
    const last = (count - 1) * STRIDE;
    ctx.lineTo(points[last], points[last + 1]);
    ctx.stroke();
  }

  /** The named places, and a ring around the one a scene starts on. */
  private paintPoints(px: number): void {
    const ctx = this.ctx;
    const start = this.store.activeScene.startPointId;
    const radius = POINT_RADIUS * px;
    for (const layer of this.store.layers) {
      if (!layer.visible) continue;
      for (const point of layer.points) {
        const at = this.grid.cellCentre(point.cell);
        const isStart = point.id === start;
        // The halo first, then the mark over it — a red dot on a red fill is
        // not a marker, which is the canvas's own reason for the pair.
        ctx.fillStyle = POINT_HALO;
        ctx.beginPath();
        ctx.arc(at.x, at.y, radius + px, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = POINT;
        ctx.beginPath();
        ctx.arc(at.x, at.y, radius, 0, Math.PI * 2);
        ctx.fill();
        // A ring around the one the scene starts on, as on the canvas.
        if (!isStart) continue;
        ctx.strokeStyle = POINT;
        ctx.lineWidth = px;
        ctx.beginPath();
        ctx.arc(at.x, at.y, radius * 2, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
  }

  // ── moving the camera ─────────────────────────────────────────────────────

  /**
   * A press names a place: the camera goes there, keeping its zoom, and keeps
   * following until the finger comes up.
   *
   * The projection is frozen for the gesture — see `scrub`.
   */
  private beginScrub(event: PointerEvent): void {
    if (!event.isPrimary || !this.view) return;
    const box = { width: this.body.clientWidth, height: this.body.clientHeight };
    const view = miniView(this.content(), cameraRect(this.view), box);
    if (view.scale <= 0) return;

    event.preventDefault();
    this.body.setPointerCapture(event.pointerId);
    this.body.classList.add("scrubbing");
    this.scrub = { pointerId: event.pointerId, view };
    this.moveScrub(event);
  }

  private moveScrub(event: PointerEvent): void {
    const scrub = this.scrub;
    if (!scrub || event.pointerId !== scrub.pointerId) return;
    const box = this.body.getBoundingClientRect();
    const at = toWorld(scrub.view, {
      x: event.clientX - box.left,
      y: event.clientY - box.top,
    });
    this.callbacks.centreOn(at.x, at.y);
  }

  private endScrub(event: PointerEvent): void {
    if (!this.scrub || event.pointerId !== this.scrub.pointerId) return;
    this.body.releasePointerCapture(event.pointerId);
    this.body.classList.remove("scrubbing");
    this.scrub = null;
    // The extent was held still while the finger was down; it may have moved
    // a long way, and the map is the thing that says where.
    this.schedule();
  }
}
