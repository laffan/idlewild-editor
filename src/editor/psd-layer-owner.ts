/**
 * Which of a PSD's layer names belong to the editor rather than to its author.
 *
 * Apart from the list that shows them because it is *policy*, not a widget:
 * the two orienting marks and an extrusion's artwork are found or regenerated
 * by name on every parse, so a rename of one is not an edit — it is a way to
 * break something quietly. The list asks this and renders the answer.
 */

import { ICONS } from "../lib/dom";
import { isExtrusionPart, isMarkLayer } from "../lib/manifest";
import type { PsdLayerInfo } from "../lib/ipc";

/**
 * A layer this editor owns the name of, and what it offers in its place.
 *
 * `reason` is what the field says when it will not be typed in. `action` is
 * the button on the right of the row — the one thing an owned layer can do
 * that an ordinary one cannot.
 */
export interface OwnedLayer {
  reason: string;
  action?: {
    icon: string | readonly string[];
    label: string;
    run: () => void;
  };
}

/**
 * Which of a PSD's layers this editor owns the name of.
 *
 * The two orienting marks on any file it wrote — `P | anchor` is looked up by
 * name on every parse, and renaming it silently costs the artwork its
 * alignment on the next re-import — and, on an extrusion, the group holding
 * its artwork and every part inside it. Apply regenerates all four under the
 * file's own key, so a new name would survive exactly one Apply.
 *
 * The group is also the way back in: its row carries the button that reopens
 * the solid. On the group rather than on a part because the group is the
 * thing the parts add up to, and it is the row a placement points at.
 */
export function psdLayerOwner(
  layer: PsdLayerInfo,
  key: string,
  isExtrusion: boolean,
  onExtrude: () => void,
): OwnedLayer | null {
  // The exported name, not the whole label: `manifestName` is what a
  // placement's path is made of, and it is what psd-to-json reads too.
  const named = manifestName(layer.name)?.toLowerCase() ?? "";
  if (isMarkLayer(named)) {
    return {
      reason:
        layer.category === "point"
          ? "The editor finds this mark by name — it cannot be renamed"
          : "The editor writes this mark — it cannot be renamed",
    };
  }
  if (!isExtrusion) return null;

  // The group the parts live in, which is what a placement points at.
  if (named === key.toLowerCase()) {
    return {
      reason: "Extrude mode writes this group — it cannot be renamed",
      action: {
        icon: ICONS.box,
        label: "Continue extruding this shape",
        run: onExtrude,
      },
    };
  }
  if (isExtrusionPart(key, named)) {
    return { reason: "Extrude mode writes this layer — it cannot be renamed" };
  }
  return null;
}

/**
 * The name psd-to-json will export a layer under — the second pipe segment,
 * which is what a placement's `layerPath` is made of. Null for a name the
 * parser ignores altogether.
 */
export function manifestName(layerName: string): string | null {
  const parts = layerName.split("|").map((part) => part.trim());
  if (parts.length < 2 || parts.length > 4) return null;
  return parts[1] || null;
}
