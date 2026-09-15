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
 * How big one stamp is on this project.
 *
 * A grid space, where the grid snaps. Where it does not — a blank project,
 * whose addressable cell is a single world **pixel** — that reading gives a
 * one-pixel shape, which is nothing at all. So a blank project stamps on its
 * **nominal unit** instead: `size` is still the number the project was made
 * with and the one play mode measures its character in, it simply is not what
 * the editor rounds to. `fill-paint.ts` reaches the same answer for a filled
 * rectangle, and the two have to agree.
 */
export function stampSize(grid: Grid): { width: number; height: number } {
  if (!grid.snaps) return { width: grid.size, height: grid.size };
  return { width: grid.tileWidth, height: grid.tileHeight };
}

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
  // A project with no lattice has no space to ask about, so the stamps fall
  // on a lattice of their own size anchored on the world origin — which is
  // the same rule the pattern lattice follows, and for the same reason: two
  // passes over the same ground have to agree about where the boxes are.
  if (!grid.snaps) {
    const { width, height } = stampSize(grid);
    return {
      x: Math.floor(x / width) * width,
      y: Math.floor(y / height) * height,
      width,
      height,
    };
  }

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
      ...stampSize(grid),
      diamond: grid.projection === "isometric",
    },
    paint: { ...style.paint, patternScale: defaultPatternScale(grid) },
  };
}
