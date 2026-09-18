/**
 * Several placed PSDs, made into one file.
 *
 * The opposite of every other conversion in this editor. Those turn one thing
 * into one file — an image, a sketch, a fill, a solid pulled off the grid —
 * and this takes files already standing on the grid, in the arrangement
 * somebody put them in, and writes *that arrangement* into a single document.
 * A wood drawn as nine files becomes `wood.psd`, and stays a wood: nine layers
 * in the places they were standing.
 *
 * **The editor owns the arrangement and Rust owns the file**, which is the
 * same division of labour the marks already keep. What crosses the bridge is
 * each placement's box in the merged file's own pixels — no cells, no
 * projection, no idea of a grid — so `psd_merge.rs` reads layers out of the
 * sources and stacks them in the order it is given, and nothing about a
 * diamond has to be true on that side.
 *
 * **Back-first.** The merged file has one stack and it had better be the one
 * that was on screen, so the parts go in in draw order — which on an isometric
 * object layer is screen Y rather than the document's order, and `lib/units.ts`
 * is what knows the difference.
 *
 * **The source files stay in the project.** What goes is the *placements*: a
 * placement is a drawing of a file, the file lives in `psd/`, and another
 * scene may well be drawing it too. So merging four trees into a copse leaves
 * `tree.psd` exactly where it was, and Export Assets still offers it.
 */

import {
  EXPORT_SCALE,
  IMPORT_SCALE,
  footprintForBox,
  marksForBox,
  marksForCells,
  psdMargin,
  scaleMarks,
} from "./import-anchor";
import { openPsdProgress } from "./psd-progress";
import { pruneLayerGroups } from "../lib/groups";
import { psd, type MergePart } from "../lib/ipc";
import { unionRect } from "../game/unit";
import { unitKey, unitsInDrawOrder } from "../lib/units";
import type { DocStore } from "../lib/doc-store";
import type { Grid } from "../lib/grid";
import type { WorldScene } from "../game/world-scene";
import type { Placement, Selection } from "../lib/types";
import { selectedUnits } from "./group-actions";
import * as log from "../lib/log";

/** What a merge needs from the shell around it. */
export interface MergeDeps {
  projectId: string;
  store: DocStore;
  grid: Grid;
  scene: () => WorldScene | null;
  selection: () => Selection | null;
  /** Redraw the left panel: rows go, and one arrives. */
  redrawLayers: () => void;
  /**
   * Make this the layer new work lands on, before the merged file is placed.
   *
   * `placePsd` puts a file on the *active* layer, and what is selected decides
   * which layer a merge is about — two facts that agree on every route into
   * this today, because picking anything sets the active layer. Saying it here
   * rather than relying on that is the difference between a guarantee and a
   * coincidence: a merged file landing on a different layer from the files it
   * was made of would be a silent change of draw order.
   */
  focusLayer: (layerId: string) => void;
  /** The file's own layer list is what anybody wants to see next. */
  onMerged?: () => void;
}

/**
 * The placements a merge is about, back-first.
 *
 * Draw order rather than document order, because those differ on an isometric
 * object layer and the merged file's stack is what the composite will be read
 * from. Within one placed PSD the document's order *is* the file's stack, so
 * the members of a unit keep the order they are stored in.
 *
 * Exported for the test: everything about a merge that can be wrong without
 * looking wrong is in this ordering.
 */
export function mergeOrder(
  store: DocStore,
  layerId: string,
  units: readonly string[],
  isometric: boolean,
): Placement[] {
  const layer = store.layer(layerId);
  if (!layer) return [];
  const wanted = new Set(units);
  return unitsInDrawOrder(layer, isometric)
    .filter((unit) => wanted.has(unitKey(unit[0])))
    .flat();
}

/**
 * Merge what is selected, place the file it makes, and take the originals off
 * the canvas.
 *
 * One undo step. The merge writes a file and the placements go, and a history
 * that could put the placements back without taking the file's placement away
 * would leave the same artwork on the grid twice.
 */
export async function mergeSelection(deps: MergeDeps): Promise<void> {
  const { store, grid } = deps;
  const scene = deps.scene();
  const chosen = selectedUnits(store, deps.selection());
  if (!scene || !chosen) {
    log.warn("Merge needs some placed PSDs selected");
    return;
  }
  if (chosen.units.length < 2) {
    log.warn("Merge needs two or more placed PSDs — one file is already one file");
    return;
  }

  const placements = mergeOrder(
    store,
    chosen.layerId,
    chosen.units,
    grid.projection === "isometric",
  );
  const box = unionRect(placements);
  if (!box || box.width <= 0 || box.height <= 0) {
    log.warn("Those placed PSDs have no artwork to merge");
    return;
  }

  // Where the merged artwork hangs from: **the middle of it**, rather than a
  // corner. A conversion of one thing anchors on the lowest corner of the
  // spaces it covers, because it is a thing standing on ground and that corner
  // is where it stands. What comes out of a merge is not one thing standing
  // anywhere — it is a composition with its own extent — so the honest fixed
  // point is its centre, which is also where an import with no opinion is
  // centred. Everything else follows from it: `art` is where the artwork's
  // corner sits relative to the anchor, and the anchor moving to the middle
  // simply makes those two numbers negative.
  const footprint = footprintForBox(grid, box);
  const anchor = grid.worldToCell({
    x: box.x + box.width / 2,
    y: box.y + box.height / 2,
  });
  const anchorWorld = grid.cellToWorld(anchor);
  const art = { x: box.x - anchorWorld.x, y: box.y - anchorWorld.y };

  const parts: MergePart[] = placements.map((placement) => ({
    key: placement.psdKey,
    path: placement.layerPath,
    left: (placement.x - box.x) * EXPORT_SCALE,
    top: (placement.y - box.y) * EXPORT_SCALE,
    width: placement.width * EXPORT_SCALE,
    height: placement.height * EXPORT_SCALE,
  }));

  // The Rust side names each source as it opens it and each part as it lays
  // it out, counted — `psd_merge.rs` — and those lines arrive here as they
  // happen. A merge of nine files is seconds of work inside one call, and a
  // sheet that said one thing for all of it could not be told from a hang.
  const progress = openPsdProgress(
    "Merging",
    `${chosen.units.length} placed PSDs into one file`,
    "Reading the files…",
  );

  try {
    const result = await psd.merge(
      deps.projectId,
      mergedName(placements),
      Math.max(1, Math.round(box.width * EXPORT_SCALE)),
      Math.max(1, Math.round(box.height * EXPORT_SCALE)),
      parts,
      scaleMarks(
        {
          ...(grid.snaps
            ? marksForCells(grid, footprint.cells, anchor, art)
            : marksForBox(grid, box, anchor)),
          // A space of clear canvas round the lot, as every file this editor
          // writes gets: the sources' own margins were their canvases', and
          // what comes out here has none until it is given one.
          margin: psdMargin(grid),
        },
        EXPORT_SCALE,
      ),
    );

    await progress.stage("Placing the artwork…");
    // The merged file goes where its sources were — see `focusLayer`.
    deps.focusLayer(chosen.layerId);
    store.history.begin();
    try {
      await scene.placePsd(result.key, result.manifest, anchor, IMPORT_SCALE);
      for (const placement of placements) {
        store.removePlacement(chosen.layerId, placement.id);
      }
      // Whatever group they were in has just lost every member of it.
      pruneLayerGroups(store, chosen.layerId);
    } finally {
      store.history.end();
    }
    deps.redrawLayers();
    deps.onMerged?.();
    log.info(
      `${chosen.units.length} placed PSDs → ${result.key}.psd ` +
        `(${result.width}×${result.height})`,
    );
  } catch (err) {
    log.error("Could not merge those PSDs:", err);
  } finally {
    progress.close();
  }
}

/**
 * What to call the merged file.
 *
 * The back-most source's name, which is the thing the rest was built around
 * nine times in ten — a wall with a roof and a door over it merges to `wall`,
 * not to `merged-m2k9f1`. Rust takes the first free name from it, so a second
 * merge of the same subject is `wall-2` rather than a file written over one
 * still standing on the grid, and the inspector renames it in one field if the
 * guess was wrong.
 */
function mergedName(placements: readonly Placement[]): string {
  return placements[0]?.psdKey ?? "merged";
}
