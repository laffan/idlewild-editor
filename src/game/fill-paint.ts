/**
 * Fills that are made of something other than a flat colour.
 *
 * A `FillPatch` is drawn by `DocRenderer` with Phaser's `Graphics`, which is
 * exactly right for a colour and cannot do either of the other two: a pattern
 * is a lattice of small rectangles — thousands of them over a large patch, on
 * an object that rebuilds its batch every frame — and a shape is a bezier path
 * per grid space. So a painted fill is rendered **once, into a canvas
 * texture**, and put on the scene as one image sitting over its own bounds.
 *
 * The texture is rebuilt only when something about that fill changes, which
 * is the whole reason this is worth the machinery: panning, zooming and
 * editing anything else in the document all cost nothing.
 *
 * **Both paints are clipped to the fill's own spaces**, not to its bounding
 * box. A run of grid spaces is usually an irregular shape and an isometric
 * one is never a rectangle, so a pattern that filled the box would spill out
 * of the fill on every diagonal edge.
 */

import type Phaser from "phaser";
import type { DocStore } from "../lib/doc-store";
import { Grid, fillShape } from "../lib/grid";
import { fillLatticeCells, paintPattern, paintShape, patternScaleOf } from "../lib/paint";
import { drawShape } from "../lib/shape-path";
import type { FillPatch, Point, Rect } from "../lib/types";
import { DEPTH_STRIDE } from "./draw-order";

/**
 * A ceiling on one fill's texture, in pixels per side.
 *
 * A careless drag over a few hundred spaces would otherwise ask for a buffer
 * measured in hundreds of megabytes, which is the same trap `fill-actions.ts`
 * guards against when it generates a PSD. Past it the fill keeps its flat
 * colour, which is what it had before any of this existed.
 */
const MAX_SIDE = 3072;

interface View {
  image: Phaser.GameObjects.Image;
  key: string;
  signature: string;
}

export class FillPaintRender {
  private readonly scene: Phaser.Scene;
  private readonly store: DocStore;
  private readonly grid: Grid;
  private readonly views = new Map<string, View>();

  constructor(scene: Phaser.Scene, store: DocStore, grid: Grid) {
    this.scene = scene;
    this.store = store;
    this.grid = grid;
  }

  /** Bring every painted fill on screen into line with the document. */
  render(): void {
    const seen = new Set<string>();
    const layers = this.store.layers;

    layers.forEach((layer, index) => {
      const depth = (layers.length - index) * DEPTH_STRIDE;
      for (const fill of layer.fills) {
        if (!fill.paint || fill.paint.kind === "color") continue;
        seen.add(fill.id);
        this.sync(fill, depth, layer.visible);
      }
    });

    for (const [id, view] of this.views) {
      if (seen.has(id)) continue;
      this.drop(id, view);
    }
  }

  private sync(fill: FillPatch, depth: number, visible: boolean): void {
    const shape = fillShape(this.grid, fill);
    if (!shape) {
      const held = this.views.get(fill.id);
      if (held) this.drop(fill.id, held);
      return;
    }

    const signature = JSON.stringify([
      fill.paint,
      fill.color,
      Math.round(shape.bounds.x),
      Math.round(shape.bounds.y),
      Math.round(shape.bounds.width),
      Math.round(shape.bounds.height),
      fill.cells.length,
      this.grid.size,
    ]);

    const held = this.views.get(fill.id);
    if (held && held.signature === signature) {
      held.image.setDepth(depth);
      held.image.setVisible(visible);
      return;
    }
    if (held) this.drop(fill.id, held);

    const made = this.paint(fill, shape);
    if (!made) return;

    const key = `fillpaint:${fill.id}:${Date.now().toString(36)}`;
    // `addCanvas` keeps a reference to the element rather than copying it, so
    // the canvas must not be reused for the next fill — each one gets its own.
    if (!this.scene.textures.addCanvas(key, made)) return;

    const image = this.scene.add.image(
      shape.bounds.x + shape.bounds.width / 2,
      shape.bounds.y + shape.bounds.height / 2,
      key,
    );
    image.setDisplaySize(shape.bounds.width, shape.bounds.height);
    image.setDepth(depth);
    image.setVisible(visible);
    this.views.set(fill.id, { image, key, signature });
  }

  /**
   * One fill, drawn into a canvas of its own bounds.
   *
   * The canvas carries the **world** transform, scaled and shifted so that
   * world `(bounds.x, bounds.y)` is its top-left corner. That is what keeps
   * the pattern lattice pinned to the world rather than to the fill: two
   * patches filled with the same pattern line up across the gap between them,
   * the way two brush strokes do.
   */
  private paint(fill: FillPatch, shape: { polygons: Point[][]; bounds: Rect }): HTMLCanvasElement | null {
    const { bounds } = shape;
    if (bounds.width <= 0 || bounds.height <= 0) return null;

    // Enough resolution for a pattern pixel to be a pixel, and no more.
    const scale = patternScaleOf(fill.paint);
    const wanted = fill.paint?.kind === "pattern" ? Math.min(4, Math.max(1, Math.ceil(2 / scale))) : 2;
    const fit = Math.min(1, MAX_SIDE / Math.max(bounds.width, bounds.height));
    const res = Math.max(0.25, Math.min(wanted, fit * wanted));

    const width = Math.max(1, Math.round(bounds.width * res));
    const height = Math.max(1, Math.round(bounds.height * res));
    if (width > MAX_SIDE || height > MAX_SIDE) return null;

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;

    ctx.setTransform(res, 0, 0, res, -bounds.x * res, -bounds.y * res);
    ctx.beginPath();
    for (const points of shape.polygons) {
      ctx.moveTo(points[0].x, points[0].y);
      for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
      ctx.closePath();
    }
    ctx.clip("nonzero");

    const colour = fill.color ?? "#ec3013";
    const pattern = paintPattern(fill.paint);
    if (pattern) {
      ctx.fillStyle = colour;
      fillLatticeCells(ctx, pattern, scale, bounds, fill.paint?.patternInvert);
      return canvas;
    }

    const libraryShape = paintShape(fill.paint);
    if (!libraryShape) return null;
    // One copy per grid space. On an isometric project the space is the
    // diamond inside that box rather than the box itself, so a *square* fills
    // its space instead of covering four halves of its neighbours'.
    const diamond = this.grid.projection === "isometric";
    for (const cell of this.spacesOf(fill, bounds)) {
      drawShape(ctx, libraryShape, { ...cell, diamond }, colour);
    }
    return canvas;
  }

  /** The box of every grid space this fill covers. */
  private spacesOf(fill: FillPatch, bounds: Rect): Rect[] {
    if (fill.rect || fill.cells.length === 0) {
      // A project that does not snap has no spaces, so the shape tiles on a
      // lattice of the project's nominal unit — the same answer `stampSize`
      // gives the brush, because a fill and a stroke over the same ground
      // have to agree about where the tiles are.
      const step = Math.max(4, this.grid.size);
      const out: Rect[] = [];
      const x0 = Math.floor(bounds.x / step) * step;
      const y0 = Math.floor(bounds.y / step) * step;
      for (let y = y0; y < bounds.y + bounds.height; y += step) {
        for (let x = x0; x < bounds.x + bounds.width; x += step) {
          out.push({ x, y, width: step, height: step });
        }
      }
      return out;
    }

    return fill.cells.map((cell) => {
      const corners = this.grid.cellPolygon(cell);
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (const p of corners) {
        if (p.x < minX) minX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.x > maxX) maxX = p.x;
        if (p.y > maxY) maxY = p.y;
      }
      return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
    });
  }

  private drop(id: string, view: View): void {
    view.image.destroy();
    if (this.scene.textures.exists(view.key)) this.scene.textures.remove(view.key);
    this.views.delete(id);
  }

  destroy(): void {
    for (const [id, view] of [...this.views]) this.drop(id, view);
  }
}
