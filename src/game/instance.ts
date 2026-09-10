/**
 * A placed PSD, as one thing rather than several.
 *
 * Placing a PSD makes one placement per placeable layer, because that is what
 * psd-to-phaser hands back and what the inspector needs to talk about. But a
 * file with three layers in it is still *one thing someone dropped on the
 * grid*, and dragging a roof off its tower is almost never what was meant. So
 * the placements one `placePsd` call produces share an `instance`, and the
 * canvas works on the instance by default.
 *
 * `instance` is optional on disk, because documents written before this
 * existed have none. `instanceOf` reads a placement's own id in that case,
 * which makes such a placement a unit of one — and the scene migrates whole
 * documents on load, so that fallback is a floor rather than the usual path.
 */

import type { Layer, Placement, Rect } from "../lib/types";

/** The unit a placement belongs to. */
export function instanceOf(placement: Placement): string {
  return placement.instance ?? placement.id;
}

/** Where a placement sits, as a box. */
export function placementRect(placement: Placement): Rect {
  return {
    x: placement.x,
    y: placement.y,
    width: placement.width,
    height: placement.height,
  };
}

/**
 * Every placement of one unit, and the layer holding them.
 *
 * A unit never spans document layers: the placements are made together on one
 * layer, and the only thing that moves one afterwards is the layer panel's
 * drag, which moves a single placement and so takes it out of its unit — see
 * `detachFromInstance`.
 */
export function instanceMembers(
  layers: readonly Layer[],
  layerId: string,
  instance: string,
): Placement[] {
  const layer = layers.find((l) => l.id === layerId);
  if (!layer) return [];
  return layer.placements.filter((p) => instanceOf(p) === instance);
}

/** The box around a unit. */
export function unionRect(placements: readonly Placement[]): Rect | null {
  if (placements.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of placements) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x + p.width > maxX) maxX = p.x + p.width;
    if (p.y + p.height > maxY) maxY = p.y + p.height;
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/**
 * Scale one member of a unit against the unit's own box.
 *
 * A unit resizes exactly, unlike the Phaser Group underneath it: every
 * placement is an independent rectangle in the document, so a member's offset
 * inside the unit scales with its size and the composition holds together.
 * That is the whole reason resizing is done here rather than by handing a
 * scale to `place()`.
 */
export function scaleWithin(
  placement: Placement,
  before: Rect,
  after: Rect,
): Pick<Placement, "x" | "y" | "width" | "height"> {
  // Aspect is locked by `resizeBox`, so one factor serves both axes; the
  // guard is for a unit that somehow has no width to divide by.
  const factor = before.width > 0 ? after.width / before.width : 1;
  return {
    x: after.x + (placement.x - before.x) * factor,
    y: after.y + (placement.y - before.y) * factor,
    width: placement.width * factor,
    height: placement.height * factor,
  };
}
