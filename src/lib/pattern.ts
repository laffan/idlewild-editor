/**
 * Where a pattern's elements land — the rule, run.
 *
 * A pattern layer stores a rule rather than a list, because there is no world
 * bound in this editor to fill: the grid is recomputed from the camera over
 * exactly the cells the viewport can see, and a pattern has to be able to do
 * the same. So nothing here holds state and nothing here is asked for the
 * whole answer. It is asked *what falls in this repeat tile*, one tile at a
 * time, and the tile's own coordinates are part of the seed — which is what
 * makes the same space answer the same way whatever route the camera took to
 * get there, and what lets the exported game regenerate the arrangement from
 * the same four numbers rather than being shipped ten thousand positions.
 *
 * The generator is mirrored in `src-tauri/templates/common/js/shared/pattern.js`,
 * which is the copy the project's own `WorldScene.js` runs. **Keep the two in
 * step** — the same rule the editor drew has to come out of the exported
 * game, or Play shows a different world from the one you built. The tests
 * beside this file pin the arithmetic that both depend on.
 */

import type { Cell, PatternShape, PatternSpec } from "./types";

/**
 * One element a pattern can put down: a top-level layer of a PSD placed on
 * the layer, and how big it is being shown.
 *
 * Read off the layer's placements rather than off the manifest. A pattern
 * layer's placements are its **palette** — see `layerKind` — so a file
 * resized in the inspector changes the size of every copy of it in the
 * pattern, which is the only reading under which that control means anything
 * on a pattern layer at all.
 */
export interface PatternElement {
  /** The manifest path `place()` resolves. */
  path: string;
  psdKey: string;
  width: number;
  height: number;
  /**
   * How big it is being shown against its own pixels — what a placed object
   * has to be scaled by, the same ratio `applyScale` reads off a placement.
   */
  scaleX: number;
  scaleY: number;
  /** Where this element's top-left sits relative to its anchor space. */
  offsetX: number;
  offsetY: number;
}

/** One copy of one element, somewhere. */
export interface PatternInstance {
  /**
   * Stable across re-renders: the tile it belongs to and its place in that
   * tile. The renderer keys its Phaser objects by this, so panning back to
   * somewhere you have been re-uses what is already there instead of
   * destroying and remaking it.
   */
  id: string;
  element: PatternElement;
  /** The grid space it stands on. */
  cell: Cell;
}

/** A rectangle of grid spaces, inclusive of both corners. */
export interface CellRange {
  from: Cell;
  to: Cell;
}

/**
 * Every instance that falls inside a range of grid spaces.
 *
 * Whole repeat tiles are generated and their instances filtered, rather than
 * the range being generated directly: a tile is the unit the rule is defined
 * over, and generating half of one would give a different answer at the edge
 * of the viewport from the one the middle of the viewport gives a moment
 * later.
 *
 * `limit` is a ceiling on what comes back, and it is not a detail. A density
 * of two hundred over a viewport forty tiles across is eight thousand Phaser
 * objects, and the difference between a slow pan and an editor that has
 * stopped answering is whether anything said no.
 */
export function patternInstances(
  spec: PatternSpec,
  elements: readonly PatternElement[],
  range: CellRange,
  limit = 1200,
): PatternInstance[] {
  if (elements.length === 0) return [];

  const cols = Math.max(1, Math.round(spec.repeat.cols));
  const rows = Math.max(1, Math.round(spec.repeat.rows));
  const low = { cx: Math.min(range.from.cx, range.to.cx), cy: Math.min(range.from.cy, range.to.cy) };
  const high = { cx: Math.max(range.from.cx, range.to.cx), cy: Math.max(range.from.cy, range.to.cy) };

  const out: PatternInstance[] = [];
  const firstTileX = Math.floor(low.cx / cols);
  const lastTileX = Math.floor(high.cx / cols);
  const firstTileY = Math.floor(low.cy / rows);
  const lastTileY = Math.floor(high.cy / rows);

  for (let ty = firstTileY; ty <= lastTileY; ty++) {
    for (let tx = firstTileX; tx <= lastTileX; tx++) {
      for (const made of tileInstances(spec, elements, tx, ty)) {
        const { cx, cy } = made.cell;
        if (cx < low.cx || cx > high.cx || cy < low.cy || cy > high.cy) continue;
        if (!insideShapes(spec.shapes, made.cell)) continue;
        out.push(made);
        if (out.length >= limit) return out;
      }
    }
  }
  return out;
}

/**
 * What one repeat tile holds.
 *
 * Exported for the tests and for the scaffold's own copy to be checked
 * against; the renderer asks for a range.
 *
 * **Random** puts `density` elements at spaces drawn from the tile's own
 * hash. Two can land on the same space, and that is left alone deliberately:
 * rejecting collisions would make the count depend on the order they were
 * drawn in, and a scatter with a clearing in it is a scatter.
 *
 * **Grid** lays the same count out on the tightest square lattice that holds
 * it, spaced evenly across the tile. The *positions* stop being random; which
 * element stands at each of them does not, so a tiled floor made of four
 * tiles is not four copies of the same tile.
 */
export function tileInstances(
  spec: PatternSpec,
  elements: readonly PatternElement[],
  tileX: number,
  tileY: number,
): PatternInstance[] {
  const cols = Math.max(1, Math.round(spec.repeat.cols));
  const rows = Math.max(1, Math.round(spec.repeat.rows));
  const count = Math.max(1, Math.round(spec.density));
  const originX = tileX * cols;
  const originY = tileY * rows;

  const out: PatternInstance[] = [];
  // The lattice grid mode lays out on: as square as the count allows, so
  // four go down as 2 × 2 and six as 3 × 2 rather than a line of six.
  const side = Math.ceil(Math.sqrt(count));
  const down = Math.ceil(count / side);

  for (let i = 0; i < count; i++) {
    const seed = spec.seed >>> 0;
    let cx: number;
    let cy: number;
    if (spec.type === "grid") {
      // Cell centres of an even division, so the arrangement is inset from
      // the tile's edges rather than sitting on them — two neighbouring
      // tiles would otherwise put their elements on adjacent spaces and the
      // lattice would read as pairs.
      cx = originX + Math.floor(((i % side) + 0.5) * (cols / side));
      cy = originY + Math.floor((Math.floor(i / side) + 0.5) * (rows / down));
    } else {
      cx = originX + (hash(seed, tileX, tileY, i, 1) % cols);
      cy = originY + (hash(seed, tileX, tileY, i, 2) % rows);
    }
    const element = elements[hash(seed, tileX, tileY, i, 3) % elements.length];
    out.push({
      id: `${tileX}:${tileY}:${i}`,
      element,
      cell: { cx, cy },
    });
  }
  return out;
}

/**
 * Whether a space is inside the pattern's shapes.
 *
 * An empty list is everywhere, which is the default and what makes a fresh
 * pattern layer infinite. A shape with neither cells nor points — which a
 * hand-edited document could hold — is nowhere rather than everywhere, since
 * the alternative is a shape list that silently stops confining anything.
 */
export function insideShapes(
  shapes: readonly PatternShape[],
  cell: Cell,
): boolean {
  if (shapes.length === 0) return true;
  return shapes.some((shape) => insideShape(shape, cell));
}

/**
 * Cells and nothing else.
 *
 * A shape drawn with the pencil keeps its outline for the canvas to draw, but
 * it is **baked** into the spaces it covers when it is made — `cellsInPolygon`
 * — so the question asked once per element per frame is a set membership
 * rather than a point-in-polygon walk over a few hundred vertices. A shape
 * with no spaces is nowhere, which is what a hand-edited document holding
 * only an outline means here.
 */
function insideShape(shape: PatternShape, cell: Cell): boolean {
  return (shape.cells ?? []).some((c) => c.cx === cell.cx && c.cy === cell.cy);
}

/**
 * A 32-bit hash of a tile, an index and a channel.
 *
 * Deliberately arithmetic rather than a seeded generator object: the exported
 * game has to produce the same numbers from the same inputs, in JavaScript
 * written into the project's own tree, and a stateful generator would have to
 * be stepped in the same order by both halves. This one is a pure function of
 * what it is given, so the two can disagree about everything else.
 *
 * It is xorshift-flavoured mixing — good enough that a scatter looks
 * unconsidered, and not pretending to be more than that.
 */
export function hash(
  seed: number,
  tileX: number,
  tileY: number,
  index: number,
  channel: number,
): number {
  let h = (seed ^ 0x9e3779b9) >>> 0;
  for (const value of [tileX, tileY, index, channel]) {
    h = (h ^ (value >>> 0)) >>> 0;
    h = Math.imul(h, 0x85ebca6b) >>> 0;
    h = (h ^ (h >>> 13)) >>> 0;
    h = Math.imul(h, 0xc2b2ae35) >>> 0;
    h = (h ^ (h >>> 16)) >>> 0;
  }
  return h >>> 0;
}
