/**
 * Reading the canvas backwards: what is under a point, and what a box caught.
 *
 * Every one of these reads the **document** rather than the rendered Phaser
 * objects. A placement whose texture failed to load still has bounds, and has
 * to stay selectable so it can be inspected or removed; a boundary is a
 * polygon nobody draws a hit area for. They are pure functions over layers
 * for that reason, and tested as such.
 *
 * The shared rules: layers are stored top-first, so the front-most candidate
 * is the earliest layer with anything in it; within a layer a later object
 * draws over an earlier one; and locked or hidden layers are inert to the
 * pointer, the same rule Hush applies to its own pick paths.
 *
 * Split out of `doc-renderer.ts` for the 700-line rule, and it splits cleanly:
 * that file is about putting the document on the canvas, and this is the one
 * question asked of it from the other end.
 */

import { convexOverlapsRect, type Grid } from "../lib/grid";
import type { Layer, MapPoint, Placement, Point, Rect, Zone } from "../lib/types";

/** What a hit-test returns: the document record, not the rendered object. */
export interface PickResult {
  layerId: string;
  placement: Placement;
}

/** The same, for a boundary. */
export interface ZonePickResult {
  layerId: string;
  zone: Zone;
}

/** And for a named place. */
export interface PointPickResult {
  layerId: string;
  point: MapPoint;
}

/**
 * And how far from the middle of one a tap still counts, in the same units.
 *
 * Half a tile's height, which on a 64 px grid is sixteen world pixels: a
 * finger's worth without being a whole space, so a point never swallows the
 * tap meant for the ground it is standing on.
 */
const POINT_REACH = 0.5;

/**
 * How near a point a finger has to land to mean it, in world pixels.
 *
 * Shared with the drag controller, which asks the same question of the same
 * marker: picking one up has to have the same reach as picking it, or a point
 * can be selected in a place where it cannot then be moved.
 */
export function pointReach(grid: Grid): number {
  return grid.tileHeight * POINT_REACH;
}

/**
 * Find the front-most boundary under a world point.
 *
 * The same rules as `pickPlacement` — the document rather than the rendered
 * graphics, top-first layers, the last zone on a layer drawing over the ones
 * before it, locked and hidden layers inert — with the box test replaced by a
 * polygon test, because a boundary is a shape rather than a rectangle and
 * selecting one by its bounding box would catch the empty corners of every
 * L-shaped wall in the project.
 */
export function pickZone(
  layers: readonly Layer[],
  worldX: number,
  worldY: number,
): ZonePickResult | undefined {
  for (const layer of layers) {
    if (layer.locked || !layer.visible) continue;
    for (let i = layer.zones.length - 1; i >= 0; i--) {
      const zone = layer.zones[i];
      if (pointInPolygon({ x: worldX, y: worldY }, zone.points)) {
        return { layerId: layer.id, zone };
      }
    }
  }
  return undefined;
}

/**
 * The nearest named place within reach of a world point.
 *
 * Nearest rather than front-most, which is what every other picker here
 * answers: two markers close together are two dots a finger lands between,
 * and the one under the middle of the finger is the one meant. Locked and
 * hidden layers are inert, the same rule the others follow.
 */
export function pickPoint(
  grid: Grid,
  layers: readonly Layer[],
  worldX: number,
  worldY: number,
): PointPickResult | undefined {
  let best: PointPickResult | undefined;
  let nearest = pointReach(grid);
  for (const layer of layers) {
    if (layer.locked || !layer.visible) continue;
    for (const point of layer.points) {
      const at = grid.cellCentre(point.cell);
      const distance = Math.hypot(at.x - worldX, at.y - worldY);
      if (distance > nearest) continue;
      nearest = distance;
      best = { layerId: layer.id, point };
    }
  }
  return best;
}

/**
 * Even-odd containment. Shared with play mode's navigation, which asks the
 * same question of the same polygons from the other end.
 */
export function pointInPolygon(
  point: { x: number; y: number },
  polygon: readonly { x: number; y: number }[],
): boolean {
  if (polygon.length < 3) return false;
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i];
    const b = polygon[j];
    const straddles = a.y > point.y !== b.y > point.y;
    if (
      straddles &&
      point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x
    ) {
      inside = !inside;
    }
  }
  return inside;
}

/**
 * Find the front-most placement under a world point.
 *
 * This reads the document rather than the rendered Phaser objects: a
 * placement whose texture failed to load still has bounds, and has to stay
 * selectable so it can be inspected or removed.
 *
 * Layers are stored top-first and, within a layer, a later placement draws
 * over an earlier one — so the front-most candidate is the earliest layer's
 * final placement. Locked and hidden layers are inert to the pointer, the
 * same rule Hush applies to its own pick paths.
 */
/**
 * Every placement a box caught, on the front-most layer that has any.
 *
 * One layer's worth, because that is what a drag can move together — and the
 * layer is chosen by the same front-most-wins rule a tap follows, so a
 * marquee over a stack of layers picks the one you would have hit by tapping
 * rather than the one that happens to be active.
 *
 * A placement counts when the marquee *overlaps* it, not when it contains it:
 * dragging a box that swallows everything whole is the fiddly half of every
 * marquee, and nothing here is small enough to catch by accident.
 *
 * The marquee arrives as its own outline rather than as a rectangle, because
 * under an isometric template it is a diamond and the box around that diamond
 * is very much bigger than what was dragged — a marquee in one corner of the
 * screen would otherwise pick up images in another.
 */
export function pickPlacementsIn(
  layers: readonly Layer[],
  outline: readonly Point[],
): { layerId: string; ids: string[] } | null {
  for (const layer of layers) {
    if (layer.locked || !layer.visible) continue;
    const ids = layer.placements
      .filter((p) => convexOverlapsRect(outline, placementRect(p)))
      .map((p) => p.id);
    if (ids.length > 0) return { layerId: layer.id, ids };
  }
  return null;
}

function placementRect(placement: Placement): Rect {
  return {
    x: placement.x,
    y: placement.y,
    width: placement.width,
    height: placement.height,
  };
}

export function pickPlacement(
  layers: readonly Layer[],
  worldX: number,
  worldY: number,
): PickResult | undefined {
  for (const layer of layers) {
    if (layer.locked || !layer.visible) continue;
    for (let i = layer.placements.length - 1; i >= 0; i--) {
      const placement = layer.placements[i];
      if (
        worldX >= placement.x &&
        worldX <= placement.x + placement.width &&
        worldY >= placement.y &&
        worldY <= placement.y + placement.height
      ) {
        return { layerId: layer.id, placement };
      }
    }
  }
  return undefined;
}
