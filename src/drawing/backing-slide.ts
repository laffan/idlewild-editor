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
 *
 * The move itself is `DonePair.shift` — across to a spare canvas and a swap,
 * never the canvas onto itself, and never a full dirty of the one on screen
 * (`done-pair.ts`). What is drawn here is the strips, onto the canvas now
 * showing: a dirty region a few hundred pixels wide.
 */

import { drawingOnly } from "./stamp-cull";
import type { Bounds } from "./types";

/** How far a redrawn strip reaches over the old edge, in pixels. */
const SEAM = 8;

/**
 * The strips a move of `dx`, `dy` pixels leaves to be drawn on a square
 * canvas `size` across, in its own pixels.
 */
export function stripsFor(size: number, dx: number, dy: number): Bounds[] {
  // Each strip reaches a little way into the moved picture: those pixels
  // were the old canvas's edge, where a stroke running off it was cut, and an
  // edge rasterises a shade differently from the same pixels mid-canvas.
  const strips: Bounds[] = [];
  const w = (d: number) => Math.min(size, Math.abs(d) + SEAM);
  if (dx > 0) strips.push({ x: 0, y: 0, width: w(dx), height: size });
  if (dx < 0) strips.push({ x: size - w(dx), y: 0, width: w(dx), height: size });
  if (dy > 0) strips.push({ x: 0, y: 0, width: size, height: w(dy) });
  if (dy < 0) strips.push({ x: 0, y: size - w(dy), width: size, height: w(dy) });
  return strips;
}

/**
 * Clear `strips` (canvas pixels) and have `lay` draw them again: `lay` is
 * handed the strips in world units, with drawing clipped to them and stamps
 * outside them skipped (`stamp-cull.ts`), and leaves its own transform —
 * this puts identity back. `world` is where the canvas's top-left is, and its
 * pixels per unit.
 */
export function redrawStrips(
  ctx: CanvasRenderingContext2D,
  strips: readonly Bounds[],
  world: { x: number; y: number; scale: number },
  lay: (reach: readonly Bounds[]) => void,
): void {
  if (strips.length === 0) return;
  const { x, y, scale } = world;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  for (const s of strips) ctx.clearRect(s.x, s.y, s.width, s.height);
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
