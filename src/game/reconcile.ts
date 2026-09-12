/**
 * Bringing the document back in line with a manifest that has just been
 * rewritten.
 *
 * Split out of `psd-loader.ts`, which imports Phaser for its side of the
 * loading contract: none of this touches a canvas — it is the document and a
 * parsed manifest, and nothing else — so keeping it apart is what lets the
 * awkward cases be tested without one. The same bargain `instance.ts` and
 * `resize.ts` already make.
 */

import type { DocStore } from "../lib/doc-store";
import {
  anchorImpliedBy,
  anchorOffset,
  placeableLayers,
  positionFrom,
  stackOrder,
  type Manifest,
} from "../lib/manifest";
import type { Grid } from "../lib/grid";
import type { Placement, Point } from "../lib/types";
import * as log from "../lib/log";

/**
 * Bring the document's placements for one key back in line with a manifest
 * that has just been rewritten by a re-import.
 *
 * Three things can have happened to a layer since the last parse, and all
 * three are answered here: it is still there and its placement is revised, it
 * has gone and its placement goes with it, or it is new and gets a placement
 * of its own — see `adoptNewLayers`.
 *
 * A placement whose layer is gone from the new file is removed: there is
 * nothing left to draw, and a placement that can never render is worse than
 * an honest gap.
 *
 * Everything else keeps two things. Its size *relative to* what the manifest
 * exported, so a deliberately shrunk image stays shrunk against new artwork.
 * And its grid space — the position is recomputed from the anchor cell it
 * was placed on and the PSD's own anchor mark, rather than being left where
 * it was. That is what lets an artist resize the canvas, move the artwork
 * inside it, or redraw the whole thing: as long as the mark stays on the
 * spot that should sit on that grid space, the artwork comes back lined up.
 *
 * And when the mark is *gone* — a file flattened on save, an edit that came
 * home as a picture — nothing moves at all. See `anchorFor`.
 */
export function reconcilePlacements(
  store: DocStore,
  grid: Grid,
  key: string,
  manifest: Manifest,
  renames?: ReadonlyMap<string, string>,
): void {
  const anchor = anchorFor(store, grid, key, manifest, renames);
  reviseExisting(store, grid, key, manifest, anchor, renames);
  adoptNewLayers(store, grid, key, manifest, anchor);
}

/**
 * The point in the canvas that goes on the placement's grid space.
 *
 * The `P | anchor` mark, when the file still has one. It usually does: a PSD
 * picked back out of Files is the bytes that went out, mark and all, and an
 * artist who resizes the canvas or moves the artwork moves the dot with it,
 * which is the whole design.
 *
 * A file can come back **without** one, though, and that is where this earns
 * its keep. Flatten a PSD on save and the mark goes with every other layer;
 * bring the edit home through the photo library, or as a PNG, and what lands
 * is a picture with no marks in it at all — `reimport` writes none, because
 * the file coming back is supposed to be carrying its own.
 *
 * `anchorOffset` answers that with the canvas centre, which is the only
 * defensible guess about a file nobody has placed and a bad one about a file
 * already standing on the grid: it moves the artwork by however far the
 * centre is from where the mark was. On an extrusion that is most of a grid
 * space, because the margin is not symmetric about the anchor — the solid
 * reaches up and the footprint stays down — which is the "it no longer
 * matches the grid" this is here to stop.
 *
 * So a file with no mark is pinned by **what is already on the canvas**: the
 * anchor it would have needed for the first placement that still resolves to
 * land where that placement is standing now. Every other layer is positioned
 * against the same point, which keeps the file's own arrangement — a layer
 * added in Photoshop still arrives beside the one it was drawn beside — and
 * moves nothing that was already right.
 */
function anchorFor(
  store: DocStore,
  grid: Grid,
  key: string,
  manifest: Manifest,
  renames?: ReadonlyMap<string, string>,
): Point {
  if (manifest.anchor) return manifest.anchor;

  for (const layer of store.layers) {
    for (const placement of layer.placements) {
      if (placement.psdKey !== key) continue;
      const entry = manifest.all.find(
        (l) => l.path === resolvePath(manifest, placement, renames),
      );
      if (!entry) continue;
      log.warn(
        `${key}.psd came back with no "P | anchor" — holding it where it is. ` +
          "Bring a PSD home rather than a flattened copy to keep the mark.",
      );
      return anchorImpliedBy(
        grid.cellToWorld(placement.anchor),
        placement,
        entry,
        scaleXOf(placement),
        scaleYOf(placement),
      );
    }
  }
  return anchorOffset(manifest);
}

/** Where a placement's layer has got to in the new file, if it is still there. */
function resolvePath(
  manifest: Manifest,
  placement: Placement,
  renames?: ReadonlyMap<string, string>,
): string {
  const renamed = renames?.get(placement.layerPath) ?? placement.layerPath;
  return repointed(manifest, renamed) ?? renamed;
}

function scaleXOf(placement: Placement): number {
  return placement.width / (placement.naturalWidth || placement.width);
}

function scaleYOf(placement: Placement): number {
  return placement.height / (placement.naturalHeight || placement.height);
}

/**
 * Whether a placement already stands for a top-level layer: its own path, or
 * one nested under it.
 */
function standsFor(taken: ReadonlySet<string>, path: string): boolean {
  if (taken.has(path)) return true;
  const inside = `${path}/`;
  for (const held of taken) {
    if (held.startsWith(inside)) return true;
  }
  return false;
}

/**
 * Repoint a placement that is standing on a layer with no pixels.
 *
 * Placing a point or a zone yields an empty group — `placeableLayers` refuses
 * to make one for exactly that reason — so a placement pointing at one draws
 * nothing at all. It is not a hypothetical: early builds wrote `layerPath:
 * "root"` and the migration repointed it at the file's *first* layer, which
 * for everything this editor generates is one of the two orienting marks
 * drawn over the artwork.
 *
 * Left alone it is worse than invisible, because the two halves of
 * reconciliation then disagree about it: revision finds the mark in the
 * manifest and keeps the placement, while adoption looks only at the layers
 * that can be placed, sees nothing standing on the artwork, and adds a second
 * placement for it. One re-parse, one extra row in the layer list, and
 * nothing new on the canvas.
 */
function repointed(manifest: Manifest, path: string): string | null {
  const entry = manifest.all.find((l) => l.path === path);
  if (!entry || (entry.category !== "point" && entry.category !== "zone")) {
    return null;
  }
  const real = placeableLayers(manifest)[0];
  return real && real.path !== path ? real.path : null;
}

/**
 * Place the layers that have appeared since the last parse.
 *
 * Adding a layer in Photoshop and re-parsing used to change nothing anyone
 * could see: reconciliation only ever *revised* the placements the document
 * already had, so a layer with no placement pointing at it was parsed,
 * exported, listed in the log — and never drawn. The file said one thing and
 * the canvas another.
 *
 * A new layer is placed the way its siblings were: on their document layer,
 * anchored to their grid space, at their scale, and positioned through the
 * PSD's own anchor mark like everything else on that key. That means it lands
 * exactly where the artist drew it relative to the artwork already there,
 * which is the only placement that can be inferred honestly.
 *
 * With no sibling there is nothing to infer from — no layer, no grid space,
 * no scale — so nothing is adopted. That only happens when every placement on
 * the key has been deleted, and inventing one for a file nobody has placed
 * would be worse than leaving it alone.
 */
function adoptNewLayers(
  store: DocStore,
  grid: Grid,
  key: string,
  manifest: Manifest,
  anchor: Point,
): void {
  const taken = new Set<string>();
  let sibling: { layerId: string; placement: Placement } | null = null;
  for (const layer of store.layers) {
    for (const placement of layer.placements) {
      if (placement.psdKey !== key) continue;
      taken.add(placement.layerPath);
      sibling ??= { layerId: layer.id, placement };
    }
  }
  if (!sibling) return;

  const scale = scaleXOf(sibling.placement);
  const cell = sibling.placement.anchor;
  const world = grid.cellToWorld(cell);

  const stack = stackOrder(manifest);
  for (const entry of placeableLayers(manifest)) {
    // Its own path, or one nested under it: a group whose child is placed is
    // not a layer that has appeared since the last parse, and adopting it
    // would put a second placement over the one already there.
    if (standsFor(taken, entry.path)) continue;
    const width = entry.width || manifest.width;
    const height = entry.height || manifest.height;
    const at = positionFrom(world, anchor, entry, scale, scale);
    store.addPlacement(sibling.layerId, {
      psdKey: key,
      layerPath: entry.path,
      x: at.x,
      y: at.y,
      width: width * scale,
      height: height * scale,
      naturalWidth: width,
      naturalHeight: height,
      anchor: cell,
      // Part of the same placed thing as the layers it arrived beside, so
      // the PSD still moves as one.
      instance: sibling.placement.instance,
      order: stack.get(entry.path) ?? 0,
    });
    log.info(`${key}.psd gained "${entry.path}" — placed on the same layer`);
  }
}

function reviseExisting(
  store: DocStore,
  grid: Grid,
  key: string,
  manifest: Manifest,
  anchor: Point,
  renames?: ReadonlyMap<string, string>,
): void {
  // Re-read from the file rather than kept: reordering a PSD's layers in the
  // inspector rewrites the stack, and it is the one edit whose whole visible
  // effect is which layer is now on top.
  const stack = stackOrder(manifest);

  for (const layer of store.layers) {
    for (const placement of [...layer.placements]) {
      if (placement.psdKey !== key) continue;

      // A layer renamed in the inspector is the same layer under a new path.
      // Without the map it looks exactly like one that has gone, and the
      // placement would be dropped for a change of one character.
      let path = renames?.get(placement.layerPath) ?? placement.layerPath;

      // A placement standing on one of the orienting marks draws nothing and
      // leaves the artwork looking unplaced — see `repointed`.
      const better = repointed(manifest, path);
      if (better) {
        log.info(
          `${key}.psd — "${path}" has no pixels; moving that placement to "${better}"`,
        );
        path = better;
      }

      const entry = manifest.all.find((l) => l.path === path);
      if (!entry) {
        log.warn(
          `${key}.psd no longer has "${placement.layerPath}" — removing that placement`,
        );
        store.removePlacement(layer.id, placement.id);
        continue;
      }

      const scaleX = scaleXOf(placement);
      const scaleY = scaleYOf(placement);
      const width = entry.width || manifest.width;
      const height = entry.height || manifest.height;

      const world = grid.cellToWorld(placement.anchor);
      const at = positionFrom(world, anchor, entry, scaleX, scaleY);
      store.updatePlacement(layer.id, placement.id, {
        layerPath: path,
        x: at.x,
        y: at.y,
        width: width * scaleX,
        height: height * scaleY,
        naturalWidth: width,
        naturalHeight: height,
        order: stack.get(path) ?? placement.order ?? 0,
      });
    }
  }
}
