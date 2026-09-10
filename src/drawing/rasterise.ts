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
import type { ImportResult } from "../lib/ipc";
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
 */
export function rasteriseStrokes(
  strokes: readonly Stroke[],
  atlas?: AtlasCache,
): Raster | null {
  const box = strokesBox(strokes);
  if (!box) return null;

  const width = Math.max(1, Math.ceil(box.width) + PADDING * 2);
  const height = Math.max(1, Math.ceil(box.height) + PADDING * 2);

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;

  const cache = atlas ?? createAtlasCache();
  ctx.translate(PADDING - box.x, PADDING - box.y);
  for (const stroke of strokes) renderStroke(ctx, stroke, cache);
  if (!atlas) cache.destroy();

  return {
    rgba: ctx.getImageData(0, 0, width, height).data,
    width,
    height,
    bounds: { x: box.x - PADDING, y: box.y - PADDING, width, height },
  };
}

/**
 * Turn a selection of strokes into a processed PSD in the project, ready to
 * place. Returns null when the selection has nothing to draw.
 */
export async function strokesToPsd(
  projectId: string,
  name: string,
  strokes: readonly Stroke[],
  atlas?: AtlasCache,
): Promise<ImportResult | null> {
  const raster = rasteriseStrokes(strokes, atlas);
  if (!raster) return null;
  return psd.fromRgba(
    projectId,
    name,
    raster.width,
    raster.height,
    toBase64(raster.rgba),
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
