/**
 * Strokes → pixels → PSD.
 *
 * The first bridge out of the drawing layer: the user sketches, lassoes a
 * group of strokes, and hands them to a layer as a PSD to flesh out
 * elsewhere. It goes through the same Rust path as any imported image, so a
 * sketch and a dropped PNG reach psd-to-phaser identically.
 *
 * It renders through the engine's own stamping rather than a stand-in path,
 * which is Hush's `stroke-paint.ts` doing its job: what lands in the PSD is
 * the ink that was on screen, brush texture and pressure taper included.
 */

import { psd } from "../lib/ipc";
import type { AnchorMarks, ImportResult } from "../lib/ipc";
import type { Stroke } from "../lib/types";
import { createAtlasCache, type AtlasCache } from "./atlas";
import { strokesBox } from "./geometry";
import { renderStroke } from "./render";
import type { Bounds } from "./types";

const PADDING = 8;

export interface Raster {
  rgba: Uint8ClampedArray;
  width: number;
  height: number;
  bounds: Bounds;
}

/**
 * Render strokes to RGBA on a transparent ground, cropped to their bounds.
 *
 * `atlas` is the live layer's cache when there is one — its brush PNGs have
 * already decoded, so the export looks like the canvas rather than like the
 * procedural fallback.
 *
 * `scale` is pixels per world unit. Above 1 the ink is re-stamped at that
 * size rather than drawn small and enlarged, so a doubled export is genuinely
 * twice the detail — see `EXPORT_SCALE` in editor/import-anchor.ts for why a
 * conversion wants that.
 *
 * `bounds` comes back in **world** units, padding included: what it locates
 * is the artwork against the grid, not a pixel against a canvas.
 */
export function rasteriseStrokes(
  strokes: readonly Stroke[],
  atlas?: AtlasCache,
  scale = 1,
): Raster | null {
  const box = strokesBox(strokes);
  if (!box) return null;

  const bounds = {
    x: box.x - PADDING,
    y: box.y - PADDING,
    width: box.width + PADDING * 2,
    height: box.height + PADDING * 2,
  };
  const width = Math.max(1, Math.ceil(bounds.width * scale));
  const height = Math.max(1, Math.ceil(bounds.height * scale));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;

  const cache = atlas ?? createAtlasCache();
  ctx.scale(scale, scale);
  ctx.translate(-bounds.x, -bounds.y);
  for (const stroke of strokes) renderStroke(ctx, stroke, cache);
  if (!atlas) cache.destroy();

  return {
    rgba: ctx.getImageData(0, 0, width, height).data,
    width,
    height,
    bounds,
  };
}

/**
 * Turn a selection of strokes into a processed PSD in the project, ready to
 * place. Returns null when the selection has nothing to draw.
 *
 * `marks` describes the grid the sketch was drawn over, which the caller
 * builds because the grid's projection lives in the editor. Without it the
 * PSD arrives with no orienting marks at all, and whoever opens it to paint
 * over the sketch has nothing to line the artwork up against.
 */
export async function strokesToPsd(
  projectId: string,
  name: string,
  strokes: readonly Stroke[],
  options: {
    atlas?: AtlasCache;
    scale?: number;
    /** Built from `raster.bounds`, so ask for those first. */
    marks?: (raster: Raster) => AnchorMarks;
  } = {},
): Promise<ImportResult | null> {
  const raster = rasteriseStrokes(strokes, options.atlas, options.scale);
  if (!raster) return null;
  return psd.fromRgba(
    projectId,
    name,
    raster.width,
    raster.height,
    toBase64(raster.rgba),
    options.marks?.(raster),
  );
}

function toBase64(bytes: Uint8ClampedArray): string {
  let binary = "";
  const chunk = 0x8000;
  const view = new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let i = 0; i < view.length; i += chunk) {
    binary += String.fromCharCode(...view.subarray(i, i + chunk));
  }
  return btoa(binary);
}
