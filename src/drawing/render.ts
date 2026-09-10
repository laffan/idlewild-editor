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
import type { AtlasCache } from "./atlas";
import { streamlinePoints, toPoints, type StreamPoint } from "./geometry";
import { stampAngle } from "./geometry";
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

/** Lay one stored stroke into a context already carrying the world transform. */
export function renderStroke(
  ctx: CanvasRenderingContext2D,
  stroke: Stroke,
  atlas: AtlasCache,
): void {
  const stream = streamlinePoints(toPoints(stroke.points), STREAMLINE);
  paint(ctx, stream, stroke.size, stroke.color, stroke.mode, stroke.brushId, atlas);
}

/** Lay an in-flight stroke, which has a style but no record yet. */
export function renderLive(
  ctx: CanvasRenderingContext2D,
  stream: readonly StreamPoint[],
  style: StrokeStyle,
  atlas: AtlasCache,
): void {
  paint(ctx, stream, style.size, style.color, style.mode, style.brushId, atlas);
}

function paint(
  ctx: CanvasRenderingContext2D,
  stream: readonly StreamPoint[],
  size: number,
  color: string,
  mode: Stroke["mode"],
  brushId: number,
  atlas: AtlasCache,
): void {
  if (stream.length === 0) return;
  ctx.save();
  // A highlight multiplies so it tints what is under it rather than covering
  // it; ink paints over. Alpha is per stroke, not per stamp, or the overlaps
  // inside one stroke would accumulate into a dark spine.
  if (mode === "highlight") {
    ctx.globalCompositeOperation = "multiply";
    ctx.globalAlpha = 0.5;
  }
  stampStream(ctx, stream, size, atlas.get(brushId, color));
  ctx.restore();
}
