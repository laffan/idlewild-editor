/**
 * What is drawn over what.
 *
 * Two orderings and the arithmetic that expresses them, split out of
 * `doc-renderer.ts` when that file reached its 700 lines — and a clean seam
 * rather than a convenient one: nothing here touches Phaser's display list or
 * the document store. It is the answer to "which of these two is in front",
 * and the exported game's own `WorldScene.js` carries the same answer in its
 * `drawOrder` and `applyDepth` blocks, because it cannot import this.
 * `game/__tests__/draw-order.test.ts` holds the two to the same fixtures.
 *
 * A **document layer** gets a slot `DEPTH_STRIDE` wide, counted from the back:
 * layer index N of M renders at `(M - N) × DEPTH_STRIDE`. Inside that slot each
 * placed unit takes the next whole number up, and inside *that* the parts of a
 * multi-layer PSD are spread across the fraction.
 */

import { unitOf } from "./unit";
import type { Collider, Layer, Placement } from "../lib/types";
import type { PlacedObject } from "./doc-renderer";

/** One document layer's worth of depth. Shared with `background-render.ts`
 *  and `pattern-render.ts`, which place things in the same slots. */
export const DEPTH_STRIDE = 1000;

/**
 * Give a placed object its depth, keeping a group's own stacking under it.
 *
 * psd-to-phaser grafts its own `setDepth` onto a Group, and that one recurses:
 * every child is given the *same* number. For a PSD placed one layer at a time
 * that was harmless — a Group of one — but an extrusion's artwork is a group
 * of three, and one number for all of them is the stacking gone. The file was
 * right and the canvas was wrong, which is the worst way for this to fail.
 *
 * So a group's children are ranked by the depth they already have — which
 * psd-to-phaser set from the manifest's `initialDepth` when it made them — and
 * spread across the interval below the next placement. Fractions rather than
 * whole numbers because the placements on a document layer are one apart, and
 * there is no room between them for anything else.
 *
 * Idempotent: ranking on the current depth gives the same order next time,
 * because the spread is monotonic in the rank.
 */
export function applyDepth(object: PlacedObject, depth: number): void {
  const children = object.getChildren?.() ?? [];
  if (children.length < 2) {
    object.setDepth(depth);
    return;
  }
  const ranked = [...children].sort((a, b) => depthOf(a) - depthOf(b));
  ranked.forEach((child, rank) => {
    const at = depth + (rank + 1) / (ranked.length + 1);
    (child as { setDepth?: (v: number) => unknown }).setDepth?.(at);
  });
}

function depthOf(child: unknown): number {
  const depth = (child as { depth?: unknown }).depth;
  return typeof depth === "number" ? depth : 0;
}

/**
 * Everything on one document layer, back to front.
 *
 * Two orderings, one inside the other.
 *
 * **Between placed PSDs.** Sort on the outermost edge of each one's collider —
 * see `nearRow` — and a thing standing nearer the viewer draws in front of one
 * behind it, which is what an isometric object layer wants. The whole unit
 * sorts on one edge rather than each of its layers separately: a roof sits
 * higher up the screen than the tower under it, and sorting the two against
 * each other would put the roof behind the building every time. Otherwise they
 * are left in the order they were placed — every layer of a flat projection,
 * and a pattern or background layer of either, neither of which holds things
 * standing anywhere. The caller decides; see `ordersByHand` in
 * `lib/units.ts`.
 *
 * **Within one placed PSD.** The author's stack, and nothing else. A PSD is a
 * stack of layers and the order is the artwork — psd-to-json reports it,
 * psd-to-phaser applies it to every object it creates, and this used to
 * overwrite all of them with a single depth per document layer, which left
 * the stacking to the order Phaser was handed the objects in. That order was
 * top-first, so every multi-layer PSD was drawn upside down.
 */
/**
 * The isometric ordering's key: the outermost edge of a unit's **collider**,
 * in rows.
 *
 * A collider is the record of which grid spaces a file stands on — the spaces
 * its base covers, or the ones an extrusion's voxels rest on at level zero —
 * so it is the footprint, and on an isometric grid `cx + cy` counts rows away
 * from the camera. The largest of them is the corner of the footprint nearest
 * the camera, where the two visible faces of a box meet, and **one row further
 * on** is the line straight up from that corner: a space whose middle is on
 * that line is past the object and draws in front of it.
 *
 * Read off the collider rather than guessed from the pixels. The bottom edge
 * of the artwork is a reasonable approximation and only that: a cast shadow, a
 * bit of transparent margin or a picture pasted flat all move it, and none of
 * them move where the thing stands. The collider is the answer this editor
 * already holds and the one a person can correct by hand.
 *
 * A collider is a fact about the *file*, so it is looked up per placement and
 * the first answer wins; failing that, the anchor — a unit of one space.
 */
function nearRow(
  unit: readonly Placement[],
  colliderOf: ColliderLookup | undefined,
): number {
  let best: number | null = null;
  for (const placement of unit) {
    for (const cell of colliderOf?.(placement)?.cells ?? []) {
      const row = placement.anchor.cx + cell.cx + placement.anchor.cy + cell.cy;
      if (best === null || row > best) best = row;
    }
  }
  if (best === null) {
    for (const placement of unit) {
      const row = placement.anchor.cx + placement.anchor.cy;
      if (best === null || row > best) best = row;
    }
  }
  return (best ?? 0) + 1;
}

/**
 * Where to find the collider of the file behind a placement.
 *
 * Handed in rather than read here, because the two sides keep it in different
 * places: the document holds one record per PSD key, and the config the
 * exported game reads writes it onto the first placement of each unit.
 */
export type ColliderLookup = (placement: Placement) => Collider | undefined;

export function drawOrder(
  placements: readonly Placement[],
  isometric: boolean,
  colliderOf?: ColliderLookup,
): Placement[] {
  const units = new Map<string, Placement[]>();
  for (const placement of placements) {
    const unit = units.get(unitOf(placement));
    if (unit) unit.push(placement);
    else units.set(unitOf(placement), [placement]);
  }

  const sorted = [...units.values()];
  if (isometric) {
    // The outermost edge of each unit's collider — see `nearRow`. Stable, so
    // two units whose near edges are level keep the order they were placed in:
    // the only answer available, and the one the panel lists.
    sorted.sort((a, b) => nearRow(a, colliderOf) - nearRow(b, colliderOf));
  }

  return sorted.flatMap((unit) =>
    [...unit].sort((a, b) => (a.order ?? 0) - (b.order ?? 0)),
  );
}

export function layerDepth(layers: readonly Layer[], layerId: string): number {
  const index = layers.findIndex((l) => l.id === layerId);
  return index < 0 ? 0 : (layers.length - index) * DEPTH_STRIDE;
}
