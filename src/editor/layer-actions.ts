/**
 * Getting rid of a document layer.
 *
 * The left panel could add a layer and reorder, rename, lock and hide one,
 * and there was no way at all to remove one — so the inspector grew a Delete
 * layer button and this is what stands behind it.
 *
 * It asks first, for the reason deleting a scene asks first: everything drawn
 * on the layer goes with it and there is no undo anywhere in this editor yet.
 * What it does *not* delete is any PSD — a placement is a drawing of a file,
 * the file lives in `psd/`, and the whole project's other scenes may be
 * drawing it too.
 *
 * Here rather than in the shell because it is a question with a sheet in
 * front of it, and the shell only wants the answer.
 */

import { confirmSheet } from "../lib/sheet";
import type { DocStore } from "../lib/doc-store";
import type { Layer } from "../lib/types";
import { count } from "./layers-panel";
import * as log from "../lib/log";

/**
 * Ask, and delete if the answer is yes.
 *
 * @returns whether the layer went, so the caller knows to move the selection
 *          and the active layer off it.
 */
export async function confirmDeleteLayer(
  store: DocStore,
  layerId: string,
): Promise<boolean> {
  const layer = store.layer(layerId);
  if (!layer) return false;
  if (store.layers.length <= 1) {
    log.warn("A scene keeps at least one layer");
    return false;
  }

  const on = describeContents(layer);
  const ok = await confirmSheet(
    `Delete ${layer.name}?`,
    on
      ? `${on} on it goes with it. The PSDs themselves stay in the project.`
      : "There is nothing on it.",
    "Delete",
    false,
  );
  if (!ok) return false;

  store.removeLayer(layerId);
  log.info(`Deleted layer ${layer.name}`);
  return true;
}

/**
 * What would go with the layer, in a sentence.
 *
 * A placed PSD is counted as the **unit** it is — one file dropped on the
 * canvas is one thing however many layers came in with it — because that is
 * what the left panel lists and what the number has to agree with.
 */
function describeContents(layer: Layer): string {
  const units = new Set(
    layer.placements.map((p) => p.instance ?? p.id),
  ).size;
  const parts: string[] = [];
  if (units) parts.push(count(units, "placed PSD"));
  if (layer.fills.length) parts.push(count(layer.fills.length, "fill"));

  const zones = layer.zones.length;
  if (zones) parts.push(`${zones} ${zones === 1 ? "boundary" : "boundaries"}`);
  if (layer.strokes.length) parts.push(count(layer.strokes.length, "stroke"));
  if (parts.length === 0) return "";
  if (parts.length === 1) return parts[0];
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}
