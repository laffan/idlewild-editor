/**
 * Turning something off the clipboard into a placed PSD.
 *
 * A paste is an import, so it takes the same route every other import takes —
 * bytes to Rust, a PSD written, psd-to-json over it, a placement anchored on
 * a grid space — and it carries the same two orienting marks. Nothing about
 * a paste should make the file it produces different in kind from one that
 * arrived through Add Image, because a week later nobody remembers which.
 *
 * What a paste has to work out for itself is *where it landed*, since there
 * was no grid selection behind it. The artwork goes in the middle of the
 * view, and the spaces it covers there become its footprint.
 */

import { Grid } from "../lib/grid";
import { psd } from "../lib/ipc";
import type { AnchorMarks } from "../lib/ipc";
import * as log from "../lib/log";
import type { Cell, Rect } from "../lib/types";
import {
  EXPORT_SCALE,
  footprintForBox,
  IMPORT_SCALE,
  marksForBox,
  marksForCells,
  scaleMarks,
} from "./import-anchor";

/** What the editor hands this: somewhere to measure against, and to place in. */
export interface PasteTarget {
  grid: Grid;
  /** The grid space in the middle of the view. */
  centreCell: () => Cell;
  placePsd: (
    key: string,
    manifest: string,
    at: Cell,
    scale: number,
  ) => Promise<void>;
}

/**
 * Import a pasted file and place it.
 *
 * The size has to be known *before* the import, because the marks travel with
 * it and they describe where the artwork sits — so the image is decoded here
 * first. A PSD cannot be decoded that way and is not marked at all: it
 * arrives as its author built it, layer stack and all, which is the same
 * thing importing a `.psd` from Files does. Adding our two layers to it would
 * mean rewriting someone else's file.
 */
export async function importPasted(
  projectId: string,
  target: PasteTarget,
  name: string,
  file: File,
): Promise<void> {
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const size = await imageSize(file);
    const at = target.centreCell();
    const plan = size ? planFor(target.grid, at, size) : null;

    const result = await psd.importBytes(
      projectId,
      name,
      toBase64(bytes),
      plan?.marks,
    );
    log.info(`Pasted ${result.key} (${result.width}×${result.height})`);
    await target.placePsd(result.key, result.manifest, plan?.anchor ?? at, IMPORT_SCALE);
  } catch (err) {
    log.error("Could not paste that:", err);
  }
}

/**
 * Where a pasted image of this size will sit, and what to mark under it.
 *
 * The artwork lands centred on the space in the middle of the view, at the
 * same half size every import lands at. `art` is sent rather than left to
 * Rust's default centring because the anchor a footprint hangs from is its
 * *top-left* space, which is only the middle of the footprint by accident —
 * so the artwork says where it goes rather than being centred on a corner.
 *
 * Marks are in the PSD's own pixels and the box is in world pixels, and an
 * import is displayed at half size, so the whole thing scales up by
 * `EXPORT_SCALE` on the way out — the same conversion a rasterised sketch
 * makes, for the same reason.
 */
export function planFor(
  grid: Grid,
  at: Cell,
  size: { width: number; height: number },
): { anchor: Cell; marks: AnchorMarks } {
  const centre = grid.cellToWorld(at);
  const box: Rect = {
    x: centre.x - (size.width * IMPORT_SCALE) / 2,
    y: centre.y - (size.height * IMPORT_SCALE) / 2,
    width: size.width * IMPORT_SCALE,
    height: size.height * IMPORT_SCALE,
  };

  // A grid that does not snap has one-pixel spaces, so asking which of them
  // this box covers would enumerate every pixel in it. There the box is the
  // space — which is what a selection in a blank project already is.
  if (!grid.snaps) {
    const anchor = grid.worldToCell({ x: box.x, y: box.y });
    return { anchor, marks: scaleMarks(marksForBox(grid, box, anchor), EXPORT_SCALE) };
  }

  const { cells, anchor } = footprintForBox(grid, box);
  const world = grid.cellToWorld(anchor);
  const marks = marksForCells(grid, cells, anchor, {
    x: box.x - world.x,
    y: box.y - world.y,
  });
  return { anchor, marks: scaleMarks(marks, EXPORT_SCALE) };
}

/**
 * The pixel size of a pasted image, or null for anything that is not one.
 *
 * `createImageBitmap` decodes whatever the browser decodes, which is every
 * raster format a paste can carry. A PSD is not one of them, and the null it
 * returns is what says "this file is already a document" — the same
 * conclusion Rust reaches from the `8BPS` signature, from the only evidence
 * each side has.
 */
async function imageSize(
  file: File,
): Promise<{ width: number; height: number } | null> {
  try {
    const bitmap = await createImageBitmap(file);
    const size = { width: bitmap.width, height: bitmap.height };
    bitmap.close();
    return size.width > 0 && size.height > 0 ? size : null;
  } catch {
    return null;
  }
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}
