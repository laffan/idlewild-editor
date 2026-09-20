/**
 * Carrying a placed PSD from one document layer to another, and the one
 * question that has to be asked first.
 *
 * The carry itself is `DocStore.movePlacements` and needs nothing from here.
 * What needs saying is what it does to a **tile layer**: a PSD on one is a
 * palette, and the tiles put down from it are gids — *the nth tile across
 * every tileset in the map* — rather than copies of the artwork. So carrying
 * the file off the layer does not move the tiles and does not break them
 * either. It orphans them: the document goes on describing them perfectly,
 * the palette is still in `GameDoc.tilesets` because a `firstgid` handed out
 * is permanent, and the canvas draws nothing at all, because nothing on that
 * layer loads the file the artwork comes from any more.
 *
 * That is the worst of the two possible wrongs — a document that is right
 * about a picture nobody can see — so the tiles go with the file, and the
 * user is told before it happens rather than after.
 *
 * **Asked rather than assumed.** Tiles are work: a hillside somebody painted
 * over ten minutes is a hundred gids, and taking them away as a side effect
 * of dragging a row in a list would be the editor throwing work away on a
 * gesture that says nothing about tiles. The sheet names the file, counts the
 * tiles and says both halves of what is about to happen.
 *
 * Its own file rather than a branch inside `layer-drag.ts`, which is about
 * what a finger on the layer panel *means* — and because the question is
 * about the document rather than about the gesture, so anything else that
 * grows a way to carry a file between layers asks it by calling this.
 */

import { confirmSheet } from "../lib/sheet";
import { pruneLayerGroups } from "../lib/groups";
import { layerKind } from "../lib/layer-kinds";
import { eraseTiles, tilesFromPsd } from "../lib/tile-layers";
import type { DocStore } from "../lib/doc-store";
import type { Cell } from "../lib/types";
import * as log from "../lib/log";

/** The tiles a carry would orphan, by the file they were cut from. */
export interface OrphanedTiles {
  psdKey: string;
  cells: Cell[];
}

/**
 * Which tiles on `layerId` are made from the files these placements draw.
 *
 * Empty for every layer that is not a tile layer, which is what lets the
 * caller ask unconditionally. Keyed by file rather than flattened, because
 * the sheet names the files and a carry of two palettes should say two.
 */
export function orphanedByCarry(
  store: DocStore,
  layerId: string,
  placementIds: readonly string[],
): OrphanedTiles[] {
  const layer = store.layer(layerId);
  if (!layer || layerKind(layer) !== "tile") return [];
  const carried = new Set(placementIds);
  const keys = new Set(
    layer.placements.filter((p) => carried.has(p.id)).map((p) => p.psdKey),
  );

  const out: OrphanedTiles[] = [];
  for (const psdKey of keys) {
    // A file carried away one layer at a time is still on the layer until the
    // last of its layers goes, and its tiles are still drawable: only a file
    // that is *leaving* takes its tiles with it.
    const staying = layer.placements.some(
      (p) => p.psdKey === psdKey && !carried.has(p.id),
    );
    if (staying) continue;
    const cells = tilesFromPsd(store, layerId, psdKey);
    if (cells.length) out.push({ psdKey, cells });
  }
  return out;
}

/**
 * Carry the placements to another layer, asking first where tiles would go
 * with them.
 *
 * Answers whether the carry happened, so the caller can leave the list and
 * the selection where they were when the answer was no.
 *
 * One undo step covers all of it — the tiles, the carry, and the group the
 * carry may have taken the last member out of. A history that could put the
 * file back without putting the tiles back would be a step that half happened.
 */
export async function carryPlacements(
  store: DocStore,
  fromLayerId: string,
  placementIds: readonly string[],
  toLayerId: string,
): Promise<boolean> {
  if (fromLayerId === toLayerId || placementIds.length === 0) return false;

  const orphaned = orphanedByCarry(store, fromLayerId, placementIds);
  if (orphaned.length > 0) {
    const sure = await confirmSheet(
      orphaned.length === 1
        ? `Carry ${orphaned[0].psdKey}.psd off this layer?`
        : `Carry ${orphaned.length} palettes off this layer?`,
      `${describe(orphaned)} go with them. A tile is a number pointing into ` +
        "a palette rather than a copy of the artwork, so tiles left behind " +
        "by the file they were cut from draw nothing at all.",
      "Carry it over",
      false,
    );
    if (!sure) return false;
  }

  store.history.group(() => {
    for (const held of orphaned) eraseTiles(store, fromLayerId, held.cells);
    store.movePlacements(fromLayerId, placementIds, toLayerId);
    // A group is one layer's, so a unit carried away leaves it.
    pruneLayerGroups(store, fromLayerId);
  });

  for (const held of orphaned) {
    log.info(
      `${held.psdKey}.psd left the layer — ${count(held.cells.length)} went with it`,
    );
  }
  return true;
}

/** What the sheet says is about to go. */
function describe(orphaned: readonly OrphanedTiles[]): string {
  const total = orphaned.reduce((sum, held) => sum + held.cells.length, 0);
  if (orphaned.length === 1) {
    return `The ${count(total)} on this layer made from it`;
  }
  return `The ${count(total)} on this layer made from them`;
}

function count(n: number): string {
  return `${n} ${n === 1 ? "tile" : "tiles"}`;
}
