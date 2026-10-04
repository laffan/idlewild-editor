/**
 * **Add anchor layer** — the way out of a "No anchor" warning.
 *
 * A PSD pasted in from somewhere else has no `P | anchor`, so an object layer
 * warns that an edit to it will not come back on the same grid space. The
 * button writes the editor's own dot into the file (`psd_layers::add_anchor`)
 * on the spot the placement is **already** anchored to: the point
 * reconciliation would have implied for it — `anchorImpliedBy`, from where
 * the placement stands now — so giving the file a mark moves nothing on the
 * canvas, and from then on a round trip through Photoshop lines up on it.
 *
 * That point is in the manifest's pixels, and the dot goes in the file's.
 * They differ by the two things that make a manifest bigger than its file:
 * a print project's screen copy (`sourceScale() / EXPORT_SCALE`) and Pixel
 * Art Rescale.
 */

import type { DocStore } from "../lib/doc-store";
import type { Grid } from "../lib/grid";
import { psd } from "../lib/ipc";
import * as log from "../lib/log";
import { parseManifest } from "../lib/manifest";
import { anchorImpliedBy } from "../lib/placing";
import { sourceScale } from "../lib/print";
import type { Placement, Point } from "../lib/types";
import { EXPORT_SCALE } from "./import-anchor";
import { pixelScaleOf } from "./psd-pixel-scale";

/** Where a placement's mark is standing in the world now. */
export function anchorWorld(grid: Grid, placement: Placement): Point {
  const sx = placement.width / (placement.naturalWidth || placement.width);
  const sy = placement.height / (placement.naturalHeight || placement.height);
  const from = placement.fromAnchor;
  return from
    ? { x: placement.x - from.x * sx, y: placement.y - from.y * sy }
    : grid.cellToWorld(placement.anchor);
}

/** The file pixel to put the dot on, from a manifest point. */
export function filePixel(point: Point, key: string): Point {
  const per = sourceScale() / EXPORT_SCALE / pixelScaleOf(key);
  return { x: Math.round(point.x * per), y: Math.round(point.y * per) };
}

export async function addAnchorLayer(
  deps: {
    projectId: string;
    store: DocStore;
    grid: Grid;
    applyManifest: (key: string, manifest: string) => Promise<void>;
  },
  key: string,
): Promise<void> {
  try {
    const manifest = parseManifest(await psd.manifest(deps.projectId, key));
    let at: Point | null = null;
    for (const layer of deps.store.layers) {
      for (const placement of layer.placements) {
        if (at || placement.psdKey !== key) continue;
        const entry = manifest.all.find((l) => l.path === placement.layerPath);
        if (!entry) continue;
        const sx = placement.width / (placement.naturalWidth || placement.width);
        const sy = placement.height / (placement.naturalHeight || placement.height);
        at = anchorImpliedBy(anchorWorld(deps.grid, placement), placement, entry, sx, sy);
      }
    }
    // Nothing placed to read it off: the middle, where an import puts it.
    const point = filePixel(at ?? { x: manifest.width / 2, y: manifest.height / 2 }, key);
    const next = await psd.addAnchor(deps.projectId, key, point.x, point.y);
    await deps.applyManifest(key, next);
    log.info(`${key}.psd has a P | anchor now — edits to it will come back on this space`);
  } catch (err) {
    log.error(`Could not add an anchor to ${key}.psd:`, err);
  }
}
