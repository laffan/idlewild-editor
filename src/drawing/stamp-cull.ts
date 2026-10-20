/**
 * Where drawing is going to land, while only part of the canvas is being
 * drawn — so a stamp that would land wholly outside it can be skipped
 * rather than drawn and clipped away.
 *
 * One user: a slide's re-bake of the strips it uncovered (`Surface.slideBy`,
 * `backing-slide.ts`). A stroke that reaches into a strip is laid again under
 * a clip, and before this every stamp of it was laid — a stroke a screen
 * long, for the corner of it that pokes into a strip a few hundred pixels
 * wide. The skipping keeps the walk's count, so the stamps that are laid get
 * the variant and turn they always had.
 */

import type { Bounds } from "./types";

let cull: readonly Bounds[] | null = null;
let outer: Bounds | null = null;

/** Run `draw` with stamps outside `within` (world units) skipped. */
export function drawingOnly(within: readonly Bounds[], draw: () => void): void {
  cull = within;
  outer = within.reduce<Bounds | null>((a, b) => (a ? union(a, b) : b), null);
  try {
    draw();
  } finally {
    cull = null;
    outer = null;
  }
}

/** Whether a stamp centred at x, y reaching `r` can land anywhere drawn. */
export function lands(x: number, y: number, r: number): boolean {
  if (!cull) return true;
  return cull.some(
    (b) => x + r > b.x && x - r < b.x + b.width && y + r > b.y && y - r < b.y + b.height,
  );
}

/** `box` cut down to the part of it that can be drawn; null if none. */
export function drawnPart(box: Bounds): Bounds | null {
  if (!outer) return box;
  const x = Math.max(box.x, outer.x);
  const y = Math.max(box.y, outer.y);
  const right = Math.min(box.x + box.width, outer.x + outer.width);
  const bottom = Math.min(box.y + box.height, outer.y + outer.height);
  if (right <= x || bottom <= y) return null;
  return { x, y, width: right - x, height: bottom - y };
}

function union(a: Bounds, b: Bounds): Bounds {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return {
    x,
    y,
    width: Math.max(a.x + a.width, b.x + b.width) - x,
    height: Math.max(a.y + a.height, b.y + b.height) - y,
  };
}
