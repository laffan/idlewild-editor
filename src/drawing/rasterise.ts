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

import { psd, toBase64 } from "../lib/ipc";
import type { AnchorMarks, ImportResult } from "../lib/ipc";
import type { Stroke } from "../lib/types";
import { createAtlasCache, type AtlasCache } from "./atlas";
import { strokesBox } from "./geometry";
import { isErasing, renderStroke } from "./render";
import type { Bounds } from "./types";

const PADDING = 8;

export interface Raster {
  rgba: Uint8ClampedArray;
  /**
   * What the session's erasers take *out*, over the same rectangle — absent
   * unless it was asked for and something actually erased.
   *
   * Only the alpha matters. `rgba` above is already correct on its own for
   * anything drawn on a clear ground: an erasing stroke rendered into a
   * transparent canvas removes the ink laid before it and there is nothing
   * else there to remove. It stops being enough the moment the pixels are
   * going to be composited over **artwork that already exists**, which is
   * PSD Edit mode — see `editor/psd-edit.ts` and `psd_paint::cut`.
   */
  erase?: Uint8ClampedArray;
  width: number;
  height: number;
  bounds: Bounds;
}

/** What else a raster can be asked for. */
export interface RasterOptions {
  /**
   * Also render the coverage the erasing strokes would take out.
   *
   * Only PSD Edit mode wants it, and only because its pixels land on top of a
   * layer that already has artwork in it. A conversion draws on a clear
   * ground, so its erasers have nothing to reach past the session's own ink.
   */
  eraseMask?: boolean;
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
  options: RasterOptions = {},
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

  const cache = atlas ?? createAtlasCache();
  const draw = (
    into: readonly Stroke[],
    each: (stroke: Stroke) => Stroke,
  ): Uint8ClampedArray | null => {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return null;
    ctx.scale(scale, scale);
    ctx.translate(-bounds.x, -bounds.y);
    for (const stroke of into) renderStroke(ctx, each(stroke), cache);
    return ctx.getImageData(0, 0, width, height).data;
  };

  const rgba = draw(strokes, (stroke) => stroke);
  const erasing = options.eraseMask ? strokes.filter(isErasing) : [];
  // Laid **on** rather than taken out, which is the mask: what a `1 - a` is
  // wanted of. Two erase strokes that cross compose to the same thing either
  // way round, because `1 - (a₁ + a₂(1 - a₁))` is `(1 - a₁)(1 - a₂)` — the
  // product rubbing twice would have left. See `psd_paint::cut`.
  const erase = erasing.length > 0 ? draw(erasing, asCoverage) : null;
  if (!atlas) cache.destroy();
  if (!rgba) return null;

  return {
    rgba,
    ...(erase ? { erase } : {}),
    width,
    height,
    bounds,
  };
}

/**
 * An erasing stroke as the mark it *would have drawn*.
 *
 * The same geometry, the same brush, the same colour opacity — so a soft
 * eraser makes a soft mask — laid down normally instead of subtracted. The
 * mode is flattened to "ink" for the two that mean something other than
 * coverage: "erase" is the legacy spelling of this very flag, and a highlight
 * multiplies, which against an empty canvas is not what it takes away.
 *
 * `points` is the same array, deliberately: `streamlineFor` caches on its
 * identity, so the mask is stamped along exactly the path the erase was.
 */
function asCoverage(stroke: Stroke): Stroke {
  return {
    ...stroke,
    erase: false,
    mode: stroke.mode === "erase" || stroke.mode === "highlight" ? "ink" : stroke.mode,
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
    /**
     * Called before each of the two long synchronous steps, and awaited.
     *
     * Both of them block this thread for as long as they take — a sketch of
     * two megapixels is a few hundred milliseconds of stamping and as much
     * again of encoding, and several times that on an iPad — so a caller
     * putting words on screen has to be given the chance to paint them
     * *first*. Hence awaited rather than called: see `editor/psd-progress.ts`.
     */
    stage?: (line: string) => Promise<void> | void;
  } = {},
): Promise<ImportResult | null> {
  await options.stage?.("Drawing the strokes…");
  const raster = rasteriseStrokes(strokes, options.atlas, options.scale);
  if (!raster) return null;
  await options.stage?.("Packing the pixels…");
  const rgbaBase64 = toBase64(raster.rgba);
  await options.stage?.("Writing the PSD…");
  return psd.fromRgba(
    projectId,
    name,
    raster.width,
    raster.height,
    rgbaBase64,
    options.marks?.(raster),
  );
}
