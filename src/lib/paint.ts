/**
 * What a mark is *made of*: a colour, a pixel pattern, or a shape.
 *
 * One record, shared by three things that used to each have their own idea of
 * it — the brush, the sweep fill, and a filled run of grid spaces. They are
 * different gestures over the same question, so saying it once is what keeps
 * "fill with a pattern" from meaning three different things in three panels.
 *
 * **Colour is always there**, whichever kind it is. A pattern is one bit per
 * pixel and a shape is a path: neither carries a colour of its own, so both
 * are drawn *in* one. That also makes the control that picks them one control
 * rather than two — the colour picker never goes away, and the kind decides
 * what else is offered beside it.
 *
 * ## The pattern lattice
 *
 * A pattern is pinned to the **world**, not to the stroke. `patternScale` is
 * how many world pixels one pattern pixel covers, so cell `(cx, cy)` of the
 * lattice is always at `(cx × scale, cy × scale)` whatever route the brush
 * took to get there. That is the whole of why the pattern brush reads as
 * *revealing* a filled area rather than as painting a texture: two strokes
 * that cross line up exactly, a stroke drawn over its own tail changes
 * nothing, and the result looks like one area with the pattern already in it.
 */

import type { PatternData } from "./library/types";
import { patternLibrary, shapeLibrary } from "./library";
import type { PatternDef, ShapeDef } from "./library/types";

export type PaintKind = "color" | "pattern" | "shape";

/**
 * Everything about a paint except its colour.
 *
 * Split out because a `Stroke` already has a `color` and a second copy of it
 * inside a `paint` field would be a fact stored twice — the kind of thing
 * that is right for a week and then quietly disagrees with itself. So what a
 * document stores is the spec, and the colour beside it.
 */
export interface PaintSpec {
  kind: PaintKind;
  /** Library id, when kind is "pattern". */
  patternId?: string;
  /** World pixels per pattern pixel. */
  patternScale?: number;
  /** Swap the pattern's ones and zeroes. */
  patternInvert?: boolean;
  /** Library id, when kind is "shape". */
  shapeId?: string;
}

/** A spec with the colour it is drawn in — what a control edits. */
export interface Paint extends PaintSpec {
  color: string;
}

/** Flat colour, which is what everything did before there was a choice. */
export const DEFAULT_PAINT: Paint = { kind: "color", color: "#201e1d" };

/** And the spec half of it, for a style that keeps its colour separately. */
export const DEFAULT_PAINT_SPEC: PaintSpec = { kind: "color" };

/** What the scale slider allows, in world pixels per pattern pixel. */
export const PATTERN_SCALE_RANGE = { min: 1, max: 32 } as const;

/** The pattern a paint names, or null — see `Library.get` on why null. */
export function paintPattern(paint: PaintSpec | undefined): PatternDef | null {
  if (!paint || paint.kind !== "pattern") return null;
  return patternLibrary.get(paint.patternId);
}

/** The shape a paint names, or null. */
export function paintShape(paint: PaintSpec | undefined): ShapeDef | null {
  if (!paint || paint.kind !== "shape") return null;
  return shapeLibrary.get(paint.shapeId);
}

/** How wide one pattern pixel is in world units, with the default filled in. */
export function patternScaleOf(paint: PaintSpec | undefined): number {
  const raw = paint?.patternScale;
  if (!raw || !Number.isFinite(raw) || raw <= 0) return 2;
  return raw;
}

/**
 * Whether this paint has anything to draw beyond a flat colour.
 *
 * False for a colour, and false for a pattern or shape whose library row has
 * gone — a document can name one this install does not have. Everything that
 * paints asks this first and falls back to the colour, which is the one
 * answer that is never wrong.
 */
export function paintIsPlain(paint: PaintSpec | undefined): boolean {
  if (!paint || paint.kind === "color") return true;
  if (paint.kind === "pattern") return paintPattern(paint) === null;
  return paintShape(paint) === null;
}

/** What the paint is called, for a readout. */
export function paintLabel(paint: PaintSpec | undefined): string {
  if (!paint || paint.kind === "color") return "Colour";
  if (paint.kind === "pattern") return paintPattern(paint)?.name ?? "Pattern (missing)";
  return paintShape(paint)?.name ?? "Shape (missing)";
}

/** Whether a pattern's pixel at a lattice cell is set, wrapping and inverting. */
export function patternBit(
  pattern: PatternData,
  cx: number,
  cy: number,
  invert = false,
): boolean {
  const size = pattern.size;
  if (size <= 0) return false;
  const col = ((cx % size) + size) % size;
  const row = ((cy % size) + size) % size;
  const on = pattern.pixels[row]?.[col] === 1;
  return invert ? !on : on;
}

/**
 * The lattice cell a world point falls in.
 *
 * `Math.floor`, so the cell that owns a coordinate is the same one either
 * side of the origin — which is what keeps the pattern continuous across
 * `x = 0` rather than putting a double-width column there.
 */
export function latticeCell(world: number, scale: number): number {
  return Math.floor(world / scale);
}

/**
 * One tile of a pattern as a canvas, one canvas pixel per pattern pixel.
 *
 * Deliberately *not* scaled up. It is either handed to `createPattern` — which
 * is given the scale through its own transform, so a tile drawn large would
 * be a tile scaled twice — or drawn as a thumbnail with smoothing off, where
 * one pixel per pixel is exactly what a thumbnail of a pattern should be.
 *
 * Transparent where the pattern is 0, so a pattern laid over artwork lets the
 * artwork through rather than painting it white.
 */
export function patternTileCanvas(
  pattern: PatternData,
  color: string,
  invert = false,
): HTMLCanvasElement {
  const size = Math.max(1, pattern.size);
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;
  ctx.fillStyle = color;
  for (let row = 0; row < size; row++) {
    for (let col = 0; col < size; col++) {
      if (patternBit(pattern, col, row, invert)) ctx.fillRect(col, row, 1, 1);
    }
  }
  return canvas;
}

/**
 * A pattern as a fill style for a context that already carries a transform.
 *
 * The tile is one canvas pixel per pattern pixel and the pattern's own matrix
 * scales it to `scale` user units per pixel, so the lattice is pinned to the
 * context's origin — which for the drawing surface and for a generated PSD
 * alike is the world origin. That is what makes two strokes line up.
 *
 * Null when the engine has neither `createPattern` nor `DOMMatrix`, which is
 * a browser this app does not run in; every caller falls back to flat colour.
 */
export function patternFillStyle(
  ctx: CanvasRenderingContext2D,
  pattern: PatternData,
  scale: number,
  color: string,
  invert = false,
): CanvasPattern | null {
  const made = ctx.createPattern(patternTileCanvas(pattern, color, invert), "repeat");
  if (!made) return null;
  if (typeof DOMMatrix !== "undefined" && made.setTransform) {
    made.setTransform(new DOMMatrix([scale, 0, 0, scale, 0, 0]));
  }
  return made;
}

/**
 * Fill the lattice cells of a box directly, one `fillRect` per set pixel.
 *
 * The crisp path, and the one the brush uses. A `CanvasPattern` is one call
 * however large the area, which is what an area fill wants; a brush covers a
 * few hundred cells and wants them landing on exact integer boundaries with
 * no resampling at all, because a dither that is a pixel wide here and two
 * pixels wide there is not a dither.
 *
 * `keep` is the filter the brush uses to say which cells its tip reached.
 */
export function fillLatticeCells(
  ctx: CanvasRenderingContext2D,
  pattern: PatternData,
  scale: number,
  box: { x: number; y: number; width: number; height: number },
  invert = false,
  keep?: (cx: number, cy: number) => boolean,
): void {
  const x0 = latticeCell(box.x, scale);
  const y0 = latticeCell(box.y, scale);
  const x1 = latticeCell(box.x + box.width, scale);
  const y1 = latticeCell(box.y + box.height, scale);
  for (let cy = y0; cy <= y1; cy++) {
    for (let cx = x0; cx <= x1; cx++) {
      if (!patternBit(pattern, cx, cy, invert)) continue;
      if (keep && !keep(cx, cy)) continue;
      ctx.fillRect(cx * scale, cy * scale, scale, scale);
    }
  }
}
