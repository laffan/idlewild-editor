/**
 * Where a Shape brush stamp goes, and the two numbers the library tools need
 * from the project.
 *
 * Both are one-liners about the grid, and both are here rather than in
 * `editor.ts` for the same reason `tool-routing.ts` is: the shell's file is
 * about wiring, and an isometric bounding box worked out inline in the middle
 * of a constructor is a piece of geometry pretending to be plumbing.
 */

import type { Grid } from "../lib/grid";
import type { StampBox, StrokeStyle } from "../drawing";

/**
 * The box a stamp at this world point fills: the bounding box of the grid
 * space under it.
 *
 * A bounding box rather than the space's own outline, because a shape is
 * drawn into a rectangle — and on an isometric project that rectangle is 2:1,
 * which is exactly what makes a tile shape come out as the diamond it was
 * drawn to be.
 */
export function stampBoxAt(grid: Grid, x: number, y: number): StampBox {
  const corners = grid.cellPolygon(grid.worldToCell({ x, y }));
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
}

/** The one drawing-layer callback that needs a grid behind it. */
export function libraryPointer(grid: Grid): {
  stampBoxAt: (x: number, y: number) => StampBox;
} {
  return { stampBoxAt: (x, y) => stampBoxAt(grid, x, y) };
}

/**
 * The style with the two numbers the library tools take from the project.
 *
 * A stamp is a grid space. A pattern pixel is a sixteenth of one, which puts
 * a default 8×8 pattern at half a space on a 64px grid and at exactly one
 * space on an 8px one — where the art is pixels and a pattern tile *is* the
 * tile. Both are only starting points: the scale is a slider.
 */
export function libraryStyle(grid: Grid, style: StrokeStyle): StrokeStyle {
  return {
    ...style,
    stamp: { width: grid.tileWidth, height: grid.tileHeight },
    paint: { ...style.paint, patternScale: Math.max(1, Math.round(grid.size / 16)) },
  };
}
