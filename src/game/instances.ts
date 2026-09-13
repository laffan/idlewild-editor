/**
 * Instances: the placed PSDs that share a file.
 *
 * Option-drag a placed PSD and the copy points at the same `psd/<key>.psd`.
 * That is the useful thing about it — a row of the same lamp-post costs one
 * file and one set of textures, and repainting the lamp-post repaints the row —
 * and it is also the thing that has to be *said*, because otherwise editing one
 * lamp-post silently edits five.
 *
 * The word for those objects is **instance**, and the editor used to call them
 * *references*: "Reference · 3 copies of this layer", with a button called
 * Remove Reference. Both halves were wrong about what they described. A
 * reference reads as one object pointing at another — as though one of the five
 * lamp-posts were the real one — when in fact none of them is: they are five
 * equal instances of a file, and deleting any of them leaves the rest exactly
 * as they were. And "Remove Reference" names the mechanism rather than the
 * result, which is not removal at all: the file is copied and this object is
 * pointed at the copy. **Make Unique** is what that does.
 *
 * **An instance is not a unit.** A unit is the layers of one placed PSD, which
 * move and resize together; an instance is one of several units drawing the
 * same file. `unit.ts` is the other half of this pair, and the two must not be
 * mixed: a three-layer PSD dropped once is one instance made of three
 * placements, and the inspector says both things about it in different rows.
 *
 * Every question here is asked of **every scene**, not of the open one. A file
 * is project-wide — `psd/` is one directory — so "would editing this change
 * something else?" is not a question about the canvas you happen to be looking
 * at, and one that stopped at the edge of it would answer no about the case
 * that matters most.
 */

import type { Layer, Placement } from "../lib/types";
import { unitOf } from "./unit";

/** Where a unit is: which layer holds it, and its id. */
export interface UnitRef {
  layerId: string;
  unit: string;
}

/**
 * Every unit in the project that draws this PSD.
 *
 * Units rather than placements, because a placement is a *layer* of a file and
 * a file with three of them placed once is one thing standing on the grid. The
 * old count was of placements matching both the key and the layer path, which
 * came to the same number for the copies an option-drag makes and to nonsense
 * for anything else — a PSD placed once as three layers counted as one for one
 * of its rows and as one for another, so the two never disagreed by accident.
 */
export function unitsOfKey(
  layers: readonly Layer[],
  psdKey: string,
): UnitRef[] {
  const seen = new Set<string>();
  const out: UnitRef[] = [];
  for (const layer of layers) {
    for (const placement of layer.placements) {
      if (placement.psdKey !== psdKey) continue;
      const unit = unitOf(placement);
      const at = `${layer.id}/${unit}`;
      if (seen.has(at)) continue;
      seen.add(at);
      out.push({ layerId: layer.id, unit });
    }
  }
  return out;
}

/** How many things on the grid an edit to this PSD would change. */
export function instanceCount(
  layers: readonly Layer[],
  psdKey: string,
): number {
  return unitsOfKey(layers, psdKey).length;
}

/**
 * Whether this placement is one of several objects sharing its file.
 *
 * The question the canvas and the inspector both ask — the canvas to outline it
 * differently, the inspector to say so and offer Make Unique. One object alone
 * on a file is not an instance of anything, so it is drawn and described as
 * what it is.
 */
export function isInstance(
  layers: readonly Layer[],
  placement: Placement,
): boolean {
  return instanceCount(layers, placement.psdKey) > 1;
}
