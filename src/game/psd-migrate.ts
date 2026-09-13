/**
 * What an older document has to be told before it can be drawn.
 *
 * Four repairs, all of them on open and none of them an edit anybody made.
 * Split from `psd-placements.ts` for the 700-line rule, and along a real seam:
 * everything else in that file is about one PSD *now*, and this is about
 * documents written by builds that did not have units, or recorded stacking, or
 * colliders. It runs once and is then never asked again.
 */

import { makeId } from "../lib/doc-store";
import type { DocStore } from "../lib/doc-store";
import type { Placement } from "../lib/types";
import * as log from "../lib/log";
import { unitOf } from "./unit";

/**
 * Bring a document written by an earlier build up to date.
 *
 * **Units.** Placements made before units existed get one each. They were made
 * the way `placePsd` still makes them — one call per PSD, one placement per
 * layer, all on the same document layer — so grouping by layer and key
 * reconstructs what was placed together. An option-drag copy of a multi-layer
 * PSD joins its original's unit, which is the one case this guesses wrong; a
 * double-tap and a drag separates them, and the alternative is every layer of
 * every old project moving on its own.
 *
 * **Stacking.** Placements made before the PSD's own layer order was recorded
 * get it from the order they are in, which was the manifest's.
 *
 * **Colliders.** Every placed key that has no record gets the same default a
 * fresh import would: an extrusion blocks the spaces it stands on, and anything
 * else blocks the spaces its artwork covers. Done on open rather than lazily,
 * because a collider that appeared the first time something asked for it would
 * make a project play differently depending on what had been looked at.
 */
export function repairDocument(
  store: DocStore,
  syncCollider: (key: string) => void,
): void {
  for (const layer of store.layers) {
    const assigned = new Map<string, string>();
    for (const placement of layer.placements) {
      if (placement.instance) continue;
      let unit = assigned.get(placement.psdKey);
      if (!unit) {
        unit = makeId("psd");
        assigned.set(placement.psdKey, unit);
      }
      // `instance` is the field the unit's id is stored under — the older name,
      // kept because every document and every export reads it. See `unit.ts`.
      store.updatePlacement(layer.id, placement.id, { instance: unit });
    }
  }

  // A document written before stacking was recorded has its placements in the
  // order they were made, which was the manifest's: top-first. So the first of
  // a unit was its top layer, and counting down from there is the stack it
  // should have had all along.
  for (const layer of store.layers) {
    const units = new Map<string, Placement[]>();
    for (const placement of layer.placements) {
      const held = units.get(unitOf(placement));
      if (held) held.push(placement);
      else units.set(unitOf(placement), [placement]);
    }
    for (const unit of units.values()) {
      if (unit.every((p) => p.order !== undefined)) continue;
      unit.forEach((placement, index) => {
        store.updatePlacement(layer.id, placement.id, {
          order: unit.length - 1 - index,
        });
      });
    }
  }

  // Every scene's keys, not the open scene's: a PSD standing in a scene nobody
  // has looked at this session is still in the export, and a collider nothing
  // ever wrote is a file that blocks nothing there.
  const keys = new Set<string>();
  for (const layer of store.allLayers) {
    for (const placement of layer.placements) keys.add(placement.psdKey);
  }
  for (const key of keys) {
    if (!store.collider(key)) syncCollider(key);
  }
}

/**
 * Rewrite the placeholder path early builds wrote.
 *
 * Those saved `layerPath: "root"`, which psd-to-phaser resolves by looking for
 * a layer of that name and never finds — the placement came back as an empty
 * group. Repoint it at the PSD's first real top-level layer.
 *
 * `data` is the plugin's parsed manifest for the placement's key, handed in
 * rather than looked up: this file has no business knowing there is a plugin.
 */
export function migrateLayerPath(
  store: DocStore,
  data: { original?: unknown } | undefined,
  layerId: string,
  placement: Placement,
): Placement {
  if (placement.layerPath !== "root") return placement;

  const layers = (data?.original as { layers?: Array<{ name?: string }> })
    ?.layers;
  const name = layers?.[0]?.name;
  if (!name) {
    log.warn(`${placement.psdKey} has no top-level layer to place`);
    return placement;
  }

  log.info(`Repointed ${placement.psdKey} from "root" to "${name}"`);
  store.updatePlacement(layerId, placement.id, { layerPath: name });
  return { ...placement, layerPath: name };
}
