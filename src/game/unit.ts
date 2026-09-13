/**
 * A placed PSD, as one thing rather than several.
 *
 * Placing a PSD makes one placement per placeable layer, because that is what
 * psd-to-phaser hands back and what the inspector needs to talk about. But a
 * file with three layers in it is still *one thing someone dropped on the
 * grid*, and dragging a roof off its tower is almost never what was meant. So
 * the placements one `placePsd` call produces share a **unit**, and the canvas
 * works on the unit by default.
 *
 * **A unit is not an instance**, and the two are worth keeping apart the way
 * the two senses of "layer" are. A unit is the layers of *one* placed PSD: how
 * many rectangles move when you drag. An **instance** is one of several placed
 * PSDs reading the *same file*: how many things on the grid an edit to that
 * file would change. One file can stand on the grid as three units of three
 * layers each; every one of those units is an instance of the file, and every
 * placement belongs to exactly one unit. See `instances.ts`.
 *
 * The unit's id is stored on a placement as `instance`, which is the older
 * name and stays on disk: renaming a field that every document in every
 * project carries, and that the exported game reads, to say the same thing a
 * different way is not a trade worth making. Every reader of it comes through
 * `unitOf`.
 *
 * It is optional there, because documents written before units existed have
 * none. `unitOf` reads a placement's own id in that case, which makes such a
 * placement a unit of one — and the scene migrates whole documents on load, so
 * that fallback is a floor rather than the usual path.
 */

import type { Layer, Placement, Rect } from "../lib/types";

/** The unit a placement belongs to. */
export function unitOf(placement: Placement): string {
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
 * drag, which carries a single placement to another layer and so takes it out
 * of the unit it was in.
 */
export function unitMembers(
  layers: readonly Layer[],
  layerId: string,
  unit: string,
): Placement[] {
  const layer = layers.find((l) => l.id === layerId);
  if (!layer) return [];
  return layer.placements.filter((p) => unitOf(p) === unit);
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
