/**
 * Placed PSDs as *units*, and the order they draw in within a layer.
 *
 * Placing a PSD makes one placement per placeable layer in the file, and they
 * share an `instance` — on the canvas they are one thing, dragged and resized
 * together. So almost nothing outside the renderer wants the placements: it
 * wants the units, in the order they are drawn, and `layer.placements` is
 * that order flattened.
 *
 * Pure functions over a list, deliberately. Reordering is a document edit, but
 * *what the order is* is a question about a layer that the panel, the
 * renderer and the store all ask — and the store is at its line limit besides.
 * The panel writes through `DocStore.editLayer`, the same hatch the
 * kind-specific edits use.
 */

import type { Layer, Placement } from "./types";

/** The unit a placement belongs to. Absent on documents written before units
 *  existed, where a placement is a unit of one — `game/instance.ts` mints the
 *  real ones on open. */
export function unitKey(placement: Placement): string {
  return placement.instance ?? placement.id;
}

/**
 * A layer's placements grouped into units, in the order they appear.
 *
 * First-seen order rather than sorted: `layer.placements` *is* the order, and
 * the first member of a unit is where that unit starts.
 */
export function unitsOf(placements: readonly Placement[]): Placement[][] {
  const units = new Map<string, Placement[]>();
  for (const placement of placements) {
    const held = units.get(unitKey(placement));
    if (held) held.push(placement);
    else units.set(unitKey(placement), [placement]);
  }
  return [...units.values()];
}

/**
 * The same, in the order they are actually drawn.
 *
 * Two orderings, and only one of them is anybody's to choose. On a flat
 * projection the document's order is the answer, which is what makes dragging
 * a row in the layer panel mean something. An **isometric** scene sorts on
 * screen Y instead, because a thing standing nearer the viewer draws in front
 * of one behind it — that is not a default, it is what makes the projection
 * read as a space at all, so it wins. The sort is stable, so the document's
 * order still separates two units standing on the same row.
 *
 * The panel lists units through here for exactly that reason: on isometric a
 * list in document order would be a list the canvas ignores.
 */
export function unitsInDrawOrder(
  placements: readonly Placement[],
  isometric: boolean,
): Placement[][] {
  const units = unitsOf(placements);
  if (!isometric) return units;
  const top = (unit: Placement[]) => Math.min(...unit.map((p) => p.y));
  return [...units].sort((a, b) => top(a) - top(b));
}

/**
 * Move one unit to a position in the layer's list, carrying its placements.
 *
 * A unit is one thing on the canvas, so its placements move as a block and
 * keep the arrangement inside them — what decides which of a file's own
 * layers is on top is `order`, which is the file's business and is untouched
 * here. Out-of-range indices are clamped rather than refused, so a drag that
 * overshoots the end of the list still lands, exactly as `reorderLayer` does.
 *
 * Answers the layer unchanged — same object — when nothing moved, so a
 * no-op drag does not write a document or push an undo step.
 */
export function reorderUnit(
  layer: Layer,
  instance: string,
  toIndex: number,
): Layer {
  const units = unitsOf(layer.placements);
  const from = units.findIndex((unit) => unitKey(unit[0]) === instance);
  if (from < 0) return layer;

  const to = Math.max(0, Math.min(units.length - 1, toIndex));
  if (to === from) return layer;

  const [moved] = units.splice(from, 1);
  units.splice(to, 0, moved);
  return { ...layer, placements: units.flat() };
}
