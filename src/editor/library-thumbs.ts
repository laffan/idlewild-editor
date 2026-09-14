/**
 * What a pattern and a shape look like as a swatch.
 *
 * Both palettes are grids of these, and so are the two editors' own pickers,
 * so the drawing is written once. A canvas rather than an SVG or a CSS
 * background for the same reason the brush buttons carry their tip: the thing
 * on the button has to *be* the thing, and a pattern is pixels.
 *
 * Drawn at device resolution and sized in CSS pixels, with smoothing off —
 * a pattern swatch that resampled its own pixels would be a picture of a
 * different pattern.
 */

import { h } from "../lib/dom";
import { patternTileCanvas } from "../lib/paint";
import { drawShape } from "../lib/shape-path";
import type { PatternData, ShapeData } from "../lib/library";

/** How big a swatch is on screen, in CSS pixels. */
export const SWATCH_PX = 38;

function surface(size: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D | null; dpr: number } {
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  const canvas = h("canvas", { class: "lib-swatch-canvas" });
  canvas.width = Math.round(size * dpr);
  canvas.height = Math.round(size * dpr);
  canvas.style.width = `${size}px`;
  canvas.style.height = `${size}px`;
  return { canvas, ctx: canvas.getContext("2d"), dpr };
}

/**
 * A pattern, tiled to fill the swatch.
 *
 * `cell` is how many CSS pixels one pattern pixel gets. Three is the smallest
 * that still reads as a dither at this size — at one pixel a 25 % dither and
 * a 37.5 % one are the same grey.
 */
export function patternSwatch(
  pattern: PatternData,
  options: { size?: number; cell?: number; color?: string; invert?: boolean } = {},
): HTMLCanvasElement {
  const size = options.size ?? SWATCH_PX;
  const cell = options.cell ?? 3;
  const { canvas, ctx, dpr } = surface(size);
  if (!ctx) return canvas;

  ctx.scale(dpr, dpr);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, size, size);
  ctx.imageSmoothingEnabled = false;

  const tile = patternTileCanvas(pattern, options.color ?? "#201e1d", options.invert);
  const step = pattern.size * cell;
  for (let y = 0; y < size; y += step) {
    for (let x = 0; x < size; x += step) {
      ctx.drawImage(tile, x, y, step, step);
    }
  }
  return canvas;
}

/** A shape, filling the swatch with a margin so its edges are visible. */
export function shapeSwatch(
  shape: ShapeData,
  options: { size?: number; color?: string; pad?: number } = {},
): HTMLCanvasElement {
  const size = options.size ?? SWATCH_PX;
  const pad = options.pad ?? 3;
  const { canvas, ctx, dpr } = surface(size);
  if (!ctx) return canvas;

  ctx.scale(dpr, dpr);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, size, size);
  drawShape(
    ctx,
    shape,
    { x: pad, y: pad, width: size - pad * 2, height: size - pad * 2 },
    options.color ?? "#201e1d",
  );
  return canvas;
}
