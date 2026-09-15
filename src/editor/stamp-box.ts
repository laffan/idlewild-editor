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
 * A bounding box rather than the space's own outline, because that is what
 * `ShapeBox` takes — with `diamond` set on an isometric project, which is
 * what tells the painter to map the shape into the diamond inscribed in it
 * rather than into the box. See `lib/shape-path.ts`.
 */
export function stampBoxAt(grid: Grid, x: number, y: number): StampBox {
  const diamond = grid.projection === "isometric";
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
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY, diamond };
}

/** The one drawing-layer callback that needs a grid behind it. */
export function libraryPointer(grid: Grid): {
  stampBoxAt: (x: number, y: number) => StampBox;
} {
  return { stampBoxAt: (x, y) => stampBoxAt(grid, x, y) };
}

/**
 * How wide one pattern pixel starts out, in world pixels.
 *
 * A sixteenth of a grid space, which puts a default 8×8 pattern at half a
 * space on a 64px grid and at exactly one space on an 8px one — where the art
 * is pixels and a pattern tile *is* the tile. Only a starting point: the
 * scale is a slider.
 *
 * Asked by two places that both start empty and must agree: the drawing
 * layer's style, and the inspector's memory of what the last fill was made
 * of. They disagreed while this was written out twice, and the symptom was a
 * brush and a fill of the same pattern coming out at different sizes.
 */
export function defaultPatternScale(grid: Grid): number {
  return Math.max(1, Math.round(grid.size / 16));
}

/** The style with the numbers the library tools take from the project. */
export function libraryStyle(grid: Grid, style: StrokeStyle): StrokeStyle {
  return {
    ...style,
    stamp: {
      width: grid.tileWidth,
      height: grid.tileHeight,
      diamond: grid.projection === "isometric",
    },
    paint: { ...style.paint, patternScale: defaultPatternScale(grid) },
  };
}
