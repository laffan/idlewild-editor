/**
 * Stamping, ported from Hush's `engine/stroke-render.js`.
 *
 * `stampStream` is the hot loop: walk the streamlined path at a fixed
 * spacing and lay one rotated atlas cell down at each step, sized by the
 * pressure interpolated between the two samples either side. One
 * `drawImage` per stamp, no path, no gradient — which is what keeps a long
 * stroke cheap enough to re-lay every frame while it is being drawn.
 */

import type { Stroke } from "../lib/types";
import { DEFAULT_PAINT_SPEC, type PaintSpec } from "../lib/paint";
import { paintPatternStroke, paintRegion, paintShapeStroke } from "./paint-render";
import type { AtlasCache } from "./atlas";
import { STRIDE, streamlineFor, type StreamPoint } from "./geometry";
import { stampAngle } from "./geometry";
import { alphaOf, opaqueHex } from "../lib/color";
import type { StrokeStyle } from "./types";

/** Stamp spacing as a fraction of the brush size. Hush's default. */
export const SPACING_FRAC = 0.15;
/** How much of the streamline to apply. 0 follows every tremor. */
export const STREAMLINE = 0.42;

/**
 * How much pressure moves the tip. A stamp is `half × (0.6 + 0.4 × p)`
 * across, so a light touch is 60 % of the nominal size and a hard one is
 * the full width — enough taper to read as a pen, not so much that a mouse
 * (which reports nothing and lands at 0.5) draws a visibly thin line.
 */
const PRESSURE_FLOOR = 0.6;

export function stampStream(
  ctx: CanvasRenderingContext2D,
  stream: readonly StreamPoint[],
  size: number,
  tinted: { atlas: CanvasImageSource; cell: number; variants: number },
): void {
  if (stream.length === 0) return;
  const { atlas, cell, variants } = tinted;
  const half = size * 0.5;
  const spacing = Math.max(0.6, size * SPACING_FRAC);
  let stampIndex = 0;

  const stamp = (x: number, y: number, pressure: number) => {
    const r = half * (PRESSURE_FLOOR + (1 - PRESSURE_FLOOR) * pressure);
    const variant = stampIndex % variants;
    const angle = stampAngle(stampIndex);
    stampIndex++;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    ctx.drawImage(atlas, variant * cell, 0, cell, cell, -r, -r, r * 2, r * 2);
    ctx.restore();
  };

  if (stream.length === 1) {
    stamp(stream[0].point[0], stream[0].point[1], stream[0].pressure);
    return;
  }

  // `carry` keeps the spacing continuous across segment boundaries, so the
  // stamps do not bunch up at every recorded sample.
  let carry = 0;
  for (let i = 1; i < stream.length; i++) {
    const a = stream[i - 1];
    const b = stream[i];
    const dx = b.point[0] - a.point[0];
    const dy = b.point[1] - a.point[1];
    const length = Math.hypot(dx, dy);
    if (length === 0) continue;
    const ux = dx / length;
    const uy = dy / length;

    let d = carry;
    while (d < length) {
      const t = d / length;
      stamp(
        a.point[0] + ux * d,
        a.point[1] + uy * d,
        a.pressure + (b.pressure - a.pressure) * t,
      );
      d += spacing;
    }
    carry = d - length;
  }
}

/**
 * Lay one stored stroke into a context already carrying the world transform.
 *
 * Through `streamlineFor`, which caches on the points array's identity — see
 * the note there. A stroke is immutable once stored, so the streamline is
 * computed once for the life of the stroke however many times the backing is
 * re-baked.
 *
 * **A fill is not streamlined.** The streamline is a lag filter over the path
 * a brush is stamped *along*: it drags every interior sample most of the way
 * towards the one before it, which is what stops a hand's jitter from
 * becoming a row of stamps at slightly wrong angles. A filled region has no
 * stamping and no path — it has corners — and dragging those towards each
 * other moves them. On a swept outline of several hundred samples a pixel
 * apart that was invisible; on a shape tapped out corner by corner it was a
 * different shape from the one on screen the moment you pressed Fill. It also
 * means both previews are now honest: neither `fillPreview` nor the point
 * fill's own repaint streamlines, so what you were looking at is what lands.
 */
export function renderStroke(
  ctx: CanvasRenderingContext2D,
  stroke: Stroke,
  atlas: AtlasCache,
): void {
  // A shape stroke is not streamlined for the same reason a fill is not, only
  // more so: its points are the corners of grid spaces, and a lag filter over
  // those would slide every tile off the space it was put on.
  const stream =
    stroke.mode === "fill" || stroke.mode === "shape"
      ? asStream(stroke.points)
      : streamlineFor(stroke.points, STREAMLINE);
  paint(ctx, stream, stroke.size, stroke.color, stroke.mode, stroke.brushId, atlas, {
    paint: stroke.paint ?? DEFAULT_PAINT_SPEC,
    stamp: stroke.stamp,
  });
}

/** A stroke's flat points as the stream shape, with nothing done to them. */
function asStream(points: readonly number[]): StreamPoint[] {
  const out: StreamPoint[] = [];
  for (let i = 0; i + STRIDE <= points.length; i += STRIDE) {
    out.push({ point: [points[i], points[i + 1]], pressure: points[i + 2] });
  }
  return out;
}

/** Lay an in-flight stroke, which has a style but no record yet. */
export function renderLive(
  ctx: CanvasRenderingContext2D,
  stream: readonly StreamPoint[],
  style: StrokeStyle,
  atlas: AtlasCache,
): void {
  paint(ctx, stream, style.size, style.color, style.mode, style.brushId, atlas, {
    paint: style.paint,
    stamp: style.stamp,
  });
}

/**
 * How a mode reaches the canvas: what it composites as, and how much of it
 * lands.
 *
 * A **highlight** multiplies, so it tints what is under it rather than
 * covering it, and it lands at half strength. An **eraser** is the same brush
 * with the paint taken out — every stamp clears what it lands on, so the tip's
 * softness and the pressure taper are the eraser's too. What it reaches is the
 * ink on this layer; an eraser that rubbed the artwork already inside the PSD
 * would have to work on that file's pixels, which is later work.
 *
 * The colour's own opacity multiplies into whichever of those applies, which
 * is what makes the picker's second slider mean something on a pen.
 */
function modeComposite(
  mode: Stroke["mode"],
  alpha: number,
): { composite: GlobalCompositeOperation; strokeAlpha: number } {
  if (mode === "highlight") {
    return { composite: "multiply", strokeAlpha: 0.5 * alpha };
  }
  if (mode === "erase") {
    return { composite: "destination-out", strokeAlpha: alpha };
  }
  return { composite: "source-over", strokeAlpha: alpha };
}

/**
 * What a mark is made of, as the two painters need it.
 *
 * Handed through rather than read off the stroke, because `renderLive` has a
 * style and `renderStroke` has a record, and the two carry the same two facts
 * under different names.
 */
interface PaintOptions {
  paint: PaintSpec;
  stamp?: { width: number; height: number };
}

function paint(
  ctx: CanvasRenderingContext2D,
  stream: readonly StreamPoint[],
  size: number,
  color: string,
  mode: Stroke["mode"],
  brushId: number,
  atlas: AtlasCache,
  options: PaintOptions,
): void {
  if (stream.length === 0) return;
  const spec = options.paint ?? DEFAULT_PAINT_SPEC;

  // A stamped field of shapes, which is the whole of what a shape stroke is.
  // It falls back to nothing rather than to flat colour when the shape has
  // gone: a stroke's points are grid corners, and a line drawn through them
  // would be a mark nobody made.
  if (mode === "shape") {
    paintShapeStroke(ctx, stream, color, spec, options.stamp);
    return;
  }

  // A fill is a closed outline rather than a path to stamp along, so it
  // leaves the loop below entirely — and a 2D context reads `#rrggbbaa` on
  // its own, so opacity needs nothing said about it here.
  if (mode === "fill") {
    ctx.save();
    const painted =
      spec.kind !== "color" &&
      paintRegion(ctx, stream, color, spec, options.stamp ?? { width: 32, height: 32 });
    if (!painted) fillRegion(ctx, stream, color);
    ctx.restore();
    return;
  }

  // The Pattern brush: the lattice cells the tip passed over, with the
  // pattern's own ones filled. `paintPatternStroke` answers false when the
  // pattern has gone, and a plain stamped stroke is the right thing to draw
  // then — the mark was made, and its colour is what survives of it.
  if (spec.kind === "pattern" && mode === "ink") {
    if (paintPatternStroke(ctx, stream, size, color, spec)) return;
  }

  // The atlas is tinted with the colour at **full** opacity, and the opacity
  // is applied once to the finished stroke. Tinting it in would put the alpha
  // on every stamp, and the stamps overlap — a spacing of 0.15 of the brush
  // means seven of them on the same pixel — so a 50 % line would come out
  // nearly solid down its spine and honest only at the tips.
  const { composite, strokeAlpha } = modeComposite(mode, alphaOf(color));
  const tinted = atlas.get(brushId, opaqueHex(color));

  if (composite === "source-over" && strokeAlpha === 1) {
    // The common case, and the cheap one: nothing to composite against and
    // nothing to hold back, so the stamps go straight onto the target.
    ctx.save();
    stampStream(ctx, stream, size, tinted);
    ctx.restore();
    return;
  }
  flattened(ctx, stream, size, tinted, composite, strokeAlpha);
}

/**
 * Stamp the stroke somewhere else at full strength, then lay that down as one
 * image — Hush's delta #38 flatten path, and the only way a stroke that is not
 * opaque can look like one stroke.
 *
 * The problem it solves is the same one from three directions. Stamps overlap
 * heavily by design; `globalAlpha` applies to each `drawImage` separately, so a
 * half-transparent pen compounds into a solid core, a highlighter's multiply
 * darkens wherever it crosses itself, and a soft-edged eraser eats further each
 * time it passes. Compositing the finished stroke *once* is the answer to all
 * three, and it costs one scratch blit per stroke.
 *
 * The scratch carries the target's own transform, so the stamping arithmetic is
 * unchanged and the blit is a rectangle in world units mapped through that
 * transform back into the scratch's raw pixels.
 */
function flattened(
  ctx: CanvasRenderingContext2D,
  stream: readonly StreamPoint[],
  size: number,
  tinted: { atlas: CanvasImageSource; cell: number; variants: number },
  composite: GlobalCompositeOperation,
  strokeAlpha: number,
): void {
  const scratch = scratchFor(ctx);
  if (!scratch) {
    // No second context to be had, which is a browser this app does not run
    // in. Stamping straight on is wrong in the overlaps and right everywhere
    // else, which beats drawing nothing.
    ctx.save();
    ctx.globalCompositeOperation = composite;
    ctx.globalAlpha = strokeAlpha;
    stampStream(ctx, stream, size, tinted);
    ctx.restore();
    return;
  }

  // The stroke's box in world units, grown by the brush: a stamp is laid
  // centred on the path, so the ink reaches past the furthest sample.
  const pad = size + 2;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const { point } of stream) {
    if (point[0] < minX) minX = point[0];
    if (point[1] < minY) minY = point[1];
    if (point[0] > maxX) maxX = point[0];
    if (point[1] > maxY) maxY = point[1];
  }
  const rx = minX - pad;
  const ry = minY - pad;
  const rw = maxX - minX + pad * 2;
  const rh = maxY - minY + pad * 2;

  const t = ctx.getTransform();
  scratch.setTransform(t.a, t.b, t.c, t.d, t.e, t.f);
  scratch.save();
  scratch.globalCompositeOperation = "source-over";
  scratch.globalAlpha = 1;
  // Only the box, so what is left elsewhere in the scratch is harmless.
  scratch.clearRect(rx, ry, rw, rh);
  stampStream(scratch, stream, size, tinted);
  scratch.restore();

  // The same rectangle in the scratch's raw pixels: the transform is a scale
  // and a translation, so this is that scale and that translation applied.
  const sx = rx * t.a + t.e;
  const sy = ry * t.d + t.f;
  const sw = rw * t.a;
  const sh = rh * t.d;

  ctx.save();
  ctx.globalCompositeOperation = composite;
  ctx.globalAlpha = strokeAlpha;
  ctx.drawImage(scratch.canvas, sx, sy, sw, sh, rx, ry, rw, rh);
  ctx.restore();
}

/**
 * A scratch canvas at least as big as the target, kept between strokes.
 *
 * **Grow-only.** Assigning `canvas.width` reallocates the backing store — the
 * churn Hush's delta #27 is about — and the three targets this renders into
 * are different sizes: the drawing surface's two four-thousand-pixel backings,
 * and whatever `rasterise.ts` asks for when ink is written into a PSD. Letting
 * it shrink would reallocate twice per Apply for no benefit; the extra pixels
 * cost nothing to have and are never read.
 */
let scratchCanvas: HTMLCanvasElement | null = null;
let scratchCtx: CanvasRenderingContext2D | null = null;

function scratchFor(
  ctx: CanvasRenderingContext2D,
): CanvasRenderingContext2D | null {
  const target = ctx.canvas;
  if (!scratchCanvas) {
    scratchCanvas = document.createElement("canvas");
    scratchCtx = scratchCanvas.getContext("2d");
    if (!scratchCtx) return null;
  }
  if (
    scratchCanvas.width < target.width ||
    scratchCanvas.height < target.height
  ) {
    scratchCanvas.width = Math.max(scratchCanvas.width, target.width);
    scratchCanvas.height = Math.max(scratchCanvas.height, target.height);
  }
  return scratchCtx;
}

/**
 * The inside of a closed outline, in flat colour.
 *
 * No brush and no stamping: a fill is one shape, and stamping its boundary
 * would leave a soft edge around a hard area. `nonzero` rather than
 * `evenodd`, so a loop that crosses itself — which a swept outline does all
 * the time — comes out filled rather than holed.
 */
function fillRegion(
  ctx: CanvasRenderingContext2D,
  stream: readonly StreamPoint[],
  color: string,
): void {
  if (stream.length < 3) return;
  ctx.beginPath();
  ctx.moveTo(stream[0].point[0], stream[0].point[1]);
  for (let i = 1; i < stream.length; i++) {
    ctx.lineTo(stream[i].point[0], stream[i].point[1]);
  }
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill("nonzero");
}
