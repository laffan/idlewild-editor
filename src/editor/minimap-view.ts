/**
 * What the minimap shows, as arithmetic.
 *
 * The world has no bounds — the lattice is recomputed from the camera over
 * exactly the cells it can see, and there is nothing to hit — so "fit the
 * whole map in the box" is not a question with an answer. What the minimap
 * frames instead is **everything that has been put down, together with where
 * the camera is standing**, which is the pair of facts it exists to carry.
 * Move about inside your own work and the frame holds still, because the
 * union is the work; walk off the edge of it and the frame opens out to keep
 * both you and the work in view, which is the only way back.
 *
 * The extent is then grown to the shape of the box rather than letterboxed
 * into it. A "contain" fit leaves strips down two sides, and those strips are
 * world as much as the middle is: painting them as anything else would draw
 * an edge onto a canvas that has none.
 *
 * Kept apart from the panel that draws it because all of this is arithmetic
 * over the document, and that is the half worth testing.
 */

import { fillShape, pointsBounds, type Grid } from "../lib/grid";
import { strokesBox } from "../drawing";
import type { Cell, Layer, Point, Rect } from "../lib/types";

/** How much room is left around the content, as a share of its longer side. */
const MARGIN = 0.06;

/** A box in whatever pixels the caller is drawing into. */
export interface Size {
  width: number;
  height: number;
}

/**
 * The map's projection: the world rect it is showing, and how many box pixels
 * a world pixel is worth. There is no second axis — the extent is grown to
 * the box's shape first, so one scale describes both.
 */
export interface MiniView {
  world: Rect;
  scale: number;
}

/**
 * The box around everything on the visible layers of a scene, or null for a
 * scene with nothing in it yet.
 *
 * Hidden layers are left out for the reason the canvas leaves them out: the
 * minimap is a small picture of what you are looking at, and a backdrop you
 * have turned off is not part of that.
 */
export function contentBounds(
  layers: readonly Layer[],
  grid: Grid,
): Rect | null {
  let box: Rect | null = null;
  for (const layer of layers) {
    if (!layer.visible) continue;
    for (const fill of layer.fills) {
      box = union(box, fillShape(grid, fill)?.bounds ?? null);
    }
    for (const placement of layer.placements) box = union(box, placement);
    for (const zone of layer.zones) {
      if (zone.points.length) box = union(box, pointsBounds(zone.points));
    }
    for (const point of layer.points) box = union(box, cellBox(grid, point.cell));
    box = union(box, strokesBox(layer.strokes));
  }
  return box;
}

/**
 * Where to put the content and the camera so that both are in the box.
 *
 * `scale` comes back as zero when there is no box to draw into — a sidebar
 * that is folded away has no width — and nothing should paint against that.
 */
export function miniView(
  content: Rect | null,
  camera: Rect,
  box: Size,
): MiniView {
  const shown = union(content, camera) ?? camera;
  // A margin, so the thing at the edge of a document is not drawn hard
  // against the edge of the panel.
  const pad = Math.max(shown.width, shown.height, 1) * MARGIN;
  const world = grow(shown, pad);

  if (box.width <= 0 || box.height <= 0) return { world, scale: 0 };

  const wide = world.width / world.height > box.width / box.height;
  const width = wide ? world.width : world.height * (box.width / box.height);
  const height = wide ? world.width * (box.height / box.width) : world.height;
  return {
    world: {
      x: world.x - (width - world.width) / 2,
      y: world.y - (height - world.height) / 2,
      width,
      height,
    },
    scale: box.width / width,
  };
}

/** A world point, in the box's pixels. */
export function toBox(view: MiniView, p: Point): Point {
  return {
    x: (p.x - view.world.x) * view.scale,
    y: (p.y - view.world.y) * view.scale,
  };
}

/** And back: what a finger on the map is pointing at. */
export function toWorld(view: MiniView, p: Point): Point {
  return {
    x: view.world.x + p.x / view.scale,
    y: view.world.y + p.y / view.scale,
  };
}

/** The world rect a viewport covers — the frame drawn over the map. */
export function cameraRect(view: {
  originX: number;
  originY: number;
  zoom: number;
  width: number;
  height: number;
}): Rect {
  return {
    x: view.originX,
    y: view.originY,
    width: view.width / view.zoom,
    height: view.height / view.zoom,
  };
}

/** The box one grid space covers, which is a diamond on an isometric grid. */
function cellBox(grid: Grid, cell: Cell): Rect {
  return pointsBounds(grid.cellPolygon(cell));
}

/**
 * Two boxes as one. Always a box of its own, never one of the arguments: the
 * boxes handed in are a placement out of the document and the stroke
 * geometry's cached bounds, and neither is this module's to hand on.
 */
function union(a: Rect | null, b: Rect | null): Rect | null {
  if (!b) return a;
  if (!a) return { x: b.x, y: b.y, width: b.width, height: b.height };
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return {
    x,
    y,
    width: Math.max(a.x + a.width, b.x + b.width) - x,
    height: Math.max(a.y + a.height, b.y + b.height) - y,
  };
}

function grow(rect: Rect, by: number): Rect {
  return {
    x: rect.x - by,
    y: rect.y - by,
    width: rect.width + by * 2,
    height: rect.height + by * 2,
  };
}
