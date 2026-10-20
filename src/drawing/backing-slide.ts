/**
 * Slide the baked canvas instead of baking it again — Hush's blit-forward
 * re-anchor (its delta #25).
 *
 * The backing covers rather more world than the screen, and when a pan
 * brings the viewport near its edge it is re-centred on the camera. That used
 * to re-bake it: clear four thousand pixels a side and lay every stroke in
 * view again. The cost of that is the stroke count — measured, about 8 ms
 * with nothing on the layer and well over a second with a few hundred
 * strokes, once per re-centre, for the ink and the plan both — and a session
 * of quick sketching is exactly how a layer gets a few hundred strokes. Hidden
 * sidebars make it worse twice over: the backing is at its 4096 cap, so it
 * covers less of the world beyond the screen and is re-centred more often.
 *
 * A pan does not change what any baked pixel looks like, only where it is.
 * So the pixels are moved by the pan, a whole number of backing pixels (the
 * anchor is snapped so that it is — a fractional move would resample and
 * soften every stroke on the layer), and only the strips the move left empty
 * are drawn: the strokes that reach into them, clipped to them. A stroke
 * laid again under a clip lands on exactly the pixels the whole bake would
 * have put there, because inside the strip it *is* the whole bake.
 */

import { drawingOnly } from "./stamp-cull";
import type { Bounds } from "./types";

/** How far a redrawn strip reaches over the old edge, in pixels. */
const SEAM = 8;

/**
 * Move every pixel of `ctx`'s canvas by `dx`, `dy` and answer the strips the
 * move left empty, in the canvas's own pixels. Leaves the identity transform.
 */
export function slideCanvas(
  ctx: CanvasRenderingContext2D,
  size: number,
  dx: number,
  dy: number,
): Bounds[] {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.save();
  // `copy` replaces the whole canvas with the moved picture, so whatever the
  // move uncovers is left transparent rather than holding the old pixels.
  ctx.globalCompositeOperation = "copy";
  ctx.drawImage(ctx.canvas, dx, dy);
  ctx.restore();

  // Each strip reaches a little way into the moved picture: those pixels
  // were the old canvas's edge, where a stroke running off it was cut, and an
  // edge rasterises a shade differently from the same pixels mid-canvas.
  const strips: Bounds[] = [];
  const w = (d: number) => Math.min(size, Math.abs(d) + SEAM);
  if (dx > 0) strips.push({ x: 0, y: 0, width: w(dx), height: size });
  if (dx < 0) strips.push({ x: size - w(dx), y: 0, width: w(dx), height: size });
  if (dy > 0) strips.push({ x: 0, y: 0, width: size, height: w(dy) });
  if (dy < 0) strips.push({ x: 0, y: size - w(dy), width: size, height: w(dy) });
  for (const s of strips) ctx.clearRect(s.x, s.y, s.width, s.height);
  return strips;
}

/**
 * Slide the canvas by `dx`, `dy` and have `lay` draw what that uncovered:
 * `lay` is handed the uncovered strips in world units, with drawing already
 * clipped to them and stamps outside them skipped (`stamp-cull.ts`), and
 * leaves its own transform — this puts identity back.
 * `world` is where the canvas's top-left now is, and its pixels per unit.
 */
export function slideBacking(
  ctx: CanvasRenderingContext2D,
  size: number,
  dx: number,
  dy: number,
  world: { x: number; y: number; scale: number },
  lay: (reach: readonly Bounds[]) => void,
): void {
  const strips = slideCanvas(ctx, size, dx, dy);
  const { x, y, scale } = world;
  ctx.save();
  ctx.beginPath();
  for (const r of strips) ctx.rect(r.x, r.y, r.width, r.height);
  ctx.clip();
  const reach = strips.map((s) => ({
    x: x + s.x / scale,
    y: y + s.y / scale,
    width: s.width / scale,
    height: s.height / scale,
  }));
  // And no stamps laid outside it only for the clip to take away again.
  drawingOnly(reach, () => lay(reach));
  ctx.restore();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
}
