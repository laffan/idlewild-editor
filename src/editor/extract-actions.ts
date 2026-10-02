/**
 * **Extract**: layers picked off the canvas, moved into a PSD of their own.
 *
 * A merge that takes *files* is `merge-actions.ts` and this takes **layers**.
 * A marquee catches placements, and a placement is one layer of one PSD — so
 * a drag across the canvas can perfectly well hold the walls of one building,
 * two layers of a second and one of a third. What those have in common is
 * usually the thing you now want to be a file: the shadows off five houses,
 * the snow off a hillside, the one wall you drew in the wrong document.
 *
 * **It is a merge and a set of deletions**, in that order, and both halves
 * matter. Writing the new file is exactly what a merge does, so it goes
 * through the same `psd.merge` and lands with the same anchor arithmetic —
 * `merge-actions.ts` holds the argument for why a composition anchors on its
 * middle. Then each source file is rewritten without the layers that left,
 * because a merge deliberately leaves its sources alone and that is the wrong
 * answer here: extract a roof and leave it in the file it came from, and the
 * artwork is in the project twice with nothing on screen to say so. See
 * `src-tauri/src/psd_extract.rs`.
 *
 * **The file changes, so every placement of it does.** A PSD placed twice on
 * the canvas is one file: taking a layer out of it takes that layer out of
 * both, and the second one is reconciled by the reload rather than left
 * drawing a texture that is no longer exported. That is the honest behaviour
 * and it is what makes the button dangerous enough to say what it takes.
 *
 * **A file with nothing left is left alone.** Rust answers `emptied` for one
 * every placeable layer was taken from and writes nothing: a PSD with no
 * layers is not a file, another scene may be drawing this one, and Merge
 * already set the precedent that a source survives what is done to its
 * placements. The console says which files that happened to.
 */

import { sourceScale } from "../lib/print";
import {
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
import { unitsInDrawOrder } from "../lib/units";
import type { DocStore } from "../lib/doc-store";
import type { Placement, Selection } from "../lib/types";
import type { MergeDeps } from "./merge-actions";
import * as log from "../lib/log";

/** What Extract needs beyond what a merge does. */
export interface ExtractDeps extends MergeDeps {
  /**
   * A source file has been rewritten: put the canvas and the inspector back
   * in step with it.
   *
   * The same call the inspector's own layer editor makes after a rewrite —
   * `PsdFileActions.applyLayers` — because it is the same event: the file on
   * disk has a different stack from the one the document was built against.
   */
  onSourceRewritten: (key: string, manifest: string) => Promise<void>;
}

/**
 * The placements a selection names, back-first.
 *
 * Draw order rather than document order, for the reason a merge's is: the new
 * file's stack is what its composite will be read from, and on an isometric
 * object layer those two differ. Within one placed PSD the document's order
 * *is* the file's stack, so the members of a unit keep the order they are
 * stored in.
 *
 * Exported for the test, like `mergeOrder`: everything about this that can be
 * wrong without looking wrong is in the ordering.
 */
export function extractOrder(
  store: DocStore,
  layerId: string,
  ids: readonly string[],
  isometric: boolean,
): Placement[] {
  const layer = store.layer(layerId);
  if (!layer) return [];
  const wanted = new Set(ids);
  return unitsInDrawOrder(layer, isometric)
    .flat()
    .filter((placement) => wanted.has(placement.id));
}

/** The placements a selection names, in no particular order. */
export function selectedPlacements(
  store: DocStore,
  selection: Selection | null,
): { layerId: string; placements: Placement[] } | null {
  if (!selection) return null;
  if (selection.kind !== "placement" && selection.kind !== "placements") {
    return null;
  }
  const layer = store.layer(selection.layerId);
  if (!layer) return null;
  const ids = new Set(
    selection.kind === "placements" ? selection.ids : [selection.placementId],
  );
  const placements = layer.placements.filter((p) => ids.has(p.id));
  return placements.length ? { layerId: selection.layerId, placements } : null;
}

/**
 * Whether extracting this selection would actually take anything out.
 *
 * What decides whether the button is offered at all, and the rule is one
 * sentence: **something has to be left behind**. A selection holding every
 * placed layer of every file it touches is a selection Merge already
 * describes — it would write the same new file and leave the same sources
 * untouched, because a file with nothing left is left alone — so offering
 * Extract there would be two buttons for one outcome under two names.
 *
 * Asked of the whole document rather than of the layer, because a file is the
 * project's: a PSD placed on Foreground and again on Background keeps its
 * Background layers through an extraction from Foreground, and that *is*
 * something left behind.
 */
export function extractLeavesSomething(
  store: DocStore,
  placements: readonly Placement[],
): boolean {
  if (placements.length === 0) return false;
  const keys = new Set(placements.map((p) => p.psdKey));
  const taken = new Set(placements.map((p) => `${p.psdKey}\u0000${p.layerPath}`));
  for (const layer of store.allLayers) {
    for (const placement of layer.placements) {
      if (!keys.has(placement.psdKey)) continue;
      if (!taken.has(`${placement.psdKey}\u0000${placement.layerPath}`)) return true;
    }
  }
  return false;
}

/** What the button says it will take. */
export function describeExtract(placements: readonly Placement[]): string {
  const n = placements.length;
  const keys = new Set(placements.map((p) => p.psdKey)).size;
  const layers = `${n} ${n === 1 ? "layer" : "layers"}`;
  return keys > 1 ? `${layers} from ${keys} PSDs` : layers;
}

/**
 * Write the selected layers out as a PSD, and take them out of the files they
 * came from.
 *
 * One undo step over the document. The *files* are not in it and cannot be —
 * undo walks `GameDoc`, and a rewritten PSD is a rewritten PSD — so what a
 * step back gives you is the placements as they were, standing on files that
 * no longer hold those layers. That is the same bargain every conversion in
 * this editor makes with the pipeline, and the reason the button names what
 * it takes before it is pressed.
 */
export async function extractSelection(deps: ExtractDeps): Promise<void> {
  const { store, grid } = deps;
  const scene = deps.scene();
  const chosen = selectedPlacements(store, deps.selection());
  if (!scene || !chosen) {
    log.warn("Extract needs some PSD layers selected");
    return;
  }

  const placements = extractOrder(
    store,
    chosen.layerId,
    chosen.placements.map((p) => p.id),
    grid.projection === "isometric",
  );
  const box = unionRect(placements);
  if (!box || box.width <= 0 || box.height <= 0) {
    log.warn("Those layers have no artwork to extract");
    return;
  }

  // The same fixed point a merge takes, and for the same reason: what comes
  // out is a composition with its own extent rather than one thing standing
  // anywhere, so the honest anchor is its middle. See `merge-actions.ts`.
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
    left: (placement.x - box.x) * sourceScale(),
    top: (placement.y - box.y) * sourceScale(),
    width: placement.width * sourceScale(),
    height: placement.height * sourceScale(),
  }));

  const progress = openPsdProgress(
    "Extracting",
    describeExtract(placements),
    "Reading the files…",
  );

  try {
    const result = await psd.merge(
      deps.projectId,
      extractedName(placements),
      Math.max(1, Math.round(box.width * sourceScale())),
      Math.max(1, Math.round(box.height * sourceScale())),
      parts,
      scaleMarks(
        {
          ...(grid.snaps
            ? marksForCells(grid, footprint.cells, anchor, art)
            : marksForBox(grid, box, anchor)),
          margin: psdMargin(grid),
        },
        sourceScale(),
      ),
    );

    // The new file exists, so the originals can go — and the document comes
    // first, because reloading a rewritten source reconciles it against what
    // the document says and a placement of a layer that has just left the
    // file would be a placement asking for artwork nothing exports.
    deps.focusLayer(chosen.layerId);
    store.history.begin();
    try {
      for (const placement of placements) {
        store.removePlacement(chosen.layerId, placement.id);
      }
      pruneLayerGroups(store, chosen.layerId);

      await progress.stage("Taking them out of their files…");
      await dropFromSources(deps, placements, progress);

      await progress.stage("Placing the new PSD…");
      await scene.placePsd(result.key, result.manifest, anchor, IMPORT_SCALE);
    } finally {
      store.history.end();
    }
    deps.redrawLayers();
    deps.onMerged?.();
    log.info(
      `${describeExtract(placements)} → ${result.key}.psd ` +
        `(${result.width}×${result.height})`,
    );
  } catch (err) {
    log.error("Could not extract those layers:", err);
  } finally {
    progress.close();
  }
}

/**
 * Rewrite each source file without the layers that left it.
 *
 * One call per **file** rather than per layer: a rewrite re-parses the whole
 * PSD, so three roofs out of one file is one job rather than three, and the
 * indices a second call would be named against have moved by then anyway.
 *
 * A failure here is logged and stepped over rather than thrown. By this point
 * the new file is written and the placements are gone, so giving up would
 * leave the project further from what was asked for than carrying on does —
 * and the one thing that goes wrong is a file the artwork is still in, which
 * is a thing somebody can see and fix.
 */
async function dropFromSources(
  deps: ExtractDeps,
  placements: readonly Placement[],
  progress: { stage: (text: string) => Promise<void> },
): Promise<void> {
  const byKey = new Map<string, string[]>();
  for (const placement of placements) {
    const held = byKey.get(placement.psdKey) ?? [];
    if (!held.includes(placement.layerPath)) held.push(placement.layerPath);
    byKey.set(placement.psdKey, held);
  }

  for (const [key, paths] of byKey) {
    await progress.stage(`Rewriting ${key}.psd…`);
    try {
      const taken = await psd.dropLayers(deps.projectId, key, paths);
      if (taken.manifest === null) {
        log.info(
          `${key}.psd had nothing left to place, so the file is unchanged — ` +
            "it is still in the project and Export Assets still offers it.",
        );
        continue;
      }
      await deps.onSourceRewritten(key, taken.manifest);
      log.info(`${key}.psd lost ${paths.length} of its layers`);
    } catch (err) {
      log.error(`Could not take those layers out of ${key}.psd:`, err);
    }
  }
}

/**
 * What to call the extracted file.
 *
 * The back-most source's key with what was taken after it — `hut-roof` — which
 * reads as *the roof out of the hut* and is the thing anybody would have typed.
 * A selection spanning several files takes the first one's name and the count,
 * because there is no one subject to name. Rust takes the first free name from
 * whatever it is given, so a second extraction of the same subject is `-2`
 * rather than a file written over one still standing on the grid.
 */
function extractedName(placements: readonly Placement[]): string {
  const first = placements[0];
  if (!first) return "extracted";
  const keys = new Set(placements.map((p) => p.psdKey));
  if (keys.size > 1) return `${first.psdKey}-parts`;
  if (placements.length === 1) return `${first.psdKey}-${last(first.layerPath)}`;
  return `${first.psdKey}-layers`;
}

/** A layer path's own name, which is its last segment. */
function last(layerPath: string): string {
  return layerPath.split("/").pop() ?? layerPath;
}
